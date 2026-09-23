/**
 * 天之灵 · 生产库只读通道（所有者）—— MongoDB 侧一次性配置脚本。
 *
 * 由 `setup-research-tunnel.sh` 以 **stdin** 注入容器内的 mongosh 执行（macOS/Linux 均可）：
 *   docker exec -i tzl_mongo mongosh -u <admin> -p <pwd> --authenticationDatabase admin \
 *     --quiet --file /dev/stdin < mongo-owner-readonly.js
 *
 * 脚本内以下占位符由安装脚本在管道中替换（不落盘、不进日志）：
 *   __DB_NAME__         业务库名（默认 tzl）
 *   __OWNER_DB_USER__   只读账号名（本次：research_ro_owner_01）
 *   __ROLE_NAME__       本通道专用只读角色名（不使用内置 read 角色）
 *   __OWNER_PWD__       一次性生成的随机口令（仅字母数字，避免转义问题）
 *
 * 设计约束（与实施单一致）：
 * - **两阶段**：先做全部只读预检，全部通过后才创建；任一目标对象已存在、
 *   或 7 个源集合 / 13 个已批准集合有缺失，都立即停止并报告（退出码 3）；
 * - **绝不删除**：脚本不调用 drop / dropRole / dropUser / deleteMany，也不修改任何业务数据；
 * - 7 个含敏感字段的集合只通过**只读视图**暴露，其余 13 个已批准集合直接授予 find/listIndexes；
 * - `user_ro` 使用**白名单投影**，只暴露 7 个路径，绝不投影整个 region；
 * - 不开启 profiler、不建索引、不修改任何现有业务账号。
 *
 * 已知限制（简化方案）：黑名单视图按“当前已审定的敏感字段”排除。
 * 这些集合将来新增字段时，必须重新检查并更新视图定义。
 */

const DB_NAME = '__DB_NAME__';
const OWNER_DB_USER = '__OWNER_DB_USER__';
const ROLE_NAME = '__ROLE_NAME__';
const OWNER_PWD = '__OWNER_PWD__';

/**
 * 7 个敏感集合 → 只读视图。
 * projection 与 `docs/research-data-sharing/方案与脱敏规则.md` 已审定的规则一致。
 * 目录的 legacy.* 子路径由 `legacy: 0` 整体覆盖（排除整个子树）。
 */
const VIEWS = [
  {
    name: 'user_ro',
    src: 'user',
    mode: 'whitelist',
    projection: {
      _id: 1,
      createdAt: 1,
      gender: 1,
      'region.countryCode': 1,
      'region.countryName': 1,
      'region.provinceCode': 1,
      'region.provinceName': 1,
    },
    note: '白名单：仅 _id/createdAt/gender + region 省级字段；市级及姓名字段永不出现',
  },
  {
    name: 'message_ro',
    src: 'message',
    mode: 'blacklist',
    projection: { mediaObjectKey: 0, mediaUrl: 0, legacy: 0 },
    note: '排除媒体素材键/URL 与历史迁移命名空间',
  },
  {
    name: 'conversation_ro',
    src: 'conversation',
    mode: 'blacklist',
    projection: { legacy: 0 },
    note: '排除历史迁移命名空间',
  },
  {
    name: 'agent_ro',
    src: 'agent',
    mode: 'blacklist',
    projection: {
      name: 0,
      realName: 0,
      avatar: 0,
      legacy: 0,
      customContext: 0,
      personaProfile: 0,
      voiceTimbreId: 0,
      pendingVoiceTimbreId: 0,
      voiceTimbreSelectedAt: 0,
      agentHomeGuideSeenAt: 0,
      agentProfileGuideSeenAt: 0,
    },
    note: '排除姓名/头像/自定义上下文/人格画像与声音素材标识',
  },
  {
    name: 'post_ro',
    src: 'post',
    mode: 'blacklist',
    projection: { images: 0, legacy: 0 },
    note: '排除图片对象与历史迁移命名空间',
  },
  {
    name: 'post_comment_ro',
    src: 'post_comment',
    mode: 'blacklist',
    projection: { legacy: 0 },
    note: '排除历史迁移命名空间',
  },
  {
    name: 'user_membership_ro',
    src: 'user_membership',
    mode: 'blacklist',
    projection: { sourceOrderId: 0, vipPlanId: 0 },
    note: '排除来源订单与套餐标识',
  },
];

