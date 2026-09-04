export const AGENT_REAL_NAME_FACT_KEY = 'identity.real_name';
export const AGENT_REAL_NAME_HISTORY_FACT_PREFIX =
  'identity.real_name_history.';
export const AGENT_DERIVED_ALIASES_FACT_KEY = 'identity.aliases.derived';
export const AGENT_EXPLICIT_ALIAS_FACT_PREFIX = 'identity.alias.confirmed.';
export const AGENT_PREFERRED_NAME_FACT_KEY =
  'relationship.preferred_agent_name';
export const USER_REAL_NAME_FACT_KEY = 'user.identity.real_name';
export const USER_REAL_NAME_HISTORY_FACT_PREFIX =
  'user.identity.real_name_history.';
export const USER_DERIVED_ALIASES_FACT_KEY = 'user.identity.aliases.derived';
export const USER_EXPLICIT_ALIAS_FACT_PREFIX = 'user.identity.alias.confirmed.';
export const USER_PREFERRED_NAME_FACT_KEY = 'relationship.preferred_user_name';

export interface AgentNameMemoryFactLike {
  key: string;
  value: string;
  status?: string;
}

export interface ExtractedAgentNameMemory {
  canonicalName?: string;
  derivedAliases: string[];
  explicitAliases: string[];
  preferredName?: string;
}

export interface ResolvedAgentNameMemory {
  canonicalName?: string;
  aliases: string[];
  preferredName?: string;
}

export type ExtractedUserNameMemory = ExtractedAgentNameMemory;
export type ResolvedUserNameMemory = ResolvedAgentNameMemory;

const NAME_TOKEN = '[\\u4e00-\\u9fa5A-Za-z·]{2,16}';
const INVALID_NAME_PART =
  /(?:什么|哪个|哪位|是谁|谁|吗|么|呢|是不是|不是|记得|忘了|忘吗|叫什么)/;
const INVALID_NAME_VALUE_PART =
  /(?:名字|姓名|全名|知道|好不好|听不到|看一下|上车|一声|一下|爸爸|妈妈|父亲|母亲|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|外公|外婆|叔叔|阿姨|儿子|女儿|孩子|闺女|大孙)/;
const TRAILING_PARTICLE = /[啊呀呢吧嘛哈哟啦哦呐哎诶]+$/;
const DECLARATION_PREFIX = '(?:(?:对|是的|没错|更正一下|纠正一下|记住)[:：]?)?';
const TRAILING_DECLARATION_PART = '(?:了)?(?:啊|呀|呢|吧|嘛|哈|哟|啦)*';
const NON_NAME_EXACT = new Set([
  '爸爸',
  '妈妈',
  '父亲',
  '母亲',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '爷爷',
  '奶奶',
  '外公',
  '外婆',
  '老公',
  '老婆',
  '丈夫',
  '妻子',
  '宝贝',
]);

export function extractAgentNameMemory(
  sourceText: string
): ExtractedAgentNameMemory {
  const result: ExtractedAgentNameMemory = {
    derivedAliases: [],
    explicitAliases: [],
  };
  const clauses = splitClauses(sourceText);

  for (const clause of clauses) {
    const canonicalName = extractCanonicalNameFromClause(clause);
    if (canonicalName) {
      result.canonicalName = canonicalName;
    }

    const alias = extractAliasFromClause(clause);
    if (alias && !result.explicitAliases.includes(alias)) {
      result.explicitAliases.push(alias);
      if (isExplicitPreferredNameClause(clause)) {
        result.preferredName = alias;
      }
    }
  }

  if (result.canonicalName) {
    result.derivedAliases = deriveChineseNameAliases(result.canonicalName);
  }

  return result;
}

export function resolveAgentNameMemory(
  facts: AgentNameMemoryFactLike[] = []
): ResolvedAgentNameMemory {
  let canonicalName: string | undefined;
  let preferredName: string | undefined;
  const aliases: string[] = [];

  for (const fact of facts) {
    if (fact.status && fact.status !== 'active') {
      continue;
    }

    if (fact.key === AGENT_REAL_NAME_FACT_KEY) {
      canonicalName = readValueAfterPrefix(fact.value, '当前角色正式姓名是');
      continue;
    }

    if (fact.key === AGENT_DERIVED_ALIASES_FACT_KEY) {
      const values = readValueListAfterPrefix(
        fact.value,
        '当前角色可识别的派生称呼：'
      );
      for (const alias of values) {
        pushUniqueName(aliases, alias);
      }
      continue;
    }

    if (fact.key.startsWith(AGENT_EXPLICIT_ALIAS_FACT_PREFIX)) {
      pushUniqueName(
        aliases,
        readValueAfterPrefix(fact.value, '当前角色别名或昵称是')
      );
      continue;
    }

    if (fact.key === AGENT_PREFERRED_NAME_FACT_KEY) {
      preferredName = readValueAfterPrefix(
        fact.value,
        '当前用户偏好称呼当前角色为'
      );
    }
  }

  return {
    ...(canonicalName ? { canonicalName } : {}),
    aliases: uniqueNames([
      ...aliases,
      ...(canonicalName ? deriveChineseNameAliases(canonicalName) : []),
    ]),
    ...(preferredName ? { preferredName } : {}),
  };
}

