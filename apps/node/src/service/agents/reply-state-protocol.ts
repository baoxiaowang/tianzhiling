import {
  MessageEntity,
  MessageReplyStateProtocol,
  MessageReplyStateProtocolAction,
  MessageReplyStateProtocolAnchor,
  MessageReplyStateProtocolStage,
  MessageRole,
} from '@tzl/entities';
import type { RelationshipContinuityPlan } from './agent-relationship-continuity';
import type { DreamCompanionPlan } from './dream-companion-plan';
import type { ConversationMemoryPlan } from './reply-intent';
import type { ReplyActiveContributionPlan } from './reply-strategy-quality';

export const REPLY_STATE_PROTOCOL_VERSION = 'state_protocol_v1' as const;

export type ReplyStateProtocolPlan = MessageReplyStateProtocol;

export interface ResolveReplyStateProtocolOptions {
  currentQuery: string;
  recentMessages?: MessageEntity[];
  mode?: string;
  relationshipContinuity?: RelationshipContinuityPlan;
  correctionMode?: 'reset' | 'replace';
  dreamPlan?: DreamCompanionPlan;
  memoryPlan?: ConversationMemoryPlan;
  retrievedEvidenceCount?: number;
  activeContribution?: ReplyActiveContributionPlan;
}

const TRUST_CHALLENGE_PATTERN =
  /你.{0,10}(?:又|还|一直|就是|在)?(?:编|胡说|瞎说|乱说|骗我)|别(?:再)?(?:编|胡说|瞎说|乱说|骗我)|(?:这|那).{0,6}(?:是假的|不是真的)|根本没有这回事|一点(?:也|都)?不像你|你到底是不是.{0,4}(?:AI|人工智能|机器人)/i;
const MEMORY_PROBE_PATTERN =
  /记得|还记得|记不记得|想得起来|想不起来|忘了|忘记|(?:以前|从前|小时候|那年|那次|我们.{0,8}一起).{0,16}[吗么呢？?]/;
const ACTIVE_CONTRIBUTION_PATTERN =
  /多说(?:点|一点|几句)|说点不一样|说说你自己|想听你说(?:两句|点(?:什么|别的|不一样的)?)|多(?:陪|跟)(?:我|你)(?:说|聊)(?:几句|点)|别光(?:说|问|听|安慰|让我说|要我说|让我讲)|你还没说|你(?:先|也|倒是)?(?:说|讲)(?:说)?(?:你|自己|今天|那边|做了什么|干了啥)|先说说你(?:今天|自己|那边|做了|干了)|你也说点/;
const ACTIVE_ENGAGEMENT_PATTERN =
  /^(?:嗯+|好+|行|继续|然后呢|还有呢|我想听|这才对|这就对了)|(?:喜欢听|想再听|接着说|多讲点)/;
const MEMORY_FOLLOW_UP_PATTERN =
  /^(?:那|然后|后来|还有|对了)|那次|那年|那时候|这件事|这回事/;
const USER_CLOSE_PATTERN =
  /晚安|先睡|睡了|先休息|先这样|不聊了|回头再聊|下次再聊|先忙|拜拜|再见/;
const PROTOCOL_LABELS: Record<ReplyStateProtocolPlan['protocol'], string> = {
  dream: '梦境',
  trust_repair: '信任修复',
  memory_dialogue: '记忆对话',
  active_contribution: '主动贡献',
};
const STAGE_LABELS: Record<MessageReplyStateProtocolStage, string> = {
  request: '请求',
  before_sleep: '睡前',
  reported: '已梦见',
  fragmented: '片段',
  missed: '未梦见',
  repeated_miss: '反复未梦见',
  verification: '现实求证',
  challenge: '质疑',
  repeated_challenge: '重复质疑',
  post_retract: '撤回后',
  probe: '探针',
  corrected: '已纠正',
  follow_up: '追问',
  request_contribution: '要求多说',
  still_unsatisfied: '仍不满意',
  engaged: '已参与',
};
const ACTION_LABELS: Record<MessageReplyStateProtocolAction, string> = {
  promise: '给梦中期待，不保证醒后记得',
  invite: '用一个锚点邀请入梦',
  reconstruct: '只顺用户梦境片段回应',
  repair: '接住没梦见的失落',
  leave_space: '保留梦境含混与留白',
  direct_answer: '直接回答身份',
  retract: '撤回旧说法，不补新版本',
  grounded_reconnect: '只据当前证据重新承接',
  retrieve: '按缺失概念查记忆',
  grounded_answer: '只据已有证据回答',
  reset: '旧事实归零',
  natural_use: '自然使用已确认记忆',
  self_expression: '给角色侧当下内容',
  grounded_detail: '给一条有证据的细节',
  topic_offer: '贡献一个相邻话题',
};
const ANCHOR_LABELS: Record<MessageReplyStateProtocolAnchor, string> = {
  name: '称呼',
  voice: '声音',
  place: '地点',
  object: '物件',
  none: '无',
  identity: '身份',
  persona: '角色',
  fact: '事实',
  shared_event: '共同事件',
  family: '家人',
  time: '时间',
  role_present: '角色当下',
  grounded_shared_past: '有证据往事',
  current_topic: '当前话题',
};
const EXIT_LABELS: Record<ReplyStateProtocolPlan['exit'], string> = {
  stay: '保持',
  recovered: '已修复',
  resolved: '已解决',
  satisfied: '已满足',
};