/** 其余 13 个已批准集合：直接授予 find/listIndexes（不建视图）。 */
const DIRECT_COLLECTIONS = [
  'conversation_reply_turn',
  'conversation_emotion_state',
  'conversation_chat_import_item',
  'chat_trace',
  'agent_profile_fact',
  'agent_memory_fact',
  'agent_relationship_signal',
  'user_relative_profile',
  'user_relative_fact',
  'person_temporal_assertion',
  'person_temporal_profile',
  'memory_open_item',
  'memory_event_group',
];

const tzl = db.getSiblingDB(DB_NAME);
const admin = db.getSiblingDB('admin');

function exists(target) {
  try {
    return target() != null;
  } catch (error) {
    const message = String((error && error.message) || error);
    // mongosh 在对象不存在时抛 "not found"/"no such"；其它错误要如实抛出。
    if (/not found|no such|does not exist/i.test(message)) {
      return false;
    }
    throw error;
  }
}

/* ------------------------------------------------------- 阶段 1：只读预检 */

const failures = [];

const infos = tzl.getCollectionInfos({});
const byName = new Map();
for (const info of infos) {
  byName.set(info.name, info);
}

for (const view of VIEWS) {
  const existing = byName.get(view.name);
  if (existing && existing.type === 'view') {
    failures.push(`view already exists: ${view.name}`);
  } else if (existing) {
    failures.push(
      `name collision: ${view.name} already exists as a normal ${existing.type}`
    );
  }

  const source = byName.get(view.src);
  if (!source || source.type !== 'collection') {
    failures.push(`source collection missing: ${view.src} (needed by ${view.name})`);
  }
}

const missingDirect = DIRECT_COLLECTIONS.filter(name => {
  const info = byName.get(name);
  return !info || info.type !== 'collection';
});
for (const name of missingDirect) {
  failures.push(`approved collection missing: ${name} (must exist before installing)`);
}

if (exists(() => admin.getRole(ROLE_NAME))) {
  failures.push(`role already exists: ${ROLE_NAME}`);
}

if (exists(() => admin.getUser(OWNER_DB_USER))) {
  failures.push(`mongodb user already exists: ${OWNER_DB_USER}`);
}

print(`[preflight] database          : ${DB_NAME}`);
print(`[preflight] views to create   : ${VIEWS.length} (${VIEWS.map(v => v.name).join(', ')})`);
print(`[preflight] direct collections: ${DIRECT_COLLECTIONS.length}`);
print(`[preflight] role              : ${ROLE_NAME}`);
print(`[preflight] mongodb user      : ${OWNER_DB_USER}`);

if (failures.length > 0) {
  print('');
  print('[preflight] REFUSED — nothing was created or modified:');
  for (const failure of failures) {
    print(`  - ${failure}`);
  }
  print('');
  print('[preflight] 这是刻意的停止行为：本脚本不做任何删除或覆盖，请人工确认后再处理。');
  quit(3);
}

/* --------------------------------------------------------- 阶段 2：创建 */

for (const view of VIEWS) {
  tzl.createView(view.name, view.src, [{ $project: view.projection }]);
  print(`[create] view ${view.name} <- ${view.src} (${view.mode}) — ${view.note}`);
}

const privileges = VIEWS.map(view => ({
  resource: { db: DB_NAME, collection: view.name },
  actions: ['find'],
})).concat(
  DIRECT_COLLECTIONS.map(name => ({
    resource: { db: DB_NAME, collection: name },
    actions: ['find', 'listIndexes'],
  }))
);

admin.createRole({
  role: ROLE_NAME,
  roles: [],
  privileges,
});
print(
  `[create] role ${ROLE_NAME}: find on ${VIEWS.length} views + find/listIndexes on ${DIRECT_COLLECTIONS.length} collections`
);

admin.createUser({
  user: OWNER_DB_USER,
  pwd: OWNER_PWD,
  roles: [{ role: ROLE_NAME, db: 'admin' }],
});
print(`[create] mongodb user ${OWNER_DB_USER} bound to ${ROLE_NAME} (admin)`);

print('');
print('RESULT: OK — read-only views, role and owner account created (no existing object was modified)');
