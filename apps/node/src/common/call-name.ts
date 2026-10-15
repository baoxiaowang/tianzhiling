/**
 * 称呼解析与归一。
 *
 * 用户可能在一个称呼字段里填写多个称呼（生产数据里 77% 是两个、15% 是三个），
 * 例如“女儿，闺女”“老婆，媳妇”“幺女，张朵朵”。这些称呼在语义上基本等价，
 * 因此：
 *   - 提示词与展示层每次只使用其中一个（否则模型会把多个一起叫出来）；
 *   - 用哪一个由 call-name-policy 结合场景决定；
 *   - 数据库始终保留用户填写的原始值，编辑页回填、导出不受影响。
 */
const CALL_NAME_SEPARATOR_PATTERN = /[，,、/／\s]+/u;
const CALL_NAME_EDGE_PUNCTUATION_PATTERN =
  /^[\s"'“”‘’、,，。.!！?？:：;；]+|[\s"'“”‘’、,，。.!！?？:：;；]+$/gu;
const CALL_NAME_FILLER_PREFIX_PATTERN =
  /^(?:或者|或|还是|也叫|又叫|称呼|叫|和|与|还有|以及|都可以|都行|也行|就行|随便)+/u;
const CALL_NAME_FILLER_SUFFIX_PATTERN = /(?:都可以|都行|也行|就行|随便)+$/u;
const CALL_NAME_SENTENCE_PATTERN = /[。！？!?；;]/u;
/** 称呼都很短；超过这个长度基本是整句或关系说明，不能当称呼注入。 */
export const CALL_NAME_MAX_LENGTH = 8;

/**
 * 把字段拆成有序、去重、可用于提示词的称呼列表。
 * 连接词（或者/也行/就行/叫…）、整句、超长片段会被过滤；
 * 全部被过滤时返回空数组（调用方回退到默认称呼）。
 */
export function parseCallNames(value?: string | null): string[] {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) {
    return [];
  }

  const names: string[] = [];

  for (const segment of raw.split(CALL_NAME_SEPARATOR_PATTERN)) {
    if (CALL_NAME_SENTENCE_PATTERN.test(segment)) {
      continue;
    }

    const name = segment
      .replace(CALL_NAME_EDGE_PUNCTUATION_PATTERN, '')
      .replace(CALL_NAME_FILLER_PREFIX_PATTERN, '')
      .replace(CALL_NAME_FILLER_SUFFIX_PATTERN, '')
      .trim();

    if (!name || name.length > CALL_NAME_MAX_LENGTH) {
      continue;
    }

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  if (names.length > 0) {
    return names;
  }

  // 整段看起来像句子（含句末标点）时上面会全部丢弃，但用户只填了一个带尾标点的
  // 称呼（如“妈妈？”）应保留：去掉首尾标点后仍是无句中标点的短词才回退使用。
  const fallback = raw.replace(CALL_NAME_EDGE_PUNCTUATION_PATTERN, '').trim();

  if (
    fallback &&
    fallback.length <= CALL_NAME_MAX_LENGTH &&
    !CALL_NAME_SENTENCE_PATTERN.test(fallback)
  ) {
    return [fallback];
  }

  return [];
}

/** 主称呼：列表里的第一个；没有可用称呼时返回空串。 */
export function primaryCallName(value?: string | null): string {
  return parseCallNames(value)[0] || '';
}

/**
 * 组装称呼池：动态改口的最新称呼优先，其后是后台配置的顺序。
 * 例：配置“老婆，姓傅的” + 聊天里说“以后叫我宝贝” → [宝贝, 老婆, 姓傅的]。
 */
export function buildCallNamePool(
  configuredValue?: string | null,
  preferredName?: string | null
): string[] {
  const pool: string[] = [];

  for (const name of [
    ...parseCallNames(preferredName),
    ...parseCallNames(configuredValue),
  ]) {
    if (!pool.includes(name)) {
      pool.push(name);
    }
  }

  return pool;
}

/**
 * 把文本中出现过的多称呼替换成当前选定的那一个。
 * 用于 description 这类派生文本：历史数据已经把“老婆，姓傅的”写进了自我介绍，
 * 读出来时若不归一，多称呼仍会进入模型上下文。
 */
export function normalizeCallNameInText(
  text?: string | null,
  rawCallName?: string | null,
  selectedCallName?: string | null
): string {
  const value = typeof text === 'string' ? text : '';
  const raw = typeof rawCallName === 'string' ? rawCallName.trim() : '';

  if (!value || !raw) {
    return value;
  }

  const alternatives = parseCallNames(raw);
  const target =
    (typeof selectedCallName === 'string' ? selectedCallName.trim() : '') ||
    alternatives[0] ||
    '';

  if (!target) {
    return value;
  }

  let normalized = raw === target ? value : value.split(raw).join(target);

  for (const alternative of [...alternatives].sort(
    (left, right) => right.length - left.length
  )) {
    if (alternative === target) {
      continue;
    }

    normalized = normalized.split(alternative).join(target);
  }

  return collapseRepeatedCallName(normalized, target);
}

/** 归一后可能出现“宝贝，宝贝”这类重复（原文里多称呼是分开写的），合并成一个。 */
function collapseRepeatedCallName(value: string, target: string): string {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const joined = new RegExp(
    `${escaped}(?:\\s*(?:[，,、/／]|或者|或|和|及|与|还有|以及)\\s*${escaped})+`,
    'gu'
  );

  return value.replace(joined, target);
}
