export interface ConversationEntityLedgerDeclaration {
  name: string;
  relationToUser?: string;
  relationToAgent?: string;
}

export interface ConversationEntityLedgerPromptEntry {
  id: string;
  name: string;
  relationToUser?: string;
  relationToAgent?: string;
  status: string;
  sourceMessageId?: string;
  sourceText?: string;
  lastMentionedAt: Date;
}

const RELATION_PATTERN =
  '儿子|女儿|闺女|孩子|宝宝|宝贝|孙子|孙女|外孙|外孙女|哥哥|姐姐|弟弟|妹妹|爸爸|妈妈|父亲|母亲|爷爷|奶奶|外公|外婆|姥姥|姥爷|丈夫|妻子|老公|老婆|爱人|伴侣';

const NAME_PATTERN = '[\\u4e00-\\u9fa5A-Za-z·]{1,6}';
const NEGATION_OR_QUESTION = /[？?]|吗|是不是|不是|没有|没(?:有)?|不记得|忘了/u;

function normalizeName(value: string): string {
  return value.replace(/[，,。！？!?；;：:、\s"'“”‘’]/g, '').trim();
}

const INVALID_ENTITY_NAMES = new Set([
  '也', '又', '还', '就', '才', '都', '只', '只是', '她', '他', '我', '你',
  '我们', '你们', '他们', '她们', '这', '那', '这个', '那个', '一个', '自己',
  '人家', '别人', '谁', '什么', '哪个', '这里', '那里', '现在', '以后', '然后',
  '所以', '因为', '但是', '而且', '如果', '已经', '一直', '总是', '每次', '好',
  '对', '是', '的', '了', '吗', '呢', '吧', '啊', '呀', '哦', '嗯',
]);

const INVALID_ENTITY_NAME_PATTERN =
  /她|他|我|你|它|的|了|和|与|也|都|就|还|只|叫|是|有|在|这|那|什么|谁|哪个|吗|呢|吧|啊|呀|哦|嗯|爸爸|妈妈|父亲|母亲|儿子|女儿|孩子|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|外公|外婆|姥姥|姥爷|老公|老婆/;

export function isValidConversationEntityName(value: string): boolean {
  const name = normalizeName(value);
  if (!name || name.length > 6) return false;
  if (INVALID_ENTITY_NAMES.has(name)) return false;
  if (INVALID_ENTITY_NAME_PATTERN.test(name)) return false;
  if (/^[0-9]+$/.test(name)) return false;
  return true;
}

export function extractConversationEntityDeclarations(
  sourceText: string
): ConversationEntityLedgerDeclaration[] {
  const text = (sourceText || '').replace(/\s+/g, '').trim();
  if (!text || NEGATION_OR_QUESTION.test(text)) return [];

  const patterns: Array<{
    regex: RegExp;
    nameIndex: number;
    relationIndex: number;
    target: 'user' | 'agent';
  }> = [
    {
      regex: new RegExp(
        `(?:^|[，,。；;])(${NAME_PATTERN})[，,](?:是|就是)?我(?:的)?(${RELATION_PATTERN})(?=$|[，,。；;])`,
        'g'
      ),
      nameIndex: 1,
      relationIndex: 2,
      target: 'user',
    },
    {
      regex: new RegExp(
        `(?:^|[，,。；;])(${NAME_PATTERN})(?:是|就是)我(?:的)?(${RELATION_PATTERN})(?=$|[，,。；;])`,
        'g'
      ),
      nameIndex: 1,
      relationIndex: 2,
      target: 'user',
    },
    {
      regex: new RegExp(
        `(?:^|[，,。；;])(${NAME_PATTERN})[，,](?:是|就是)?你(?:的)?(${RELATION_PATTERN})(?=$|[，,。；;])`,
        'g'
      ),
      nameIndex: 1,
      relationIndex: 2,
      target: 'agent',
    },
    {
      regex: new RegExp(
        `(?:^|[，,。；;])(${NAME_PATTERN})(?:是|就是)你(?:的)?(${RELATION_PATTERN})(?=$|[，,。；;])`,
        'g'
      ),
      nameIndex: 1,
      relationIndex: 2,
      target: 'agent',
    },
    {
      regex: new RegExp(
        `你(?:的)?(${RELATION_PATTERN})(?:叫|名叫|是)(${NAME_PATTERN})(?=$|[，,。；;])`,
        'g'
      ),
      nameIndex: 2,
      relationIndex: 1,
      target: 'agent',
    },
    {
      regex: new RegExp(
        `我(?:的)?(${RELATION_PATTERN})(?:叫|名叫|是)(${NAME_PATTERN})(?=$|[，,。；;])`,
        'g'
      ),
      nameIndex: 2,
      relationIndex: 1,
      target: 'user',
    },
  ];


  const byName = new Map<string, ConversationEntityLedgerDeclaration>();
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text))) {
      const name = normalizeName(match[pattern.nameIndex] || '');
      const relation = (match[pattern.relationIndex] || '').trim();
      if (!name || !relation || name.length > 12) {
        if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
        continue;
      }
      if (!isValidConversationEntityName(name)) {
        if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
        continue;
      }
      const prior = byName.get(name) || { name };
      byName.set(name, {
        ...prior,
        ...(pattern.target === 'user'
          ? { relationToUser: relation }
          : { relationToAgent: relation }),
      });
      if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
    }
  }

  return [...byName.values()];
}

function formatRelation(value?: string): string {
  return (value || '').trim();
}

export function renderConversationEntityPrompt(
  entries: ConversationEntityLedgerPromptEntry[]
): string {
  if (!entries.length) return '';
  const lines = [
    '# 本会话已知人物',
    '这些是用户在本会话中明确说过的人物关系，优先于猜测；只在与当前话题相关时使用，不确定就自然问一句。',
  ];
  for (const entry of entries.slice(0, 8)) {
    const relations: string[] = [];
    if (entry.relationToAgent) {
      relations.push(`是当前角色的${formatRelation(entry.relationToAgent)}`);
    }
    if (entry.relationToUser) {
      relations.push(`是用户的${formatRelation(entry.relationToUser)}`);
    }
    const relationText = relations.length
      ? relations.join('，')
      : '关系未确认';
    const statusText =
      entry.status === 'conflicted'
        ? '（关系有冲突，先用一句自然问法确认）'
        : '';
    const source = entry.sourceText?.trim()
      ? `（用户原话：“${entry.sourceText.trim().slice(0, 40)}”）`
      : '';
    lines.push(`- ${entry.name}：${relationText}${statusText}${source}`);
  }
  lines.push('不要把这个名字猜成宠物、朋友或其他关系；没有把握时先问。');
  return lines.join('\n');
}

