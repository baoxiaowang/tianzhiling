/**
 * 角色核心记忆：当前采用值的构造规则（纯函数，无模型、无 IO）。
 *
 * 设计边界（对齐任务书《角色核心记忆与检索记忆分工》）：
 * - 事实真值只有一份，仍由各自既有服务持有（agent_profile_fact / person_temporal_* /
 *   conversation 称呼 / AgentEntity 兼容字段）；这里只做"冲突解决后的可重建投影"。
 * - 主体、含义、同义关系由现有模型判断；程序只做来源校验、范围校验、优先级与幂等，
 *   不从"户主/山东/爸爸"这类关键词猜主体或价值。
 * - 未知、冲突、未验证是合法状态，不为填满页面补齐。
 * - 与 admin-node 共用：本文件不 import 任何 Midway/Nest/模型/队列运行时，
 *   可被后台直接复用，避免两套优先级规则长期分叉。
 */

/** 来源类型：决定冲突优先级，也用于后台解释"当前采用原因"。 */
export type RoleCoreSourceKind =
  /** 用户明确陈述或明确要求 */
  | 'user_explicit'
  /** 用户明确更正（优先级最高） */
  | 'user_correction'
  /** 创建资料/人工编辑字段 */
  | 'profile_field'
  /** 真实导入聊天样本中的特征 */
  | 'import_style'
  /** 由已认可事实按产品规则派生（不是从聊天证实） */
  | 'product_derived'
  /** 资料摘要/助手回复等派生资料，不作为强证据 */
  | 'summary';

export interface RoleCoreSourceRef {
  kind: RoleCoreSourceKind;
  /** 来源消息（用户陈述/导入样本/更正） */
  messageId?: string;
  /** 导入批次 */
  batchId?: string;
  /** 创建资料或兼容字段名 */
  field?: string;
  /** 来源发生时间（与处理时间分开） */
  at?: Date;
}

export type RoleCoreAdoptionStatus = 'adopted' | 'pending' | 'rejected';

export interface RoleCoreEntry<T> {
  value: T;
  status: RoleCoreAdoptionStatus;
  source?: RoleCoreSourceRef;
  /** 与 status 配套的可读原因，后台直接展示 */
  reason?: string;
}

/** 优先级：数值越大越优先。语义不是"新的一定赢"，而是"依据更强才赢"。 */
const SOURCE_PRIORITY: Record<RoleCoreSourceKind, number> = {
  user_correction: 60,
  user_explicit: 50,
  profile_field: 40,
  import_style: 30,
  product_derived: 20,
  summary: 10,
};

export function sourcePriority(kind: RoleCoreSourceKind): number {
  return SOURCE_PRIORITY[kind] ?? 0;
}

/**
 * 语言设定：区分"事实"与"由事实派生的表达设定"。
 * 地域口吻只影响表达，不涉及音色/TTS。
 */
export interface RoleCoreLanguageSetting {
  /** 例如"说山东话"；由模型给出的有据标签组装，程序不做省份→方言硬编码词典 */
  value: string;
  origin: RoleCoreSourceKind;
  /** 派生设定必须能指回它依据的事实 */
  derivedFrom?: RoleCoreSourceRef;
  source?: RoleCoreSourceRef;
  /** 被更明确的设定覆盖时置 false，但事实本身仍保留 */
  active: boolean;
  reason?: string;
}

/** 已认可的籍贯事实：由现有模型提取，程序只消费。 */
export interface HometownFact {
  /** 省级即可形成省级语言方向；不猜城市或方言支系 */
  province?: string;
  /** 模型给出的有据语言标签（如"山东话"、"普通话"） */
  languageLabel?: string;
  /** 来源必须可追溯；没有来源不生成派生设定 */
  source?: RoleCoreSourceRef;
}

/** 用户明确要求的语言/口吻设定，优先级高于任何派生。 */
export interface ExplicitLanguageSetting {
  value: string;
  source?: RoleCoreSourceRef;
}

export interface DeriveLanguageSettingsInput {
  hometown?: HometownFact;
  explicit?: ExplicitLanguageSetting;
}

export interface DeriveLanguageSettingsResult {
  /** 当前实际采用、可注入提示的设定；可能为空 */
  active?: RoleCoreLanguageSetting;
  /** 被覆盖但仍需保留解释的（例如籍贯事实保留、山东话默认被普通话覆盖） */
  superseded: RoleCoreLanguageSetting[];
  /** 不足以生成设定时说明原因，供后台显示 */
  note?: string;
}

const DIALECT_VERB_PATTERN = /^(?:说|讲)/;

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, '').trim();
}

/**
 * 由"已认可的籍贯事实 + 模型给出的语言标签"生成产品派生设定。
 *
 * 注意：这里**不**维护省份→方言对照表。标签必须由模型依据用户原话给出，
 * 程序只做组装与优先级判定；没有标签时明确说明不可派生，而不是猜一个方言。
 */