export function extractUserNameMemory(
  sourceText: string
): ExtractedUserNameMemory {
  const result: ExtractedUserNameMemory = {
    derivedAliases: [],
    explicitAliases: [],
  };

  for (const clause of splitClauses(sourceText)) {
    const text = compact(clause);
    if (!text || isQuestionOrAmbiguousNameClause(text)) {
      continue;
    }

    const canonicalMatch =
      text.match(
        new RegExp(
          `^${DECLARATION_PREFIX}我(?:现在|如今)?(?:叫|名叫|全名叫)(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
        )
      ) ||
      text.match(
        new RegExp(
          `^${DECLARATION_PREFIX}我(?:的)?(?:名字|姓名|全名)(?:叫|是|为)(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
        )
      ) ||
      text.match(
        /^(?:(?:更正一下|纠正一下|记住)[:：]?)?我(?:把名字)?(?:改名叫|改成)([\u4e00-\u9fa5A-Za-z·]{2,16}?)(?=了(?:弟弟|哥哥|姐姐|妹妹|爸爸|妈妈|孩子)?$|$)/
      );
    const canonicalName = normalizeName(canonicalMatch?.[1]);
    if (canonicalName) {
      result.canonicalName = canonicalName;
    }

    const aliasMatch =
      text.match(
        new RegExp(
          `^(?:以后|今后)?你(?:以后|今后)?(?:就|还是|一直|都)?(?:叫|称呼)我(?:作|做|为)?(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
        )
      ) ||
      text.match(
        new RegExp(
          `^(?:大家|家里人|朋友)(?:都)?(?:叫|称呼)我(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
        )
      ) ||
      text.match(
        new RegExp(
          `^我的(?:小名|昵称)(?:叫|是|为)(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
        )
      );
    const alias = normalizeName(aliasMatch?.[1]);
    if (alias && !result.explicitAliases.includes(alias)) {
      result.explicitAliases.push(alias);
      if (isExplicitPreferredUserNameClause(text)) {
        result.preferredName = alias;
      }
    }
  }

  if (result.canonicalName) {
    result.derivedAliases = deriveChineseNameAliases(result.canonicalName);
  }

  return result;
}

export function resolveUserNameMemory(
  facts: AgentNameMemoryFactLike[] = []
): ResolvedUserNameMemory {
  let canonicalName: string | undefined;
  let preferredName: string | undefined;
  const aliases: string[] = [];

  for (const fact of facts) {
    if (fact.status && fact.status !== 'active') {
      continue;
    }
    if (fact.key === USER_REAL_NAME_FACT_KEY) {
      canonicalName = readValueAfterPrefix(fact.value, '用户正式姓名是');
    } else if (fact.key === USER_DERIVED_ALIASES_FACT_KEY) {
      const value = readValueListAfterPrefix(
        fact.value,
        '用户可识别的派生称呼：'
      );
      for (const alias of value) pushUniqueName(aliases, alias);
    } else if (fact.key.startsWith(USER_EXPLICIT_ALIAS_FACT_PREFIX)) {
      pushUniqueName(
        aliases,
        readValueAfterPrefix(fact.value, '用户别名或昵称是')
      );
    } else if (fact.key === USER_PREFERRED_NAME_FACT_KEY) {
      preferredName = readValueAfterPrefix(
        fact.value,
        '当前用户希望当前角色称呼其为'
      );
    }
  }

  return {
    ...(canonicalName ? { canonicalName } : {}),
    aliases: uniqueNames([
      ...aliases,
      ...(canonicalName ? deriveChineseNameAliases(canonicalName) : []),
    ]),
    ...(preferredName ? { preferredName } : {}),
  };
}

export function isExplicitCanonicalNameReplacement(
  sourceText: string,
  subject: 'agent' | 'user' | 'either' = 'either'
): boolean {
  const text = compact(sourceText);
  const subjects =
    subject === 'agent' ? '你' : subject === 'user' ? '我' : '你我';
  return new RegExp(
    `(?:[${subjects}](?:把名字)?(?:改名叫|改成)|[${subjects}](?:现在|如今|以后正式)(?:叫|名叫)|(?:更正|纠正).{0,12}[${subjects}](?:现在|如今)?(?:叫|名叫)|[${subjects}]不叫[^，,。！！？?]{2,16}[，,][${subjects}]?叫)`
  ).test(text);
}

export function isAgentNameFactKey(key: string): boolean {
  return (
    key === 'identity.name' ||
    key === AGENT_REAL_NAME_FACT_KEY ||
    key.startsWith(AGENT_REAL_NAME_HISTORY_FACT_PREFIX) ||
    key === AGENT_DERIVED_ALIASES_FACT_KEY ||
    key.startsWith(AGENT_EXPLICIT_ALIAS_FACT_PREFIX) ||
    key === AGENT_PREFERRED_NAME_FACT_KEY
  );
}

export function isUserNameFactKey(key: string): boolean {
  return (
    key === USER_REAL_NAME_FACT_KEY ||
    key.startsWith(USER_REAL_NAME_HISTORY_FACT_PREFIX) ||
    key === USER_DERIVED_ALIASES_FACT_KEY ||
    key.startsWith(USER_EXPLICIT_ALIAS_FACT_PREFIX) ||
    key === USER_PREFERRED_NAME_FACT_KEY
  );
}

export function isNameMemoryFactKey(key: string): boolean {
  return isAgentNameFactKey(key) || isUserNameFactKey(key);
}

export function isValidatedNameFactForSource(
  key: string,
  value: string,
  sourceText: string
): boolean {
  if (!isNameMemoryFactKey(key)) {
    return true;
  }

  const extracted = isUserNameFactKey(key)
    ? extractUserNameMemory(sourceText)
    : extractAgentNameMemory(sourceText);
  const normalizedValue = compact(value);

  if (key === 'identity.name') {
    return false;
  }

  if (key === AGENT_REAL_NAME_FACT_KEY || key === USER_REAL_NAME_FACT_KEY) {
    const prefix =
      key === USER_REAL_NAME_FACT_KEY ? '用户正式姓名是' : '当前角色正式姓名是';
    const candidate = readValueAfterPrefix(value, prefix);
    return Boolean(
      candidate &&
        ((extracted.canonicalName && candidate === extracted.canonicalName) ||
          isSafeModelNameCandidate(
            key === USER_REAL_NAME_FACT_KEY ? 'user' : 'agent',
            candidate,
            sourceText
          ))
    );
  }

  if (
    key === AGENT_DERIVED_ALIASES_FACT_KEY ||
    key === USER_DERIVED_ALIASES_FACT_KEY
  ) {
    return extracted.derivedAliases.some(alias =>
      normalizedValue.includes(alias)
    );
  }

  if (
    key.startsWith(AGENT_EXPLICIT_ALIAS_FACT_PREFIX) ||
    key.startsWith(USER_EXPLICIT_ALIAS_FACT_PREFIX)
  ) {
    return extracted.explicitAliases.some(alias =>
      normalizedValue.includes(alias)
    );
  }

  return Boolean(
    extracted.preferredName && normalizedValue.includes(extracted.preferredName)
  );
}

function extractCanonicalNameFromClause(clause: string): string | undefined {
  const text = compact(clause);
  if (!text || isQuestionOrAmbiguousNameClause(text)) {
    return undefined;
  }

  const patterns = [
    new RegExp(
      `^${DECLARATION_PREFIX}你(?:现在|如今)?(?:叫|名叫|全名叫)(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
    ),
    new RegExp(
      `^${DECLARATION_PREFIX}你(?:的)?(?:名字|姓名|全名)(?:叫|是|为)(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
    ),
    /^(?:(?:更正一下|纠正一下|记住)[:：]?)?你(?:把名字)?(?:改名叫|改成)([\u4e00-\u9fa5A-Za-z·]{2,16}?)(?=了(?:弟弟|哥哥|姐姐|妹妹|爸爸|妈妈|孩子)?$|$)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = normalizeName(match?.[1]);
    if (name) {
      return name;
    }
  }

  return undefined;
}

function extractAliasFromClause(clause: string): string | undefined {
  const text = compact(clause);
  if (!text || isQuestionOrAmbiguousNameClause(text)) {
    return undefined;
  }

  const patterns = [
    new RegExp(
      `^(?:以后|今后)?(?:我)?(?:以后|今后)?(?:就|还是|一直|都)?(?:喜欢|想)?(?:叫|称呼)你(?:作|做|为)?(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
    ),
    new RegExp(
      `^你的(?:小名|昵称)(?:叫|是|为)(${NAME_TOKEN}?)${TRAILING_DECLARATION_PART}$`
    ),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = normalizeName(match?.[1]);
    if (name) {
      return name;
    }
  }

  return undefined;
}

function isExplicitPreferredNameClause(clause: string): boolean {
  return /(?:以后|今后|我就|我都|我还是|我喜欢|想叫你)/.test(compact(clause));
}

function isExplicitPreferredUserNameClause(clause: string): boolean {
  return /(?:以后|今后|你就|你都|你还是|请叫我|叫我[^，,。！！？?]{2,16}就行)/.test(
    compact(clause)
  );
}

function isQuestionOrAmbiguousNameClause(text: string): boolean {
  return (
    /[?？]/.test(text) ||
    INVALID_NAME_PART.test(text) ||
    /(?:叫不叫|是否|不知道)/.test(text)
  );
}

function deriveChineseNameAliases(name: string): string[] {
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(name)) {
    return [];
  }

  const givenName = name.length === 3 ? name.slice(1) : '';
  if (!givenName || givenName.length !== 2) {
    return [];
  }

  return Array.from(
    new Set([
      givenName,
      `${givenName[0]}${givenName[0]}`,
      `${givenName[1]}${givenName[1]}`,
    ])
  ).filter(alias => alias !== name);
}

function normalizeName(value?: string): string | undefined {
  const name = (value || '').replace(TRAILING_PARTICLE, '').trim();
  if (
    name.length < 2 ||
    name.length > 16 ||
    !/^[\u4e00-\u9fa5A-Za-z·]+$/.test(name) ||
    (/^[\u4e00-\u9fa5]+$/.test(name) && name.length > 4) ||
    NON_NAME_EXACT.has(name) ||
    /^(?:我|你|他|她|它|的|了|要|想|听|看|来|去|叫|上|下)/.test(name) ||
    /(?:我|你|他|她|它|的|了|要|吗)$/.test(name) ||
    INVALID_NAME_PART.test(name) ||
    INVALID_NAME_VALUE_PART.test(name)
  ) {
    return undefined;
  }
  return name;
}

function isSafeModelNameCandidate(
  subject: 'agent' | 'user',
  candidate: string,
  sourceText: string
): boolean {
  for (const clause of splitClauses(sourceText)) {
    const text = compact(clause);
    if (
      !text.includes(candidate) ||
      isQuestionOrAmbiguousNameClause(text) ||
      /(?:可能|好像|大概|也许|听说|假如|如果|别人|朋友|同事)/.test(text)
    ) {
      continue;
    }

    const subjectSignal =
      subject === 'user'
        ? /(?:我|本人)(?:[^，,。！？!?]{0,8})?(?:正式)?(?:名字|姓名|全名)|我(?:现在|如今)?(?:叫|名叫)|我(?:改名|改成)/
        : /(?:你|他|她)(?:[^，,。！？!?]{0,8})?(?:正式)?(?:名字|姓名|全名)|(?:你|他|她)(?:现在|如今)?(?:叫|名叫)|(?:你|他|她)(?:改名|改成)/;
    const assertionSignal = /(?:叫|名叫|姓名|全名|名字|改名|改成|就是|为)/;

    if (subjectSignal.test(text) && assertionSignal.test(text)) {
      return true;
    }
  }

  return false;
}

function readValueAfterPrefix(
  value: string,
  prefix: string
): string | undefined {
  const normalized = (value || '').trim();
  const candidate = normalized.startsWith(prefix)
    ? normalized.slice(prefix.length)
    : '';
  return normalizeName(candidate);
}

function readValueListAfterPrefix(value: string, prefix: string): string[] {
  const normalized = (value || '').trim();
  if (!normalized.startsWith(prefix)) return [];
  return normalized
    .slice(prefix.length)
    .split('、')
    .map(item => normalizeName(item))
    .filter((item): item is string => Boolean(item));
}

function pushUniqueName(values: string[], value?: string): void {
  const normalized = normalizeName(value);
  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

function uniqueNames(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map(value => normalizeName(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function splitClauses(value: string): string[] {
  return (value || '')
    .replace(/[\r\n]+/g, '，')
    .split(/[，,。；;！!]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function compact(value: string): string {
  return (value || '').replace(/\s+/g, '').trim();
}
