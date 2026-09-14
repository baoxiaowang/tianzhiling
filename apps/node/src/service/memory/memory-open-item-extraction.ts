export const OPEN_ITEM_EXTRACTION_VERSION =
  'memory_open_item_extraction_v1' as const;

/** 允许的事项类别：与检索/组合的话题表对齐，模型只能从这里选。 */
export const OPEN_ITEM_TOPIC_KEYS = [
  '就医',
  '身体',
  '学业',
  '工作',
  '居住',
  '钱财',
  '婚育',
  '关系矛盾',
  '习惯',
  '家人',
  '纪念日',
] as const;

export type OpenItemTopicKey = (typeof OPEN_ITEM_TOPIC_KEYS)[number];

export type OpenItemCandidateState = 'awaiting_result' | 'action_committed';

export interface OpenItemExtractionMessage {
  messageId: string;
  content: string;
  occurredAt: string;
}

export interface OpenItemCandidate {
  messageId: string;
  /** 逐字引用输入里的原话，程序会校验它确实是某条消息的子串。 */
  quote: string;
  topicKey: OpenItemTopicKey;
  state: OpenItemCandidateState;
  importance: 1 | 2 | 3;
  dueHint?: string;
  subjectRef?: string;
}

export interface OpenItemExtractionParseResult {
  candidates: OpenItemCandidate[];
  /** 被程序拒掉的项及原因，便于诊断与调提示词。 */
  rejected: Array<{ reason: string; raw?: unknown }>;
}

export const OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT = [
  '你的任务是从一段用户原话里，挑出**极少数真正需要以后再跟进的事件型内容**，供陪伴型聊天对象日后适时关心。',
  '',
  '只收同时满足以下全部条件的内容：',
  '1. 是用户自己未来要面对、正在等结果、或已经明确答应/下决心要做的一件**有头有尾的事**（事件型）；',
  '2. 有具体事项，能从这几个类别里选一个：就医、身体、学业、工作、居住、钱财、婚育、关系矛盾、习惯、家人、纪念日；',
  '3. 这件事现在没有结果：还没去、还没出结果、还在等、或者刚下了决心要做。',
  '',
  '以下一律不收（这是本任务最容易犯的错）：',
  '- 回忆过去的事（"以前""那时候""去年还做了手术"）；',
  '- **已经做完、只有回忆语气、或者没有明确将来动作的**（"我后悔那天没多劝你去检查""我七八岁的时候，那会哥还没结婚""今天送闺女上大学回来了"）——这类即使里面有日期、有检查、有结婚，也不是要跟进的事；',
  '- 情绪与思念（"我感觉你没走""我想你了""我好痛苦"）；',
  '- 日常作息与当下动作（"准备去上班了""明天还要上班""我休息一会儿"）；',
  '- 已经了结或已有结果的（"没事了""考完了""已经出院了""检查完了，有点焦虑"）；',
  '- 一闪而过的身体小症状，没有就诊、用药或治疗在跟进的（"有点肚子不舒服""腿还是有点疼""头有点重"）；',
  '- 只是表态、不是要去做的事（"可我不想结婚"）；',
  '- 别人的一般状态（"他34岁了还没结婚""家里一切都好"）；',
  '- 用户明确不想提的（"别问了""不想提"）。',
  '',
  '判断窍门：把这句话当成"过几天你会不会自然地问起这件事"。会，才收；只是听了一句心里话，就不收。',
  '',
  '引用必须是一句能独立讲清"谁要做什么、在等什么"的完整原话：',
  '- 不许只截半句（如"还有4个月的时间""就是明天下午最后一台"这种没有主事的片段不要给；',
  '  除非同一句里能看出是哪件事，才用更完整的原话引用）；',
  '- 引用的原话里至少要有"人"或"时间/日子"的信息，让人看得出这是谁的什么事。',
  '',
  '另外两条容易犯的：',
  '- 只有身体症状、没有就诊/用药/治疗在跟进的，不收（"看东西有重影""头很重一直哭"这类）；',
  '- 只是陈述某人的状态、没有"要做什么/在等什么"的，不收（"女儿才7个多月""他病重了"）。',
  '',
  '关于纪念日：六七、满七、百天、头七、生日、周年、忌日、中元、清明这类"日子"要照常识别，',
  '但它们属于"日子"不是"要跟进的事"，程序会把它们和待跟进的事分开存放；给的时候照常标 topicKey=纪念日。',
  '- 就医、身体类：必须有挂号/预约/复查/治疗/用药/手术在往后走；',
  '- 家人类：是家人的具体安排或状况（要接送、要看病、要去外地），subjectRef 必须写明是谁；',
  '- 纪念日类：满七、百天、周年、忌日这类日子，importance 一律填 1。',
  '',
  '输出要求：',
  '- 宁可少给，不可乱给。没有值得跟进的，就返回空数组；一般一批里 0~2 条，最多 4 条。',
  '- 每条必须逐字引用输入里的原话片段（quote），不得改写、不得拼接、不得补充原文没有的信息；',
  '- messageId 必须取自输入；quote 必须是该消息内容里连续出现的一段原文；',
  '- state：还在等结果用 awaiting_result；用户答应/下决心要做的用 action_committed；',
  '- importance：就医、身体、钱财这类重的给 3，纪念日类一律 1，其余一般 2；',
  '- dueHint：原话里明确说了时间点就照抄（如"下周""下个月"），没说不填；',
  '- subjectRef：原话里明确点出是哪位家人的姓名/称呼才填，没说不填。',
  '',
  '只输出 JSON，不要解释：',
  '{"items":[{"messageId":"...","quote":"...","topicKey":"就医","state":"awaiting_result","importance":3,"dueHint":"下周"}]}',
].join('\n');

