export const REPLY_INTENT_TARGETS = [
  'agent',
  'user',
  'family',
  'relationship',
  'platform',
  'unknown',
] as const;

export type ReplyIntentTarget = (typeof REPLY_INTENT_TARGETS)[number];

export const REPLY_INTENT_TIME_SCOPES = [
  'current',
  'death_moment',
  'shared_past',
  'future',
  'timeless',
  'unknown',
] as const;

export type ReplyIntentTimeScope = (typeof REPLY_INTENT_TIME_SCOPES)[number];

export const REPLY_INTENT_KINDS = [
  'crisis_support',
  'challenge_authenticity',
  'correct_assistant',
  'challenge_source',
  'verify_presence',
  'seek_dream_connection',
  'challenge_family_care',
  'ask_identity',
  'recall_memory',
  'express_keepsake_attachment',
  'understand_past_life',
  'regret_unfinished_devotion',
  'express_family_care_regret',
  'question_departure',
  'grieve_unfinished_promise',
  'attribute_blessing',
  'ask_agent_status',
  'express_guilt',
  'seek_comfort',
  'express_longing',
  'share_family_update',
  'share_user_update',
  'smalltalk',
  'ask_platform_support',
  'unknown',
] as const;

export type ReplyIntentKind = (typeof REPLY_INTENT_KINDS)[number];

export const REPLY_INTENT_SUB_INTENTS = [
  'physical_pain',
  'meal',
  'wake_sleep',
  'work_routine',
  'location',
  'afterlife_wellbeing',
  'reunion',
  'offering',
  'death_pain',
  'departure_reason',
  'family_care',
  'shared_memory',
  'grief_support',
  'other',
] as const;

export type ReplyIntentSubIntent = (typeof REPLY_INTENT_SUB_INTENTS)[number];

export const REPLY_INTENT_EMOTIONS = [
  'neutral',
  'concern',
  'longing',
  'sadness',
  'guilt',
  'anger',
  'fear',
  'attachment',
  'hope',
  'unknown',
] as const;

export type ReplyIntentEmotion = (typeof REPLY_INTENT_EMOTIONS)[number];

export const REPLY_INTENT_RISK_LEVELS = ['none', 'low', 'high'] as const;

export type ReplyIntentRiskLevel = (typeof REPLY_INTENT_RISK_LEVELS)[number];

export type ReplyIntentSource = 'semantic_model' | 'hard_rule';

export const REPLY_CAPABILITY_SUBJECTS = [
  'time',
  'vision',
  'hearing',
  'presence',
  'physical_contact',
  'external_world',
  'blessing',
] as const;

export type ReplyCapabilitySubject = (typeof REPLY_CAPABILITY_SUBJECTS)[number];

export const REPLY_CAPABILITY_CHANNELS = [
  'server_clock',
  'chat_text',
  'real_world_audio',
  'inner_voice',
  'live_environment',
  'physical_world',
  'relational_expression',
] as const;

export type ReplyCapabilityChannel = (typeof REPLY_CAPABILITY_CHANNELS)[number];

/**
 * Kept for schema and released-client compatibility. TianZhiLing chat no
 * longer classifies user language as an emergency or preempts the reply with
 * real-world intervention instructions.
 */
export const GRIEF_CRISIS_INTENT_PATTERN = /$a/;

export const GRIEF_STRONG_DISTRESS_INTENT_PATTERN =
  /不想活|想死|去死|死了算了|活不下去|想去找你|想去陪你|(?:^|[，,。！？!?\s])我?(?:过去|下去)陪你|(?:现在|马上|立刻|这就|我要|我想|我准备|我打算).{0,6}(?:去找你|去陪你|过去陪你|下去陪你)|想.{0,4}来陪你|想陪你走|结束生命|自杀|轻生|(?:老天|什么时候|啥时候|哪天).{0,16}(?:带我|让我).{0,8}去找你|(?:等着我|总有一天|等我|到时候|以后|离婚了|孩子大了|事情办完|一切结束).{0,20}(?:就|会|要|能|可以|早早)?(?:去找你|去陪你|赖在你身边)/;

