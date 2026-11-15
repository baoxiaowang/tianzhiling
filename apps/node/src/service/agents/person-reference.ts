const KIN_TERMS =
  '妈|妈妈|母亲|爸|爸爸|父亲|老婆|妻子|老公|丈夫|儿子|女儿|孩子|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|姥姥|姥爷|外公|外婆|婆婆|公公';

const FIRST_PERSON_KIN_PATTERN = new RegExp(
  `我(${KIN_TERMS})`,
  'gu'
);
const SECOND_PERSON_KIN_PATTERN = new RegExp(
  `你(${KIN_TERMS})`,
  'gu'
);

export interface PersonReferenceDirective {
  firstPersonTerms: string[];
  secondPersonTerms: string[];
  prompt: string;
}

export function buildPersonReferenceDirective(
  currentQuery: string
): PersonReferenceDirective | null {
  const text = String(currentQuery || '');
  const firstPersonTerms = uniqueMatches(text, FIRST_PERSON_KIN_PATTERN);
  const secondPersonTerms = uniqueMatches(text, SECOND_PERSON_KIN_PATTERN);
  if (!firstPersonTerms.length && !secondPersonTerms.length) return null;
  const lines = ['## 本轮亲属指代'];
  if (firstPersonTerms.length) {
    lines.push(
      `用户说“我${firstPersonTerms.join('、我')}”时，这些人是用户这边的亲属。回复不要原样重复“我${firstPersonTerms[0]}”，应使用“你${firstPersonTerms[0]}”“咱${firstPersonTerms[0]}”或双方约定的直接称呼。`
    );
  }
  if (secondPersonTerms.length) {
    lines.push(
      `用户说“你${secondPersonTerms.join('、你')}”时，这些人是当前角色这边的亲属；回复可用“我${secondPersonTerms[0]}”或按关系称呼。`
    );
  }
  lines.push('亲属称呼要按说话人视角转换，不把用户的第一人称原样复制成角色自称。');
  return {
    firstPersonTerms,
    secondPersonTerms,
    prompt: lines.join('\n'),
  };
}

export function detectPersonReferenceMismatch(
  currentQuery: string,
  reply: string
): string | undefined {
  const query = String(currentQuery || '');
  const text = String(reply || '');
  const firstPersonTerms = uniqueMatches(query, FIRST_PERSON_KIN_PATTERN);
  if (!firstPersonTerms.length) return undefined;
  for (const term of firstPersonTerms) {
    if (new RegExp(`我${term}`, 'u').test(text)) {
      return `用户说“我${term}”指用户这边的亲属，回复却原样使用了“我${term}”`;
    }
  }
  return undefined;
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const values: string[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1];
    if (value && !values.includes(value)) values.push(value);
  }
  pattern.lastIndex = 0;
  return values;
}

export function normalizePersonReferenceInReply(
  currentQuery: string,
  reply: string
): string {
  const query = String(currentQuery || '');
  let text = String(reply || '');
  const firstPersonTerms = uniqueMatches(query, FIRST_PERSON_KIN_PATTERN);
  if (!firstPersonTerms.length) return text;
  for (const term of firstPersonTerms) {
    // 只处理明确的“我+亲属”原样复制；不碰“你妈”“咱妈”等已经转换过的说法。
    text = text.replace(new RegExp(`我${term}`, 'gu'), `你${term}`);
  }
  return text;
}