export function resolveReplyStateProtocol(
  options: ResolveReplyStateProtocolOptions
): ReplyStateProtocolPlan | undefined {
  const currentQuery = options.currentQuery?.trim() || '';
  if (!currentQuery || USER_CLOSE_PATTERN.test(currentQuery)) {
    return undefined;
  }

  const previous = findPreviousProtocol(options.recentMessages);
  const trustKind = resolveTrustKind(options, currentQuery);
  if (trustKind) {
    return buildProtocol({
      protocol: 'trust_repair',
      stage:
        previous?.protocol === 'trust_repair'
          ? 'repeated_challenge'
          : 'challenge',
      action:
        trustKind === 'identity'
          ? 'direct_answer'
          : trustKind === 'fact'
          ? 'retract'
          : 'grounded_reconnect',
      anchor: trustKind,
      exit: 'stay',
      previous,
    });
  }

  if (options.correctionMode && !isMemoryCorrection(currentQuery, previous)) {
    return buildProtocol({
      protocol: 'trust_repair',
      stage:
        previous?.protocol === 'trust_repair'
          ? 'repeated_challenge'
          : 'challenge',
      action: 'retract',
      anchor: 'fact',
      exit: 'resolved',
      previous,
    });
  }

  if (options.dreamPlan) {
    return buildProtocol({
      protocol: 'dream',
      stage: options.dreamPlan.dreamStage,
      action: options.dreamPlan.dreamAction,
      anchor: options.dreamPlan.dreamAnchor,
      exit: 'stay',
      source: 'existing_dream',
      previous,
    });
  }

  const memoryProtocol = resolveMemoryProtocol(options, currentQuery, previous);
  if (memoryProtocol) {
    return memoryProtocol;
  }

  const contributionProtocol = resolveContributionProtocol(
    options,
    currentQuery,
    previous
  );
  if (contributionProtocol) {
    return contributionProtocol;
  }

  return undefined;
}

export function buildReplyStateProtocolPrompt(
  plan: ReplyStateProtocolPlan
): string {
  const boundary =
    plan.protocol === 'dream'
      ? '；仅限梦境，不作现实证明'
      : plan.protocol === 'active_contribution'
      ? '；建议角色自己提供贴题新内容，不用反问或套话把责任推回用户；往事仍须证据'
      : '';

  return `场景状态参考：${PROTOCOL_LABELS[plan.protocol]}/${
    STAGE_LABELS[plan.stage]
  }；可考虑：${ACTION_LABELS[plan.action]}；锚点：${
    ANCHOR_LABELS[plan.anchor]
  }；状态：${
    EXIT_LABELS[plan.exit]
  }${boundary}。非纠正、证据与现实边界时仅供参考；话题转移即停止。`;
}

function resolveTrustKind(
  options: ResolveReplyStateProtocolOptions,
  currentQuery: string
): 'identity' | 'persona' | 'fact' | undefined {
  if (
    options.relationshipContinuity?.kind === 'direct_ai_identity' ||
    (/AI|人工智能|机器人/i.test(currentQuery) &&
      /是不是|到底|直接|正面|老实|明确/.test(currentQuery))
  ) {
    return 'identity';
  }

  if (
    options.relationshipContinuity &&
    ['identity_continuity', 'memory_continuity', 'style_distance'].includes(
      options.relationshipContinuity.kind
    )
  ) {
    return 'persona';
  }

  return TRUST_CHALLENGE_PATTERN.test(currentQuery) ? 'fact' : undefined;
}