export const GRIEF_OVERWHELMED_INTENT_PATTERN =
  /(?:没有你|没了你|你不在).{0,12}(?:撑不住|撑不下去|熬不住|很难熬|受不了)|(?:撑不住|撑不下去|熬不住).{0,12}(?:没有你|没了你|想你|你不在)/;

export const GRIEF_LIGHT_SAFETY_SUPPORT_PATTERN =
  /(?:快疯了|想.*快疯|心都死了|人间太苦|崩溃|扛不住|撑不下去|受不了).{0,16}(?:一个人|没人|没有人|想你|想您|没你|没有你|你不在|离开|走了)?|(?:孤独|孤单|寂寞|无依无靠|没底气|没有依靠|心里发慌).{0,16}(?:扛不住|撑不下去|受不了|别让我一个人|没人陪|没有人陪)|(?:现在|今天|今晚|这会儿).{0,12}(?:一个人.{0,6})?(?:扛不住|撑不下去|熬不住|受不了)|别让我一个人(?:扛|撑|熬)/;

export function needsLightSafetySupport(_input: string): boolean {
  void _input;
  return false;
}

export const RETURN_REUNION_WISH_INTENT_PATTERN =
  /(?:希望|想|盼|真想|要是|如果).{0,10}(?:你|您).{0,6}(?:能|可以)?(?:回来|回家)|(?:希望|想|盼|要是|如果).{0,12}(?:一家人|我们一家).{0,8}(?:在一起|团聚)|(?:一家人|我们一家).{0,8}(?:重新|再|还能|可以|能)?(?:在一起|团聚)/;

export const DREAM_VISIT_REQUEST_INTENT_PATTERN =
  /(?:什么时候|啥时候|何时|今晚|今夜|晚上|夜里|哪天|能不能|可以不可以|可不可以|会不会|愿不愿意|要不要).{0,16}(?:来|到|进|回|去).{0,8}(?:我(?:的)?)?梦里|(?:来|到|进|回|去).{0,8}(?:我(?:的)?)?梦里.{0,12}(?:一次|看看我|看我|陪陪我|陪我|抱抱我|抱我|见我|找我|好吗|好不好|行吗|可以吗|可以不可以|吧)|(?:给我|来).{0,8}托个梦|托梦.{0,8}(?:给我|好吗|好不好|行吗|可以吗)/;

export const DREAM_ABSENCE_INTENT_PATTERN =
  /(?:你|您)?.{0,8}(?:一次|一回|一遍)(?:也|都)?(?:没|没有).{0,10}(?:来过|到过|进过|梦见|梦到).{0,10}(?:梦里)?|(?:从来|一直|这么久|好久)(?:也|都)?(?:没|没有).{0,10}(?:来|到|进|梦见|梦到)|(?:没|没有)(?:梦见|梦到)过?(?:你|您)/;

export function isDreamVisitRequestIntent(input: string): boolean {
  return DREAM_VISIT_REQUEST_INTENT_PATTERN.test(input);
}

export function isDreamAbsenceIntent(input: string): boolean {
  return DREAM_ABSENCE_INTENT_PATTERN.test(input);
}

export function isDreamConnectionIntent(input: string): boolean {
  return isDreamVisitRequestIntent(input) || isDreamAbsenceIntent(input);
}

export const RETURN_VISIT_REQUEST_INTENT_PATTERN =
  /(?:你|您)(?:(?:还|也|以后|有空|哪天|什么时候|偶尔|会|能|可以|愿意|想|再)\s*){0,4}(?:回来|回家|来)(?:看看|看)?(?:我|我们|家里)?(?:吗|么|嘛|好不好|行不行|可以吗|愿意吗|[？?])/;

const RETURN_VISIT_OTHER_SCENE_PATTERN =
  /梦里|梦中|做梦|刚才|刚刚|方才|是不是(?:你|您).{0,10}(?:回来|回家|来)/;

