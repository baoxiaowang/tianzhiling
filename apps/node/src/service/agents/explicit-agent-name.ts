/**
 * 用户直接给 AI 本人起名/改称呼的窄规则。
 *
 * 只处理“对 AI 说”的明确指令，不处理：
 * - “你叫我X”（这是称呼用户）
 * - “你叫什么/你的名字是什么”（提问）
 * - “你叫阿香嘛老婆”（叙事/误抽取）
 */

export type ExplicitAgentNameKind = 'realName' | 'callName';

export interface ExplicitAgentNameInstruction {
  kind: ExplicitAgentNameKind;
  name: string;
  matched: string;
}

const NAME_SOURCE = '([\\u4e00-\\u9fa5A-Za-z·]{1,12})';
const NAME_PATTERNS: Array<{
  kind: ExplicitAgentNameKind;
  pattern: RegExp;
}> = [
  // 你的名字叫X / 你的名字是X
  {
    kind: 'realName',
    pattern: new RegExp(
      `(?:你的|您的)名字(?:是|叫|叫做)\\s*${NAME_SOURCE}`
    ),
  },
  // 记住你叫X / 记住你现在的名字叫X
  {
    kind: 'realName',
    pattern: new RegExp(
      `(?:记住|记好|别忘了)[，,：:\\s]*(?:你|您)(?:现在)?(?:的)?名字(?:是|叫|叫做)?\\s*${NAME_SOURCE}`
    ),
  },
  {
    kind: 'realName',
    pattern: new RegExp(
      `(?:记住|记好|别忘了)[，,：:\\s]*(?:你|您)(?:现在)?叫\\s*${NAME_SOURCE}`
    ),
  },
  // 以后你叫X / 你以后叫X
  {
    kind: 'realName',
    pattern: new RegExp(
      `(?:你|您)(?:以后|之后|从今以后)(?:就)?叫\\s*${NAME_SOURCE}`
    ),
  },
  {
    kind: 'realName',
    pattern: new RegExp(
      `(?:以后|之后|从今以后)[，,]?(?:你|您)(?:就)?叫\\s*${NAME_SOURCE}`
    ),
  },
  // 我叫你X / 以后我就叫你X：这是用户对 AI 的称呼
  {
    kind: 'callName',
    pattern: new RegExp(
      `(?:我|俺)(?:以后|之后|从今以后)?(?:就)?叫你\\s*${NAME_SOURCE}`
    ),
  },
];

const QUESTION_OR_NEGATION =
  /[?？]|(?:吗|呢|什么|啥|谁|哪|是不是|不是|别|不要|不许)/;
const INVALID_NAME =
  /^(?:什么|啥|谁|哪个|名字|这个|那个|我|你|您|他|她|它|我们|你们|他们|她们|我的|你的|他的|她的)$/;

function normalizeName(raw: string): string | undefined {
  let name = (raw || '').trim();
  if (!name) return undefined;
  name = name.replace(/^[“”"'‘’\s]+|[“”"'‘’\s]+$/g, '');
  name = name.replace(/(?:啊|呀|吧|哦|嘛|呢|哈|啦)+$/g, '').trim();
  if (!name || name.length > 12) return undefined;
  if (INVALID_NAME.test(name)) return undefined;
  if (/[我你您他她它]/.test(name)) return undefined;
  if (/[，。！？、,.!?]/.test(name)) return undefined;
  if (/(?:什么|啥|谁|哪|吗|呢)/.test(name)) return undefined;
  return name;
}

export function detectExplicitAgentName(
  text: string
): ExplicitAgentNameInstruction | undefined {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 300) return undefined;
  if (QUESTION_OR_NEGATION.test(value)) return undefined;

  for (const item of NAME_PATTERNS) {
    const match = item.pattern.exec(value);
    if (!match) continue;
    const name = normalizeName(match[1]);
    if (!name) continue;
    return {
      kind: item.kind,
      name,
      matched: match[0].trim(),
    };
  }
  return undefined;
}