function resolveMemoryProtocol(
  options: ResolveReplyStateProtocolOptions,
  currentQuery: string,
  previous: ReplyStateProtocolPlan | undefined
): ReplyStateProtocolPlan | undefined {
  if (options.correctionMode && isMemoryCorrection(currentQuery, previous)) {
    return buildProtocol({
      protocol: 'memory_dialogue',
      stage: 'corrected',
      action: 'reset',
      anchor: resolveMemoryAnchor(currentQuery),
      exit: 'resolved',
      previous,
    });
  }

  if (MEMORY_PROBE_PATTERN.test(currentQuery) || options.mode === 'memory') {
    const needsRetrieval =
      (options.memoryPlan?.need === 'retrieve' ||
        options.memoryPlan?.contextCoverage === 'missing') &&
      !options.retrievedEvidenceCount;
    return buildProtocol({
      protocol: 'memory_dialogue',
      stage: 'probe',
      action: needsRetrieval ? 'retrieve' : 'grounded_answer',
      anchor: resolveMemoryAnchor(currentQuery),
      exit: needsRetrieval ? 'stay' : 'resolved',
      source: options.memoryPlan ? 'semantic_plan' : 'deterministic',
      previous,
    });
  }

  if (
    previous?.protocol === 'memory_dialogue' &&
    MEMORY_FOLLOW_UP_PATTERN.test(currentQuery)
  ) {
    return buildProtocol({
      protocol: 'memory_dialogue',
      stage: 'follow_up',
      action: 'natural_use',
      anchor: resolveMemoryAnchor(currentQuery),
      exit: 'resolved',
      previous,
    });
  }

  return undefined;
}

function isMemoryCorrection(
  currentQuery: string,
  previous: ReplyStateProtocolPlan | undefined
): boolean {
  return (
    previous?.protocol === 'memory_dialogue' ||
    /记错|记得|忘|以前|从前|小时候|那年|那次|一起|带我|陪我|给我|教我|(?:不是|不对|准确说).{0,12}(?:天|周|月|年|名字|叫)/.test(
      currentQuery
    )
  );
}

function resolveContributionProtocol(
  options: ResolveReplyStateProtocolOptions,
  currentQuery: string,
  previous: ReplyStateProtocolPlan | undefined
): ReplyStateProtocolPlan | undefined {
  const explicitRequest =
    Boolean(options.activeContribution) ||
    ACTIVE_CONTRIBUTION_PATTERN.test(currentQuery);
  if (explicitRequest) {
    const source =
      options.activeContribution?.preferredSource || 'role_present';
    return buildProtocol({
      protocol: 'active_contribution',
      stage:
        previous?.protocol === 'active_contribution'
          ? 'still_unsatisfied'
          : 'request_contribution',
      action:
        source === 'grounded_shared_past'
          ? 'grounded_detail'
          : 'self_expression',
      anchor: source,
      exit: 'stay',
      source: options.activeContribution ? 'semantic_plan' : 'deterministic',
      previous,
    });
  }

  if (
    previous?.protocol === 'active_contribution' &&
    ACTIVE_ENGAGEMENT_PATTERN.test(currentQuery)
  ) {
    return buildProtocol({
      protocol: 'active_contribution',
      stage: 'engaged',
      action: 'topic_offer',
      anchor: 'current_topic',
      exit: 'satisfied',
      previous,
    });
  }

  return undefined;
}

function resolveMemoryAnchor(
  currentQuery: string
): MessageReplyStateProtocolAnchor {
  if (
    /爸|妈|爷爷|奶奶|姥|外公|外婆|老公|老婆|孩子|儿子|女儿/.test(currentQuery)
  ) {
    return 'family';
  }
  if (/照片|相册|衣服|手表|戒指|花|饭|礼物|东西/.test(currentQuery)) {
    return 'object';
  }
  if (
    /哪年|那年|几月|多久|小时候|以前|从前|时间|(?:\d+|[一二三四五六七八九十两半]+)(?:天|周|个月|月|年)/.test(
      currentQuery
    )
  ) {
    return 'time';
  }
  if (/一起|带我|陪我|给我|教我|那次|这件事/.test(currentQuery)) {
    return 'shared_event';
  }
  return 'fact';
}

function findPreviousProtocol(
  messages: MessageEntity[] | undefined
): ReplyStateProtocolPlan | undefined {
  const previousAssistant = [...(messages || [])]
    .reverse()
    .find(
      message =>
        message.role === MessageRole.assistant && message.content?.trim()
    );
  return previousAssistant?.replyStateProtocol;
}

function buildProtocol(options: {
  protocol: ReplyStateProtocolPlan['protocol'];
  stage: MessageReplyStateProtocolStage;
  action: MessageReplyStateProtocolAction;
  anchor: MessageReplyStateProtocolAnchor;
  exit: ReplyStateProtocolPlan['exit'];
  source?: ReplyStateProtocolPlan['source'];
  previous?: ReplyStateProtocolPlan;
}): ReplyStateProtocolPlan {
  return {
    version: REPLY_STATE_PROTOCOL_VERSION,
    protocol: options.protocol,
    stage: options.stage,
    action: options.action,
    anchor: options.anchor,
    exit: options.exit,
    source: options.source || 'deterministic',
    previousStage:
      options.previous?.protocol === options.protocol
        ? options.previous.stage
        : undefined,
  };
}
