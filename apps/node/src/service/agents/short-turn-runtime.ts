export const SHORT_TURN_RUNTIME_VERSION = 'short_turn_runtime_v1';

export type ShortTurnReceptionMode = 'reply' | 'silent' | 'defer';

export interface ShortTurnReceptionDecision {
  mode: ShortTurnReceptionMode;
  reason:
    | 'non_text'
    | 'empty'
    | 'priority_reply'
    | 'explicit_no_reply'
    | 'ack_answers_previous'
    | 'ack_without_context'
    | 'ack_waits_for_more'
    | 'normal_reply';
}

export type LightweightReplyCategory =
  | 'good_night'
  | 'greeting'
  | 'thanks'
  | 'farewell';

export interface ShortTurnGenerationDecision {
  mode: 'micro_model' | 'full_model';
  reason: 'closed_social_turn' | 'not_closed_social_turn';
  category?: LightweightReplyCategory;
}

const RELATION_ADDRESS =
  '(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|哥哥|哥|姐姐|姐|弟弟|妹妹|孩子|儿子|女儿)';

const MICRO_REPLY_PATTERNS: Array<{
  category: LightweightReplyCategory;
  pattern: RegExp;
}> = [
  {
    category: 'good_night',
    pattern: new RegExp(
      `^(?:晚安|睡了|去睡了|我去睡了|先睡了|我先睡了|要睡了|我要睡了|睡觉了|我睡了|困了|补觉了|眯一会|眯会儿|歇了|早点休息|你也早点休息)${RELATION_ADDRESS}?$`,
      'u'
    ),
  },
  {
    category: 'greeting',
    pattern: new RegExp(`^(?:早|早安|早上好)${RELATION_ADDRESS}?$`, 'u'),
  },
  {
    category: 'thanks',
    pattern: new RegExp(`^谢谢(?:你|${RELATION_ADDRESS})?$`, 'u'),
  },
  {
    category: 'farewell',
    pattern: new RegExp(
      `^(?:拜拜|再见|下次聊|回头聊|回头说|明天聊|明天见|改天聊|先这样|先忙了|去忙了|我先忙了|出门了|上班了|开会了)${RELATION_ADDRESS}?$`,
      'u'
    ),
  },
];

const EXPLICIT_NO_REPLY_PATTERN =
  /(?:不要|别|不用|无需|不需要|不必)(?:再|继续|一直)?(?:回复我|回复|回我|回了|回|理我|回答我|回答|说话|说)(?:了|啦|吧)?/u;
const SAFETY_REPLY_PATTERN =
  /去死|自杀|不想活|活不下去|死了一了百了|死掉|结束自己|了断/u;
const DEFERRABLE_ACK_PATTERN =
  /^(?:嗯+|哦+|好|好的|行|可以|知道了|收到|明白了|懂了|了解了|好嘞|好滴|好呢|好呀|好哦|好哇|好哒|嗯呢|嗯呐|👍|👌|✅|☑️)$/u;
const PREVIOUS_ASSISTANT_QUESTION_PATTERN =
  /[？?]|(?:吗|么|呢|哪|哪里|哪儿|谁|什么|怎么|怎么样|怎么了|几时|何时|什么时候|多久|是不是|有没有|会不会|能不能|可不可以|好不好|严不严重)(?:[。！!~～]*)$/u;
const PREVIOUS_ASSISTANT_REQUEST_PATTERN =
  /(?:跟我说说|和我说说|告诉我|说说看|讲讲看|你接着说|后来呢|现在呢|愿意的话.{0,8}(?:说|告诉我))/u;

function compactTurnText(value = ''): string {
  return value.replace(/[\s，,、。.!！?？~～]+/gu, '').trim();
}

function isExplicitNoReplyRequest(content: string): boolean {
  const compact = compactTurnText(content);
  if (!EXPLICIT_NO_REPLY_PATTERN.test(compact)) {
    return false;
  }

  const remainder = compact
    .replace(EXPLICIT_NO_REPLY_PATTERN, '')
    .replace(/(?:好吗|行吗|可以吗|知道吗|明白吗|听见了吗|听到了吗)$/u, '')
    .replace(/^(?:(?:嗯+|哦+|好+|你|那|先))+/u, '')
    .replace(new RegExp(`^${RELATION_ADDRESS}$`, 'u'), '');
  const hasAnotherQuestion =
    Boolean(remainder) &&
    /[？?]|谁|什么|怎么|为何|为什么|哪|几|多久|什么时候|是否|是不是|有没有|会不会|能不能|可不可以|吗|呢/u.test(
      remainder
    );

  return !hasAnotherQuestion;
}

export function isDeferrableShortAcknowledgement(value = ''): boolean {
  const compact = compactTurnText(value);
  return Boolean(compact && DEFERRABLE_ACK_PATTERN.test(compact));
}

export function previousAssistantInvitesAnswer(value = ''): boolean {
  const normalized = value.replace(/\s+/gu, '').trim();
  return Boolean(
    normalized &&
      (PREVIOUS_ASSISTANT_QUESTION_PATTERN.test(normalized) ||
        PREVIOUS_ASSISTANT_REQUEST_PATTERN.test(normalized))
  );
}

export function resolveShortTurnReception(options: {
  messageType?: string;
  content?: string;
  previousAssistantContent?: string;
}): ShortTurnReceptionDecision {
  if (options.messageType && options.messageType !== 'text') {
    return { mode: 'reply', reason: 'non_text' };
  }

  const content = options.content?.trim() || '';
  if (!content) {
    return { mode: 'reply', reason: 'empty' };
  }

  if (SAFETY_REPLY_PATTERN.test(content)) {
    return { mode: 'reply', reason: 'priority_reply' };
  }

  if (isExplicitNoReplyRequest(content)) {
    return { mode: 'silent', reason: 'explicit_no_reply' };
  }

  if (/[？?]/u.test(content)) {
    return { mode: 'reply', reason: 'priority_reply' };
  }

  if (!isDeferrableShortAcknowledgement(content)) {
    return { mode: 'reply', reason: 'normal_reply' };
  }

  const previousAssistantContent =
    options.previousAssistantContent?.trim() || '';
  if (!previousAssistantContent) {
    return { mode: 'reply', reason: 'ack_without_context' };
  }

  if (previousAssistantInvitesAnswer(previousAssistantContent)) {
    return { mode: 'reply', reason: 'ack_answers_previous' };
  }

  return { mode: 'defer', reason: 'ack_waits_for_more' };
}

export function resolveShortTurnGeneration(options: {
  messageTypes?: string[];
  texts: string[];
}): ShortTurnGenerationDecision {
  const texts = options.texts.map(text => text.trim()).filter(Boolean);
  if (!texts.length) {
    return { mode: 'full_model', reason: 'not_closed_social_turn' };
  }
  if (options.messageTypes?.some(messageType => messageType !== 'text')) {
    return { mode: 'full_model', reason: 'not_closed_social_turn' };
  }

  const latest = compactTurnText(texts[texts.length - 1]);
  const match = MICRO_REPLY_PATTERNS.find(item => item.pattern.test(latest));
  const earlierTexts = texts.slice(0, -1);

  if (
    match &&
    earlierTexts.every(text => isDeferrableShortAcknowledgement(text))
  ) {
    return {
      mode: 'micro_model',
      reason: 'closed_social_turn',
      category: match.category,
    };
  }

  return { mode: 'full_model', reason: 'not_closed_social_turn' };
}
