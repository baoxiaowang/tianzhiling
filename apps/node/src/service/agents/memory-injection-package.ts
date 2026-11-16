// 记忆按包注入（package injection v1）
//
// 注入选择单位从"条"改为"包"：同一事件组（groupId）的成员要么整包注入，
// 要么不选；只有超过容量硬顶时才截断，且必带标记。
// 解决的问题：引擎 recall 已按组扩展证据，但旧选择器按单条分数切 top1~3，
// 大事件被拦腰截断，关键信息缺失。
//
// 容量双维度硬顶（成员数 + 字符数），防单包无限大；
// 每包输出原始 vs 注入规模统计（truncated / oversized），为未来针对性优化
// （尾部折叠摘要 / 按时间拆子包 / 老成员压缩）提供决策数据。
// 截断策略独立成 trimPackageMembersToCapacity：将来替换它即可，选择器不动。

export interface InjectableMemoryItem {
  id?: string;
  content: string;
  createdAt?: string;
  score?: number;
  /** 引擎给出的事件组 id；缺省视为单件包。 */
  groupId?: string;
}

export interface PackageInjectionCapacity {
  /** 最多注入几个包（对齐引擎 MAX_GROUPS_EXPANDED）。 */
  maxPackages?: number;
  /** 单包成员数硬顶（对齐 MAX_GROUP_MEMBERS，双保险）。 */
  maxMembersPerPackage?: number;
  /** 单包字符硬顶。 */
  maxCharsPerPackage?: number;
  /** 全局成员封顶（token 包络）。 */
  maxTotalMembers?: number;
  /** 全局字符封顶。 */
  maxTotalChars?: number;
  /** 包间 score-gap：top1/top2 太接近时只留 1 包（沿用逐条时代的去同质语义）。 */
  minPackageScoreGap?: number;
  /** 时间降权（与 agent.context 的 recencyFactor 同源）。 */
  recencyFactor?: (createdAt?: string) => number;
  /** 超限处理：drop=丢最旧（旧行为）；summarize=压缩行+保留成员（默认）。 */
  compression?: 'drop' | 'summarize';
}

export interface MemoryInjectionPackageStat {
  /** 引擎组 id；单件包为 'singleton'。 */
  groupId: string;
  injectedMembers: number;
  originalMembers: number;
  injectedChars: number;
  originalChars: number;
  /** 超出容量硬顶被截断（含全局预算导致的截断）。 */
  truncated: boolean;
  /** summarize 模式下超限包的压缩说明行（背景，不可断言）。 */
  compressionLine?: string;
}

export interface PackageInjectionResult {
  /** 扁平注入列表：包按得分降序排列，包内成员按时间正序（叙事连贯）。 */
  items: InjectableMemoryItem[];
  packages: MemoryInjectionPackageStat[];
  /** 被截断的包数量（含全局预算截断）。 */
  oversizedCount: number;
}

const DEFAULT_MAX_PACKAGES = 2;
const DEFAULT_MAX_MEMBERS_PER_PACKAGE = 10;
const DEFAULT_MAX_CHARS_PER_PACKAGE = 720;
const DEFAULT_MAX_TOTAL_MEMBERS = 12;
const DEFAULT_MAX_TOTAL_CHARS = 1080;
const DEFAULT_MIN_PACKAGE_SCORE_GAP = 0.02;

