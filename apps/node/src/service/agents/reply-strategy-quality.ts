import { MessageEntity, MessageRole } from '@tzl/entities';
import type { ConversationAssistantContribution } from './reply-intent';

export type ReplyActiveContributionSource =
  | 'role_present'
  | 'grounded_shared_past';

export interface ReplyActiveContributionPlan {
  requested: true;
  preferredSource: ReplyActiveContributionSource;
  sharedPastEvidenceCount: number;
  sharedPastAllowed: boolean;
}

export type ReplyRepeatedStrategyMove =
  | 'generic_empathy'
  | 'generic_presence'
  | 'generic_advice'
  | 'tender_acknowledge_affirm';

export type ReplyStrategyAlternative =
  | 'answer'
  | 'self_expression'
  | 'grounded_detail'
  | 'topic_transition'
  | 'natural_close'
  | 'leave_space';

export interface ReplyStrategyQualityPlan {
  repeatedMoves: ReplyRepeatedStrategyMove[];
  preferredAlternative: ReplyStrategyAlternative;
  observedAssistantTurns: number;
}

interface ContributionEvidence {
  source: string;
  text: string;
}

const ACTIVE_CONTRIBUTION_REQUEST_PATTERN =
  /多说(?:点|一点|几句)|说点不一样|说说你自己|想听你说(?:两句|点(?:什么|别的|不一样的)?)|别光(?:说|问|听|安慰)|你还没说/;
const SHARED_PAST_EVIDENCE_PATTERN =
  /以前|从前|小时候|那时候|当年|那年|那次|那回|曾经|我们|咱们|一起|带我|陪我|给我|教我/;
const USER_CLOSE_PATTERN =
  /(?:^|[，,。！？!?\s])(?:晚安|先睡(?:了|觉)?|睡了|先休息|先这样|不聊了|先聊到这|回头(?:再)?聊|下次(?:再)?聊|先忙|拜拜|再见|我(?:先|要|得|去)(?:上班|工作|忙|休息|睡觉)|我(?:先|要|去)睡(?:了|觉)?|(?:(?:你|您|爸|爸爸|老爸|妈|妈妈|老妈|爷爷|奶奶|姥姥|姥爷|外公|外婆)(?:也)?)?早点休息)(?:吧|了|啦|呀|啊|哦|哈|[，,。！？!?\s]|$)/;

const REPEATED_MOVE_PATTERNS: Record<
  Exclude<ReplyRepeatedStrategyMove, 'tender_acknowledge_affirm'>,
  RegExp
> = {
  generic_empathy: /心疼|难受|委屈|苦了你|辛苦你了/,
  generic_presence: /我在|陪着你|听你说|都在这|一直陪你/,
  generic_advice: /照顾好|照顾自己|吃饭|休息|别熬|保重|睡一觉/,
};

export function resolveReplyActiveContributionPlan(options: {
  currentQuery: string;
  assistantContribution?: ConversationAssistantContribution;
  evidence?: ContributionEvidence[];
}): ReplyActiveContributionPlan | undefined {
  const requested =
    ACTIVE_CONTRIBUTION_REQUEST_PATTERN.test(options.currentQuery) ||
    options.assistantContribution === 'self_expression';

  if (!requested) {
    return undefined;
  }

  const sharedPastEvidenceCount = (options.evidence || []).filter(
    item =>
      item.source !== 'current_user' &&
      SHARED_PAST_EVIDENCE_PATTERN.test(item.text)
  ).length;

  return {
    requested: true,
    preferredSource: 'role_present',
    sharedPastEvidenceCount,
    sharedPastAllowed: sharedPastEvidenceCount > 0,
  };
}