export function buildOpenItemExtractionPrompt(
  messages: OpenItemExtractionMessage[]
): string {
  return JSON.stringify({
    version: OPEN_ITEM_EXTRACTION_VERSION,
    allowedTopicKeys: OPEN_ITEM_TOPIC_KEYS,
    messages: messages.map(message => ({
      messageId: message.messageId,
      occurredAt: message.occurredAt,
      content: message.content,
    })),
    task: '从上面的用户原话里挑出少数真正需要以后再跟进的事件型内容；没有就返回空数组。',
  });
}

/** 回忆/往事信号：只有这类信号、又没有明确的将来动作时，不是未了结的事。 */
const RETROSPECT_PATTERN =
  /(?:那时候|那时|当时|以前|去年|前年|当年|小时候|\d{1,2}岁|几岁|年轻时|曾经|后来|后悔|没来得及|想起|回想|那会|那天)/u;
/** 明确的将来/待办信号：只要它是"将来要做的"，就算过去时描述也值得跟进。 */
const STRONG_FUTURE_PATTERN =
  /(?:下周|下个星期|下个月|明天|后天|过几天|到时候|要去|得去|打算|准备去|计划去|约好|答应|要开始|开始戒|在戒|还没去|还没做|还没办|还没出|还没定|等结果|等消息)/u;
/** 已经做完的信号：没有将来动作时，不算待跟进。 */
const COMPLETED_PATTERN =
  /(?:已经[^，。]{0,6}了|回来了|办完了|送完了|考完了|做完了|出院了|好了|看完了|办好了)/u;

/** 只有回忆/已经做完、没有明确将来动作的原话：不是未了结的事。 */
export function isPastOnlyStatement(text: string): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  const looksBack =
    RETROSPECT_PATTERN.test(value) || COMPLETED_PATTERN.test(value);
  if (!looksBack) return false;
  // 例外：里面还带着"将来要去做"的动作（"那天没去成，下周再去"）。
  return !STRONG_FUTURE_PATTERN.test(value);
}

/** 原话里出现"人"或"时间/日子"才算能看出主事的一句话。 */
const PERSON_OR_TIME_MARKER_PATTERN =
  /(?:我|俺|咱|他|她|爸|妈|爹|娘|奶|爷|姥|婆|公|哥|姐|弟|妹|儿|女|娃|孩子|老公|老婆|老大|老二|小姨|叔|婶|舅|同学|同事|医生|护士|今天|明天|后天|昨天|前天|下周|下个|下星期|这周|本周|月底|月初|过年|春节|中元|清明|七月半|月半|生日|忌日|周年|满七|百天|六七|七七|头七|号|个月|多天|几天)/u;

/** 身体类必须伴随就医/用药/治疗，否则只是症状。 */
const CARE_IN_PROGRESS_PATTERN =
  /(?:医院|医生|大夫|挂号|号|复查|复诊|检查|化验|拿药|开药|吃药|中药|西药|药|治疗|化疗|放疗|住院|出院|手术|就诊|看病|产检|体检|输液)/u;