export function deriveLanguageSettings(
  input: DeriveLanguageSettingsInput
): DeriveLanguageSettingsResult {
  const superseded: RoleCoreLanguageSetting[] = [];
  const explicitValue = normalizeText(input.explicit?.value);

  const hometown = input.hometown;
  const derived = buildHometownDerivedSetting(hometown);

  // 明确要求/更正优先：覆盖派生设定，但籍贯事实本身保留。
  if (explicitValue) {
    const explicitSetting: RoleCoreLanguageSetting = {
      value: explicitValue,
      origin: input.explicit?.source?.kind || 'user_explicit',
      source: input.explicit?.source,
      active: true,
    };
    if (derived) {
      superseded.push({
        ...derived,
        active: false,
        reason: '被用户明确要求覆盖',
      });
    }
    return { active: explicitSetting, superseded };
  }

  if (derived) {
    return { active: derived, superseded };
  }

  if (hometown?.province && !normalizeText(hometown.languageLabel)) {
    return {
      superseded,
      note: '籍贯已确认但没有可依据的语言标签，不猜方言',
    };
  }

  return { superseded };
}

function buildHometownDerivedSetting(
  hometown?: HometownFact
): RoleCoreLanguageSetting | undefined {
  const province = normalizeText(hometown?.province);
  const label = normalizeText(hometown?.languageLabel);
  if (!province || !label) return undefined;
  // 没有来源就不生成派生设定：产品派生也必须可追溯。
  if (!hometown?.source) return undefined;
  // 「普通话」这类标签同样由模型给出，不在这里用省份反推。
  const value = DIALECT_VERB_PATTERN.test(label) ? label : `说${label}`;
  return {
    value,
    origin: 'product_derived',
    derivedFrom: hometown.source,
    active: true,
    reason: '由籍贯事实生成',
  };
}

/**
 * 通用字段选择：按来源优先级取一条，冲突无法判定时保留待定而不是"选最新字符串"。
 * 同优先级的不同值视为冲突。
 */
export function selectRoleCoreEntry<T>(
  candidates: Array<{ value: T; source: RoleCoreSourceRef; reason?: string }>,
  options: { isSameValue?: (left: T, right: T) => boolean } = {}
): RoleCoreEntry<T> | undefined {
  if (!candidates.length) return undefined;
  const same = options.isSameValue || ((left, right) => left === right);
  const ranked = [...candidates].sort(
    (left, right) => sourcePriority(right.source.kind) - sourcePriority(left.source.kind)
  );
  const top = ranked[0];
  const sameRank = ranked.filter(
    item => sourcePriority(item.source.kind) === sourcePriority(top.source.kind)
  );
  const conflict = sameRank.some(item => !same(item.value, top.value));
  if (conflict) {
    return {
      value: top.value,
      status: 'pending',
      source: top.source,
      reason: '来源同优先级但取值冲突，保留待定',
    };
  }
  return { value: top.value, status: 'adopted', source: top.source, reason: top.reason };
}

/**
 * 籍贯事实的规范 key 与取值前缀。
 *
 * 事实真值只有一份：`agent_profile_fact` 里一条 `origin.hometown` 记录，
 * 由现有模型抽取写入（程序不靠"山东/老家"这类关键词猜主体）。
 * "说山东话"是**由该事实派生的产品设定**，不单独落库，读时用
 * `deriveLanguageSettings` 重建，避免第二份真值互相竞争。
 */
export const HOMETOWN_FACT_KEY = 'origin.hometown';
export const HOMETOWN_FACT_VALUE_PREFIX = '当前角色的籍贯是';

export function buildHometownFactValue(province: string): string {
  return `${HOMETOWN_FACT_VALUE_PREFIX}${normalizeText(province)}`;
}

/** 从事实 value 里取回省级；取不到返回 undefined，不猜。 */
export function parseHometownProvince(value?: string): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) return undefined;
  const stripped = normalized.startsWith(HOMETOWN_FACT_VALUE_PREFIX)
    ? normalized.slice(HOMETOWN_FACT_VALUE_PREFIX.length)
    : normalized;
  const province = stripped.replace(/(?:省|市)?(?:人|籍贯)?$/, '').trim();
  return province || undefined;
}

/**
 * 地域语言标签的装配口径只保留一份。
 *
 * 省级足以形成省级语言方向；不猜城市、不猜方言支系。放这里是为了让主聊天与后台
 * 用同一行代码产出同一个标签，避免两边各写一遍 `<省>话` 后长期分叉。
 */
export function buildDialectLabel(province?: string): string | undefined {
  const normalized = normalizeText(province);
  return normalized ? `${normalized}话` : undefined;
}