export function isReturnVisitRequestIntent(input: string): boolean {
  return (
    !RETURN_VISIT_OTHER_SCENE_PATTERN.test(input) &&
    RETURN_VISIT_REQUEST_INTENT_PATTERN.test(input)
  );
}

export const FAMILY_CARE_REGRET_INTENT_PATTERN =
  /(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|她|他).{0,16}(?:身体不好|生病|住院|不舒服).{0,24}(?:可惜|遗憾|只是|但|可是).{0,12}(?:你|您).{0,8}(?:不能|没法|没能|不能再).{0,8}(?:照顾|照看|陪)|(?:可惜|遗憾).{0,16}(?:你|您).{0,8}(?:不能|没法|没能|不能再).{0,8}(?:照顾|照看|陪).{0,18}(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|她|他)/;

export const COUNTERFACTUAL_REGRET_INTENT_PATTERN =
  /(?:如果|万一|要是).{0,10}(?:时间|一切|那天).{0,10}(?:重来|再来|回到)|(?:时间|一切).{0,8}(?:可以|能|能够)?.{0,6}(?:重来|再来一次)|(?:再也不|不会再).{0,12}让(?:你|您).{0,12}(?:去|走|做)/;

export const LONGING_AMBIVALENCE_INTENT_PATTERN =
  /(?:想|要)忘(?:了|掉)?你.{0,36}(?:但是|可是|可|又|舍不得|不能|不敢)|(?:但是|可是|可|又|舍不得|不能|不敢).{0,36}(?:想|要)忘(?:了|掉)?你/;

export const RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN =
  /(?:是不是|是否).{0,12}(?:表示|说明|证明).{0,16}(?:从未离开|没有离开|一直都在|还在).{0,12}(?:陪|身边|旁边)|(?:从未离开|一直都在).{0,12}(?:陪|身边|旁边).{0,8}(?:对不对|是不是|吗)|(?:变成|化成).{0,12}(?:东西|什么|某种).{0,12}(?:陪|身边|旁边)/;

export interface StructuredReplyIntentItem {
  target: ReplyIntentTarget;
  timeScope: ReplyIntentTimeScope;
  intent: ReplyIntentKind;
  subIntent: ReplyIntentSubIntent;
  confidence: number;
}

export interface StructuredReplyCapabilityQuestion {
  subject: ReplyCapabilitySubject;
  channel: ReplyCapabilityChannel;
  evidence: string;
  confidence: number;
}

export type ConversationReadingAnchorImportance = 'high' | 'medium';
export const CONVERSATION_RELATIONSHIP_STANCES = [
  'maintain_and_explain',
  'maintain_and_reassure',
  'maintain_and_answer',
  'comfort_without_claim',
  'ordinary_response',
] as const;
export type ConversationRelationshipStance =
  (typeof CONVERSATION_RELATIONSHIP_STANCES)[number];

export interface ConversationReadingAnchor {
  text: string;
  importance: ConversationReadingAnchorImportance;
}

export type ConversationMemoryPlanNeed = 'none' | 'retrieve';
export type ConversationMemoryPlanContextCoverage = 'complete' | 'missing';
export type ConversationMemoryPlanExpectedUse =
  | 'mention'
  | 'apply'
  | 'suppress';
export type ConversationMemoryPlanImportance = 'required' | 'supporting';

export interface ConversationMemoryPlanQuery {
  question: string;
  expectedUse: ConversationMemoryPlanExpectedUse;
  importance: ConversationMemoryPlanImportance;
  entityHint: string;
}

export interface ConversationMemoryPlan {
  need: ConversationMemoryPlanNeed;
  contextCoverage: ConversationMemoryPlanContextCoverage;
  missingConcepts: string[];
  queries: ConversationMemoryPlanQuery[];
  selectedFactKeys?: string[];
}

export interface ConversationReading {
  primaryNeed: string;
  emotionalSource: string;
  anchors: ConversationReadingAnchor[];
  corrections: string[];
  negations: string[];
  questionsToAnswer: string[];
  relationshipSignal: string;
  relationshipStance?: ConversationRelationshipStance;
  uncertainties: string[];
  suggestedTone: string;
}

