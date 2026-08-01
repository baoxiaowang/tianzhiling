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
  | 'generic_advice';

export type ReplyStrategyAlternative =
  | 'answer'
  | 'self_expression'
  | 'topic_transition'
  | 'natural_close';

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
  /^(?:晚安|睡了|先睡|先这样|不聊了|回头聊|下次聊|我去忙了|先忙|拜拜|再见)(?:呀|啊|了|啦|哦|哈|[。.!！]*)$/;

const REPEATED_MOVE_PATTERNS: Record<ReplyRepeatedStrategyMove, RegExp> = {
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
}): ReplyStrategyQualityPlan | undefined {
  const assistantTurns = (options.recentMessages || [])
    .filter(
      message =>
        message.role === MessageRole.assistant &&
        Boolean(message.content?.trim())
    )
    .slice(-3);

  if (assistantTurns.length < 2) {
    return undefined;
  }

  const repeatedMoves = (
    Object.keys(REPEATED_MOVE_PATTERNS) as ReplyRepeatedStrategyMove[]
  ).filter(move => {
    const pattern = REPEATED_MOVE_PATTERNS[move];
    return (
      assistantTurns.filter(message => {
        pattern.lastIndex = 0;
        return pattern.test(message.content);
      }).length >= 2
    );
  });

  if (!repeatedMoves.length) {
    return undefined;
  }

  const currentQuery = options.currentQuery.trim();
  const preferredAlternative: ReplyStrategyAlternative =
    USER_CLOSE_PATTERN.test(currentQuery)
      ? 'natural_close'
      : options.activeContribution
      ? 'self_expression'
      : /[?？]/.test(currentQuery)
      ? 'answer'
      : 'topic_transition';

  return {
    repeatedMoves,
    preferredAlternative,
    observedAssistantTurns: assistantTurns.length,
  };
}

export function buildReplyStrategyQualityPrompt(
  plan: ReplyStrategyQualityPlan
): string {
  const repeatedLabels: Record<ReplyRepeatedStrategyMove, string> = {
    generic_empathy: '泛化心疼',
    generic_presence: '“我在/陪着你”',
    generic_advice: '吃饭休息等叮嘱',
  };
  const alternativeLabels: Record<ReplyStrategyAlternative, string> = {
    answer: '直接回答本轮问题',
    self_expression: '给一个角色侧当下内容',
    topic_transition: '贴着用户新信息推进或轻转一个相邻话题',
    natural_close: '简短自然收尾',
  };

  return `近轮已重复${plan.repeatedMoves
    .map(move => repeatedLabels[move])
    .join('、')}；本轮主体改为${
    alternativeLabels[plan.preferredAlternative]
  }，不要换词复刻旧动作。`;
}