/** 容量全部 env 可调（NODE_MEMORY_PKG_*）：调容量不改代码。 */
function envCap(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

interface PackageBucket {
  key: string;
  groupId: string;
  members: InjectableMemoryItem[];
  score: number;
}

function itemChars(item: InjectableMemoryItem): number {
  return String(item.content || '').length;
}

function occurredTime(item: InjectableMemoryItem): number {
  const ts = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * 截断策略（未来优化的缝）：超出单包硬顶时，保三点——
 * ① 最高分成员必留（它是这包被触发的原因）；
 * ② 余量按时间近优先填充；
 * ③ 字符仍超顶时从最旧的非必留成员开始丢弃。
 * 返回成员按时间正序。将来"尾部折叠摘要 / 按时间拆子包 / 老成员压缩"
 * 只替换本函数。
 */
export function trimPackageMembersToCapacity(
  members: InjectableMemoryItem[],
  capacity: { maxMembers: number; maxChars: number },
  recencyFactor: (createdAt?: string) => number
): { kept: InjectableMemoryItem[]; truncated: boolean } {
  const maxMembers = Math.max(1, capacity.maxMembers);
  const maxChars = Math.max(1, capacity.maxChars);
  const totalChars = members.reduce((sum, item) => sum + itemChars(item), 0);
  if (
    members.length <= maxMembers &&
    totalChars <= maxChars
  ) {
    return {
      kept: [...members].sort((left, right) => occurredTime(left) - occurredTime(right)),
      truncated: false,
    };
  }

  // 必留：最高分成员（同分取时间最近）。
  const anchor = [...members].sort(
    (left, right) =>
      (right.score || 0) * recencyFactor(right.createdAt) -
        (left.score || 0) * recencyFactor(left.createdAt) ||
      occurredTime(right) - occurredTime(left)
  )[0];
  const rest = members
    .filter(item => item !== anchor)
    .sort((left, right) => occurredTime(right) - occurredTime(left));

  const kept: InjectableMemoryItem[] = [anchor];
  let chars = itemChars(anchor);
  for (const item of rest) {
    if (kept.length >= maxMembers) break;
    const itemLength = itemChars(item);
    if (chars + itemLength > maxChars) continue;
    kept.push(item);
    chars += itemLength;
  }
  kept.sort((left, right) => occurredTime(left) - occurredTime(right));
  return { kept, truncated: kept.length < members.length };
}

/**
 * 按包选择可注入记忆。入参应已过 keepInjectable（碎片/近重复过滤）。
 */
export function selectInjectableMemoryPackages(
  items: InjectableMemoryItem[],
  capacity: PackageInjectionCapacity = {}
): PackageInjectionResult {
  const maxPackages = Math.max(
    1,
    capacity.maxPackages ?? envCap('NODE_MEMORY_PKG_MAX_PACKAGES', DEFAULT_MAX_PACKAGES)
  );
  const maxMembersPerPackage = Math.max(
    1,
    capacity.maxMembersPerPackage ??
      envCap('NODE_MEMORY_PKG_MAX_MEMBERS', DEFAULT_MAX_MEMBERS_PER_PACKAGE)
  );
  const maxCharsPerPackage = Math.max(
    1,
    capacity.maxCharsPerPackage ??
      envCap('NODE_MEMORY_PKG_MAX_CHARS_PER_PACKAGE', DEFAULT_MAX_CHARS_PER_PACKAGE)
  );
  const maxTotalMembers = Math.max(
    1,
    capacity.maxTotalMembers ??
      envCap('NODE_MEMORY_PKG_MAX_TOTAL_MEMBERS', DEFAULT_MAX_TOTAL_MEMBERS)
  );
  const maxTotalChars = Math.max(
    1,
    capacity.maxTotalChars ??
      envCap('NODE_MEMORY_PKG_MAX_TOTAL_CHARS', DEFAULT_MAX_TOTAL_CHARS)
  );
  const minPackageScoreGap =
    capacity.minPackageScoreGap ?? DEFAULT_MIN_PACKAGE_SCORE_GAP;
  const recencyFactor =
    capacity.recencyFactor ?? (() => 1);
  const compression =
    capacity.compression ??
    ((process.env.NODE_MEMORY_PACKAGE_COMPRESSION || 'summarize').trim().toLowerCase() ===
    'drop'
      ? 'drop'
      : 'summarize');

  // 1. 分区：groupId 聚包，无 groupId 为单件包。
  const buckets = new Map<string, PackageBucket>();
  const singletons: PackageBucket[] = [];
  for (const item of items) {
    const groupId = item.groupId?.trim();
    if (groupId) {
      const bucket = buckets.get(groupId) ?? {
        key: `group:${groupId}`,
        groupId,
        members: [],
        score: 0,
      };
      bucket.members.push(item);
      buckets.set(groupId, bucket);
    } else {
      singletons.push({
        key: `singleton:${item.id ?? singletons.length}`,
        groupId: 'singleton',
        members: [item],
        score: 0,
      });
    }
  }

  const allPackages = [...buckets.values(), ...singletons];
  for (const pack of allPackages) {
    pack.score = Math.max(
      ...pack.members.map(
        item => (item.score || 0) * recencyFactor(item.createdAt)
      )
    );
  }
  allPackages.sort((left, right) => right.score - left.score);
  if (!allPackages.length) {
    return { items: [], packages: [], oversizedCount: 0 };
  }

  // 2. 包间去同质：top1/top2 得分太接近时只留 1 包（沿用旧语义，作用域=包间）。
  const topScore = allPackages[0].score;
  const secondScore = allPackages[1]?.score ?? 0;
  const hasDistinctSecond =
    allPackages.length > 1 &&
    topScore > 0 &&
    secondScore > 0 &&
    topScore - secondScore >= minPackageScoreGap;
  const packageBudget = Math.min(
    maxPackages,
    hasDistinctSecond ? maxPackages : 1
  );
  const selected = allPackages.slice(0, packageBudget);

  // 3. 逐包注入：单包硬顶截断 + 全局双预算（成员数/字符）。
  const flatItems: InjectableMemoryItem[] = [];
  const stats: MemoryInjectionPackageStat[] = [];
  let totalMembers = 0;
  let totalChars = 0;

  for (const pack of selected) {
    const originalMembers = pack.members.length;
    const originalChars = pack.members.reduce(
      (sum, item) => sum + itemChars(item),
      0
    );
    const membersLeft = maxTotalMembers - totalMembers;
    const charsLeft = maxTotalChars - totalChars;
    if (membersLeft < 1 || charsLeft < 1) break;

    const trimmed = trimPackageMembersToCapacity(
      pack.members,
      {
        maxMembers: Math.min(maxMembersPerPackage, membersLeft),
        maxChars: Math.min(maxCharsPerPackage, charsLeft),
      },
      recencyFactor
    );
    if (!trimmed.kept.length) break;

    const injectedChars = trimmed.kept.reduce(
      (sum, item) => sum + itemChars(item),
      0
    );
    totalMembers += trimmed.kept.length;
    totalChars += injectedChars;
    flatItems.push(...trimmed.kept);
    const truncated =
      trimmed.kept.length < originalMembers || injectedChars < originalChars;
    stats.push({
      groupId: pack.groupId,
      injectedMembers: trimmed.kept.length,
      originalMembers,
      injectedChars,
      originalChars,
      // 截断来源可能是单包硬顶，也可能是全局预算；统一标记为可观测。
      truncated,
      // summarize：不静默丢成员，给一行诚实的压缩说明（背景，不可断言）。
      ...(truncated && compression === 'summarize'
        ? {
            compressionLine: `【本场共 ${originalMembers} 条提及，超容量保留 ${trimmed.kept.length} 条】`,
          }
        : {}),
    });
  }

  return {
    items: flatItems,
    packages: stats,
    oversizedCount: stats.filter(stat => stat.truncated).length,
  };
}

// ── 叙事化注入渲染 ─────────────────────────────────────────────────
// 程序拼装结构（标题/前情/压缩说明），原话仍逐条带引号引用。
// 全部为背景层：可断言内容只认带引号的原话。

export interface NarrativePackageView {
  groupId: string;
  title: string;
  subjectRef?: string;
  topicKey: string;
  spanFrom: string;
  spanTo: string;
  chain?: Array<{
    title: string;
    spanFrom: string;
    spanTo: string;
    memberCount: number;
  }>;
}

function narrativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/**
 * 一场的叙事块：标题行（谁的事｜跨度）+ 前情链行 + 压缩说明 + 原话引用（时间正序）。
 */
export function renderMemoryPackageNarrative(
  view: NarrativePackageView,
  quotes: string[],
  compressionLine?: string
): string {
  const subject = view.subjectRef ? `${view.subjectRef}的` : '';
  const span =
    narrativeDate(view.spanFrom) && narrativeDate(view.spanTo)
      ? `｜${narrativeDate(view.spanFrom)}~${narrativeDate(view.spanTo)}`
      : '';
  const lines: string[] = [`【${subject}${view.topicKey}${span}】`];
  for (const chain of view.chain || []) {
    lines.push(
      `前情：${chain.title}（${narrativeDate(chain.spanFrom)}~${narrativeDate(
        chain.spanTo
      )}，${chain.memberCount} 次提及）`
    );
  }
  if (compressionLine) lines.push(compressionLine);
  if (quotes.length) {
    lines.push('原话（按时间先后，引用只认带引号部分）：');
    for (const quote of quotes) {
      const text = String(quote || '').trim();
      if (text) lines.push(`- 「${text}」`);
    }
  }
  return lines.join('\n');
}