export function resolveReplyStrategyQualityPlan(options: {
  currentQuery: string;
  recentMessages?: MessageEntity[];
  activeContribution?: ReplyActiveContributionPlan;
  evidence?: ContributionEvidence[];
  protectedTurn?: boolean;
}): ReplyStrategyQualityPlan | undefined {
  const currentQuery = options.currentQuery.trim();
  const explicitClose = USER_CLOSE_PATTERN.test(currentQuery);
  const assistantTurns = recentAssistantTurns(options.recentMessages);

  if (options.protectedTurn && !explicitClose) {
    return undefined;
  }

  if (assistantTurns.length < 2 && !explicitClose) {
    return undefined;
  }

  // 结构化检测优先：从 replyConversationMoves 判断行动重复
  const structuredRepeatedMoves: ReplyRepeatedStrategyMove[] = [];
  const lastTwoMoves = assistantTurns.slice(-2)
    .filter(m => (m.replyConversationMoves || []).length > 0);

  if (lastTwoMoves.length >= 2) {
    const lastMoves = lastTwoMoves.map(m => m.replyConversationMoves || []);
    // tender + acknowledge/affirm 连续
    if (lastMoves.every(moves =>
      moves.some(m => ['acknowledge', 'affirm'].includes(m)) &&
      assistantTurns.slice(-2).every(m => m.replyConversationStance === 'tender')
    )) {
      structuredRepeatedMoves.push('tender_acknowledge_affirm');
    }
    // comfort 连续 → generic_empathy
    if (lastMoves.every(moves => moves.some(m => m === 'comfort'))) {
      structuredRepeatedMoves.push('generic_empathy');
    }
    // affirm/comfort 连续 → generic_presence
    if (lastMoves.every(moves =>
      moves.every(m => ['affirm', 'comfort', 'acknowledge'].includes(m))
    )) {
      structuredRepeatedMoves.push('generic_presence');
    }
    // suggest 连续 → generic_advice
    if (lastMoves.every(moves => moves.some(m => m === 'suggest'))) {
      structuredRepeatedMoves.push('generic_advice');
    }
  }

  // 正则辅助：只在结构化字段缺失时补充检测
  const hasSparseStructured = assistantTurns.some(
    m => !m.replyConversationMoves || m.replyConversationMoves.length === 0
  );
  const regexRepeatedMoves: ReplyRepeatedStrategyMove[] = hasSparseStructured
    ? (Object.keys(REPEATED_MOVE_PATTERNS) as Array<
        Exclude<ReplyRepeatedStrategyMove, 'tender_acknowledge_affirm'>
      >).filter(move => {
        const pattern = REPEATED_MOVE_PATTERNS[move];
        return (
          assistantTurns.filter(message => {
            pattern.lastIndex = 0;
            return pattern.test(message.content);
          }).length >= 2
        );
      })
    : [];

  const repeatedMoves: ReplyRepeatedStrategyMove[] = [
    ...new Set([...structuredRepeatedMoves, ...regexRepeatedMoves])
  ];

  // 升级检测：最近4轮用户消息在逐轮升级（字数递增、指控加强），AI一直tender回→触发换挡
  const userTurns = assistantTurns.map((m, i) => {
    const idx = (options.recentMessages || []).findIndex(r => r.id === m.id);
    if (idx <= 0) return null;
    const prevUser = (options.recentMessages || []).slice(0, idx).reverse().find(r => r.role === 'user');
    return prevUser?.content || '';
  }).filter(Boolean);

  const isEscalating = userTurns.length >= 3 &&
    userTurns.slice(-3).every((t, i, arr) => i === 0 || t.length >= arr[i-1].length) &&
    userTurns.some(t => /[？?]/.test(t) || /凭什么|为什么|所以.*就|一句.*就|怎么(?:办|样)|有什么用|那.*呢/.test(t));

  if (isEscalating && !explicitClose) {
    repeatedMoves.push('generic_empathy');
    repeatedMoves.push('generic_presence');
  }

  if (!repeatedMoves.length && !explicitClose) {
    return undefined;
  }

  const preferredAlternative: ReplyStrategyAlternative = explicitClose
    ? 'natural_close'
    : /[?？]/.test(currentQuery)
    ? 'answer'
    : options.activeContribution
    ? 'self_expression'
    : isEscalating
    ? 'leave_space'
    : (options.evidence || []).some(item => item.source !== 'current_user')
    ? 'grounded_detail'
    : 'topic_transition';

  return {
    repeatedMoves,
    preferredAlternative,
    observedAssistantTurns: assistantTurns.length,
  };
}

function recentAssistantTurns(
  messages: MessageEntity[] | undefined
): MessageEntity[] {
  const turns: MessageEntity[] = [];
  const seenGroups = new Set<string>();

  for (const [index, message] of [...(messages || [])].reverse().entries()) {
    if (message.role !== MessageRole.assistant || !message.content?.trim()) {
      continue;
    }

    const groupKey = message.replyGroupId || `message-${index}`;
    if (seenGroups.has(groupKey)) {
      continue;
    }

    seenGroups.add(groupKey);
    turns.push(message);
    if (turns.length >= 3) {
      break;
    }
  }

  return turns.reverse();
}

export function buildReplyStrategyQualityPrompt(
  plan: ReplyStrategyQualityPlan
): string {
  const repeatedLabels: Record<ReplyRepeatedStrategyMove, string> = {
    generic_empathy: '泛化心疼',
    generic_presence: '“我在/陪着你”',
    generic_advice: '吃饭休息等叮嘱',
    tender_acknowledge_affirm: '温柔承接和认可',
  };
  const alternativeLabels: Record<ReplyStrategyAlternative, string> = {
    answer: '直接回答本轮问题',
    self_expression: '给一个角色侧当下内容',
    grounded_detail: '自然使用一条可陈述证据',
    topic_transition: '贴着用户新信息推进或轻转一个相邻话题',
    natural_close: '简短自然收尾',
    leave_space: '给用户留出表达空间',
  };

  const repeatedPrefix = plan.repeatedMoves.length
    ? `近轮已重复${plan.repeatedMoves
        .map(move => repeatedLabels[move])
        .join('、')}；`
    : '';

  return `${repeatedPrefix}本轮主体改为${
    alternativeLabels[plan.preferredAlternative]
  }，不要换词复刻旧动作。`;
}