/** 去掉标点空白后的内容，用于"quote 是否逐字来自原话"的校验。 */
export function normalizeExtractionText(value: string): string {
  return (value || '')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/**
 * 解析并校验模型输出。
 * 程序只认"quote 确实逐字出现在某条输入消息里"的项；引用不上的直接丢掉。
 */
export function parseOpenItemExtractionOutput(
  rawContent: string,
  messages: OpenItemExtractionMessage[]
): OpenItemExtractionParseResult {
  const rejected: Array<{ reason: string; raw?: unknown }> = [];
  const candidates: OpenItemCandidate[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      (rawContent || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/u, '')
    );
  } catch {
    return { candidates, rejected: [{ reason: 'invalid_json' }] };
  }

  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) {
    return { candidates, rejected: [{ reason: 'missing_items' }] };
  }

  const allowedTopics: string[] = [...OPEN_ITEM_TOPIC_KEYS];

  for (const item of items.slice(0, 12)) {
    const record = (item || {}) as Record<string, unknown>;
    const topicKey = String(record.topicKey || '').trim();
    if (allowedTopics.indexOf(topicKey) === -1) {
      rejected.push({ reason: 'topic_not_allowed', raw: item });
      continue;
    }
    const state = String(record.state || '').trim();
    if (state !== 'awaiting_result' && state !== 'action_committed') {
      rejected.push({ reason: 'invalid_state', raw: item });
      continue;
    }
    const importanceRaw = Number(record.importance);
    const importance = (
      importanceRaw === 3 ? 3 : importanceRaw === 1 ? 1 : 2
    ) as 1 | 2 | 3;

    const quote = String(record.quote || '').trim();
    const normalizedQuote = normalizeExtractionText(quote);
    if (normalizedQuote.length < 8) {
      rejected.push({ reason: 'quote_too_short', raw: item });
      continue;
    }
    // 原话里至少要有"人"或"时间/日子"，否则是看不出主事的片段。
    if (!PERSON_OR_TIME_MARKER_PATTERN.test(quote) && topicKey !== '纪念日') {
      rejected.push({ reason: 'quote_without_subject_or_time', raw: item });
      continue;
    }
    // 只有回忆、或者已经做完、没有明确将来动作的，不收。
    if (isPastOnlyStatement(quote)) {
      rejected.push({ reason: 'past_only_statement', raw: item });
      continue;
    }
    // 只有症状、没有就医/用药/治疗在跟进的不收。
    if (topicKey === '身体' && !CARE_IN_PROGRESS_PATTERN.test(quote)) {
      rejected.push({ reason: 'symptom_without_care', raw: item });
      continue;
    }

    const declaredId = String(record.messageId || '').trim();
    const matched =
      messages.find(
        message =>
          message.messageId === declaredId &&
          normalizeExtractionText(message.content).indexOf(normalizedQuote) !==
            -1
      ) ||
      messages.find(
        message =>
          normalizeExtractionText(message.content).indexOf(normalizedQuote) !==
          -1
      );
    if (!matched) {
      rejected.push({ reason: 'quote_not_found_in_source', raw: item });
      continue;
    }

    candidates.push({
      messageId: matched.messageId,
      quote: matched.content.includes(quote) ? quote : matched.content,
      topicKey: topicKey as OpenItemTopicKey,
      state: state as OpenItemCandidateState,
      importance,
      ...(record.dueHint
        ? { dueHint: String(record.dueHint).slice(0, 20) }
        : {}),
      ...(record.subjectRef
        ? { subjectRef: String(record.subjectRef).slice(0, 20) }
        : {}),
    });
  }

  return { candidates: candidates.slice(0, 4), rejected };
}

/** 小窗口上限：消息很少的用户，把最近的原话整段交给模型，上下文更完整。 */
export const OPEN_ITEM_SMALL_WINDOW_MAX = 40;
/** 大窗口上限：消息多的用户，先按"事实型"收窄，再截最近这些条。 */
export const OPEN_ITEM_LARGE_WINDOW_MAX = 60;

/**
 * 挑选交给模型的候选窗口（实测结论）：
 * - 消息少的用户（≤40 条）直接给全部最近原话——只给事实型会把 0.32 条/人压到 0.05 条/人；
 * - 消息多的用户先按事实型收窄，避免上下文过长、成本变高。
 */
export function selectOpenItemExtractionWindow<T>(
  rows: T[],
  options: {
    textOf: (row: T) => string;
    isFactBearing: (text: string) => boolean;
    smallWindowMax?: number;
    largeWindowMax?: number;
  }
): T[] {
  const smallWindowMax = options.smallWindowMax ?? OPEN_ITEM_SMALL_WINDOW_MAX;
  const largeWindowMax = options.largeWindowMax ?? OPEN_ITEM_LARGE_WINDOW_MAX;
  const usable = rows.filter(
    row => (options.textOf(row) || '').trim().length >= 2
  );
  if (usable.length <= smallWindowMax) return usable.slice();
  return usable
    .filter(row => options.isFactBearing(options.textOf(row)))
    .slice(-largeWindowMax);
}