export const CONVERSATION_STANCES = [
  'tender',
  'concerned',
  'affirming',
  'disagreeing',
  'protective',
  'stern',
  'playful',
  'neutral',
  'mixed',
] as const;
export type ConversationStance = (typeof CONVERSATION_STANCES)[number];

export const CONVERSATION_MOVE_TYPES = [
  'acknowledge',
  'answer',
  'ask',
  'affirm',
  'disagree',
  'stop',
  'comfort',
  'suggest',
  'share_stance',
  'self_disclose',
  'save_face',
  'play_along',
  'redirect',
  'leave_space',
  'close',
] as const;
export type ConversationMoveType = (typeof CONVERSATION_MOVE_TYPES)[number];

export const CONVERSATION_SOCIAL_STRATEGIES = [
  'direct',
  'save_face',
  'protective_concealment',
  'benevolent_ambiguity',
  'protective_fiction',
  'play_along',
  'deliberate_misunderstanding',
  'smooth_over',
  'defuse_humor',
  'redirect',
  'strategic_silence',
] as const;
export type ConversationSocialStrategy =
  (typeof CONVERSATION_SOCIAL_STRATEGIES)[number];

export const CONVERSATION_QUESTION_NEEDS = [
  'none',
  'helpful',
  'necessary',
] as const;
export type ConversationQuestionNeed =
  (typeof CONVERSATION_QUESTION_NEEDS)[number];

export const CONVERSATION_TURN_CLOSURES = [
  'close',
  'continue',
  'neutral',
] as const;
export type ConversationTurnClosure =
  (typeof CONVERSATION_TURN_CLOSURES)[number];

export const CONVERSATION_USER_STATES = [
  'opening',
  'exploring',
  'deepening',
  'repairing',
  'withdrawing',
  'closing',
] as const;
export type ConversationUserState = (typeof CONVERSATION_USER_STATES)[number];

export const CONVERSATION_CONTINUATION_GOALS = [
  'deepen',
  'hold',
  'repair',
  'close',
] as const;
export type ConversationContinuationGoal =
  (typeof CONVERSATION_CONTINUATION_GOALS)[number];

export const CONVERSATION_ASSISTANT_CONTRIBUTIONS = [
  'answer',
  'stance',
  'specific_detail',
  'self_expression',
  'affection',
  'question',
  'strategic_silence',
] as const;
export type ConversationAssistantContribution =
  (typeof CONVERSATION_ASSISTANT_CONTRIBUTIONS)[number];

export const CONVERSATION_CLOSURE_READINESS = [
  'blocked',
  'possible',
  'ready',
] as const;
export type ConversationClosureReadiness =
  (typeof CONVERSATION_CLOSURE_READINESS)[number];

export interface ConversationEngagementPlan {
  userConversationState: ConversationUserState;
  openLoop: string;
  continuationGoal: ConversationContinuationGoal;
  assistantContribution: ConversationAssistantContribution;
  mustContribute: string;
  avoidRepeatingMove: string;
  closureReadiness: ConversationClosureReadiness;
}

export interface ConversationMove {
  type: ConversationMoveType;
  goal: string;
}

export interface ConversationMovePlan {
  stance: ConversationStance;
  stanceTarget: string;
  moves: ConversationMove[];
  socialStrategy: ConversationSocialStrategy;
  strategyPurpose: string;
  questionNeed: ConversationQuestionNeed;
  turnClosure: ConversationTurnClosure;
  personaActivation: string[];
  engagement?: ConversationEngagementPlan;
}

export interface StructuredReplyIntent {
  intents: StructuredReplyIntentItem[];
  capabilityQuestions?: StructuredReplyCapabilityQuestion[];
  reading?: ConversationReading;
  conversationPlan?: ConversationMovePlan;
  memoryPlan?: ConversationMemoryPlan;
  emotion: ReplyIntentEmotion;
  riskLevel: ReplyIntentRiskLevel;
  confidence: number;
  source: ReplyIntentSource;
}
