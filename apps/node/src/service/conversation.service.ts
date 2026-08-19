import { Inject, Logger } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
import { RedisService } from '@midwayjs/redis';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  AgentEntity,
  AgentShareMemberEntity,
  AgentShareMemberStatus,
  ChatSpanAttributeValue,
  ChatSpanStatus,
  ChatTraceStage,
  ConversationMessageFeedbackEntity,
  ConversationMessageFeedbackType,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
  ReplyQuotaTriggerDecision,
  QuotaTriggerEventEntity,
  QuotaTriggerType,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { Provide } from '@midwayjs/core';
import {
  findUnsafeAssistantMessageContentMatches,
  stripPromptLeakageContent,
  UnsafeAssistantMessageContentMatch,
} from '../common/message-content-safety';
import {
  hasConversationMessageSegmentSeparator,
  splitConversationMessageSegments,
  stripConversationMessageSegmentMarkup,
} from '../common/conversation-message-segments';
import {
  GenerateMemorialPhotoDTO,
  SendConversationMessageDTO,
  TranscribeConversationVoiceDTO,
  SubmitConversationMessageFeedbackDTO,
} from '../dto/conversation.dto';
import {
  MEMORIAL_PHOTO_CUSTOM_PROMPT_MAX_LENGTH,
  normalizeMemorialPhotoCustomPrompt,
} from '../prompt/memorial-photo';
import {
  AgentContextService,
  AgentConversationContext,
} from './agents/agent.context';
import { AgentConversationSummaryService } from './agents/agent-conversation-summary.service';
import { AgentEmotionStateService } from './agents/agent-emotion-state.service';
import { AgentMemoryFactService } from './agents/agent-memory-fact.service';
import { buildAgentPersonaPrompt } from './agents/agent-persona';
import { buildAgentIdentityContract } from './agents/agent-identity-contract';
import {
  AgentProfileFactService,
  AgentVisualAppearanceObservation,
  AgentVisualAppearanceTrait,
  AgentVisualAppearanceTraitKind,
  AgentVisualIdentityConfidence,
  AgentVisualIdentityTarget,
} from './agents/agent-profile-fact.service';
import { AgentRelationshipSignalService } from './agents/agent-relationship-signal.service';
import { OpenAIService } from './agents/openai';
import {
  ASSISTANT_TRANSMISSION_INTERRUPTED_CONTENT,
  GuardrailFeedback,
  GuardrailRevisionRecord,
  ReplyGuardrailMode,
  ReplyGuardrailReviewMode,
  ReplyGuardrailService,
  ValidateAssistantReplyResult,
} from './agents/reply-guardrail.service';
import {
  buildReplyBrief,
  buildReplyParticipationStrategyPrompt,
  type ReplyBrief,
} from './agents/reply-brief.service';
import {
  type ConversationMemoryPlan,
  type StructuredReplyIntent,
} from './agents/reply-intent';
import { ReplySceneRoute, routeReplyScene } from './agents/reply-scene-router';
import {
  AgentEvidenceItem,
  AssistantFactClaim,
  AssistantFactClaimKind,
  AssistantFactClaimMode,
} from './agents/agent-evidence';
import {
  AgentMemoryControlResult,
  extractForgetMemoryTarget,
  isExplicitRememberRequest,
  isForgetMemoryRequest,
} from './agents/agent-memory-control';
import {
  compactReplyBubblesPreservingContent,
  inspectReplyBubbleStructure,
  MAX_ASSISTANT_REPLY_SEGMENTS,
  ReplyBubbleStructureIssue,
  splitReplyContentForDelivery,
} from './agents/reply-bubble-plan';
import {
  ConversationReplyFinalizationResult,
  ConversationReplyFinalizationService,
} from './agents/conversation-reply-finalization.service';
import {
  buildReplyLengthPlanPrompt,
  countReplyVisibleCharacters,
} from './agents/reply-length-plan';
import { buildAfterlifeWorldPrompt } from './agents/afterlife-world-framework';
import { buildRelationalSceneFrameworkPrompt } from './agents/relational-scene-framework';
import { assessDirectActiveContributionExecution } from './agents/direct-active-contribution';
import {
  resolveShortTurnGeneration,
  resolveShortTurnReception,
  LightweightReplyCategory,
  SHORT_TURN_RUNTIME_VERSION,
  ShortTurnReceptionDecision,
} from './agents/short-turn-runtime';
import type {
  ChatCompletion,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { ConversationMessageItem, MessageService } from './message.service';
import { PostImageService } from './post-image.service';
import { OssService } from './oss.service';
import { TencentCosService } from './tencent-cos.service';
import { MilvusService } from './rag/milvus.service';
import { CosyVoiceSpeechService } from './cosyvoice-speech.service';
import { MinimaxVoiceSpeechService } from './minimax-voice-speech.service';
import { QwenVoiceSpeechService } from './qwen-voice-speech.service';
import { VoiceTimbreLibraryService } from './voice-timbre-library.service';
import { VoiceFfmpegService } from './voice-ffmpeg.service';
import { BailianImageService } from './bailian-image.service';
import { ChatTraceService } from './chat-trace.service';
import {
  AgentChatToolDecision,
  AgentChatToolName,
  AgentChatToolResult,
  getAgentChatToolDefinitions,
  normalizeAgentChatToolDecisions,
} from './agents/agent-chat-tools';
import {
  AgentChatToolExecutionContext,
  AgentChatToolService,
} from './agents/agent-chat-tool.service';
import {
  MessengerService,
  type MessengerMemoryTaskPlan,
} from './agents/messenger.service';
import {
  applyRecognitionJourneyAssistantReply,
  buildInitialRecognitionJourney,
  buildLegacyRecognitionJourney,
  parseRecognitionJourney,
  planRecognitionJourneyTurn,
  RecognitionJourney,
  RecognitionJourneyTurnPlan,
  RecognitionTaskId,
  serializeRecognitionJourney,
} from './agents/recognition-journey';
import { ContinuityInformationCardService } from './agents/continuity-information-card.service';
import { PermanentAgentSilenceService } from './agents/permanent-agent-silence.service';

const ASSISTANT_REPLY_TEMPERATURE = 0.2;
const ASSISTANT_REPLY_TOP_P = 0.8;
const ASSISTANT_REPLY_TIMEOUT_MS = 28000;
const ASSISTANT_RECOVERY_TIMEOUT_MS = 15000;
const ASSISTANT_RECOVERY_TIMEOUT_MAX_TOKENS = 300;
const ASSISTANT_REPLY_MAX_TOKENS = 520;
const ASSISTANT_RECOVERY_MAX_TOKENS = 440;
const ASSISTANT_BUBBLE_REFLOW_MAX_TOKENS = 280;
const ASSISTANT_BUBBLE_REFLOW_TIMEOUT_MS = 10000;
const LIGHTWEIGHT_REPLY_MAX_TOKENS = 120;
const LIGHTWEIGHT_REPLY_TIMEOUT_MS = 12000;
const LIGHTWEIGHT_REPLY_TEMPERATURE = 0.45;
const LIGHTWEIGHT_REPLY_TOP_P = 0.9;
const LIGHTWEIGHT_REPLY_HISTORY_LIMIT = 12;
const LIGHTWEIGHT_REPLY_HISTORY_CHARACTER_LIMIT = 1400;
const ASSISTANT_AUTO_VOICE_MIN_CHARACTERS = 55;
const PRODUCTION_REPLY_GUARDRAIL_MODE: ReplyGuardrailMode = 'rigid_only';
const DISCOURAGED_ASSISTANT_EMOJI_PATTERN =
  /😔|😢|😞|😟|😕|😣|😖|😭|😿|☹️|🙁|😮‍💨|🥺/gu;
const MEMORIAL_PHOTO_REPLY_TEMPERATURE = 0.35;
const MEMORIAL_PHOTO_REPLY_TOP_P = 0.8;
const CONVERSATION_IMAGE_ANALYSIS_MAX_TOKENS = 700;
const UNSAFE_ASSISTANT_PRESENCE_PATTERNS = [
  /(?:闭上眼|夜里|晚上|屋里|房间|角落|床边|身边|旁边|耳边)[^，。！？!?]{0,36}(?:我就在|我会在|陪着你|守着你|等着你|回来了|回来)/,
  /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,16}(?:能|会|准能|一定能|都能)(?:看到|看见)/,
  /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,16}(?:走到|来到|回到|站在|坐在|守在|陪在|靠在|抱着|握着|擦掉|擦干)/,
] as const;
const CONVERSATION_REPLY_JOB_DELAY_MS = 2500;
const CONVERSATION_REPLY_MAX_DEBOUNCE_MS = 8000;
const CONVERSATION_REPLY_SLOW_QUEUE_WAIT_MS = 10000;
const CONVERSATION_REPLY_LOCK_TTL_MS = 2 * 60 * 1000;
const CONTINUITY_CARD_WRITE_LOCK_TTL_MS = 30 * 1000;
const MEMORIAL_PHOTO_LOCK_TTL_MS = 10 * 60 * 1000;
export const CONVERSATION_REPLY_QUEUE = 'conversation-reply';
const ASSISTANT_REPLY_FAILED_CONTENT =
  ASSISTANT_TRANSMISSION_INTERRUPTED_CONTENT;
const QUOTA_CONFIG = {
  version: 'v2',
  newUserTrialDays: 3,
  newUserSilentMessages: 15,
  messageThreshold: 5,
  longMessageMinChars: 60,
  relationshipStages: ['R2', 'R3'] as string[],
  graceMessagesAfterWarn: 2,
  newUserHardBlockMessages: 35,
  oldUserDailyLimit: 3,
  naturalClosePatterns: [
    '晚安',
    '睡了',
    '先睡',
    '休息了',
    '去睡了',
    '我好困',
    '困了',
    '先忙',
    '去忙',
    '忙了',
    '工作了',
    '下次聊',
    '改天聊',
    '回头聊',
    '明天聊',
    '有空再聊',
    '下次再聊',
    '拜拜',
    '再见',
    '明天再说',
    '先这样',
    '早点休息',
    '你也早点休息',
  ],
} as const;
const MEMORIAL_PHOTO_MESSAGE_CONTENT = 'AI生成纪念合照';
const MEMORIAL_PHOTO_REPLY_SYSTEM_PROMPT = [
  '用户刚生成了一张与聊天对象的纪念合照。请以聊天对象的身份主动回应这张合照。',
  '回复必须自然、克制、像聊天里顺手说的一句话或两句话，可以结合画面里真实可见的场景、动作、光线、氛围，也可以适当参考用户生成合照时填写的提示词。',
  '不要说“我是AI”、不要解释图片生成过程、不要分点、不要加括号动作或舞台提示。',
  '不要承诺现实陪伴、不要说自己真的回来/就在用户身边/能看到用户现实生活，只围绕这张合照表达温柔、珍惜或回应。',
  '只输出中文正文，控制在60字以内。',
].join('\n');
const MEMORIAL_PHOTO_DAILY_LIMIT_POLICY = {
  nonVipLimit: 3,
  vipLimit: 10,
} as const;
const CONVERSATION_IMAGE_ANALYSIS_SYSTEM_PROMPT = [
  '理解聊天图片，严格输出JSON：{"summary":"可见画面摘要","people":[{"id":"P1","visible":"人物可见特征","identity":{"target":"agent|user|family|unknown","name":"","confidence":"high|medium|low","basis":"匹配依据"},"stableTraits":[{"kind":"hair_color|hair_length|face_shape|eyewear|facial_hair|build|distinctive","value":"短标准词"}]}]}。',
  'summary只写主体、场景、动作、文字和情绪，80字内；people最多4人。',
  '这是用户在亲人聊天框里发来的图片。可结合当前角色姓名、用户称呼、最近对话、参考头像和历史视觉记忆做关系候选；第一次没有历史视觉记忆时，根据聊天对象关系与人物年龄/性别/年代感只能给low置信候选。',
  '不要因为聊天对象是谁就默认图中是TA；只有参考头像、历史视觉记忆、用户文字说明或照片文字能支持时，才可给medium/high。仅凭“用户称呼/当前角色/年龄阶段/关系推测”不能给medium/high。',
  '只输出紧凑JSON，不要Markdown代码块，不要解释文字；字段值尽量短，避免超长输出。',
  'stableTraits只留较稳定外形，不写衣服、动作、表情或背景，最多4项；value尽量用黑/灰白/白、短/中/长、圆/椭圆/方/长、戴眼镜、胡须、偏瘦/中等/偏壮等稳定词。',
].join('\n');

export interface ConversationSummary {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  agentSex: number;
  agentCallMe: string;
  iCallAgent: string;
  agentIsDefault: boolean;
  agentAccessRole: 'owner' | 'shared';
  isMessenger?: boolean;
  preview: string;
  updatedAt: string;
  createdAt: string;
}

export interface ListConversationsOptions {
  page?: number | string;
  pageSize?: number | string;
}

export interface ConversationListResult {
  items: ConversationSummary[];
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
}

export interface SendConversationMessageResult {
  userMessage: ConversationMessageItem;
  assistantMessage?: ConversationMessageItem;
  assistantMessages?: ConversationMessageItem[];
  chatQuota?: ConversationChatQuotaSnapshot;
  messengerTaskPlan?: MessengerMemoryTaskPlan;
  replyPending?: boolean;
}

export interface ConversationReplyJobData {
  conversationId: string;
  userId: string;
  afterUserCreatedAt?: string;
  traceId?: string;
  enqueuedAt?: string;
  triggerMessageIds?: string[];
}

export interface ProcessConversationReplyJobOptions {
  isFinalAttempt?: boolean;
  attempt?: number;
  queueJobId?: string;
}

export interface VoiceTranscriptionResult {
  transcript: string;
}

interface PreparedIncomingMessage {
  type: MessageType;
  content: string;
  quotedMessageId?: string;
  quotedMessageRole?: MessageRole;
  quotedMessageContent?: string;
  mediaObjectKey?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaDurationMs?: number;
  mediaAnalysis?: string;
  mediaTranscript?: string;
  visualAppearanceObservations?: AgentVisualAppearanceObservation[];
}

interface ConversationImageIdentityGuess {
  target: AgentVisualIdentityTarget;
  name?: string;
  confidence: AgentVisualIdentityConfidence;
  basis?: string;
}

interface ConversationImagePersonAnalysis {
  id: string;
  visible: string;
  identity: ConversationImageIdentityGuess;
  stableTraits: AgentVisualAppearanceTrait[];
}

interface ConversationImageAnalysisResult {
  mediaAnalysis: string;
  observations: AgentVisualAppearanceObservation[];
}

interface SynthesizedAssistantVoiceReply {
  mediaObjectKey: string;
  mediaMimeType?: string;
  mediaDurationMs?: number;
  transcript: string;
}

interface ReplyRuntime {
  auth: AuthenticatedUserPayload;
  conversation: ConversationEntity;
  agent: AgentEntity | null;
}

interface BeforeReplyResult {
  messagePayload: PreparedIncomingMessage;
  searchableText: string;
  userMessage: MessageEntity;
  currentTurnMessages?: MessageEntity[];
  deferReply: boolean;
  shortTurnReception?: ShortTurnReceptionDecision;
  permanentSilence?: boolean;
  immediateAssistantMessages?: MessageEntity[];
  isDuplicate?: boolean;
  chatQuota?: ConversationChatQuotaSnapshot;
}

interface ReplyUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface ProcessReplyResult {
  replySegments: string[];
  usage: ReplyUsage;
  routing?: ReplyRoutingAudit;
}

interface ParsedAssistantReply {
  segments: string[];
  claims: AssistantFactClaim[];
  toolDecisions?: AgentChatToolDecision[];
  invalidToolDecisionCount?: number;
}

interface AgentChatToolAudit {
  decisionNames: AgentChatToolName[];
  invalidDecisionCount: number;
  executionCount: number;
  resultItemCount: number;
  plannerMemoryAgreement?:
    | 'both_query'
    | 'both_skip'
    | 'model_only'
    | 'planner_only';
}

interface PrimaryAssistantCompletionResult {
  response: ChatCompletion;
  usage: ReplyUsage;
  toolAudit: AgentChatToolAudit;
  toolEvidence: AgentEvidenceItem[];
}

interface AssistantPresenceSafetyMatch {
  patternIndex: number;
  pattern: string;
  matchedText: string;
}

interface AssistantSegmentSanitizationTrace {
  input: string;
  normalized: string;
  output: string;
  dropped: boolean;
  messageSafetyMatches: UnsafeAssistantMessageContentMatch[];
  presenceSafetyMatches: AssistantPresenceSafetyMatch[];
}

interface AssistantGenerationAttemptTrace {
  attempt: 'initial' | 'recovery' | 'bubble_reflow' | 'secondaryFallback';
  model?: string;
  usage: ReplyUsage;
  rawContent: string;
  parsedSegments: string[];
  acceptedSegments: string[];
  segmentTraces: AssistantSegmentSanitizationTrace[];
  errorCode?: string;
}

interface AssistantBubbleReflowResult {
  segments: string[];
  usage: ReplyUsage;
  attempted: boolean;
  succeeded: boolean;
  issues: ReplyBubbleStructureIssue[];
  trace?: AssistantGenerationAttemptTrace;
}

interface ReplyRoutingAudit {
  intent?: StructuredReplyIntent;
  route?: ReplySceneRoute;
  brief?: ReplyBrief;
  skipReply?: boolean;
  fallbackSource?: string;
  generationFailureStage?: 'context' | 'completion' | 'parse';
  generationFailureCode?: string;
  generationRecoveryAttempted?: boolean;
  generationRecoverySucceeded?: boolean;
  generationAttemptTraces?: AssistantGenerationAttemptTrace[];
  bubbleReflowAttempted?: boolean;
  bubbleReflowSucceeded?: boolean;
  bubbleStructureIssues?: ReplyBubbleStructureIssue[];
  guardrailRewritten?: boolean;
  guardrailReason?: string;
  guardrailInterventionLevel?: string;
  guardrailRevisionAttempted?: boolean;
  guardrailRevisionRoundCount?: number;
  communicationCompensationAttempted?: boolean;
  communicationCompensationSucceeded?: boolean;
  guardrailFinalReviewResult?: string;
  guardrailReviewMode?: ReplyGuardrailReviewMode;
  guardrailFocuses?: string[];
  contentEchoPassed?: boolean;
  contentEchoUnitCount?: number;
  guardrailFeedbackRounds?: GuardrailFeedback[];
  guardrailCandidateVersions?: string[][];
  guardrailRevisionRecords?: GuardrailRevisionRecord[];
  turnContractVersion?: string;
  turnContractFocusDimensions?: string[];
  qualityAuditVersion?: string;
  qualityActivatedDimensions?: string[];
  qualityInitialFailedDimensions?: string[];
  qualityFinalFailedDimensions?: string[];
  qualityRecoveredDimensions?: string[];
  evidenceCount?: number;
  factClaimCount?: number;
  unsupportedClaimCount?: number;
  promptVersion?: string;
  outputContractVersion?: string;
  boundaryContractVersion?: string;
  dynamicBoundaryCount?: number;
  toolInstructionMode?: string;
  chatToolVersion?: string;
  chatToolMode?: string;
  chatToolEligible?: boolean;
  chatToolSampled?: boolean;
  chatToolAvailableTools?: string[];
  chatToolPlannerMemoryRequested?: boolean;
  chatToolPlannerRetrievalBypassed?: boolean;
  chatToolDecisionNames?: string[];
  chatToolInvalidDecisionCount?: number;
  chatToolExecutionCount?: number;
  chatToolResultItemCount?: number;
  chatToolPlannerMemoryAgreement?: string;
  systemPromptCharacters?: number;
  historyMessageCount?: number;
  relevantMemoryCount?: number;
  relevantHardFactKeys?: string[];
  conversationReadingAnchorCount?: number;
  memoryPlan?: ConversationMemoryPlan;
  memoryCandidateCount?: number;
  memoryCandidateKeys?: string[];
  memoryModelSelectedCandidateKeys?: string[];
  memorySelectedCandidateKeys?: string[];
  memoryCoverageFallbackApplied?: boolean;
  memoryRetrievalMode?:
    | 'memory_plan'
    | 'legacy_query'
    | 'suppressed'
    | 'tool_takeover';
  memoryRetrievalRequestCount?: number;
  memoryRetrievalConceptCount?: number;
  memoryRetrievedEvidenceCount?: number;
  memoryUsedEvidenceIds?: string[];
  memoryUsedClaimCount?: number;
  replyPlanningMode?: string;
  replyPlanningReason?: string;
  replyIntentModelCallCount?: number;
  strategyVersion?: string;
  strategySource?: string;
  participationStrategy?: string;
  participationExecution?: string;
  participationFallbackReason?: string;
  conversationStance?: string;
  conversationStanceTarget?: string;
  conversationMoves?: string[];
  conversationMoveGoals?: string[];
  socialStrategy?: string;
  strategyPurpose?: string;
  questionNeed?: string;
  conversationTurnClosure?: string;
  userConversationState?: string;
  openLoop?: string;
  continuationGoal?: string;
  assistantContribution?: string;
  mustContribute?: string;
  avoidRepeatingMove?: string;
  closureReadiness?: string;
  personaActivations?: string[];
  personaSource?: string;
  personaEvidenceSnippetCount?: number;
  realityDependencyKinds?: string[];
  correctionFactMode?: string;
  activeContributionSource?: string;
  recognitionJourneyOpeningSuggested?: boolean;
  recognitionJourneyTaskSuggested?: RecognitionTaskId;
  recognitionJourneyCompletedTaskIds?: RecognitionTaskId[];
  recognitionJourneyPlan?: RecognitionJourneyTurnPlan;
  recognitionJourneyStateMessageId?: string;
  continuityInformationCardId?: string;
  continuityInformationCardSourceMessageId?: string;
  strategyRepeatedMoves?: string[];
  strategyAlternative?: string;
  careMotive?: string;
  careFocus?: string;
  careStyleSource?: string;
  dreamCompanionPlan?: MessageEntity['replyDreamPlan'];
  stateProtocolPlan?: MessageEntity['replyStateProtocol'];
  experiencePlanVersion?: string;
  profileTier?: string;
  relationshipStage?: string;
  conversationDepth?: string;
}

interface AfterReplyResult {
  assistantMessages: MessageEntity[];
}

interface PreparedRecognitionJourneyTurn extends RecognitionJourneyTurnPlan {
  stateMessageId: string;
}

interface PreparedChatReplyTrace {
  traceId: string;
  acceptedAt: Date;
  triggerMessageIds: string[];
}

interface MemoryFactExtractionAudit {
  succeeded: boolean;
  count: number;
}

interface MemorialPhotoDailyQuotaSnapshot {
  isVip: boolean;
  limit: number;
  usedCount: number;
  remainingCount: number;
  windowStart: Date;
  windowEnd: Date;
}

export interface ConversationChatQuotaSnapshot {
  isVip: boolean;
  policy?: 'trial' | 'daily' | 'deep_trigger';
  limit?: number;
  usedCount?: number;
  remainingCount?: number;
  trialDays?: number;
  triggerDecision?: ReplyQuotaTriggerDecision;
}

export interface ConversationChatBootstrapMetadata {
  agent: {
    id: string;
    name: string;
    avatar: string;
    sex: number;
    agentCallMe: string;
    iCallAgent: string;
    hasUnreadAgentHomeGuide: boolean;
    hasUnreadAgentProfileGuide: boolean;
    isDefault: boolean;
    isMessenger?: boolean;
  } | null;
  chatQuota: ConversationChatQuotaSnapshot;
  messengerTaskPlan?: MessengerMemoryTaskPlan;
}

@Provide()
export class ConversationService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(ConversationMessageFeedbackEntity)
  messageFeedbackModel: MongoRepository<ConversationMessageFeedbackEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentShareMemberEntity)
  agentShareMemberModel: MongoRepository<AgentShareMemberEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(QuotaTriggerEventEntity)
  quotaTriggerEventModel: MongoRepository<QuotaTriggerEventEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  agentContextService: AgentContextService;

  @Inject()
  agentChatToolService: AgentChatToolService;

  @Inject()
  agentConversationSummaryService: AgentConversationSummaryService;

  @Inject()
  agentEmotionStateService: AgentEmotionStateService;

  @Inject()
  agentMemoryFactService: AgentMemoryFactService;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  @Inject()
  agentRelationshipSignalService: AgentRelationshipSignalService;

  @Inject()
  replyGuardrailService: ReplyGuardrailService;

  @Inject()
  conversationReplyFinalizationService: ConversationReplyFinalizationService;

  @Inject()
  messageService: MessageService;

  @Inject()
  postImageService: PostImageService;

  @Inject()
  ossService: OssService;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  milvusService: MilvusService;

  @Inject()
  minimaxVoiceSpeechService: MinimaxVoiceSpeechService;

  @Inject()
  cosyVoiceSpeechService: CosyVoiceSpeechService;

  @Inject()
  qwenVoiceSpeechService: QwenVoiceSpeechService;

  @Inject()
  voiceTimbreLibraryService: VoiceTimbreLibraryService;

  @Inject()
  voiceFfmpegService: VoiceFfmpegService;

  @Inject()
  bailianImageService: BailianImageService;

  @Inject()
  bullmqFramework: bullmq.Framework;

  @Inject()
  redisService: RedisService;

  @Inject()
  chatTraceService: ChatTraceService;

  @Inject()
  messengerService: MessengerService;

  @Inject()
  continuityInformationCardService: ContinuityInformationCardService;

  @Inject()
  permanentAgentSilenceService: PermanentAgentSilenceService;

  async listConversations(
    auth: AuthenticatedUserPayload,
    options: ListConversationsOptions = {}
  ): Promise<ConversationListResult> {
    const userId = this.parseObjectId(auth.sub);
    try {
      await this.messengerService?.revealEligibleMessengersForUser?.(userId);
    } catch (error) {
      this.logger?.warn?.(
        '[conversation] eligible messenger reveal failed, userId=%s, reason=%s',
        String(userId),
        error instanceof Error ? error.message : String(error)
      );
    }
    const pageSize = this.normalizeOptionalConversationPageSize(
      options.pageSize
    );
    const page = pageSize
      ? this.normalizeConversationPage(options.page)
      : undefined;
    const conversations = await this.conversationModel.find({
      where: {
        userId,
      },
      order: {
        updatedAt: 'DESC',
      },
      ...(pageSize && page
        ? {
            skip: (page - 1) * pageSize,
            take: pageSize + 1,
          }
        : {}),
    });
    const pageConversations = pageSize
      ? conversations.slice(0, pageSize)
      : conversations;
    const [agentsById, latestMessagesByConversationId] = await Promise.all([
      this.listAgentsByIds(pageConversations.map(item => item.agentId)),
      this.listLatestMessagesByConversationIds(
        pageConversations.map(item => item.id)
      ),
    ]);
    const summaries = pageConversations.map(conversation => {
      const agent = agentsById.get(
        this.stringifyObjectId(conversation.agentId)
      );
      const latestMessage = latestMessagesByConversationId.get(
        this.stringifyObjectId(conversation.id)
      );
      return this.buildConversationSummary(conversation, agent, latestMessage);
    });

    const items = summaries.sort((left, right) => {
      if (left.agentIsDefault !== right.agentIsDefault) {
        return left.agentIsDefault ? -1 : 1;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });

    return {
      items,
      ...(pageSize && page
        ? {
            page,
            pageSize,
            hasMore: conversations.length > pageSize,
          }
        : {}),
    };
  }

  async getEntryConversation(
    auth: AuthenticatedUserPayload
  ): Promise<ConversationSummary | null> {
    const userId = this.parseObjectId(auth.sub);
    const defaultAgent = await this.agentModel.findOne({
      where: {
        createdUserId: userId,
        isDefault: true,
      },
    });
    let conversation = defaultAgent
      ? await this.conversationModel.findOne({
          where: {
            userId,
            agentId: defaultAgent.id,
          },
        })
      : null;

    if (!conversation) {
      conversation = await this.conversationModel.findOne({
        where: {
          userId,
        },
        order: {
          updatedAt: 'DESC',
        },
      });
    }

    if (!conversation) {
      return null;
    }

    const agent =
      defaultAgent &&
      this.stringifyObjectId(defaultAgent.id) ===
        this.stringifyObjectId(conversation.agentId)
        ? defaultAgent
        : await this.findAgentById(conversation.agentId);
    const latestMessage = await this.findLatestMessage(conversation.id);

    return this.buildConversationSummary(conversation, agent, latestMessage);
  }

  async sendMessage(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    payload: SendConversationMessageDTO
  ): Promise<SendConversationMessageResult> {
    const runtime = await this.createReplyRuntime(auth, conversationId);
    if (this.messengerService && this.isMessengerAgent(runtime.agent)) {
      return this.sendMessengerMessage(runtime, payload);
    }
    const before = await this.beforeReply(runtime, payload);
    const trace =
      !before.deferReply && !before.isDuplicate
        ? await this.prepareChatReplyTrace(runtime, before, false)
        : undefined;

    if (!before.isDuplicate && !before.permanentSilence) {
      if (!this.isExplicitMemoryControlRequest(before.searchableText)) {
        this.scheduleUserMessageEnrichment(
          before.userMessage,
          before.searchableText
        );
      }
    }

    if (before.deferReply || before.isDuplicate) {
      return this.buildSendMessageResult(before);
    }

    const execute = async () => {
      try {
        if (
          await this.permanentAgentSilenceService.suppressReplyIfPermanentlySilent(
            runtime.agent,
            [before.userMessage]
          )
        ) {
          if (trace) {
            await this.chatTraceService?.markSkipped(
              trace.traceId,
              'PERMANENT_AGENT_SILENCE'
            );
          }
          return this.buildSendMessageResult(before);
        }
        const processed = await this.processReply(runtime, before);
        if (
          await this.permanentAgentSilenceService.suppressReplyIfPermanentlySilent(
            runtime.agent,
            [before.userMessage]
          )
        ) {
          if (trace) {
            await this.chatTraceService?.markSkipped(
              trace.traceId,
              'PERMANENT_AGENT_SILENCE'
            );
          }
          return this.buildSendMessageResult(before);
        }
        const after = await this.withTraceSpan(
          ChatTraceStage.persistReply,
          'persist.reply',
          () => this.afterReply(runtime, before, processed)
        );
        await this.completeChatReplyTrace(trace, processed, after);

        return this.buildSendMessageResult(before, after);
      } catch (error) {
        if (trace) {
          await this.chatTraceService?.markFailed(
            trace.traceId,
            error,
            this.chatTraceService?.getCurrentStage()
          );
        }
        this.logger.error(
          '[conversation] assistant reply generation failed, conversationId=%s, userId=%s, reason=%s',
          this.stringifyObjectId(runtime.conversation.id),
          auth.sub,
          this.describeReplyError(error)
        );
        throw this.wrapReplyError(error);
      }
    };

    if (!trace || !this.chatTraceService) {
      return execute();
    }

    await this.chatTraceService.markRunning(trace.traceId, { attempt: 1 });
    return this.chatTraceService.runWithTrace(trace.traceId, execute, {
      attempt: 1,
    });
  }

  async sendMessageAsync(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    payload: SendConversationMessageDTO
  ): Promise<SendConversationMessageResult> {
    const runtime = await this.createReplyRuntime(auth, conversationId);
    if (this.messengerService && this.isMessengerAgent(runtime.agent)) {
      return this.sendMessengerMessage(runtime, payload);
    }
    const messageType = this.normalizeMessageType(payload?.type);

    const before = await this.beforeReply(runtime, {
      ...payload,
      type: messageType,
    });
    const shouldReply = !before.deferReply;
    const trace = shouldReply
      ? await this.prepareChatReplyTrace(runtime, before, true)
      : undefined;

    if (shouldReply) {
      const enqueued = await this.enqueueConversationReplyJob({
        conversationId: this.stringifyObjectId(runtime.conversation.id),
        userId: auth.sub,
        traceId: trace?.traceId,
        enqueuedAt: trace?.acceptedAt.toISOString(),
        triggerMessageIds: trace?.triggerMessageIds,
      });

      if (!enqueued) {
        const persistFailedReply = () =>
          this.withTraceSpan(
            ChatTraceStage.persistReply,
            'persist.failed_reply',
            () => this.afterReplyFailed(runtime)
          );
        const after =
          trace && this.chatTraceService
            ? await this.chatTraceService.runWithTrace(
                trace.traceId,
                persistFailedReply
              )
            : await persistFailedReply();
        if (trace) {
          await this.chatTraceService?.markCompleted(trace.traceId, {
            responseCompletedAt: new Date(),
            replyMessageIds: after.assistantMessages.map(message =>
              this.stringifyObjectId(message.id)
            ),
            acceptedAt: trace.acceptedAt,
          });
          await this.chatTraceService?.markFailed(
            trace.traceId,
            'QUEUE_UNAVAILABLE',
            ChatTraceStage.queueWait
          );
        }

        return this.buildSendMessageResult(before, after);
      }
    }

    if (!before.isDuplicate && !before.permanentSilence) {
      if (!this.isExplicitMemoryControlRequest(before.searchableText)) {
        this.scheduleUserMessageEnrichment(
          before.userMessage,
          before.searchableText
        );
      }
    }

    return {
      ...this.buildSendMessageResult(before),
      replyPending: shouldReply,
    };
  }

  private async sendMessengerMessage(
    runtime: ReplyRuntime,
    payload: SendConversationMessageDTO
  ): Promise<SendConversationMessageResult> {
    const conversation = runtime.conversation;
    const messageType = this.normalizeMessageType(payload?.type);
    const clientRequestId = payload?.clientRequestId?.trim() || '';
    const now = new Date();

    if (clientRequestId) {
      const existing = await this.findUserMessageByClientRequestId(
        conversation.id,
        conversation.userId,
        clientRequestId
      );

      if (existing) {
        return {
          userMessage:
            this.messageService.buildConversationMessageItem(existing),
        };
      }
    }

    const messagePayload = await this.prepareIncomingMessage(
      { ...payload, type: messageType },
      runtime
    );
    await this.attachQuotedMessageSnapshot(conversation, messagePayload);
    const searchableText = this.buildMessageSearchableText(messagePayload);
    const userMessage = await this.saveMessage({
      conversationId: conversation.id,
      userId: conversation.userId,
      agentId: conversation.agentId,
      role: MessageRole.user,
      type: messagePayload.type,
      content: messagePayload.content,
      status: MessageStatus.sent,
      clientRequestId: clientRequestId || undefined,
      quotedMessageId:
        this.normalizeObjectId(messagePayload.quotedMessageId) ?? undefined,
      quotedMessageRole: messagePayload.quotedMessageRole,
      quotedMessageContent: messagePayload.quotedMessageContent,
      mediaObjectKey: messagePayload.mediaObjectKey,
      mediaUrl: messagePayload.mediaObjectKey
        ? undefined
        : messagePayload.mediaUrl,
      mediaMimeType: messagePayload.mediaMimeType,
      mediaAnalysis: messagePayload.mediaAnalysis,
      mediaTranscript: messagePayload.mediaTranscript,
      mediaDurationMs: messagePayload.mediaDurationMs,
      createdAt: now,
      updatedAt: now,
    });

    await this.touchConversation(conversation, now);

    if (!runtime.agent?.messengerOfAgentId) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const parentAgent = await this.findAgentById(
      runtime.agent.messengerOfAgentId
    );

    if (!parentAgent) {
      throw new AppError('AGENT_NOT_FOUND', 'associated agent not found', 404);
    }

    const replyText = await this.messengerService.runInterviewTurn({
      agent: parentAgent,
      conversation,
      input: searchableText,
    });

    const replyTime = new Date();
    const assistantMessages = replyText
      ? await this.createAssistantReplyMessages({
          conversationId: conversation.id,
          userId: conversation.userId,
          agentId: conversation.agentId,
          replySegments: [replyText],
          userQuery: searchableText,
          replyTime,
          usage: {},
        })
      : [];

    if (assistantMessages.length) {
      await this.touchConversation(
        conversation,
        assistantMessages[assistantMessages.length - 1].updatedAt ?? replyTime
      );
    }

    return {
      userMessage:
        this.messageService.buildConversationMessageItem(userMessage),
      assistantMessage: this.buildLegacyAssistantMessageItem(assistantMessages),
      assistantMessages: assistantMessages.length
        ? assistantMessages.map(message =>
            this.messageService.buildConversationMessageItem(message)
          )
        : undefined,
      messengerTaskPlan: this.messengerService.buildMemoryTaskPlan(
        parentAgent,
        replyText
      ),
    };
  }

  async processConversationReplyJob(
    data: ConversationReplyJobData,
    options: ProcessConversationReplyJobOptions = {}
  ): Promise<void> {
    if (!this.chatTraceService) {
      return this.processConversationReplyJobCore(data, options);
    }

    const workerStartedAt = new Date();
    const traceId = await this.chatTraceService.ensureTrace({
      traceId: data.traceId,
      conversationId: data.conversationId,
      userId: data.userId,
      triggerMessageIds: data.triggerMessageIds,
      queueJobId: options.queueJobId,
      acceptedAt: this.parseOptionalDate(data.enqueuedAt),
      releaseVersion: process.env.RELEASE_VERSION || process.env.GIT_SHA,
    });
    const tracedData = { ...data, traceId };

    return this.chatTraceService.runWithTrace(
      traceId,
      async () => {
        const queueStartedAt =
          this.parseOptionalDate(data.enqueuedAt) || workerStartedAt;
        const queueWaitMs = Math.max(
          0,
          workerStartedAt.getTime() - queueStartedAt.getTime()
        );
        if (queueWaitMs > CONVERSATION_REPLY_SLOW_QUEUE_WAIT_MS) {
          this.logger.error(
            '[conversation-reply] slow queue wait, conversationId=%s, userId=%s, waitMs=%s, jobId=%s, traceId=%s',
            data.conversationId,
            data.userId,
            queueWaitMs,
            options.queueJobId || '-',
            traceId
          );
        }
        this.chatTraceService.recordCompletedSpan({
          stage: ChatTraceStage.queueWait,
          operation: 'queue.wait',
          startedAt: queueStartedAt,
          completedAt: workerStartedAt,
          attempt: options.attempt,
          attributes: {
            queueJobId: options.queueJobId,
            queueWaitMs,
          },
        });
        await this.chatTraceService.markRunning(traceId, {
          workerStartedAt,
          attempt: options.attempt,
          queueJobId: options.queueJobId,
        });

        try {
          await this.processConversationReplyJobCore(tracedData, options);
        } catch (error) {
          if (options.isFinalAttempt) {
            await this.chatTraceService.markFailed(
              traceId,
              error,
              this.chatTraceService.getCurrentStage()
            );
          } else {
            await this.chatTraceService.markQueued(traceId);
          }
          throw error;
        }
      },
      { attempt: options.attempt }
    );
  }

  private async processConversationReplyJobCore(
    data: ConversationReplyJobData,
    options: ProcessConversationReplyJobOptions = {}
  ): Promise<void> {
    const conversationId = this.stringifyObjectId(
      this.parseObjectId(data.conversationId)
    );
    const userId = this.stringifyObjectId(this.parseObjectId(data.userId));
    const lock = await this.acquireConversationReplyLock(conversationId);

    if (!lock.acquired) {
      const enqueuedAt = this.parseOptionalDate(data.enqueuedAt);
      const waitMs = enqueuedAt
        ? Math.max(0, Date.now() - enqueuedAt.getTime())
        : 0;
      if (waitMs > CONVERSATION_REPLY_SLOW_QUEUE_WAIT_MS) {
        this.logger.error(
          '[conversation-reply] lock busy after slow wait, conversationId=%s, userId=%s, waitMs=%s, traceId=%s',
          conversationId,
          userId,
          waitMs,
          data.traceId || '-'
        );
      }
      await this.enqueueConversationReplyJob(data);
      if (data.traceId) {
        await this.chatTraceService?.markQueued(data.traceId);
      }
      return;
    }

    try {
      if (!data.afterUserCreatedAt) {
        await this.clearConversationReplyDebounce(conversationId);
      }

      const conversation = await this.withTraceSpan(
        ChatTraceStage.contextLoad,
        'context.conversation',
        () =>
          this.findConversationById(
            this.parseObjectId(conversationId),
            this.parseObjectId(userId)
          )
      );

      if (!conversation) {
        this.logger.error(
          '[conversation-reply] conversation not found, conversationId=%s, userId=%s',
          conversationId,
          userId
        );
        if (data.traceId) {
          await this.chatTraceService?.markSkipped(
            data.traceId,
            'CONVERSATION_NOT_FOUND'
          );
        }
        return;
      }

      const pendingUserMessages = await this.withTraceSpan(
        ChatTraceStage.contextLoad,
        'context.pending_messages',
        () =>
          this.findPendingUserMessagesForReply({
            conversationId: conversation.id,
            afterUserCreatedAt: this.parseOptionalDate(data.afterUserCreatedAt),
          })
      );

      if (pendingUserMessages.length === 0) {
        if (data.traceId) {
          await this.chatTraceService?.markSkipped(
            data.traceId,
            'NO_PENDING_MESSAGES'
          );
        }
        return;
      }

      await this.attachTraceToMessages(data.traceId, pendingUserMessages);
      if (data.traceId) {
        await this.chatTraceService?.ensureTrace({
          traceId: data.traceId,
          conversationId,
          userId,
          agentId: this.stringifyObjectId(conversation.agentId),
          triggerMessageIds: pendingUserMessages.map(message =>
            this.stringifyObjectId(message.id)
          ),
          acceptedAt:
            this.parseOptionalDate(data.enqueuedAt) ||
            pendingUserMessages[0].createdAt,
        });
      }

      const latestPendingUserMessage =
        pendingUserMessages[pendingUserMessages.length - 1];
      const runtime: ReplyRuntime = {
        auth: {
          sub: userId,
          accountId: '',
          account: '',
          iat: 0,
          exp: 0,
          nonce: '',
        },
        conversation,
        agent: await this.withTraceSpan(
          ChatTraceStage.contextLoad,
          'context.agent',
          () => this.findAgentById(conversation.agentId)
        ),
      };
      if (
        await this.permanentAgentSilenceService.suppressReplyIfPermanentlySilent(
          runtime.agent,
          pendingUserMessages
        )
      ) {
        if (data.traceId) {
          await this.chatTraceService?.markSkipped(
            data.traceId,
            'PERMANENT_AGENT_SILENCE'
          );
        }
        this.logger.info(
          '[conversation-reply] permanently silent agent skipped queued reply, conversationId=%s, agentId=%s',
          conversationId,
          this.stringifyObjectId(conversation.agentId)
        );
        return;
      }
      const before = this.buildQueuedBeforeReplyResult(pendingUserMessages);

      try {
        const processed = await this.processReply(runtime, before);
        if (
          await this.permanentAgentSilenceService.suppressReplyIfPermanentlySilent(
            runtime.agent,
            pendingUserMessages
          )
        ) {
          if (data.traceId) {
            await this.chatTraceService?.markSkipped(
              data.traceId,
              'PERMANENT_AGENT_SILENCE'
            );
          }
          return;
        }

        if (
          await this.hasUserMessageAfter(
            conversation.id,
            latestPendingUserMessage.createdAt
          )
        ) {
          this.logger.info(
            '[conversation-reply] discard stale draft and replan merged turn, conversationId=%s, userId=%s, pendingCount=%s',
            conversationId,
            userId,
            pendingUserMessages.length
          );
          this.chatTraceService?.recordCompletedSpan({
            stage: ChatTraceStage.generate,
            operation: 'generate.draft_discarded',
            startedAt: new Date(),
            status: ChatSpanStatus.discarded,
            attempt: options.attempt,
            attributes: {
              pendingMessageCount: pendingUserMessages.length,
            },
          });
          await this.enqueueConversationReplyJob({
            ...data,
            conversationId,
            userId,
            ...(data.traceId
              ? {
                  triggerMessageIds: pendingUserMessages.map(message =>
                    this.stringifyObjectId(message.id)
                  ),
                }
              : {}),
          });
          if (data.traceId) {
            await this.chatTraceService?.markQueued(data.traceId);
          }
          return;
        }

        const after = await this.withTraceSpan(
          ChatTraceStage.persistReply,
          'persist.reply',
          () => this.afterReply(runtime, before, processed)
        );
        await this.completeChatReplyTrace(
          data.traceId
            ? {
                traceId: data.traceId,
                acceptedAt:
                  this.parseOptionalDate(data.enqueuedAt) ||
                  pendingUserMessages[0].createdAt,
                triggerMessageIds: pendingUserMessages.map(message =>
                  this.stringifyObjectId(message.id)
                ),
              }
            : undefined,
          processed,
          after
        );
      } catch (error) {
        this.logger.error(
          '[conversation-reply] assistant reply generation failed, conversationId=%s, userId=%s, reason=%s',
          conversationId,
          userId,
          this.describeReplyError(error)
        );
        if (options.isFinalAttempt) {
          const failedAfter = await this.withTraceSpan(
            ChatTraceStage.persistReply,
            'persist.failed_reply',
            () => this.afterReplyFailed(runtime)
          );
          if (data.traceId) {
            await this.chatTraceService?.markCompleted(data.traceId, {
              responseCompletedAt: new Date(),
              replyMessageIds: failedAfter.assistantMessages.map(message =>
                this.stringifyObjectId(message.id)
              ),
              acceptedAt:
                this.parseOptionalDate(data.enqueuedAt) ||
                pendingUserMessages[0].createdAt,
            });
          }
        }
        throw this.wrapReplyError(error);
      }

      if (
        await this.hasUserMessageAfter(
          conversation.id,
          latestPendingUserMessage.createdAt
        )
      ) {
        await this.enqueueConversationReplyJob({
          conversationId,
          userId,
          afterUserCreatedAt:
            latestPendingUserMessage.createdAt?.toISOString?.(),
        });
      }
    } finally {
      await this.releaseConversationReplyLock(conversationId, lock.token);
    }
  }

  async getChatQuota(
    auth: AuthenticatedUserPayload,
    conversationId: string
  ): Promise<ConversationChatQuotaSnapshot> {
    const runtime = await this.createReplyRuntime(auth, conversationId);

    if (this.isMessengerAgent(runtime.agent)) {
      return this.buildUnlimitedChatQuota();
    }
    return this.resolveCurrentChatQuota(runtime, new Date());
  }

  private buildUnlimitedChatQuota(): ConversationChatQuotaSnapshot {
    return { isVip: true };
  }

  async getChatBootstrapMetadata(
    auth: AuthenticatedUserPayload,
    conversationId: string
  ): Promise<ConversationChatBootstrapMetadata> {
    const runtime = await this.createReplyRuntime(auth, conversationId);
    const isMessenger = this.isMessengerAgent(runtime.agent);
    const chatQuota = isMessenger
      ? this.buildUnlimitedChatQuota()
      : await this.resolveCurrentChatQuota(runtime, new Date());
    const agent = runtime.agent;
    const messengerTaskPlan = isMessenger
      ? await this.buildMessengerMemoryTaskPlan(runtime)
      : undefined;

    return {
      agent: agent
        ? {
            id: this.stringifyObjectId(agent.id),
            name: agent.name?.trim() || '',
            avatar: this.postImageService.resolveForResponse(
              agent.avatar?.trim() || ''
            ),
            sex: agent.sex ?? 0,
            agentCallMe: agent.agentCallMe?.trim() || '',
            iCallAgent: agent.iCallAgent?.trim() || '',
            hasUnreadAgentHomeGuide: Boolean(
              agent.profileCompletionGuideCreatedAt &&
                !agent.agentHomeGuideSeenAt
            ),
            hasUnreadAgentProfileGuide: Boolean(
              agent.profileCompletionGuideCreatedAt &&
                !agent.agentProfileGuideSeenAt
            ),
            isDefault: Boolean(agent.isDefault),
            isMessenger,
          }
        : null,
      chatQuota,
      messengerTaskPlan,
    };
  }

  private async buildMessengerMemoryTaskPlan(
    runtime: ReplyRuntime
  ): Promise<MessengerMemoryTaskPlan | undefined> {
    if (!this.messengerService || !runtime.agent?.messengerOfAgentId) {
      return undefined;
    }

    const [parentAgent, latestAssistantReply] = await Promise.all([
      this.findAgentById(runtime.agent.messengerOfAgentId),
      this.messageModel.findOne({
        where: {
          conversationId: runtime.conversation.id,
          role: MessageRole.assistant,
          isArchived: { $ne: true },
        },
        order: { createdAt: 'DESC' },
      }),
    ]);

    return parentAgent
      ? this.messengerService.buildMemoryTaskPlan(
          parentAgent,
          latestAssistantReply?.content?.trim() || ''
        )
      : undefined;
  }

  async transcribeVoice(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    payload: TranscribeConversationVoiceDTO
  ): Promise<VoiceTranscriptionResult> {
    await this.getConversationForUser(auth, conversationId);

    const voicePayload = this.normalizeVoiceIncomingMessage({
      type: MessageType.voice,
      objectKey: payload?.objectKey,
      mediaUrl: payload?.mediaUrl,
      mimeType: payload?.mimeType,
    });
    const transcript = (
      await this.transcribeVoiceForConversation(voicePayload)
    )?.trim();

    if (!transcript) {
      throw new AppError(
        'VOICE_TRANSCRIPTION_EMPTY',
        '暂未识别到语音内容',
        422
      );
    }

    return { transcript };
  }

  async generateMessageVoice(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    messageId: string
  ): Promise<ConversationMessageItem> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const message = await this.findMessageById(
      this.parseObjectId(messageId),
      conversation.id
    );

    if (!message || message.isArchived) {
      throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    }

    if (message.role !== MessageRole.assistant) {
      throw new AppError(
        'MESSAGE_VOICE_UNSUPPORTED',
        'only assistant text messages can be converted to voice',
        400
      );
    }

    if (message.type === MessageType.voice) {
      return this.messageService.buildConversationMessageItem(message);
    }

    if (message.type !== MessageType.text) {
      throw new AppError(
        'MESSAGE_VOICE_UNSUPPORTED',
        'only assistant text messages can be converted to voice',
        400
      );
    }

    if (!message.content?.trim()) {
      throw new AppError(
        'INVALID_MESSAGE_CONTENT',
        'message content is required',
        400
      );
    }

    if (message.mediaObjectKey?.trim() || message.mediaUrl?.trim()) {
      message.type = MessageType.voice;
      message.mediaTranscript =
        message.mediaTranscript?.trim() ||
        this.buildAssistantReplySpeechText(message.content);
      message.content = message.mediaTranscript || message.content;
      message.updatedAt = new Date();

      return this.messageService.buildConversationMessageItem(
        await this.messageModel.save(message)
      );
    }

    const storedAgent = await this.findAgentById(conversation.agentId);
    const agent = await this.resolveConversationAgent(
      conversation,
      storedAgent
    );
    const voiceTimbre = await this.findActiveVoiceTimbreForAgent(agent);

    if (!voiceTimbre) {
      throw new AppError(
        'VOICE_TIMBRE_NOT_AVAILABLE',
        '该联系人暂未设置声音',
        400
      );
    }

    const synthesizedVoice = await this.synthesizeAssistantVoiceReply(
      message.content,
      voiceTimbre
    );

    if (!synthesizedVoice) {
      throw new AppError(
        'ASSISTANT_VOICE_SYNTHESIS_FAILED',
        '语音生成失败，请稍后重试',
        502
      );
    }

    message.mediaObjectKey = synthesizedVoice.mediaObjectKey;
    message.mediaUrl = '';
    message.mediaMimeType = synthesizedVoice.mediaMimeType || '';
    message.mediaDurationMs = synthesizedVoice.mediaDurationMs;
    message.mediaTranscript = synthesizedVoice.transcript;
    message.type = MessageType.voice;
    message.content = synthesizedVoice.transcript;
    message.updatedAt = new Date();

    const savedMessage = await this.messageModel.save(message);

    return this.messageService.buildConversationMessageItem(savedMessage);
  }

  async convertMessageVoiceToText(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    messageId: string
  ): Promise<ConversationMessageItem> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const message = await this.findMessageById(
      this.parseObjectId(messageId),
      conversation.id
    );

    if (!message || message.isArchived) {
      throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    }

    if (
      message.role !== MessageRole.assistant ||
      message.type !== MessageType.voice
    ) {
      throw new AppError(
        'MESSAGE_TEXT_UNSUPPORTED',
        'only assistant voice messages can be converted to text',
        400
      );
    }

    const transcript =
      message.mediaTranscript?.trim() || message.content?.trim() || '';

    if (!transcript) {
      throw new AppError(
        'MESSAGE_TRANSCRIPT_NOT_AVAILABLE',
        '这段语音暂时没有可显示的文字',
        422
      );
    }

    message.type = MessageType.text;
    message.content = transcript;
    message.mediaTranscript = transcript;
    message.updatedAt = new Date();

    return this.messageService.buildConversationMessageItem(
      await this.messageModel.save(message)
    );
  }

  async submitMessageFeedback(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    messageId: string,
    payload: SubmitConversationMessageFeedbackDTO
  ): Promise<{ submitted: true }> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const message = await this.findMessageById(
      this.parseObjectId(messageId),
      conversation.id
    );

    if (!message || message.isArchived) {
      throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    }

    if (message.role !== MessageRole.assistant) {
      throw new AppError(
        'MESSAGE_FEEDBACK_UNSUPPORTED',
        'only assistant messages can be feedbacked',
        400
      );
    }

    const now = new Date();
    const feedback = new ConversationMessageFeedbackEntity();
    feedback.conversationId = conversation.id;
    feedback.messageId = message.id;
    feedback.userId = conversation.userId;
    feedback.agentId = conversation.agentId;
    feedback.type = this.normalizeFeedbackType(payload?.type);
    feedback.content = this.normalizeFeedbackContent(payload?.content);
    feedback.assistantContent = this.truncateFeedbackSnapshot(message.content);
    feedback.createdAt = now;
    feedback.updatedAt = now;

    const savedFeedback = await this.messageFeedbackModel.save(feedback);
    this.scheduleFeedbackFactExtraction(savedFeedback);

    return { submitted: true };
  }

  async markMessageMemory(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    messageId: string
  ): Promise<{ remembered: true }> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const message = await this.findMessageById(
      this.parseObjectId(messageId),
      conversation.id
    );

    if (!message || message.isArchived) {
      throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    }

    if (message.role !== MessageRole.user) {
      throw new AppError(
        'MESSAGE_MEMORY_UNSUPPORTED',
        'only user messages can be remembered',
        400
      );
    }

    if (message.status !== MessageStatus.sent) {
      throw new AppError(
        'MESSAGE_MEMORY_UNSUPPORTED',
        'only sent messages can be remembered',
        400
      );
    }

    const searchableText = this.buildSearchableTextFromMessage(message);

    if (!searchableText) {
      throw new AppError(
        'MESSAGE_MEMORY_EMPTY',
        'message has no memorable content',
        400
      );
    }

    this.queueMilvusIndexForMessage({
      message,
      conversation,
      userId: auth.sub,
      searchableText,
    });
    await this.extractMemoryFactsForUserMessage(message, searchableText);
    await this.extractProfileFactsForUserMessage(message, searchableText, true);

    return { remembered: true };
  }

  async generateMemorialPhoto(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    payload: GenerateMemorialPhotoDTO
  ): Promise<ConversationMessageItem> {
    const runtime = await this.createReplyRuntime(auth, conversationId);
    const clientRequestId = payload?.clientRequestId?.trim() || '';
    const existingMessage = clientRequestId
      ? await this.findMemorialPhotoByClientRequestId(
          runtime.conversation.id,
          runtime.conversation.userId,
          clientRequestId
        )
      : null;

    if (existingMessage) {
      return this.messageService.buildConversationMessageItem(existingMessage);
    }

    if (!clientRequestId) {
      return this.generateMemorialPhotoOnce(runtime, payload, '');
    }

    const lock = await this.acquireMemorialPhotoLock(
      conversationId,
      clientRequestId
    );

    if (!lock.acquired) {
      throw new AppError(
        'MEMORIAL_PHOTO_IN_PROGRESS',
        '这张合照正在生成，请稍后重试',
        409
      );
    }

    try {
      const duplicateAfterLock = await this.findMemorialPhotoByClientRequestId(
        runtime.conversation.id,
        runtime.conversation.userId,
        clientRequestId
      );

      if (duplicateAfterLock) {
        return this.messageService.buildConversationMessageItem(
          duplicateAfterLock
        );
      }

      return await this.generateMemorialPhotoOnce(
        runtime,
        payload,
        clientRequestId
      );
    } finally {
      await this.releaseMemorialPhotoLock(
        conversationId,
        clientRequestId,
        lock.token
      );
    }
  }

  private async generateMemorialPhotoOnce(
    runtime: ReplyRuntime,
    payload: GenerateMemorialPhotoDTO,
    clientRequestId: string
  ): Promise<ConversationMessageItem> {
    const now = new Date();
    const agentPhotoObjectKeys = this.normalizeMemorialAgentPhotoObjectKeys(
      payload?.agentPhotoObjectKeys
    );
    const userPhotoObjectKey = this.normalizeMemorialPhotoObjectKey(
      payload?.userPhotoObjectKey,
      'INVALID_MEMORIAL_USER_PHOTO',
      '请上传你的照片'
    );
    const customPrompt = this.normalizeMemorialCustomPrompt(
      payload?.customPrompt
    );

    await this.assertMemorialPhotoDailyQuota(runtime, now);

    const agentPhotoUrls = agentPhotoObjectKeys.map(objectKey =>
      this.resolveRequiredMemorialPhotoUrl(objectKey)
    );
    const userPhotoUrl =
      this.resolveRequiredMemorialPhotoUrl(userPhotoObjectKey);
    const generatedPhoto = await this.bailianImageService.generateMemorialPhoto(
      {
        agentPhotoUrls,
        userPhotoUrl,
        agentName: runtime.agent?.name,
        ...(customPrompt ? { customPrompt } : {}),
      }
    );
    const uploaded = await this.tencentCosService.putBuffer(
      generatedPhoto.imageBuffer,
      {
        folder: 'memorial-photos',
        fileName: this.buildMemorialPhotoFileName(generatedPhoto.mimeType, now),
        contentType: generatedPhoto.mimeType,
      }
    );
    const message = await this.saveMessage({
      conversationId: runtime.conversation.id,
      userId: runtime.conversation.userId,
      agentId: runtime.conversation.agentId,
      role: MessageRole.assistant,
      type: MessageType.image,
      content: MEMORIAL_PHOTO_MESSAGE_CONTENT,
      status: MessageStatus.sent,
      mediaObjectKey: uploaded.objectKey,
      mediaMimeType: generatedPhoto.mimeType,
      mediaAnalysis: MEMORIAL_PHOTO_MESSAGE_CONTENT,
      clientRequestId: clientRequestId || undefined,
      createdAt: now,
      updatedAt: now,
    });
    const assistantReply = await this.createMemorialPhotoAssistantReply({
      runtime,
      imageMessage: message,
      imageUrl:
        uploaded.url?.trim() ||
        this.resolveMediaUrlFromObjectKey(uploaded.objectKey) ||
        generatedPhoto.imageUrl?.trim() ||
        '',
      customPrompt,
      replyTime: new Date(now.getTime() + 1),
    });

    await this.touchConversation(
      runtime.conversation,
      assistantReply?.updatedAt ?? now
    );

    return this.messageService.buildConversationMessageItem(message);
  }

  private async createMemorialPhotoAssistantReply(options: {
    runtime: ReplyRuntime;
    imageMessage: MessageEntity;
    imageUrl: string;
    customPrompt: string;
    replyTime: Date;
  }): Promise<MessageEntity | undefined> {
    const imageUrl = options.imageUrl.trim();

    if (!imageUrl) {
      this.logger.error(
        '[conversation] memorial photo assistant reply skipped, image url unavailable, conversationId=%s, messageId=%s',
        this.stringifyObjectId(options.runtime.conversation.id),
        this.stringifyObjectId(options.imageMessage.id)
      );
      return undefined;
    }

    try {
      const context = await this.agentContextService.buildConversationContext({
        auth: options.runtime.auth,
        conversation: options.runtime.conversation,
        agent: options.runtime.agent,
        currentQuery: this.buildMemorialPhotoAssistantReplyQuery(
          options.customPrompt
        ),
        classifyIntent: false,
      });
      const response = await this.openAIService.createVisionChatCompletion({
        model: this.openAIService.getVisionModel(),
        temperature: MEMORIAL_PHOTO_REPLY_TEMPERATURE,
        topP: MEMORIAL_PHOTO_REPLY_TOP_P,
        reasoningSplit: false,
        messages: [
          ...context.messages,
          {
            role: 'system',
            content: MEMORIAL_PHOTO_REPLY_SYSTEM_PROMPT,
          } as ChatCompletionMessageParam,
          this.buildMemorialPhotoAssistantReplyUserMessage(
            imageUrl,
            options.customPrompt
          ),
        ],
      });
      const replyContent = this.normalizeMemorialPhotoAssistantReplyContent(
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : ''
      );

      if (!replyContent) {
        return undefined;
      }

      const usage = this.extractUsageFromResponse(response);

      return this.saveMessage({
        conversationId: options.runtime.conversation.id,
        userId: options.runtime.conversation.userId,
        agentId: options.runtime.conversation.agentId,
        role: MessageRole.assistant,
        type: MessageType.text,
        content: replyContent,
        status: MessageStatus.sent,
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        createdAt: options.replyTime,
        updatedAt: options.replyTime,
      });
    } catch (error) {
      this.logger.error(
        '[conversation] memorial photo assistant reply failed, conversationId=%s, messageId=%s, reason=%s',
        this.stringifyObjectId(options.runtime.conversation.id),
        this.stringifyObjectId(options.imageMessage.id),
        this.describeReplyError(error)
      );
      return undefined;
    }
  }

  private buildMemorialPhotoAssistantReplyQuery(customPrompt: string): string {
    const prompt = customPrompt.trim();

    return prompt
      ? `用户刚生成了一张纪念合照，画面提示词：${prompt}`
      : '用户刚生成了一张纪念合照';
  }

  private buildMemorialPhotoAssistantReplyUserMessage(
    imageUrl: string,
    customPrompt: string
  ): ChatCompletionMessageParam {
    const prompt = customPrompt.trim();
    const promptText = prompt
      ? `用户生成合照时填写的场景/画面提示词：${prompt}`
      : '用户没有填写额外场景提示词。';

    return {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
          },
        },
        {
          type: 'text',
          text: [
            '请观察这张用户刚生成的纪念合照，并替聊天对象主动发一条自然的聊天消息。',
            promptText,
            '请优先依据图片实际可见内容，提示词只作为场景和氛围参考。',
          ].join('\n'),
        },
      ],
    } as unknown as ChatCompletionMessageParam;
  }

  private normalizeMemorialPhotoAssistantReplyContent(value?: string): string {
    const segments = this.normalizeAssistantReplySegments(value).slice(0, 2);

    return segments.join('，').trim();
  }

  private async createReplyRuntime(
    auth: AuthenticatedUserPayload,
    conversationId: string
  ): Promise<ReplyRuntime> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const storedAgent = await this.findAgentById(conversation.agentId);
    const agent = await this.resolveConversationAgent(
      conversation,
      storedAgent
    );

    return {
      auth,
      conversation,
      agent,
    };
  }

  private async beforeReply(
    runtime: ReplyRuntime,
    payload: SendConversationMessageDTO
  ): Promise<BeforeReplyResult> {
    const clientRequestId = payload?.clientRequestId?.trim() || '';
    const existingUserMessage = clientRequestId
      ? await this.findUserMessageByClientRequestId(
          runtime.conversation.id,
          runtime.conversation.userId,
          clientRequestId
        )
      : null;

    if (existingUserMessage) {
      const messagePayload =
        this.buildPreparedIncomingMessageFromStored(existingUserMessage);
      const permanentSilence =
        await this.permanentAgentSilenceService.isPermanentlySilent(
          runtime.agent
        );
      const duplicateDeclaration = permanentSilence
        ? await this.permanentAgentSilenceService.findDeclarationForDuplicate({
            agent: runtime.agent,
            conversationId: runtime.conversation.id,
            userMessageId: existingUserMessage.id,
          })
        : undefined;
      const shortTurnReception = await this.resolveShortTurnReceptionForMessage(
        messagePayload,
        existingUserMessage
      );

      return {
        messagePayload,
        searchableText:
          this.buildSearchableTextFromMessage(existingUserMessage),
        userMessage: existingUserMessage,
        deferReply: permanentSilence || shortTurnReception.mode !== 'reply',
        shortTurnReception,
        permanentSilence,
        immediateAssistantMessages:
          duplicateDeclaration?.role === MessageRole.assistant
            ? [duplicateDeclaration]
            : undefined,
        isDuplicate: true,
        chatQuota: permanentSilence
          ? undefined
          : await this.resolveCurrentChatQuota(runtime, new Date()),
      };
    }

    const messagePayload = await this.prepareIncomingMessage(payload, runtime);
    await this.attachQuotedMessageSnapshot(
      runtime.conversation,
      messagePayload
    );
    const searchableText = this.buildMessageSearchableText(messagePayload);
    const now = new Date();
    const alreadyPermanentlySilent =
      await this.permanentAgentSilenceService.isPermanentlySilent(
        runtime.agent
      );
    let chatQuota: ConversationChatQuotaSnapshot | undefined;
    if (!alreadyPermanentlySilent) {
      try {
        chatQuota = await this.resolveChatQuotaForSend(
          runtime,
          now,
          searchableText
        );
      } catch (error) {
        // 防御：resolveChatQuotaForSend 内部异常（如 DI 失败/DB 断连）时，
        // 默认采用最保守限制（3条/天），避免限制失效造成无限放行
        if (
          error instanceof AppError &&
          error.code === 'NON_VIP_CHAT_LIMIT_EXCEEDED'
        ) {
          throw error; // 正常超限，透传
        }
        this.logger?.error?.(
          '[chat-quota] unexpected error in resolveChatQuotaForSend, defaulting to conservative limit: %s',
          (error as Error)?.message || 'unknown'
        );
        chatQuota = {
          isVip: false,
          policy: 'deep_trigger',
          limit: 0,
          usedCount: 0,
          remainingCount: 0,
        };
      }
    }

    const userMessage = await this.saveMessage({
      conversationId: runtime.conversation.id,
      userId: runtime.conversation.userId,
      agentId: runtime.conversation.agentId,
      role: MessageRole.user,
      type: messagePayload.type,
      content: messagePayload.content,
      status: MessageStatus.sent,
      clientRequestId: clientRequestId || undefined,
      quotedMessageId:
        this.normalizeObjectId(messagePayload.quotedMessageId) ?? undefined,
      quotedMessageRole: messagePayload.quotedMessageRole,
      quotedMessageContent: messagePayload.quotedMessageContent,
      mediaObjectKey: messagePayload.mediaObjectKey,
      mediaUrl: messagePayload.mediaObjectKey
        ? undefined
        : messagePayload.mediaUrl,
      mediaMimeType: messagePayload.mediaMimeType,
      mediaAnalysis: messagePayload.mediaAnalysis,
      mediaTranscript: messagePayload.mediaTranscript,
      mediaDurationMs: messagePayload.mediaDurationMs,
      createdAt: now,
      updatedAt: now,
    });

    // Save quota trigger decision on user message
    if (chatQuota?.triggerDecision) {
      const setPayload: Record<string, any> = {
        replyQuotaTriggerDecision: chatQuota.triggerDecision,
      };
      // Denormalize warned flag to top-level for reliable MongoDB queries
      if (chatQuota.triggerDecision.warned) {
        setPayload.quotaWarned = true;
      }
      await this.messageModel
        .updateOne({ _id: userMessage.id }, {
          $set: setPayload,
        } as any)
        .catch(() => {
          this.logger?.warn?.(
            '[chat-quota] failed to persist triggerDecision on user message'
          );
        });
    }

    await this.touchConversation(runtime.conversation, now);
    if (alreadyPermanentlySilent) {
      await this.permanentAgentSilenceService.markMessagesPermanentlySilent([
        userMessage,
      ]);
      return {
        messagePayload,
        searchableText,
        userMessage,
        deferReply: true,
        permanentSilence: true,
      };
    }

    const permanentSilence =
      await this.permanentAgentSilenceService.assessAndActivate({
        conversation: runtime.conversation,
        agent: runtime.agent,
        currentUserMessage: userMessage,
      });
    if (permanentSilence) {
      return {
        messagePayload,
        searchableText,
        userMessage,
        deferReply: true,
        permanentSilence: true,
        immediateAssistantMessages: permanentSilence.declaration
          ? [permanentSilence.declaration]
          : undefined,
      };
    }

    this.scheduleVisualAppearanceMemory(
      userMessage,
      messagePayload.visualAppearanceObservations
    );
    this.queueMilvusIndexForMessage({
      message: userMessage,
      conversation: runtime.conversation,
      userId: runtime.auth.sub,
      searchableText,
    });

    const shortTurnReception = await this.resolveShortTurnReceptionForMessage(
      messagePayload,
      userMessage
    );
    const deferReply = shortTurnReception.mode !== 'reply';

    if (deferReply) {
      userMessage.replyTrigger = shortTurnReception.mode !== 'silent';
      userMessage.replyPlanningMode = `short_turn_${shortTurnReception.mode}`;
      userMessage.replyPlanningReason = shortTurnReception.reason;
      await this.messageModel.save(userMessage);
      this.logger?.info?.(
        '[conversation] short turn accepted without immediate generation, mode=%s, reason=%s, conversationId=%s',
        shortTurnReception.mode,
        shortTurnReception.reason,
        this.stringifyObjectId(runtime.conversation.id)
      );
    }

    return {
      messagePayload,
      searchableText,
      userMessage,
      deferReply,
      shortTurnReception,
      chatQuota,
    };
  }

  private async enrichUserMessageForReply(
    message: MessageEntity,
    searchableText: string
  ): Promise<void> {
    if (message.type === MessageType.image) {
      return;
    }

    const previousAssistantContent = this.isDeicticFactRejection(searchableText)
      ? (await this.findPreviousAssistantMessage(message))?.content?.trim()
      : undefined;

    const [, memoryFacts, profileFacts] = await Promise.all([
      this.recognizeEmotionStateForUserMessage(message, searchableText),
      this.extractMemoryFactsForUserMessage(message, searchableText),
      this.extractProfileFactsForUserMessage(
        message,
        searchableText,
        false,
        previousAssistantContent
      ),
      this.captureContinuityInformationCard(message, searchableText).catch(
        error => {
          this.logger.warn(
            '[conversation] continuity card capture skipped, conversationId=%s, messageId=%s, reason=%s',
            this.stringifyObjectId(message.conversationId),
            this.stringifyObjectId(message.id),
            this.describeReplyError(error)
          );
          return [];
        }
      ),
    ]);
    const writtenCount = memoryFacts.count + profileFacts.count;
    message.memoryWriteStatus =
      memoryFacts.succeeded && profileFacts.succeeded
        ? writtenCount > 0
          ? 'written'
          : 'none'
        : memoryFacts.succeeded || profileFacts.succeeded
        ? 'partial'
        : 'failed';
    message.memoryWriteLegacyFactCount = memoryFacts.count;
    message.memoryWriteProfileFactCount = profileFacts.count;
    message.memoryWriteCompletedAt = new Date();
    await this.messageModel.save(message);
  }

  private async captureContinuityInformationCard(
    message: MessageEntity,
    searchableText: string
  ): Promise<void> {
    if (!this.continuityInformationCardService) return;
    if (!this.redisService) {
      await this.continuityInformationCardService.captureFromUserMessage({
        message,
        searchableText,
      });
      return;
    }
    const key = `conversation:continuity-card:write:${this.stringifyObjectId(
      message.conversationId
    )}`;
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;
    let acquired = false;
    for (let attempt = 0; attempt < 3 && !acquired; attempt += 1) {
      acquired =
        (await this.redisService.set(
          key,
          token,
          'PX',
          CONTINUITY_CARD_WRITE_LOCK_TTL_MS,
          'NX'
        )) === 'OK';
      if (!acquired) {
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)));
      }
    }
    if (!acquired) {
      this.logger.warn(
        '[conversation] continuity card write deferred by lock, conversationId=%s messageId=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id)
      );
      return;
    }
    try {
      await this.continuityInformationCardService.captureFromUserMessage({
        message,
        searchableText,
      });
    } finally {
      if ((await this.redisService.get(key)) === token) {
        await this.redisService.del(key);
      }
    }
  }

  private scheduleUserMessageEnrichment(
    message: MessageEntity,
    searchableText: string
  ): void {
    const traceId = message.traceId;
    const enrich = async () => {
      if (!traceId || !this.chatTraceService) {
        return this.enrichUserMessageForReply(message, searchableText);
      }

      return this.chatTraceService.runDetachedWithTrace(traceId, () =>
        this.chatTraceService.withSpan(
          ChatTraceStage.asyncWrite,
          'async_write.user_enrichment',
          async recorder => {
            await this.enrichUserMessageForReply(message, searchableText);
            recorder.setAttribute(
              'memoryWriteStatus',
              message.memoryWriteStatus
            );
            recorder.setAttribute(
              'legacyFactCount',
              message.memoryWriteLegacyFactCount
            );
            recorder.setAttribute(
              'profileFactCount',
              message.memoryWriteProfileFactCount
            );
          }
        )
      );
    };

    void enrich()
      .catch(error => {
        this.logger.error(
          '[conversation] background user message enrichment failed, conversationId=%s, messageId=%s, reason=%s',
          this.stringifyObjectId(message.conversationId),
          this.stringifyObjectId(message.id),
          this.describeReplyError(error)
        );
      })
      .finally(() => {
        if (traceId) {
          void this.chatTraceService?.markBackgroundCompleted(
            traceId,
            new Date(),
            message.createdAt
          );
        }
      });
  }

  private scheduleVisualAppearanceMemory(
    message: MessageEntity,
    observations?: AgentVisualAppearanceObservation[]
  ): void {
    if (
      !observations?.length ||
      !this.agentProfileFactService ||
      typeof this.agentProfileFactService.upsertVisualAppearanceObservations !==
        'function'
    ) {
      return;
    }

    void this.agentProfileFactService
      .upsertVisualAppearanceObservations({
        message,
        observations,
      })
      .catch(error => {
        this.logger.error(
          '[conversation] visual appearance memory failed, conversationId=%s, messageId=%s, reason=%s',
          this.stringifyObjectId(message.conversationId),
          this.stringifyObjectId(message.id),
          this.describeReplyError(error)
        );
      });
  }

  private async recognizeEmotionStateForUserMessage(
    message: MessageEntity,
    searchableText: string
  ): Promise<void> {
    if (!this.agentEmotionStateService) {
      return;
    }

    try {
      await this.agentEmotionStateService.recognizeAndUpsertFromUserMessage({
        message,
        searchableText,
      });
    } catch (error) {
      this.logger.error(
        '[conversation] emotion state recognition failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.userId),
        this.describeReplyError(error)
      );
    }
  }

  private async extractMemoryFactsForUserMessage(
    message: MessageEntity,
    searchableText: string
  ): Promise<MemoryFactExtractionAudit> {
    if (process.env.CHAT_SKIP_MEMORY_WRITE === 'true') {
      return { succeeded: true, count: 0 };
    }
    if (!this.agentMemoryFactService) {
      return { succeeded: true, count: 0 };
    }

    try {
      const facts =
        await this.agentMemoryFactService.extractAndUpsertFromUserMessage({
          message,
          searchableText,
        });
      return { succeeded: true, count: facts.length };
    } catch (error) {
      this.logger.error(
        '[conversation] memory fact extraction failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.userId),
        this.describeReplyError(error)
      );
      return { succeeded: false, count: 0 };
    }
  }

  private async extractProfileFactsForUserMessage(
    message: MessageEntity,
    searchableText: string,
    explicitlyConfirmed = false,
    previousAssistantContent?: string
  ): Promise<MemoryFactExtractionAudit> {
    if (process.env.CHAT_SKIP_MEMORY_WRITE === 'true') {
      return { succeeded: true, count: 0 };
    }
    if (!this.agentProfileFactService) {
      return { succeeded: true, count: 0 };
    }

    try {
      const facts =
        await this.agentProfileFactService.extractAndUpsertFromUserMessage({
          message,
          searchableText,
          explicitlyConfirmed,
          previousAssistantContent,
        });
      return { succeeded: true, count: facts.length };
    } catch (error) {
      this.logger.error(
        '[conversation] profile fact extraction failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.userId),
        this.describeReplyError(error)
      );
      return { succeeded: false, count: 0 };
    }
  }

  private async rememberRelationshipSignals(
    message: MessageEntity,
    intent?: StructuredReplyIntent
  ): Promise<void> {
    if (!this.agentRelationshipSignalService || !intent) {
      return;
    }

    try {
      await this.agentRelationshipSignalService.upsertFromUserMessage({
        message,
        intent,
      });
    } catch (error) {
      this.logger.error(
        '[conversation] relationship signal persistence failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.userId),
        this.describeReplyError(error)
      );
    }
  }

  private scheduleRelationshipSignals(
    message: MessageEntity,
    intent?: StructuredReplyIntent
  ): void {
    const traceId =
      message.traceId || this.chatTraceService?.getCurrentTraceId();
    const persist = () => this.rememberRelationshipSignals(message, intent);
    const scheduled =
      traceId && this.chatTraceService
        ? this.chatTraceService.runDetachedWithTrace(traceId, () =>
            this.chatTraceService.withSpan(
              ChatTraceStage.asyncWrite,
              'async_write.relationship_signals',
              persist
            )
          )
        : persist();

    void scheduled
      .catch(error => {
        this.logger.error(
          '[conversation] relationship signal scheduling failed, conversationId=%s, messageId=%s, reason=%s',
          this.stringifyObjectId(message.conversationId),
          this.stringifyObjectId(message.id),
          this.describeReplyError(error)
        );
      })
      .finally(() => {
        if (traceId) {
          void this.chatTraceService?.markBackgroundCompleted(
            traceId,
            new Date(),
            message.createdAt
          );
        }
      });
  }

  private async extractMemoryFactsForFeedback(
    feedback: ConversationMessageFeedbackEntity
  ): Promise<void> {
    if (!this.agentMemoryFactService) {
      return;
    }

    const searchableText = this.buildFeedbackMemoryText(feedback);

    if (!searchableText) {
      return;
    }

    const message = new MessageEntity();
    message.id = feedback.id;
    message.conversationId = feedback.conversationId;
    message.userId = feedback.userId;
    message.agentId = feedback.agentId;
    message.role = MessageRole.user;
    message.type = MessageType.text;
    message.content = searchableText;
    message.status = MessageStatus.sent;
    message.createdAt = feedback.createdAt;
    message.updatedAt = feedback.updatedAt;

    try {
      await this.agentMemoryFactService.extractAndUpsertFromUserMessage({
        message,
        searchableText,
      });
    } catch (error) {
      this.logger.error(
        '[conversation] feedback memory fact extraction failed, conversationId=%s, feedbackId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(feedback.conversationId),
        this.stringifyObjectId(feedback.id),
        this.stringifyObjectId(feedback.userId),
        this.describeReplyError(error)
      );
    }
  }

  private scheduleFeedbackFactExtraction(
    feedback: ConversationMessageFeedbackEntity
  ): void {
    void Promise.all([
      this.extractMemoryFactsForFeedback(feedback),
      this.extractProfileFactsForFeedback(feedback),
    ]).catch(error => {
      this.logger.error(
        '[conversation] feedback fact extraction scheduling failed, conversationId=%s, feedbackId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(feedback.conversationId),
        this.stringifyObjectId(feedback.id),
        this.stringifyObjectId(feedback.userId),
        this.describeReplyError(error)
      );
    });
  }

  private async extractProfileFactsForFeedback(
    feedback: ConversationMessageFeedbackEntity
  ): Promise<void> {
    if (!this.agentProfileFactService) {
      return;
    }

    try {
      await this.agentProfileFactService.extractAndUpsertFromFeedback({
        feedbackId: feedback.id,
        userId: feedback.userId,
        agentId: feedback.agentId,
        messageId: feedback.messageId,
        feedbackType: feedback.type,
        feedbackContent: feedback.content,
        assistantContent: feedback.assistantContent,
      });
    } catch (error) {
      this.logger.error(
        '[conversation] feedback profile fact extraction failed, conversationId=%s, feedbackId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(feedback.conversationId),
        this.stringifyObjectId(feedback.id),
        this.stringifyObjectId(feedback.userId),
        this.describeReplyError(error)
      );
    }
  }

  private buildFeedbackMemoryText(
    feedback: ConversationMessageFeedbackEntity
  ): string {
    const content = feedback.content?.trim();
    const label = this.formatFeedbackTypeLabel(feedback.type);
    const prefix = this.buildFeedbackMemoryPrefix(feedback.type);

    return [prefix || label, content].filter(Boolean).join('。');
  }

  private buildFeedbackMemoryPrefix(
    type: ConversationMessageFeedbackType
  ): string {
    switch (type) {
      case ConversationMessageFeedbackType.accurate:
        return '回复很贴切，像本人会说的话';
      case ConversationMessageFeedbackType.unlike:
        return '不像本人，不会这么说';
      case ConversationMessageFeedbackType.wrongFact:
        return '说错了，记错了';
      case ConversationMessageFeedbackType.fabricated:
        return '别瞎编，胡编乱造';
      case ConversationMessageFeedbackType.uncomfortable:
        return '回复不舒服';
      case ConversationMessageFeedbackType.other:
      default:
        return '';
    }
  }

  private formatFeedbackTypeLabel(
    type: ConversationMessageFeedbackType
  ): string {
    switch (type) {
      case ConversationMessageFeedbackType.accurate:
        return '很贴切';
      case ConversationMessageFeedbackType.unlike:
        return '不像本人';
      case ConversationMessageFeedbackType.wrongFact:
        return '说错了';
      case ConversationMessageFeedbackType.fabricated:
        return '瞎编了';
      case ConversationMessageFeedbackType.uncomfortable:
        return '回复不舒服';
      case ConversationMessageFeedbackType.other:
      default:
        return '其他';
    }
  }

  private async resolveChatQuotaForSend(
    runtime: ReplyRuntime,
    now: Date,
    currentMessageContent?: string
  ): Promise<ConversationChatQuotaSnapshot> {
    const currentQuota = await this.resolveCurrentChatQuota(
      runtime,
      now,
      currentMessageContent
    );

    if (currentQuota.isVip) {
      return currentQuota;
    }

    const remainingCount = currentQuota.remainingCount ?? 0;

    if (remainingCount > 0) {
      // daily policy（老用户固定每日额度）：remainingCount 表示“发送前还能发几句”，
      // 发送成功后应减 1，使前端收到“发完本条后还剩几句”，从而正确触发
      // 「剩 1 句」提醒（remainingCount === 1）与「额度用完」拦截（remainingCount === 0）。
      const nextRemaining =
        currentQuota.policy === 'daily' ? remainingCount - 1 : remainingCount;
      return {
        ...currentQuota,
        usedCount: (currentQuota.usedCount ?? 0) + 1,
        remainingCount: nextRemaining,
      };
    }

    throw new AppError(
      'NON_VIP_CHAT_LIMIT_EXCEEDED',
      '免费额度已用完。开通会员后可继续倾听TA的声音。',
      429,
      {
        policy: currentQuota.policy,
        limit: currentQuota.limit,
        usedCount: currentQuota.usedCount,
        remainingCount: 0,
      }
    );
  }

  private async assertMemorialPhotoDailyQuota(
    runtime: ReplyRuntime,
    now: Date
  ): Promise<void> {
    const quota = await this.resolveMemorialPhotoDailyQuota(runtime, now);

    if (quota.usedCount < quota.limit) {
      return;
    }

    throw new AppError(
      'MEMORIAL_PHOTO_DAILY_LIMIT_EXCEEDED',
      this.buildMemorialPhotoDailyLimitMessage(quota.isVip, quota.limit),
      429,
      {
        isVip: quota.isVip,
        limit: quota.limit,
        usedCount: quota.usedCount,
        remainingCount: 0,
        windowStart: quota.windowStart.toISOString(),
        windowEnd: quota.windowEnd.toISOString(),
      }
    );
  }

  private async resolveMemorialPhotoDailyQuota(
    runtime: ReplyRuntime,
    now: Date
  ): Promise<MemorialPhotoDailyQuotaSnapshot> {
    const isVip = await this.isUserVip(runtime.conversation.userId, now);
    const limit = isVip
      ? MEMORIAL_PHOTO_DAILY_LIMIT_POLICY.vipLimit
      : MEMORIAL_PHOTO_DAILY_LIMIT_POLICY.nonVipLimit;
    const windowStart = this.getBeijingDayStart(now);
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    const usedCount = await this.countMemorialPhotoMessagesForUser({
      userId: runtime.conversation.userId,
      windowStart,
      windowEnd,
    });

    return {
      isVip,
      limit,
      usedCount,
      remainingCount: Math.max(limit - usedCount, 0),
      windowStart,
      windowEnd,
    };
  }

  private buildMemorialPhotoDailyLimitMessage(
    isVip: boolean,
    limit: number
  ): string {
    if (isVip) {
      return `会员每天可生成${limit}次纪念合照，今日次数已用完。`;
    }

    return `非会员每天可生成${limit}次纪念合照，开通会员后每天可生成${MEMORIAL_PHOTO_DAILY_LIMIT_POLICY.vipLimit}次。`;
  }

  private async resolveCurrentChatQuota(
    runtime: ReplyRuntime,
    now: Date,
    currentMessageContent?: string
  ): Promise<ConversationChatQuotaSnapshot> {
    // 防御：DI 初始化失败时宁可误拦也不要放行
    if (!this.userMembershipModel || !this.userModel || !this.messageModel) {
      this.logger?.error?.(
        '[chat-quota] critical DI failure: userMembershipModel=%s userModel=%s messageModel=%s — defaulting to conservative limit',
        !!this.userMembershipModel,
        !!this.userModel,
        !!this.messageModel
      );
      return {
        isVip: false,
        policy: 'deep_trigger',
        limit: 0,
        usedCount: 0,
        remainingCount: 0,
      };
    }

    if (await this.isUserVip(runtime.conversation.userId, now)) {
      return { isVip: true };
    }

    const userId = runtime.conversation.userId;
    const agentId = runtime.conversation.agentId;

    // Count today's messages (Beijing time)
    const dayStart = this.getBeijingDayStart(now);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const todayMsgs = await this.countUserMessagesForAgent({
      userId,
      agentId,
      windowStart: dayStart,
      windowEnd: dayEnd,
    });

    // Count session and lifetime messages (for audit)
    const sessionMsgCount = await this.countSessionMessages(
      runtime.conversation.id
    );
    const totalLifetimeMsgs = await this.countTotalUserMessagesForAgent(
      userId,
      agentId
    );

    // Determine if this is a new user (within trial days)
    const isNewUser = await this.isUserInTrialPeriod(runtime, now);

    // New user silent zone: first N lifetime messages, no evaluation
    if (isNewUser && totalLifetimeMsgs < QUOTA_CONFIG.newUserSilentMessages) {
      return this.buildQuotaResult({
        path: 'trial',
        remainingCount: 99,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: false,
        matchedConditions: [],
      });
    }

    // New user hard block: 35 lifetime messages → blocked
    if (
      isNewUser &&
      totalLifetimeMsgs >= QUOTA_CONFIG.newUserHardBlockMessages
    ) {
      return this.buildQuotaResult({
        path: 'trial',
        remainingCount: 0,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: true,
        matchedConditions: ['hardBlock'],
        naturalCloseExempted: false,
        warned: false,
        blocked: true,
      });
    }

    // New user → deep-trigger evaluation (unchanged)
    if (isNewUser) {
      return this.evaluateDeepTriggerQuota(
        userId,
        agentId,
        now,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        currentMessageContent,
        isNewUser
      );
    }

    // Old user → fixed daily quota (no trigger-based evaluation)
    return this.evaluateOldUserDailyQuota(
      userId,
      agentId,
      now,
      totalLifetimeMsgs,
      todayMsgs,
      sessionMsgCount
    );
  }

  private async evaluateDeepTriggerQuota(
    userId: MongoObjectId,
    agentId: MongoObjectId,
    now: Date,
    totalLifetimeMsgs: number,
    todayMsgs: number,
    sessionMsgCount: number,
    currentMessageContent: string | undefined,
    isNewUser: boolean
  ): Promise<ConversationChatQuotaSnapshot> {
    const cfg = QUOTA_CONFIG;
    const matched: string[] = [];

    // Condition A: Effective today messages exceed threshold
    const effectiveMsgs = isNewUser
      ? todayMsgs - cfg.newUserSilentMessages
      : todayMsgs;
    if (effectiveMsgs > cfg.messageThreshold) matched.push('messageCount');

    // Condition B: Long message
    if (
      currentMessageContent &&
      currentMessageContent.length > cfg.longMessageMinChars
    ) {
      matched.push('longMessage');
    }

    // Condition C: Relationship stage
    const lastStage = await this.getLastRelationshipStage(userId, agentId);
    if (lastStage && (cfg.relationshipStages as string[]).includes(lastStage)) {
      const freshlyPromoted = await this.isStageJustPromoted(userId, agentId);
      if (!freshlyPromoted) matched.push('relationshipStage');
    }

    // Trigger if any 2 of 3 conditions are met
    const triggered = matched.length >= 2;

    // Natural close exemption
    const naturalClose = currentMessageContent
      ? cfg.naturalClosePatterns.some(p => currentMessageContent.includes(p))
      : false;

    // ═══════════════════════════════════════════════════════════════
    // GRACE/BLOCK CHECK — once warned, EVERY message counts toward
    // the grace limit, regardless of trigger conditions.
    // ═══════════════════════════════════════════════════════════════
    const wasWarned = await this.wasQuotaWarningSent(userId, agentId, now);

    if (wasWarned) {
      const dayStart = this.getBeijingDayStart(now);
      const firstWarnedMsg = (
        await this.messageModel.find({
          where: {
            userId,
            agentId,
            role: MessageRole.user,
            quotaWarned: true,
            createdAt: { $gte: dayStart },
          },
          order: { createdAt: 'ASC' },
          take: 1,
        } as any)
      )[0];

      const postWarnCount = firstWarnedMsg
        ? await this.messageModel.count({
            userId,
            agentId,
            role: MessageRole.user,
            createdAt: { $gt: firstWarnedMsg.createdAt },
            status: MessageStatus.sent,
          } as never)
        : 0;

      if (postWarnCount > cfg.graceMessagesAfterWarn) {
        return this.buildQuotaResult({
          path: isNewUser ? 'trial' : 'active',
          remainingCount: 0,
          totalLifetimeMsgs,
          todayMsgs,
          sessionMsgCount,
          triggered: true,
          matchedConditions: matched,
          naturalCloseExempted: false,
          warned: true,
          blocked: true,
        });
      }

      // Within grace period → pass through (don't re-warn)
      return this.buildQuotaResult({
        path: isNewUser ? 'trial' : 'active',
        remainingCount: 99,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: true,
        matchedConditions: matched,
        naturalCloseExempted: false,
        warned: true,
        blocked: false,
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // NOT WARNED YET → trigger-based evaluation
    // ═══════════════════════════════════════════════════════════════

    if (naturalClose) {
      return this.buildQuotaResult({
        path: isNewUser ? 'trial' : 'active',
        remainingCount: 2,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: true,
        matchedConditions: matched,
        naturalCloseExempted: true,
      });
    }

    if (triggered) {
      // First warning
      // Record the trigger event for return-tracking
      this.recordQuotaTriggerEvent(userId, agentId, {
        triggerType: QuotaTriggerType.warned,
        triggeredAt: now,
        dayMsgs: todayMsgs,
        lifetimeMsgs: totalLifetimeMsgs,
        triggered: true,
        matchedConditions: matched,
        warnCount: 1,
      });
      return this.buildQuotaResult({
        path: isNewUser ? 'trial' : 'active',
        remainingCount: 1,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: true,
        matchedConditions: matched,
        naturalCloseExempted: false,
        warned: true,
        blocked: false,
      });
    }

    // Not triggered, not warned → completely free pass
    return this.buildQuotaResult({
      path: isNewUser ? 'trial' : 'active',
      remainingCount: 99,
      totalLifetimeMsgs,
      todayMsgs,
      sessionMsgCount,
      triggered: false,
      matchedConditions: matched,
      naturalCloseExempted: false,
    });
  }

  private async evaluateOldUserDailyQuota(
    userId: MongoObjectId,
    agentId: MongoObjectId,
    now: Date,
    totalLifetimeMsgs: number,
    todayMsgs: number,
    sessionMsgCount: number
  ): Promise<ConversationChatQuotaSnapshot> {
    const cfg = QUOTA_CONFIG;
    const limit = cfg.oldUserDailyLimit;
    // 发送前剩余额度（含当前这条）：今天还能发几句
    const remainingBefore = limit - todayMsgs;

    // 额度已用完 → 拦截（第 8 句起）
    if (remainingBefore <= 0) {
      return this.buildQuotaResult({
        path: 'active',
        policy: 'daily',
        limit,
        remainingCount: 0,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: true,
        matchedConditions: ['dailyLimit'],
        naturalCloseExempted: false,
        warned: true,
        blocked: true,
      });
    }

    // 发完当前这条后正好剩 1 句（remainingBefore === 2）→ 弹“剩 1 句”提醒
    // resolveChatQuotaForSend 会对 daily policy 做 remainingCount - 1，
    // 因此本条返回 2，前端实际收到 1，触发「还可以聊最后 1 句」弹框。
    if (remainingBefore === 2) {
      this.recordQuotaTriggerEvent(userId, agentId, {
        triggerType: QuotaTriggerType.warned,
        triggeredAt: now,
        dayMsgs: todayMsgs,
        lifetimeMsgs: totalLifetimeMsgs,
        triggered: true,
        matchedConditions: ['dailyLimit'],
        warnCount: 1,
      });
      return this.buildQuotaResult({
        path: 'active',
        policy: 'daily',
        limit,
        remainingCount: remainingBefore,
        totalLifetimeMsgs,
        todayMsgs,
        sessionMsgCount,
        triggered: true,
        matchedConditions: ['dailyLimit'],
        naturalCloseExempted: false,
        warned: true,
        blocked: false,
      });
    }

    // 额度充足 → 正常放行（remainingBefore === 1 为最后一句，发完后剩余 0）
    return this.buildQuotaResult({
      path: 'active',
      policy: 'daily',
      limit,
      remainingCount: remainingBefore,
      totalLifetimeMsgs,
      todayMsgs,
      sessionMsgCount,
      triggered: false,
      matchedConditions: [],
      naturalCloseExempted: false,
      warned: false,
      blocked: false,
    });
  }

  private recordQuotaTriggerEvent(
    userId: MongoObjectId,
    agentId: MongoObjectId,
    params: {
      triggerType: QuotaTriggerType;
      triggeredAt: Date;
      dayMsgs: number;
      lifetimeMsgs: number;
      triggered: boolean;
      matchedConditions: string[];
      warnCount?: number;
    }
  ): void {
    // Deduplicate: only one event per user+agent+type per day
    const dayStart = this.getBeijingDayStart(params.triggeredAt);
    this.quotaTriggerEventModel
      .findOne({
        where: {
          userId,
          agentId,
          triggerType: params.triggerType,
          triggeredAt: { $gte: dayStart },
        },
      } as any)
      .then((existing: any) => {
        if (existing) return;
        this.quotaTriggerEventModel
          .save({
            userId,
            agentId,
            triggerType: params.triggerType,
            triggeredAt: params.triggeredAt,
            dayMsgs: params.dayMsgs,
            lifetimeMsgs: params.lifetimeMsgs,
            triggered: params.triggered,
            matchedConditions: params.matchedConditions,
            warnCount: params.warnCount ?? 0,
          } as any)
          .catch(() => {});
      })
      .catch(() => {});
  }

  private buildQuotaResult(params: {
    path: 'trial' | 'active';
    remainingCount: number;
    totalLifetimeMsgs: number;
    todayMsgs: number;
    sessionMsgCount: number;
    triggered: boolean;
    matchedConditions: string[];
    naturalCloseExempted?: boolean;
    warned?: boolean;
    blocked?: boolean;
    policy?: 'trial' | 'daily' | 'deep_trigger';
    limit?: number;
  }): ConversationChatQuotaSnapshot {
    const limit = params.limit ?? (params.remainingCount <= 1 ? 1 : 99);
    return {
      isVip: false,
      policy: params.policy ?? 'deep_trigger',
      limit,
      usedCount: params.totalLifetimeMsgs,
      remainingCount: Math.max(params.remainingCount, 0),
      triggerDecision: {
        version: QUOTA_CONFIG.version,
        path: params.path,
        triggered: params.triggered,
        totalLifetimeMsgs: params.totalLifetimeMsgs,
        todayMsgs: params.todayMsgs,
        sessionMsgCount: params.sessionMsgCount,
        matchedConditions: params.matchedConditions,
        naturalCloseExempted: params.naturalCloseExempted ?? false,
        returnVisitCount: 0,
        lastMessageGapDays: 0,
        warned: params.warned ?? false,
        blocked: params.blocked ?? false,
      },
    };
  }

  private async isUserInTrialPeriod(
    runtime: ReplyRuntime,
    now: Date
  ): Promise<boolean> {
    const accountId = this.normalizeObjectId(runtime.auth.accountId);
    const account = accountId
      ? await this.userAccountModel.findOne({
          where: {
            _id: accountId,
            userId: runtime.conversation.userId,
          },
        } as any)
      : null;
    const user = account?.createdAt
      ? null
      : await this.userModel.findOne({
          where: { _id: runtime.conversation.userId },
        } as any);
    const registeredAt = account?.createdAt || user?.createdAt;
    if (!registeredAt) return false;

    const registrationDay = this.getBeijingDayStart(new Date(registeredAt));
    const currentDay = this.getBeijingDayStart(now);
    const daysSinceRegister = Math.floor(
      (currentDay.getTime() - registrationDay.getTime()) / 86400000
    );
    return daysSinceRegister < QUOTA_CONFIG.newUserTrialDays;
  }

  private async countSessionMessages(
    conversationId: MongoObjectId
  ): Promise<number> {
    return this.messageModel.count({
      conversationId,
      role: MessageRole.user,
      status: MessageStatus.sent,
    } as never);
  }

  private async countTotalUserMessagesForAgent(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<number> {
    return this.messageModel.count({
      userId,
      agentId,
      role: MessageRole.user,
      status: MessageStatus.sent,
      quotaExempt: { $ne: true },
    } as never);
  }

  private async getLastRelationshipStage(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<string | null> {
    const lastAssistantMsg = await this.messageModel.findOne({
      where: {
        userId,
        agentId,
        role: MessageRole.assistant,
        replyRelationshipStage: { $exists: true, $ne: null },
      },
      order: { createdAt: 'DESC' },
    } as any);
    return lastAssistantMsg?.replyRelationshipStage ?? null;
  }

  private async isStageJustPromoted(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<boolean> {
    const lastTwo = await this.messageModel.find({
      where: {
        userId,
        agentId,
        role: MessageRole.assistant,
        replyRelationshipStage: { $exists: true, $ne: null },
      },
      order: { createdAt: 'DESC' },
      take: 2,
    } as any);
    if (lastTwo.length < 2) return false;
    const cur = lastTwo[0]?.replyRelationshipStage;
    const prev = lastTwo[1]?.replyRelationshipStage;
    if (!cur || !prev) return false;
    const stageRank: Record<string, number> = {
      R0: 0,
      R1: 1,
      R2: 2,
      R3: 3,
      R4: 4,
    };
    const curRank = stageRank[cur] ?? 0;
    const prevRank = stageRank[prev] ?? 0;
    return curRank > prevRank && curRank >= 2;
  }

  private async wasQuotaWarningSent(
    userId: MongoObjectId,
    agentId: MongoObjectId,
    now: Date
  ): Promise<boolean> {
    // Check for any warned message today (not just the last one),
    // so non-triggered messages between triggered ones don't reset the counter.
    const dayStart = this.getBeijingDayStart(now);
    const warnedMsg = (
      await this.messageModel.find({
        where: {
          userId,
          agentId,
          role: MessageRole.user,
          quotaWarned: true,
          createdAt: { $gte: dayStart },
        },
        order: { createdAt: 'ASC' },
        take: 1,
      } as any)
    )[0];

    if (!warnedMsg) return false;

    const warnedAt = new Date(warnedMsg.createdAt);
    return now.getTime() - warnedAt.getTime() < 24 * 60 * 60 * 1000;
  }

  private async isUserVip(userId: MongoObjectId, now: Date): Promise<boolean> {
    const memberships = await this.userMembershipModel.find({
      where: {
        userId,
        status: UserMembershipStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    return memberships.some(
      membership =>
        membership.lifetime ||
        Boolean(membership.expiredAt && membership.expiredAt > now)
    );
  }

  private getBeijingDayStart(value: Date): Date {
    const offsetMs = 8 * 60 /* deprecated */ * 60 * 1000;
    const shifted = new Date(value.getTime() + offsetMs);

    return new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate()
      ) - offsetMs
    );
  }

  private countUserMessagesForAgent(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    windowStart: Date;
    windowEnd?: Date;
  }): Promise<number> {
    const createdAtQuery: Record<string, Date> = {
      $gte: options.windowStart,
    };

    if (options.windowEnd) {
      createdAtQuery.$lt = options.windowEnd;
    }

    return this.messageModel.count({
      userId: options.userId,
      agentId: options.agentId,
      role: MessageRole.user,
      status: MessageStatus.sent,
      quotaExempt: { $ne: true },
      createdAt: createdAtQuery,
    } as never);
  }

  private countMemorialPhotoMessagesForUser(options: {
    userId: MongoObjectId;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<number> {
    return this.messageModel.count({
      userId: options.userId,
      role: MessageRole.assistant,
      type: MessageType.image,
      status: MessageStatus.sent,
      createdAt: {
        $gte: options.windowStart,
        $lt: options.windowEnd,
      },
      $or: [
        { content: MEMORIAL_PHOTO_MESSAGE_CONTENT },
        { mediaAnalysis: MEMORIAL_PHOTO_MESSAGE_CONTENT },
      ],
    } as never);
  }

  /**
   * A/B 通道路由：基于 userId 哈希决定是否使用 B 侧模型。
   * 返回 undefined 表示使用默认主模型。
   */
  private resolveChatModelForAB(userId: string): string | undefined {
    const cfg = this.openAIService?.openAIConfig;
    const abModel = cfg?.abModel?.trim();
    const abSplit = cfg?.abSplitPercent ?? 0;
    if (!abModel || abSplit <= 0) return cfg?.model?.trim() || undefined;
    const hash = require('crypto')
      .createHash('md5')
      .update(String(userId))
      .digest('hex');
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    if (bucket < abSplit) {
      this.logger?.info?.(
        '[conversation] AB routing to ' + abModel + ', bucket=' + bucket
      );
      return abModel;
    }
    return undefined;
  }

  private async processReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult
  ): Promise<ProcessReplyResult> {
    let context;
    const currentTurnMessages = this.resolveCurrentTurnMessages(before);
    const containsImage = currentTurnMessages.some(
      message => message.type === MessageType.image
    );

    const effectiveChatModel =
      this.resolveChatModelForAB(runtime.auth.sub) || undefined;

    const [recognitionJourneyPlan, continuityInformationCardPlan] =
      await Promise.all([
        this.prepareRecognitionJourneyTurn({
          runtime,
          before,
          currentTurnMessages,
        }),
        this.continuityInformationCardService?.prepareTurn({
          conversation: runtime.conversation,
          currentQuery: before.searchableText,
          currentTurnMessages,
        }),
      ]);
    if (continuityInformationCardPlan) {
      this.logger?.info?.(
        '[conversation] continuity background offered, conversationId=%s cardId=%s sourceMessageId=%s',
        this.stringifyObjectId(runtime.conversation.id),
        continuityInformationCardPlan.cardId,
        continuityInformationCardPlan.sourceMessageId
      );
    }

    const shortTurnGeneration = resolveShortTurnGeneration({
      messageTypes: currentTurnMessages.map(message => message.type),
      texts: currentTurnMessages.map(message =>
        this.buildSearchableTextFromMessage(message)
      ),
    });
    if (
      shortTurnGeneration.mode === 'micro_model' &&
      !recognitionJourneyPlan?.prompt &&
      !continuityInformationCardPlan?.prompt
    ) {
      try {
        return await this.processLightweightReply({
          runtime,
          before,
          currentTurnMessages,
          category: shortTurnGeneration.category!,
          effectiveChatModel,
        });
      } catch (error) {
        this.logger?.warn?.(
          '[conversation] lightweight reply escalated to full model, category=%s, conversationId=%s, reason=%s',
          shortTurnGeneration.category || '-',
          this.stringifyObjectId(runtime.conversation.id),
          this.describeReplyError(error)
        );
      }
    }

    const memoryControlResult = await this.applyExplicitMemoryControl(
      before.userMessage,
      before.searchableText
    );

    try {
      context = await this.withTraceSpan(
        ChatTraceStage.contextLoad,
        'context.build',
        () =>
          this.agentContextService.buildConversationContext({
            auth: runtime.auth,
            conversation: runtime.conversation,
            agent: runtime.agent,
            currentQuery: before.searchableText,
            currentTurnMessageIds: currentTurnMessages.map(message =>
              this.stringifyObjectId(message.id)
            ),
            forceSemanticPlanning:
              currentTurnMessages.length > 1 || containsImage,
            memoryControlResult,
            effectiveChatModel: effectiveChatModel || undefined,
            recognitionJourneyPrompt: recognitionJourneyPlan?.prompt,
            continuityInformationCardPrompt:
              continuityInformationCardPlan?.prompt,
          })
      );
    } catch (error) {
      const fallbackRoute = routeReplyScene({
        currentQuery: before.searchableText,
      });
      const fallbackBrief = buildReplyBrief({
        currentQuery: before.searchableText,
        intent: fallbackRoute.intent,
        route: fallbackRoute,
      });

      return this.attachRecognitionJourneyPlan(
        await this.buildGenerationFailureReply(
          before.searchableText,
          fallbackRoute,
          fallbackRoute.intent,
          fallbackBrief,
          error,
          'context'
        ),
        recognitionJourneyPlan
      );
    }

    const replyBrief =
      context.replyBrief ??
      buildReplyBrief({
        currentQuery: before.searchableText,
        intent: context.replyIntent ?? context.replyRoute?.intent,
        route: context.replyRoute,
      });

    const contextEvidence = context.evidence || [];
    let reviewEvidence = contextEvidence;
    this.scheduleRelationshipSignals(
      before.userMessage,
      context.replyIntent ?? context.replyRoute?.intent
    );
    const primaryIntent =
      context.replyRoute?.responseIntents?.[0] ??
      context.replyIntent?.intents?.[0];
    this.logger?.info?.(
      '[conversation] reply routed, intent=%s, target=%s, timeScope=%s, confidence=%s, scene=%s, source=%s',
      primaryIntent?.intent || '-',
      primaryIntent?.target || '-',
      primaryIntent?.timeScope || '-',
      context.replyIntent?.confidence ?? '-',
      context.replyRoute?.primaryScene?.scene || '-',
      context.replyRoute?.routingSource || 'legacy'
    );
    if (replyBrief.capabilityConstraints.length) {
      this.logger?.info?.(
        '[conversation] capability constraints resolved, policies=%s',
        replyBrief.capabilityConstraints
          .map(item => `${item.policyId}:${item.access}`)
          .join(',')
      );
    }
    const preplanned = this.replyGuardrailService?.resolvePreplannedSafetyReply(
      {
        userQuery: before.searchableText,
        replyRoute: context.replyRoute,
        replyBrief,
      }
    );

    if (preplanned?.segments.length) {
      this.logger?.info?.(
        '[conversation] preplanned safety-critical reply selected, scene=%s, segments=%s',
        context.replyRoute?.primaryScene?.scene || '-',
        preplanned.segments.length
      );

      return this.attachRecognitionJourneyPlan(
        {
          replySegments: compactReplyBubblesPreservingContent(
            preplanned.segments
          ),
          usage: {},
          routing: {
            intent: context.replyIntent ?? context.replyRoute?.intent,
            route: context.replyRoute,
            brief: replyBrief,
            guardrailRewritten: preplanned.rewritten,
            guardrailReason: preplanned.reason,
            guardrailInterventionLevel: preplanned.interventionLevel,
            guardrailRevisionAttempted: preplanned.revisionAttempted,
            evidenceCount: contextEvidence.length,
            factClaimCount: 0,
            unsupportedClaimCount: 0,
            ...context.diagnostics,
          },
        },
        recognitionJourneyPlan
      );
    }

    let response;
    let replySegments: string[];
    let replyClaims: AssistantFactClaim[] = [];
    let generationUsage: ReplyUsage = {};
    let generationRecoveryAttempted = false;
    let generationRecoverySucceeded = false;
    let chatToolAudit: AgentChatToolAudit = {
      decisionNames: [],
      invalidDecisionCount: 0,
      executionCount: 0,
      resultItemCount: 0,
    };
    const generationAttemptTraces: AssistantGenerationAttemptTrace[] = [];

    try {
      const primaryCompletion = await this.createPrimaryAssistantCompletion({
        runtime,
        before,
        context,
      });
      response = primaryCompletion.response;
      chatToolAudit = primaryCompletion.toolAudit;
      reviewEvidence = contextEvidence.concat(primaryCompletion.toolEvidence);
      generationUsage = this.mergeReplyUsage(
        generationUsage,
        primaryCompletion.usage
      );
      const responseContent =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const replyTruncated = this.checkAssistantCompletionTruncated(response);
      if (replyTruncated) {
        this.logger.error(
          '[conversation] primary assistant completion truncated by token limit'
        );
      }
      const parsedReply = this.parseAssistantReply(
        responseContent,
        context.chatToolPlan?.availableTools
      );
      chatToolAudit = this.mergeAgentChatToolDecisionAudit(
        context,
        chatToolAudit,
        parsedReply
      );
      this.recordAgentChatToolAudit(context, chatToolAudit);
      const plannedSegments = parsedReply.segments;
      generationAttemptTraces.push(
        this.buildAssistantGenerationAttemptTrace({
          attempt: 'initial',
          responseContent,
          parsedSegments: plannedSegments,
          userQuery: before.searchableText,
          model:
            typeof response.model === 'string' ? response.model : undefined,
          usage: this.extractUsageFromResponse(response),
        })
      );
      replyClaims = parsedReply.claims;
      replySegments = this.normalizeAssistantReplySegments(
        plannedSegments,
        before.searchableText
      );
    } catch (initialError) {
      generationRecoveryAttempted = true;
      if (!generationAttemptTraces.some(item => item.attempt === 'initial')) {
        generationAttemptTraces.push(
          this.buildAssistantGenerationAttemptTrace({
            attempt: 'initial',
            responseContent: '',
            userQuery: before.searchableText,
            errorCode: this.resolveGenerationFailureCode(initialError),
          })
        );
      }

      const isTimeoutRecovery = this.isGenerationTimeoutError(initialError);

      try {
        response = await this.openAIService.createChatCompletion(
          {
            temperature: ASSISTANT_REPLY_TEMPERATURE,
            topP: ASSISTANT_REPLY_TOP_P,
            max_tokens: isTimeoutRecovery
              ? ASSISTANT_RECOVERY_TIMEOUT_MAX_TOKENS
              : ASSISTANT_RECOVERY_MAX_TOKENS,
            messages: this.buildMinimalGenerationRecoveryMessages({
              runtime,
              userQuery: before.searchableText,
              contextMessages: context.messages,
              replyBrief,
              evidence: contextEvidence,
            }),
            trace: {
              stage: ChatTraceStage.generate,
              operation: 'generate.recovery',
            },
          },
          {
            timeout: isTimeoutRecovery
              ? ASSISTANT_RECOVERY_TIMEOUT_MS
              : ASSISTANT_REPLY_TIMEOUT_MS,
            maxRetries: 0,
          }
        );
        generationUsage = this.mergeReplyUsage(
          generationUsage,
          this.extractUsageFromResponse(response)
        );
        const responseContent =
          typeof response.choices?.[0]?.message?.content === 'string'
            ? response.choices[0].message.content
            : '';
        const replyTruncated = this.checkAssistantCompletionTruncated(response);
        if (replyTruncated) {
          this.logger.error(
            '[conversation] recovery assistant completion truncated by token limit'
          );
        }
        const parsedReply = this.parseAssistantReply(responseContent);
        const plannedSegments = parsedReply.segments;
        generationAttemptTraces.push(
          this.buildAssistantGenerationAttemptTrace({
            attempt: 'recovery',
            responseContent,
            parsedSegments: plannedSegments,
            userQuery: before.searchableText,
            model:
              typeof response.model === 'string' ? response.model : undefined,
            usage: this.extractUsageFromResponse(response),
          })
        );
        replyClaims = parsedReply.claims;
        replySegments = this.normalizeAssistantReplySegments(
          plannedSegments,
          before.searchableText
        );
        generationRecoverySucceeded = true;
      } catch (recoveryError) {
        if (
          !generationAttemptTraces.some(item => item.attempt === 'recovery')
        ) {
          generationAttemptTraces.push(
            this.buildAssistantGenerationAttemptTrace({
              attempt: 'recovery',
              responseContent: '',
              userQuery: before.searchableText,
              errorCode: this.resolveGenerationFailureCode(recoveryError),
            })
          );
        }
        return this.attachRecognitionJourneyPlan(
          await this.buildGenerationFailureReply(
            before.searchableText,
            context.replyRoute,
            context.replyIntent ?? context.replyRoute?.intent,
            replyBrief,
            recoveryError,
            this.resolveGenerationFailureStage(recoveryError),
            {
              attempted: true,
              succeeded: false,
              initialFailureCode:
                this.resolveGenerationFailureCode(initialError),
            },
            generationUsage,
            context.messages,
            generationAttemptTraces,
            runtime
          ),
          recognitionJourneyPlan
        );
      }
    }

    let guarded: ValidateAssistantReplyResult;
    let guardrailReviewMode: ReplyGuardrailReviewMode = 'deterministic_first';
    let participationResult: {
      segments: string[];
      execution?: string;
      fallbackReason?: string;
    };
    let finalClaims: AssistantFactClaim[];
    let bubbleStructureIssues: ReplyBubbleStructureIssue[] = [];
    let bubbleReflowAttempted = false;
    let bubbleReflowSucceeded: boolean | undefined;
    let finalizationUsage: ReplyUsage = {};
    let replyQualityAudit: ConversationReplyFinalizationResult['qualityAudit'];

    if (this.conversationReplyFinalizationService) {
      const finalized = await this.withTraceSpan(
        ChatTraceStage.review,
        'review.finalize_reply',
        () =>
          this.conversationReplyFinalizationService.finalize({
            messages: context.messages,
            userQuery: before.searchableText,
            segments: replySegments,
            claims: replyClaims,
            evidence: reviewEvidence,
            brief: replyBrief,
            turnDecision: context.turnDecision,
            turnContract: context.turnContract,
          })
      );
      const governance = finalized.governance;
      guarded = {
        segments: finalized.segments,
        claims: finalized.claims,
        rewritten: governance.rewritten,
        reason: governance.reason,
        unsupportedClaimCount: governance.unsupportedClaimCount,
        interventionLevel: governance.interventionLevel,
        revisionAttempted: governance.revisionAttempted,
        revisionRoundCount: governance.revisionRoundCount,
        revisionUsage: governance.revisionUsage,
        finalReviewResult: governance.finalReviewResult,
        candidateVersions: governance.candidateVersions,
      };
      finalClaims = finalized.claims;
      bubbleStructureIssues =
        finalized.bubbleStructureIssues as ReplyBubbleStructureIssue[];
      participationResult = {
        segments: finalized.segments,
        execution: finalized.participationExecution,
      };
      replyQualityAudit = finalized.qualityAudit;
    } else {
      // 仅供直接 new ConversationService() 的旧测试/脚本兼容；生产 DI
      // 必须走上面的 FinalValidator → 单次修订 → 再验证链路。
      const generatedBubbleReflow = await this.reflowAssistantReplyBubbles({
        userQuery: before.searchableText,
        replySegments,
      });
      replySegments = generatedBubbleReflow.segments;
      generationUsage = this.mergeReplyUsage(
        generationUsage,
        generatedBubbleReflow.usage
      );
      if (generatedBubbleReflow.trace) {
        generationAttemptTraces.push(generatedBubbleReflow.trace);
      }

      const requestedGuardrailReviewMode = this.resolveGuardrailReviewMode({
        replyBrief,
        claims: replyClaims,
      });
      guardrailReviewMode =
        this.replyGuardrailService?.resolveEffectiveReviewMode({
          requestedMode: requestedGuardrailReviewMode,
          userQuery: before.searchableText,
          replySegments,
          replyBrief,
          evidence: reviewEvidence,
          claims: replyClaims,
          mode: PRODUCTION_REPLY_GUARDRAIL_MODE,
        }) ?? requestedGuardrailReviewMode;
      guarded = await this.withTraceSpan(
        ChatTraceStage.review,
        'review.reply_legacy_compatibility',
        () =>
          this.validateAssistantReply({
            contextMessages: context.messages,
            userQuery: before.searchableText,
            replySegments,
            replyRoute: context.replyRoute,
            replyBrief,
            evidence: reviewEvidence,
            claims: replyClaims,
            reviewMode: guardrailReviewMode,
            conversationId: this.stringifyObjectId(runtime.conversation.id),
          })
      );
      const guardedBubbleReflow = await this.reflowAssistantReplyBubbles({
        userQuery: before.searchableText,
        replySegments: guarded.segments,
      });
      if (guardedBubbleReflow.trace) {
        generationAttemptTraces.push(guardedBubbleReflow.trace);
      }
      const strategyAlignedSegments = this.applyConversationStrategyToSegments(
        guardedBubbleReflow.segments,
        replyBrief,
        before.searchableText
      );
      participationResult = this.finalizeParticipationReplySegments(
        strategyAlignedSegments,
        replyBrief.participationStrategy
      );
      finalClaims = guarded.claims || replyClaims;
      bubbleStructureIssues = Array.from(
        new Set(generatedBubbleReflow.issues.concat(guardedBubbleReflow.issues))
      );
      bubbleReflowAttempted =
        generatedBubbleReflow.attempted || guardedBubbleReflow.attempted;
      bubbleReflowSucceeded = bubbleReflowAttempted
        ? (!generatedBubbleReflow.attempted ||
            generatedBubbleReflow.succeeded) &&
          (!guardedBubbleReflow.attempted || guardedBubbleReflow.succeeded)
        : undefined;
      finalizationUsage = guardedBubbleReflow.usage;
    }

    const toolEvidenceIds = new Set(
      reviewEvidence
        .slice(contextEvidence.length)
        .map(item => item.id)
        .filter(Boolean)
    );
    const memoryUsedEvidenceIds = Array.from(
      new Set(
        finalClaims
          .reduce<string[]>(
            (ids, claim) => ids.concat(claim.evidenceIds || []),
            []
          )
          .filter(id => /^(?:F|L)\d+$/.test(id) || toolEvidenceIds.has(id))
      )
    );
    const memoryUsedClaimCount = finalClaims.filter(claim =>
      (claim.evidenceIds || []).some(
        id => /^(?:F|L)\d+$/.test(id) || toolEvidenceIds.has(id)
      )
    ).length;
    return this.attachRecognitionJourneyPlan(
      {
        replySegments: participationResult.segments,
        usage: this.mergeReplyUsage(
          this.mergeReplyUsage(generationUsage, guarded.revisionUsage),
          finalizationUsage
        ),
        routing: {
          intent: context.replyIntent ?? context.replyRoute?.intent,
          route: context.replyRoute,
          brief: replyBrief,
          guardrailRewritten: guarded.rewritten,
          guardrailReason: guarded.reason,
          guardrailInterventionLevel: guarded.interventionLevel,
          guardrailRevisionAttempted: guarded.revisionAttempted,
          guardrailRevisionRoundCount: guarded.revisionRoundCount,
          communicationCompensationAttempted:
            guarded.communicationCompensationAttempted,
          communicationCompensationSucceeded:
            guarded.communicationCompensationSucceeded,
          guardrailFinalReviewResult: guarded.finalReviewResult,
          guardrailReviewMode,
          guardrailFocuses: replyBrief.guardrailFocuses,
          contentEchoPassed: guarded.contentEcho?.passed,
          contentEchoUnitCount: guarded.contentEcho?.unitCount,
          guardrailFeedbackRounds: guarded.feedbackRounds,
          guardrailCandidateVersions: guarded.candidateVersions,
          guardrailRevisionRecords: guarded.revisionRecords,
          generationRecoveryAttempted,
          generationRecoverySucceeded,
          generationAttemptTraces,
          bubbleReflowAttempted,
          bubbleReflowSucceeded,
          bubbleStructureIssues,
          chatToolDecisionNames: chatToolAudit.decisionNames,
          chatToolInvalidDecisionCount: chatToolAudit.invalidDecisionCount,
          chatToolExecutionCount: chatToolAudit.executionCount,
          chatToolResultItemCount: chatToolAudit.resultItemCount,
          chatToolPlannerMemoryAgreement: chatToolAudit.plannerMemoryAgreement,
          participationExecution: participationResult.execution,
          participationFallbackReason: participationResult.fallbackReason,
          evidenceCount: reviewEvidence.length,
          factClaimCount: finalClaims.length,
          unsupportedClaimCount: guarded.unsupportedClaimCount ?? 0,
          qualityAuditVersion: replyQualityAudit?.version,
          qualityActivatedDimensions: replyQualityAudit?.activatedDimensions,
          qualityInitialFailedDimensions:
            replyQualityAudit?.initialFailedDimensions,
          qualityFinalFailedDimensions:
            replyQualityAudit?.finalFailedDimensions,
          qualityRecoveredDimensions: replyQualityAudit?.recoveredDimensions,
          memoryUsedEvidenceIds,
          memoryUsedClaimCount,
          ...context.diagnostics,
          ...(replyBrief.directActiveContribution
            ? {
                assistantContribution: assessDirectActiveContributionExecution(
                  participationResult.segments.join('\n'),
                  replyBrief.directActiveContribution
                ),
              }
            : {}),
        },
      },
      recognitionJourneyPlan
    );
  }

  private async processLightweightReply(options: {
    runtime: ReplyRuntime;
    before: BeforeReplyResult;
    currentTurnMessages: MessageEntity[];
    category: LightweightReplyCategory;
    effectiveChatModel?: string;
  }): Promise<ProcessReplyResult> {
    const lightweightContext = await this.buildLightweightReplyMessages({
      runtime: options.runtime,
      currentTurnMessages: options.currentTurnMessages,
      category: options.category,
    });
    const response = await this.openAIService.createChatCompletion(
      {
        ...(options.effectiveChatModel
          ? { model: options.effectiveChatModel }
          : {}),
        temperature: LIGHTWEIGHT_REPLY_TEMPERATURE,
        topP: LIGHTWEIGHT_REPLY_TOP_P,
        max_tokens: LIGHTWEIGHT_REPLY_MAX_TOKENS,
        reasoningSplit: false,
        messages: lightweightContext.messages,
        trace: {
          stage: ChatTraceStage.generate,
          operation: 'generate.lightweight_reply',
          attributes: {
            shortTurnCategory: options.category,
            shortTurnRuntimeVersion: SHORT_TURN_RUNTIME_VERSION,
            historyMessageCount: lightweightContext.historyMessageCount,
          },
        },
      },
      {
        timeout: LIGHTWEIGHT_REPLY_TIMEOUT_MS,
        maxRetries: 0,
      }
    );
    const responseContent =
      typeof response.choices?.[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : '';
    const normalizedSegments = this.normalizeAssistantReplySegments(
      responseContent,
      options.before.searchableText
    );
    const inspectedSegments = normalizedSegments.map(segment =>
      this.inspectAssistantSegmentSanitization(
        segment,
        options.before.searchableText,
        { dropSemanticRisks: true }
      )
    );

    if (
      inspectedSegments.some(segment => segment.dropped) ||
      !inspectedSegments.some(segment => segment.output)
    ) {
      throw new AppError(
        'LIGHTWEIGHT_REPLY_BOUNDARY_REJECTED',
        'lightweight reply requires full-model handling',
        502
      );
    }

    const replySegments = splitReplyContentForDelivery(
      inspectedSegments.map(segment => segment.output).filter(Boolean)
    );
    if (!replySegments.length) {
      throw new AppError(
        'LIGHTWEIGHT_REPLY_EMPTY',
        'lightweight reply did not contain usable text',
        502
      );
    }

    return {
      replySegments,
      usage: this.extractUsageFromResponse(response),
      routing: {
        replyPlanningMode: 'micro_model',
        replyPlanningReason: `closed_social_turn:${options.category}`,
        replyIntentModelCallCount: 0,
        strategyVersion: SHORT_TURN_RUNTIME_VERSION,
        strategySource: 'model_generated_lightweight',
        promptVersion: 'lightweight_reply_prompt_v1',
        systemPromptCharacters: lightweightContext.systemPromptCharacters,
        historyMessageCount: lightweightContext.historyMessageCount,
        relevantMemoryCount: 0,
        evidenceCount: 0,
        factClaimCount: 0,
        unsupportedClaimCount: 0,
        guardrailRewritten: false,
        guardrailRevisionAttempted: false,
        guardrailReviewMode: 'deterministic_first',
        conversationDepth: 'micro',
      },
    };
  }

  private async prepareRecognitionJourneyTurn(options: {
    runtime: ReplyRuntime;
    before: BeforeReplyResult;
    currentTurnMessages: MessageEntity[];
  }): Promise<PreparedRecognitionJourneyTurn | undefined> {
    if (
      !options.runtime.agent ||
      this.isMessengerAgent(options.runtime.agent)
    ) {
      return undefined;
    }

    try {
      const conversation = options.runtime.conversation;
      const earliestCurrentMessage = [...options.currentTurnMessages].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      )[0];
      const priorUserMessageCount = await this.messageModel.count({
        conversationId: conversation.id,
        role: MessageRole.user,
        status: MessageStatus.sent,
        isArchived: { $ne: true },
        ...(earliestCurrentMessage?.createdAt
          ? { createdAt: { $lt: earliestCurrentMessage.createdAt } }
          : {}),
      } as never);
      const userTurnNumber =
        priorUserMessageCount + Math.max(1, options.currentTurnMessages.length);
      const stored = await this.findRecognitionJourneyStateMessage(
        conversation.id
      );
      let stateMessage = stored?.message;
      let journey = stored?.journey;
      if (!stateMessage || !journey) {
        journey =
          priorUserMessageCount >= 20
            ? buildLegacyRecognitionJourney()
            : buildInitialRecognitionJourney({
                hasKnownDepartureDate: Boolean(options.runtime.agent.deathDate),
              });
        stateMessage = await this.createRecognitionJourneyStateMessage({
          runtime: options.runtime,
          journey,
        });
      }

      const beforeState = serializeRecognitionJourney(journey);
      const resolved = planRecognitionJourneyTurn({
        journey,
        currentQuery: options.before.searchableText,
        currentUserMessageId: this.stringifyObjectId(
          options.before.userMessage.id
        ),
        userTurnNumber,
      });
      const nextState = serializeRecognitionJourney(resolved.journey);
      if (nextState !== beforeState) {
        stateMessage.content = nextState;
        stateMessage.updatedAt = new Date();
        await this.messageModel.save(stateMessage);
      }
      return {
        ...resolved.plan,
        stateMessageId: this.stringifyObjectId(stateMessage.id),
      };
    } catch (error) {
      this.logger?.warn?.(
        '[conversation] recognition journey preparation skipped, conversationId=%s, reason=%s',
        this.stringifyObjectId(options.runtime.conversation.id),
        this.describeReplyError(error)
      );
      return undefined;
    }
  }

  private attachRecognitionJourneyPlan(
    result: ProcessReplyResult,
    plan?: PreparedRecognitionJourneyTurn
  ): ProcessReplyResult {
    if (!plan) return result;

    const { stateMessageId, ...turnPlan } = plan;

    return {
      ...result,
      routing: {
        ...(result.routing || {}),
        recognitionJourneyOpeningSuggested: plan.openingSuggested,
        recognitionJourneyTaskSuggested: plan.suggestedTaskId,
        recognitionJourneyCompletedTaskIds: plan.completedTaskIds,
        recognitionJourneyPlan: turnPlan,
        recognitionJourneyStateMessageId: stateMessageId,
      },
    };
  }

  private async finalizeRecognitionJourneyTurn(options: {
    runtime: ReplyRuntime;
    processed: ProcessReplyResult;
    assistantMessages: MessageEntity[];
  }): Promise<void> {
    const plan = options.processed.routing?.recognitionJourneyPlan;
    const stateMessageId =
      options.processed.routing?.recognitionJourneyStateMessageId;
    if (!plan || !stateMessageId || !options.assistantMessages.length) return;

    try {
      const stateMessage = await this.findRecognitionJourneyStateMessageById(
        options.runtime.conversation.id,
        stateMessageId
      );
      const journey = parseRecognitionJourney(stateMessage?.content);
      if (!stateMessage || !journey) return;

      const latestAssistantMessage =
        options.assistantMessages[options.assistantMessages.length - 1];
      const updated = applyRecognitionJourneyAssistantReply({
        journey,
        plan,
        assistantText: options.processed.replySegments.join('\n'),
        assistantMessageId: this.stringifyObjectId(latestAssistantMessage.id),
        now: latestAssistantMessage.createdAt,
      });
      const nextState = serializeRecognitionJourney(updated);
      if (nextState === stateMessage.content) return;

      stateMessage.content = nextState;
      stateMessage.updatedAt = latestAssistantMessage.updatedAt || new Date();
      await this.messageModel.save(stateMessage);
    } catch (error) {
      this.logger?.warn?.(
        '[conversation] recognition journey finalization skipped, conversationId=%s, reason=%s',
        this.stringifyObjectId(options.runtime.conversation.id),
        this.describeReplyError(error)
      );
    }
  }

  private async findRecognitionJourneyStateMessage(
    conversationId: MongoObjectId
  ): Promise<
    { message: MessageEntity; journey: RecognitionJourney } | undefined
  > {
    const candidates = await this.messageModel.find({
      where: {
        conversationId,
        role: MessageRole.system,
        isArchived: true,
      },
      order: {
        updatedAt: 'DESC',
      },
      take: 20,
    });

    for (const message of candidates) {
      const journey = parseRecognitionJourney(message.content);
      if (journey) return { message, journey };
    }
    return undefined;
  }

  private async findRecognitionJourneyStateMessageById(
    conversationId: MongoObjectId,
    stateMessageId: string
  ): Promise<MessageEntity | undefined> {
    const objectId = this.parseObjectId(stateMessageId);
    const byId = await this.messageModel.findOne({
      where: {
        id: objectId,
        conversationId,
        role: MessageRole.system,
        isArchived: true,
      } as never,
    });
    if (byId && parseRecognitionJourney(byId.content)) return byId;

    const byMongoId = await this.messageModel.findOne({
      where: {
        _id: objectId,
        conversationId,
        role: MessageRole.system,
        isArchived: true,
      } as never,
    });
    return byMongoId && parseRecognitionJourney(byMongoId.content)
      ? byMongoId
      : undefined;
  }

  private async createRecognitionJourneyStateMessage(options: {
    runtime: ReplyRuntime;
    journey: RecognitionJourney;
  }): Promise<MessageEntity> {
    const now = new Date();
    const message = new MessageEntity();
    message.conversationId = options.runtime.conversation.id;
    message.userId = options.runtime.conversation.userId;
    message.agentId = options.runtime.conversation.agentId;
    message.role = MessageRole.system;
    message.type = MessageType.text;
    message.content = serializeRecognitionJourney(options.journey);
    message.status = MessageStatus.sent;
    message.quotaExempt = true;
    message.replyTrigger = false;
    message.isArchived = true;
    message.archivedAt = now;
    message.createdAt = now;
    message.updatedAt = now;
    return this.messageModel.save(message);
  }

  private async buildLightweightReplyMessages(options: {
    runtime: ReplyRuntime;
    currentTurnMessages: MessageEntity[];
    category: LightweightReplyCategory;
  }): Promise<{
    messages: ChatCompletionMessageParam[];
    systemPromptCharacters: number;
    historyMessageCount: number;
  }> {
    const identity = buildAgentIdentityContract({
      agent: options.runtime.agent,
    });
    const categoryLabel: Record<LightweightReplyCategory, string> = {
      good_night: '晚安或休息收尾',
      greeting: '日常问候',
      thanks: '感谢',
      farewell: '告别或暂时离开',
    };
    const systemPrompt = [
      `你现在就是${identity.agent.displayName}（${identity.relationship.label}），用户称呼你为“${identity.addresses.userCallsAgent}”，你称呼用户为“${identity.addresses.agentCallsUser}”。`,
      `当前是简单的${
        categoryLabel[options.category]
      }。结合最近聊天自然回应，延续其中的关系和情绪，不要照抄最近回复。`,
      '如果最近上下文里有用户正在牵挂的事，可以自然接住；不需要猜测或补充未提供的资料。',
      '不要编造共同往事、用户现实情况、现实到场、现实触碰或具体离世生活事实。',
      '只输出给用户看的聊天正文，不解释规则，不写动作或说话人标签。',
    ].join('\n');
    const fetchedMessages = await this.messageModel.find({
      where: {
        conversationId: options.runtime.conversation.id,
        isArchived: { $ne: true },
      } as never,
      order: {
        createdAt: 'DESC',
      },
      take: LIGHTWEIGHT_REPLY_HISTORY_LIMIT * 2,
    });
    const mergedById = new Map<string, MessageEntity>();
    [...fetchedMessages, ...options.currentTurnMessages].forEach(
      (message, index) => {
        const id = message.id
          ? this.stringifyObjectId(message.id)
          : `${message.role}:${message.createdAt?.getTime?.() || 0}:${index}`;
        mergedById.set(id, message);
      }
    );
    const candidates = Array.from(mergedById.values())
      .filter(
        message =>
          !message.isArchived &&
          message.status === MessageStatus.sent &&
          (message.role === MessageRole.user ||
            message.role === MessageRole.assistant)
      )
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      )
      .slice(-LIGHTWEIGHT_REPLY_HISTORY_LIMIT)
      .map(message => ({
        role:
          message.role === MessageRole.assistant
            ? ('assistant' as const)
            : ('user' as const),
        content: this.buildLightweightHistoryContent(message),
      }))
      .filter(message => message.content);
    const selected: typeof candidates = [];
    let characterCount = 0;
    for (const message of [...candidates].reverse()) {
      const content = message.content.slice(0, 280);
      if (
        selected.length > 0 &&
        characterCount + content.length >
          LIGHTWEIGHT_REPLY_HISTORY_CHARACTER_LIMIT
      ) {
        continue;
      }
      selected.unshift({ ...message, content });
      characterCount += content.length;
    }

    return {
      messages: [
        { role: 'system', content: systemPrompt },
        ...selected,
      ] as ChatCompletionMessageParam[],
      systemPromptCharacters: systemPrompt.length,
      historyMessageCount: selected.length,
    };
  }

  private buildLightweightHistoryContent(message: MessageEntity): string {
    if (message.role === MessageRole.assistant) {
      return stripPromptLeakageContent(
        message.mediaTranscript?.trim() || message.content?.trim() || ''
      )
        .replace(/\s+/gu, ' ')
        .trim();
    }

    return this.buildSearchableTextFromMessage(message)
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private async createPrimaryAssistantCompletion(options: {
    runtime: ReplyRuntime;
    before: BeforeReplyResult;
    context: AgentConversationContext;
  }): Promise<PrimaryAssistantCompletionResult> {
    const plan = options.context.chatToolPlan;
    const tools =
      plan?.mode === 'active'
        ? getAgentChatToolDefinitions(plan.availableTools)
        : [];
    let usage: ReplyUsage = {};
    const firstResponse = await this.openAIService.createChatCompletion(
      {
        temperature: ASSISTANT_REPLY_TEMPERATURE,
        topP: ASSISTANT_REPLY_TOP_P,
        max_tokens: ASSISTANT_REPLY_MAX_TOKENS,
        messages: options.context.messages,
        ...(tools.length
          ? {
              tools,
              tool_choice: 'auto' as const,
              parallel_tool_calls: false,
            }
          : {}),
        trace: {
          stage: ChatTraceStage.generate,
          operation: 'generate.primary',
          attributes: {
            chatToolMode: plan?.mode || 'off',
            registeredToolCount: tools.length,
          },
        },
      },
      {
        timeout: ASSISTANT_REPLY_TIMEOUT_MS,
        maxRetries: 0,
      }
    );
    usage = this.mergeReplyUsage(
      usage,
      this.extractUsageFromResponse(firstResponse)
    );

    if (!tools.length || plan?.mode !== 'active') {
      return {
        response: firstResponse,
        usage,
        toolAudit: this.emptyAgentChatToolAudit(plan?.plannerMemoryRequested),
        toolEvidence: [],
      };
    }

    const firstMessage = firstResponse.choices?.[0]?.message;
    const rawToolCalls = Array.isArray(firstMessage?.tool_calls)
      ? firstMessage.tool_calls
      : [];
    const toolCalls = rawToolCalls
      .filter(
        (call): call is ChatCompletionMessageFunctionToolCall =>
          call?.type === 'function' &&
          plan.availableTools.includes(call.function?.name as AgentChatToolName)
      )
      .slice(0, plan.maxCalls);

    if (!toolCalls.length) {
      return {
        response: firstResponse,
        usage,
        toolAudit: this.emptyAgentChatToolAudit(plan.plannerMemoryRequested),
        toolEvidence: [],
      };
    }

    const executionContext = this.buildAgentChatToolExecutionContext(options);
    const results: Array<{
      callId: string;
      name: AgentChatToolName;
      arguments: Record<string, unknown>;
      result: AgentChatToolResult;
    }> = [];

    for (const call of toolCalls) {
      const name = call.function.name as AgentChatToolName;
      const rawArguments = this.parseAgentChatToolArguments(
        call.function.arguments
      );
      const result = await this.withTraceSpan(
        this.resolveAgentChatToolTraceStage(),
        `tool.${name}`,
        () =>
          this.executeAgentChatToolWithTimeout(
            name,
            rawArguments,
            executionContext,
            plan.timeoutMs
          ),
        { chatToolName: name }
      );
      results.push({
        callId: call.id,
        name,
        arguments:
          rawArguments && typeof rawArguments === 'object'
            ? (rawArguments as Record<string, unknown>)
            : {},
        result,
      });
    }

    const continuationMessages: ChatCompletionMessageParam[] = [
      ...options.context.messages,
      {
        role: 'assistant',
        content:
          typeof firstMessage?.content === 'string'
            ? firstMessage.content
            : null,
        tool_calls: toolCalls,
      },
      ...results.map(
        item =>
          ({
            role: 'tool',
            tool_call_id: item.callId,
            content: JSON.stringify(item.result),
          } as ChatCompletionMessageParam)
      ),
    ];
    const finalResponse = await this.openAIService.createChatCompletion(
      {
        temperature: ASSISTANT_REPLY_TEMPERATURE,
        topP: ASSISTANT_REPLY_TOP_P,
        max_tokens: ASSISTANT_REPLY_MAX_TOKENS,
        messages: continuationMessages,
        tools,
        tool_choice: 'none',
        trace: {
          stage: ChatTraceStage.generate,
          operation: 'generate.tool_continuation',
          attributes: {
            chatToolMode: plan.mode,
            toolExecutionCount: results.length,
            toolResultItemCount: results.reduce(
              (total, item) => total + item.result.items.length,
              0
            ),
          },
        },
      },
      {
        timeout: ASSISTANT_REPLY_TIMEOUT_MS,
        maxRetries: 0,
      }
    );
    usage = this.mergeReplyUsage(
      usage,
      this.extractUsageFromResponse(finalResponse)
    );

    return {
      response: finalResponse,
      usage,
      toolEvidence: this.buildAgentChatToolEvidence(results),
      toolAudit: {
        decisionNames: results.map(item => item.name),
        invalidDecisionCount: results.filter(
          item => item.result.status === 'invalid_arguments'
        ).length,
        executionCount: results.length,
        resultItemCount: results.reduce(
          (total, item) => total + item.result.items.length,
          0
        ),
        plannerMemoryAgreement: this.resolvePlannerMemoryAgreement(
          plan.plannerMemoryRequested,
          results.some(item => item.name === 'lookup_chat_evidence')
        ),
      },
    };
  }

  private buildAgentChatToolEvidence(
    results: Array<{
      name: AgentChatToolName;
      result: AgentChatToolResult;
    }>
  ): AgentEvidenceItem[] {
    const evidence: AgentEvidenceItem[] = [];

    for (const { result } of results) {
      for (const item of result.items) {
        const conflicted = item.conflictStatus !== 'none';
        if (item.source === 'conversation_memory') {
          evidence.push({
            id: item.id,
            source: 'retrieved_user' as const,
            text: item.value,
            assertionPolicy: 'context_only' as const,
            subjectRef: item.subjectRef,
            factKey: item.factKey || 'memory.relationship',
            useMode: 'recall' as const,
            status: 'active' as const,
            confidence: item.confidence,
          });
          continue;
        }

        evidence.push({
          id: item.id,
          source: 'confirmed_fact' as const,
          text: item.value,
          assertionPolicy: conflicted
            ? ('context_only' as const)
            : ('can_assert' as const),
          subjectRef: item.subjectRef,
          factKey: item.factKey || 'external_evidence',
          useMode: conflicted ? ('hypothesis' as const) : ('assert' as const),
          status: 'active' as const,
          confidence: item.confidence,
        });
      }
    }

    return evidence;
  }

  private buildAgentChatToolExecutionContext(options: {
    runtime: ReplyRuntime;
    before: BeforeReplyResult;
    context: AgentConversationContext;
  }): AgentChatToolExecutionContext {
    const previousAssistant = [...options.context.messages]
      .reverse()
      .find(
        message =>
          message.role === 'assistant' &&
          typeof message.content === 'string' &&
          message.content.trim()
      );

    return {
      userId: options.runtime.conversation.userId,
      agentId: options.runtime.conversation.agentId,
      conversationId: options.runtime.conversation.id,
      currentMessage: options.before.userMessage,
      currentQuery: options.before.searchableText,
      previousAssistantContent:
        typeof previousAssistant?.content === 'string'
          ? previousAssistant.content
          : undefined,
      agent: options.runtime.agent,
    };
  }

  private async executeAgentChatToolWithTimeout(
    name: AgentChatToolName,
    args: unknown,
    context: AgentChatToolExecutionContext,
    timeoutMs: number
  ): Promise<AgentChatToolResult> {
    if (!this.agentChatToolService) {
      return this.buildAgentChatToolFailure(name, 'tool_service_unavailable');
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.agentChatToolService.execute(name, args, context),
        new Promise<AgentChatToolResult>(resolve => {
          timer = setTimeout(
            () => resolve(this.buildAgentChatToolFailure(name, 'tool_timeout')),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private buildAgentChatToolFailure(
    name: AgentChatToolName,
    errorCode: string
  ): AgentChatToolResult {
    return {
      version: 'agent_chat_tools_v1',
      tool: name,
      status: 'error',
      items: [],
      truncated: false,
      errorCode,
    };
  }

  private parseAgentChatToolArguments(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private resolveAgentChatToolTraceStage(): ChatTraceStage {
    return ChatTraceStage.memoryRetrieve;
  }

  private emptyAgentChatToolAudit(
    plannerMemoryRequested = false
  ): AgentChatToolAudit {
    return {
      decisionNames: [],
      invalidDecisionCount: 0,
      executionCount: 0,
      resultItemCount: 0,
      plannerMemoryAgreement: this.resolvePlannerMemoryAgreement(
        plannerMemoryRequested,
        false
      ),
    };
  }

  private mergeAgentChatToolDecisionAudit(
    context: AgentConversationContext,
    audit: AgentChatToolAudit,
    parsed: ParsedAssistantReply
  ): AgentChatToolAudit {
    if (context.chatToolPlan?.mode !== 'shadow') {
      return audit;
    }

    const decisionNames = (parsed.toolDecisions || []).map(item => item.name);
    return {
      ...audit,
      decisionNames,
      invalidDecisionCount: parsed.invalidToolDecisionCount || 0,
      plannerMemoryAgreement: this.resolvePlannerMemoryAgreement(
        context.chatToolPlan.plannerMemoryRequested,
        decisionNames.includes('lookup_chat_evidence')
      ),
    };
  }

  private resolvePlannerMemoryAgreement(
    plannerRequested: boolean,
    modelRequested: boolean
  ): AgentChatToolAudit['plannerMemoryAgreement'] {
    if (plannerRequested && modelRequested) {
      return 'both_query';
    }
    if (!plannerRequested && !modelRequested) {
      return 'both_skip';
    }
    return modelRequested ? 'model_only' : 'planner_only';
  }

  private recordAgentChatToolAudit(
    context: AgentConversationContext,
    audit: AgentChatToolAudit
  ): void {
    const plan = context.chatToolPlan;
    if (!plan || (plan.mode !== 'shadow' && plan.mode !== 'active')) {
      return;
    }

    this.chatTraceService?.recordCompletedSpan({
      stage: ChatTraceStage.plan,
      operation:
        plan.mode === 'shadow' ? 'tools.shadow_decision' : 'tools.active_round',
      startedAt: new Date(),
      attributes: {
        chatToolVersion: plan.version,
        chatToolMode: plan.mode,
        decisionCount: audit.decisionNames.length,
        decisionNames: audit.decisionNames.join(','),
        invalidDecisionCount: audit.invalidDecisionCount,
        executionCount: audit.executionCount,
        resultItemCount: audit.resultItemCount,
        plannerMemoryRequested: plan.plannerMemoryRequested,
        plannerMemoryAgreement: audit.plannerMemoryAgreement,
      },
    });
  }

  private isExplicitMemoryControlRequest(value: string): boolean {
    return isExplicitRememberRequest(value) || isForgetMemoryRequest(value);
  }

  private buildMinimalGenerationRecoveryMessages(options: {
    runtime: ReplyRuntime;
    userQuery: string;
    contextMessages: ChatCompletionMessageParam[];
    replyBrief: ReplyBrief;
    evidence: AgentEvidenceItem[];
  }): ChatCompletionMessageParam[] {
    const agentName = options.runtime.agent?.name?.trim() || 'TA';
    const agentCallsUser = options.runtime.agent?.agentCallMe?.trim() || '我';
    const recentMessages = options.contextMessages
      .filter(
        message =>
          message.role !== 'system' &&
          typeof message.content === 'string' &&
          message.content.trim()
      )
      .slice(-5)
      .map(message => ({
        ...message,
        content: (message.content as string).trim().slice(0, 500),
      })) as ChatCompletionMessageParam[];
    const evidence = options.evidence.slice(0, 8).map(item => ({
      id: item.id,
      source: item.source,
      assertionPolicy: item.assertionPolicy,
      text: item.text.slice(0, 160),
    }));
    const reading = options.replyBrief.reading;
    const conversationPlan = options.replyBrief.conversationPlan;
    const persona = buildAgentPersonaPrompt({
      agent: options.runtime.agent,
    });
    const systemPrompt = [
      '# 天之灵主回复恢复',
      `你是用户创建的已故亲人角色“${agentName}”，称呼用户为“${agentCallsUser}”。以第一人称自然聊天。`,
      persona.prompt,
      '上一轮模型调用不可用。只根据下面的当前原话、最近对话、Conversation Reading 和证据重新生成，不解释技术失败。',
      `Conversation Reading：${JSON.stringify(reading || {})}`,
      `交谈规划：${JSON.stringify(conversationPlan || {})}`,
      `可用证据：${JSON.stringify(evidence)}`,
      ...(options.replyBrief.afterlifeWorld
        ? [
            '# 离世生活框架',
            buildAfterlifeWorldPrompt(options.replyBrief.afterlifeWorld),
          ]
        : []),
      ...(options.replyBrief.sceneFramework
        ? [
            '# 关系场景体系',
            buildRelationalSceneFrameworkPrompt(
              options.replyBrief.sceneFramework
            ),
          ]
        : []),
      '身份质疑时保持亲人关系并给合理解释，不先认错退出，也不要求用户教你怎么像。',
      '不编造共同经历、生物学关系或用户现实状态；离世生活只按已激活框架及其中的资料、连续状态锚点回答，不临时另造具体房屋、物品、人物或爱好。带有来生、走完一生、自然老去、年老以后或很久以后等前置条件的团聚表达可以承接，但不邀请用户现在或近期赴死；不声称现实到场或触碰；看见和听见只限用户发来的内容或断续片段。',
      '事实不确定、能力做不到或边界不能跨越时，不要停在限制说明。先答能答的部分，边界最多一句，再用关系确认、情绪承接、愿望或假设性陪伴、远期条件或具体追问补回用户真正需要的情感价值。',
      '像微信聊天，直接回答，温和朴素。不要把同一个意思解释、安慰、总结三遍。',
      buildReplyLengthPlanPrompt(options.replyBrief.lengthPlan),
      ...(options.replyBrief.participationStrategy
        ? [
            buildReplyParticipationStrategyPrompt(
              options.replyBrief.participationStrategy
            ),
          ]
        : []),
      `默认一颗、最多 ${MAX_ASSISTANT_REPLY_SEGMENTS} 颗；第二颗必须有不可替代的新动作。`,
      options.replyBrief.participationStrategy
        ? '只输出气泡 JSON，不要正文外解释。'
        : '只输出给用户看的中文正文。多个气泡用空行分段；不要 JSON、字段名、代码块、分析或内部说明。',
    ].join('\n');
    const hasCurrentUserMessage = recentMessages.some(
      message =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.trim() === options.userQuery.trim()
    );

    return [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...recentMessages,
      ...(hasCurrentUserMessage
        ? []
        : [
            {
              role: 'user' as const,
              content: options.userQuery,
            },
          ]),
    ];
  }

  private async applyExplicitMemoryControl(
    message: MessageEntity,
    searchableText: string
  ): Promise<AgentMemoryControlResult | undefined> {
    const action = isExplicitRememberRequest(searchableText)
      ? 'remember'
      : isForgetMemoryRequest(searchableText)
      ? 'forget'
      : undefined;

    if (!action) {
      return undefined;
    }

    try {
      if (action === 'remember') {
        const [legacyFacts, profileFacts] = await Promise.all([
          this.agentMemoryFactService?.extractAndUpsertFromUserMessage?.({
            message,
            searchableText,
          }) ?? Promise.resolve([]),
          this.agentProfileFactService?.extractAndUpsertFromUserMessage?.({
            message,
            searchableText,
            explicitlyConfirmed: true,
          }) ?? Promise.resolve([]),
        ]);

        return {
          action,
          target: searchableText.slice(0, 120),
          affectedCount: legacyFacts.length + profileFacts.length,
          succeeded: true,
        };
      }

      const [legacyCount, profileCount] = await Promise.all([
        this.agentMemoryFactService?.archiveMatchingFacts?.({
          userId: message.userId,
          agentId: message.agentId,
          requestText: searchableText,
        }) ?? Promise.resolve(0),
        this.agentProfileFactService?.archiveMatchingFacts?.({
          userId: message.userId,
          agentId: message.agentId,
          requestText: searchableText,
        }) ?? Promise.resolve(0),
      ]);

      return {
        action,
        target: extractForgetMemoryTarget(searchableText),
        affectedCount: legacyCount + profileCount,
        succeeded: true,
      };
    } catch (error) {
      this.logger.error(
        '[conversation] explicit memory control failed, action=%s, messageId=%s, reason=%s',
        action,
        this.stringifyObjectId(message.id),
        this.describeReplyError(error)
      );

      return {
        action,
        target:
          action === 'forget'
            ? extractForgetMemoryTarget(searchableText)
            : searchableText.slice(0, 120),
        affectedCount: 0,
        succeeded: false,
      };
    }
  }

  // 二次轻量生成兜底：在静态模板之前尝试一次极简生成
  private async trySecondaryGenerationFallback(options: {
    userQuery: string;
    replyBrief: ReplyBrief;
    messages: ChatCompletionMessageParam[];
    runtime: ReplyRuntime;
    error: unknown;
    generationAttemptTraces: AssistantGenerationAttemptTrace[];
  }): Promise<ProcessReplyResult | undefined> {
    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0.3,
          topP: 0.9,
          max_tokens: 200,
          messages: this.buildMinimalGenerationRecoveryMessages({
            runtime: options.runtime,
            userQuery: options.userQuery,
            contextMessages: options.messages,
            replyBrief: options.replyBrief,
            evidence: [],
          }),
          trace: {
            stage: ChatTraceStage.generate,
            operation: 'generate.secondaryFallback',
          },
        },
        {
          timeout: 10000,
          maxRetries: 0,
          skipPrimary: true,
        }
      );
      const responseContent =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const parsedReply = this.parseAssistantReply(responseContent);
      const segments = this.normalizeAssistantReplySegments(
        parsedReply.segments,
        options.userQuery
      );
      if (segments.length > 0) {
        options.generationAttemptTraces.push(
          this.buildAssistantGenerationAttemptTrace({
            attempt: 'secondaryFallback',
            responseContent,
            parsedSegments: segments,
            userQuery: options.userQuery,
            model:
              typeof response.model === 'string' ? response.model : undefined,
            usage: this.extractUsageFromResponse(response),
          })
        );
        return {
          replySegments: compactReplyBubblesPreservingContent(segments),
          usage: this.extractUsageFromResponse(response),
          routing: {
            route: undefined,
            brief: options.replyBrief,
            fallbackSource: 'secondary_generation',
            generationFailureStage: 'completion',
            generationFailureCode: this.resolveGenerationFailureCode(
              options.error
            ),
            generationRecoveryAttempted: true,
            generationRecoverySucceeded: true,
            generationAttemptTraces: options.generationAttemptTraces,
          },
        };
      }
    } catch {
      // 二次生成也失败，继续走静态兜底
    }
    return undefined;
  }

  private async buildGenerationFailureReply(
    userQuery: string,
    replyRoute: ReplySceneRoute | undefined,
    replyIntent: StructuredReplyIntent | undefined,
    replyBrief: ReplyBrief,
    error: unknown,
    stage: 'context' | 'completion' | 'parse',
    recovery?: {
      attempted: boolean;
      succeeded: boolean;
      initialFailureCode?: string;
    },
    usage: ReplyUsage = {},
    messages?: ChatCompletionMessageParam[],
    generationAttemptTraces: AssistantGenerationAttemptTrace[] = [],
    runtime?: ReplyRuntime
  ): Promise<ProcessReplyResult> {
    // 在线生成不可用时，先尝试二次轻量生成，失败再走静态兜底
    if (stage !== 'context' && runtime && messages?.length) {
      const secondaryRecoveryResult = await this.trySecondaryGenerationFallback(
        {
          userQuery,
          replyBrief,
          messages,
          runtime,
          error,
          generationAttemptTraces,
        }
      );
      if (secondaryRecoveryResult) {
        return {
          ...secondaryRecoveryResult,
          usage: this.mergeReplyUsage(
            usage,
            secondaryRecoveryResult.usage || {}
          ),
        };
      }
    }

    const fallback = this.replyGuardrailService?.resolveGenerationFailureReply({
      userQuery,
      replyRoute,
      replyBrief,
      messages,
    });

    if (!fallback?.segments.length) {
      throw error;
    }

    this.logger?.warn?.(
      '[conversation] assistant %s unavailable, safe fallback selected, scene=%s, reason=%s',
      stage,
      replyRoute?.primaryScene?.scene || '-',
      this.describeReplyError(error)
    );

    return {
      replySegments: compactReplyBubblesPreservingContent(fallback.segments),
      usage,
      routing: {
        intent: replyIntent ?? replyRoute?.intent,
        route: replyRoute,
        brief: replyBrief,
        fallbackSource: 'contextual_reply_brief',
        generationFailureStage: stage,
        generationFailureCode:
          this.resolveGenerationFailureCode(error) ||
          recovery?.initialFailureCode,
        generationRecoveryAttempted: recovery?.attempted === true,
        generationRecoverySucceeded: recovery?.succeeded === true,
        generationAttemptTraces,
        guardrailRewritten: fallback.rewritten,
        guardrailReason: fallback.reason,
        guardrailInterventionLevel: fallback.interventionLevel,
        guardrailRevisionAttempted: fallback.revisionAttempted,
      },
    };
  }

  private resolveGenerationFailureStage(
    error: unknown
  ): 'completion' | 'parse' {
    const code = this.resolveGenerationFailureCode(error);

    return /(?:EMPTY_REPLY|NO_USABLE_TEXT|INVALID_REPLY|PARSE|STRUCTURE)/i.test(
      code
    )
      ? 'parse'
      : 'completion';
  }

  private resolveGenerationFailureCode(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return typeof error === 'string' ? error.slice(0, 80) : 'UNKNOWN';
    }

    const candidate = error as {
      code?: unknown;
      name?: unknown;
    };
    const code =
      typeof candidate.code === 'string' ? candidate.code.trim() : '';
    const name =
      typeof candidate.name === 'string' ? candidate.name.trim() : '';

    return (code || name || 'UNKNOWN').slice(0, 80);
  }

  private isGenerationTimeoutError(error: unknown): boolean {
    const code = this.resolveGenerationFailureCode(error);
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : typeof error === 'string'
        ? error
        : '';

    return /(?:TIMEOUT|ABORT|AbortError|ETIMEDOUT|exceeded)/i.test(
      `${code}\n${message}`
    );
  }

  private async validateAssistantReply(options: {
    contextMessages: ChatCompletionMessageParam[];
    userQuery: string;
    replySegments: string[];
    replyRoute?: ReplySceneRoute;
    replyBrief?: ReplyBrief;
    evidence?: AgentEvidenceItem[];
    claims?: AssistantFactClaim[];
    reviewMode?: ReplyGuardrailReviewMode;
    conversationId?: string;
  }): Promise<ValidateAssistantReplyResult> {
    if (!this.replyGuardrailService) {
      return {
        segments: this.sanitizeAssistantSegmentsForFinalOutput(
          options.replySegments,
          options.userQuery
        ),
        rewritten: true,
        reason: 'Guardrail unavailable; deterministic final-output filter used',
      };
    }

    try {
      const result = await this.replyGuardrailService.validateAssistantReply({
        messages: options.contextMessages,
        userQuery: options.userQuery,
        replySegments: options.replySegments,
        replyRoute: options.replyRoute,
        replyBrief: options.replyBrief,
        evidence: options.evidence,
        claims: options.claims,
        reviewMode: options.reviewMode,
        mode: PRODUCTION_REPLY_GUARDRAIL_MODE,
        conversationId: options.conversationId,
      });

      if (result.rewritten) {
        this.logger.error(
          '[conversation] assistant reply rewritten by guardrail, reason=%s',
          result.reason || ''
        );
      }

      return {
        ...result,
        segments: result.segments.length
          ? result.segments
          : options.replySegments,
      };
    } catch (error) {
      this.logger.error(
        '[conversation] assistant reply guardrail failed, reason=%s',
        this.describeReplyError(error)
      );
      return {
        segments: this.sanitizeAssistantSegmentsForFinalOutput(
          options.replySegments,
          options.userQuery
        ),
        rewritten: true,
        reason: 'Guardrail failed; deterministic final-output filter used',
      };
    }
  }

  private resolveGuardrailReviewMode(options: {
    replyBrief: ReplyBrief;
    claims: AssistantFactClaim[];
  }): ReplyGuardrailReviewMode {
    return options.replyBrief.guardrailFocuses.length ||
      (options.replyBrief.factClaimMode === 'grounded' &&
        !options.claims.length)
      ? 'full'
      : 'deterministic_first';
  }

  private async afterReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult,
    processed: ProcessReplyResult
  ): Promise<AfterReplyResult> {
    const replyTime = new Date();
    if (!processed.replySegments.length) {
      await this.touchConversation(runtime.conversation, replyTime);
      return { assistantMessages: [] };
    }

    const assistantMessages =
      (await this.createAssistantVoiceReplyMessages({
        runtime,
        before,
        replySegments: processed.replySegments,
        replyTime,
        usage: processed.usage,
        routing: processed.routing,
      })) ??
      (await this.createAssistantReplyMessages({
        conversationId: runtime.conversation.id,
        userId: runtime.conversation.userId,
        agentId: runtime.conversation.agentId,
        replySegments: processed.replySegments,
        userQuery: before.searchableText,
        replyTime,
        usage: processed.usage,
        routing: processed.routing,
      }));

    await this.finalizeRecognitionJourneyTurn({
      runtime,
      processed,
      assistantMessages,
    });

    await this.touchConversation(
      runtime.conversation,
      assistantMessages[assistantMessages.length - 1]?.updatedAt ?? replyTime
    );
    this.scheduleConversationSummaryRefresh(runtime.conversation);

    return {
      assistantMessages,
    };
  }

  private scheduleConversationSummaryRefresh(
    conversation: ConversationEntity
  ): void {
    if (!this.agentConversationSummaryService) {
      return;
    }

    const traceId = this.chatTraceService?.getCurrentTraceId();
    const refresh = () =>
      this.agentConversationSummaryService.refresh(conversation);
    const scheduled =
      traceId && this.chatTraceService
        ? this.chatTraceService.runDetachedWithTrace(traceId, () =>
            this.chatTraceService.withSpan(
              ChatTraceStage.asyncWrite,
              'async_write.conversation_summary',
              refresh
            )
          )
        : refresh();

    void scheduled
      .catch(error => {
        this.logger.error(
          '[conversation] continuity summary refresh failed, conversationId=%s, reason=%s',
          this.stringifyObjectId(conversation.id),
          this.describeReplyError(error)
        );
      })
      .finally(() => {
        if (traceId) {
          void this.chatTraceService?.markBackgroundCompleted(traceId);
        }
      });
  }

  private async afterReplyFailed(
    runtime: ReplyRuntime
  ): Promise<AfterReplyResult> {
    const replyTime = new Date();
    const assistantMessage = await this.saveMessage({
      conversationId: runtime.conversation.id,
      userId: runtime.conversation.userId,
      agentId: runtime.conversation.agentId,
      role: MessageRole.assistant,
      type: MessageType.text,
      content: ASSISTANT_REPLY_FAILED_CONTENT,
      status: MessageStatus.failed,
      createdAt: replyTime,
      updatedAt: replyTime,
    });

    await this.touchConversation(runtime.conversation, replyTime);

    return {
      assistantMessages: [assistantMessage],
    };
  }

  private async prepareChatReplyTrace(
    runtime: ReplyRuntime,
    before: BeforeReplyResult,
    includePendingMessages: boolean
  ): Promise<PreparedChatReplyTrace | undefined> {
    if (!this.chatTraceService) {
      return undefined;
    }

    const currentMessages = includePendingMessages
      ? await this.findPendingUserMessagesForReply({
          conversationId: runtime.conversation.id,
        })
      : this.resolveCurrentTurnMessages(before);
    if (
      !currentMessages.some(
        message =>
          Boolean(message.id) &&
          this.stringifyObjectId(message.id) ===
            this.stringifyObjectId(before.userMessage.id)
      )
    ) {
      currentMessages.push(before.userMessage);
    }
    currentMessages.sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
    );
    const acceptedAt = currentMessages[0]?.createdAt || new Date();
    const triggerMessageIds = currentMessages.map(message =>
      this.stringifyObjectId(message.id)
    );
    const existingTraceId = currentMessages.find(
      message => message.traceId
    )?.traceId;
    const traceId = await this.chatTraceService.ensureTrace({
      traceId: existingTraceId,
      conversationId: this.stringifyObjectId(runtime.conversation.id),
      userId: this.stringifyObjectId(runtime.conversation.userId),
      agentId: this.stringifyObjectId(runtime.conversation.agentId),
      triggerMessageIds,
      acceptedAt,
      releaseVersion: process.env.RELEASE_VERSION || process.env.GIT_SHA,
    });
    await this.attachTraceToMessages(traceId, currentMessages);

    return { traceId, acceptedAt, triggerMessageIds };
  }

  private async attachTraceToMessages(
    traceId: string | undefined,
    messages: MessageEntity[]
  ): Promise<void> {
    if (!traceId) {
      return;
    }

    for (const message of messages) {
      if (message.traceId === traceId) {
        continue;
      }
      message.traceId = traceId;
      await this.messageModel.save(message);
    }
  }

  private async completeChatReplyTrace(
    trace: PreparedChatReplyTrace | undefined,
    processed: ProcessReplyResult,
    after: AfterReplyResult
  ): Promise<void> {
    if (!trace || !this.chatTraceService) {
      return;
    }

    const firstMessage = after.assistantMessages[0];
    const responseCompletedAt = new Date();
    await this.chatTraceService.markCompleted(trace.traceId, {
      responseCompletedAt,
      replyMessageIds: after.assistantMessages.map(message =>
        this.stringifyObjectId(message.id)
      ),
      replyGroupId: firstMessage?.replyGroupId,
      promptVersion: processed.routing?.promptVersion,
      strategyVersion: processed.routing?.strategyVersion,
      acceptedAt: trace.acceptedAt,
    });
  }

  private withTraceSpan<T>(
    stage: ChatTraceStage,
    operation: string,
    task: () => Promise<T> | T,
    attributes?: Record<string, ChatSpanAttributeValue | undefined>
  ): Promise<T> {
    if (!this.chatTraceService) {
      return Promise.resolve(task());
    }

    return this.chatTraceService.withSpan(stage, operation, () => task(), {
      attributes,
    });
  }

  private async enqueueConversationReplyJob(
    data: ConversationReplyJobData
  ): Promise<boolean> {
    const queue = this.bullmqFramework?.getQueue(CONVERSATION_REPLY_QUEUE);
    if (!queue) {
      this.logger.error(
        '[conversation-reply] queue not found, skip enqueue, conversationId=%s',
        data.conversationId
      );
      return false;
    }

    let queuedData = data;
    if (this.chatTraceService) {
      const enqueuedAt = this.parseOptionalDate(data.enqueuedAt) || new Date();
      const traceId = await this.chatTraceService.ensureTrace({
        traceId: data.traceId,
        conversationId: data.conversationId,
        userId: data.userId,
        triggerMessageIds: data.triggerMessageIds,
        acceptedAt: enqueuedAt,
        releaseVersion: process.env.RELEASE_VERSION || process.env.GIT_SHA,
      });
      queuedData = {
        ...data,
        traceId,
        enqueuedAt: enqueuedAt.toISOString(),
      };
    }

    const reusableJobId = this.buildConversationReplyJobId(queuedData);
    const delay = await this.resolveConversationReplyJobDelay(queuedData);
    const existingState = await this.removeReusableConversationReplyJob(
      queue,
      reusableJobId
    );
    const jobId =
      existingState === 'active' ? `${reusableJobId}:follow-up` : reusableJobId;

    if (jobId !== reusableJobId) {
      await this.removeReusableConversationReplyJob(queue, jobId);
    }

    if (queuedData.traceId) {
      await this.chatTraceService?.ensureTrace({
        traceId: queuedData.traceId,
        conversationId: queuedData.conversationId,
        userId: queuedData.userId,
        triggerMessageIds: queuedData.triggerMessageIds,
        queueJobId: jobId,
        acceptedAt: this.parseOptionalDate(queuedData.enqueuedAt),
      });
    }

    await queue.addJobToQueue(queuedData, {
      jobId,
      delay,
      attempts: 3,
      removeOnComplete: true,
      removeOnFail: true,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    return true;
  }

  private buildConversationReplyJobId(data: ConversationReplyJobData): string {
    const suffix = data.afterUserCreatedAt
      ? `after:${
          new Date(data.afterUserCreatedAt).getTime() || data.afterUserCreatedAt
        }`
      : 'latest';

    return `conversation-reply:${data.conversationId}:${suffix}`;
  }

  private async resolveConversationReplyJobDelay(
    data: ConversationReplyJobData
  ): Promise<number> {
    if (data.afterUserCreatedAt) {
      return CONVERSATION_REPLY_JOB_DELAY_MS;
    }

    const key = this.getConversationReplyDebounceKey(data.conversationId);
    const now = Date.now();
    const firstQueuedAt = await this.getOrCreateConversationReplyDebounceStart(
      key,
      now
    );
    const elapsed = Math.max(0, now - firstQueuedAt);
    const remainingDebounceMs = Math.max(
      0,
      CONVERSATION_REPLY_MAX_DEBOUNCE_MS - elapsed
    );

    return Math.min(CONVERSATION_REPLY_JOB_DELAY_MS, remainingDebounceMs);
  }

  private async getOrCreateConversationReplyDebounceStart(
    key: string,
    now: number
  ): Promise<number> {
    try {
      const existing = await this.redisService?.get(key);
      const parsed = Number(existing);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }

      await this.redisService?.set(
        key,
        String(now),
        'PX',
        CONVERSATION_REPLY_MAX_DEBOUNCE_MS,
        'NX'
      );

      return now;
    } catch (error) {
      this.logger.error(
        '[conversation-reply] debounce state unavailable, key=%s, reason=%s',
        key,
        this.describeReplyError(error)
      );
      return now;
    }
  }

  private async removeReusableConversationReplyJob(
    queue: unknown,
    jobId: string
  ): Promise<string | undefined> {
    const queueWithGetJob = queue as {
      getJob?: (id: string) => Promise<{
        getState?: () => Promise<string>;
        remove?: () => Promise<void>;
      } | null>;
    };

    if (!queueWithGetJob.getJob) {
      return undefined;
    }

    try {
      const existingJob = await queueWithGetJob.getJob(jobId);
      const state = await existingJob?.getState?.();

      if (
        state === 'delayed' ||
        state === 'waiting' ||
        state === 'completed' ||
        state === 'failed'
      ) {
        await existingJob?.remove?.();
      }

      return state;
    } catch (error) {
      this.logger.error(
        '[conversation-reply] remove reusable job failed, jobId=%s, reason=%s',
        jobId,
        this.describeReplyError(error)
      );
      return undefined;
    }
  }

  private async acquireConversationReplyLock(
    conversationId: string
  ): Promise<{ acquired: boolean; token: string }> {
    const token = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const result = await this.redisService?.set(
      this.getConversationReplyLockKey(conversationId),
      token,
      'PX',
      CONVERSATION_REPLY_LOCK_TTL_MS,
      'NX'
    );

    return {
      acquired: result === 'OK',
      token,
    };
  }

  private async releaseConversationReplyLock(
    conversationId: string,
    token: string
  ): Promise<void> {
    const key = this.getConversationReplyLockKey(conversationId);
    const currentToken = await this.redisService?.get(key);

    if (currentToken === token) {
      await this.redisService?.del(key);
    }
  }

  private getConversationReplyLockKey(conversationId: string): string {
    return `conversation:reply:lock:${conversationId}`;
  }

  private getConversationReplyDebounceKey(conversationId: string): string {
    return `conversation:reply:debounce:${conversationId}`;
  }

  private async clearConversationReplyDebounce(
    conversationId: string
  ): Promise<void> {
    try {
      await this.redisService?.del(
        this.getConversationReplyDebounceKey(conversationId)
      );
    } catch (error) {
      this.logger.error(
        '[conversation-reply] clear debounce state failed, conversationId=%s, reason=%s',
        conversationId,
        this.describeReplyError(error)
      );
    }
  }

  private async findPendingUserMessagesForReply(options: {
    conversationId: MongoObjectId;
    afterUserCreatedAt?: Date;
  }): Promise<MessageEntity[]> {
    const messages = await this.messageModel.find({
      where: {
        conversationId: options.conversationId,
        isArchived: { $ne: true },
      } as never,
      order: {
        createdAt: 'ASC',
      },
    });
    const activeMessages = messages.filter(message => !message.isArchived);

    if (options.afterUserCreatedAt) {
      return activeMessages.filter(
        message =>
          message.role === MessageRole.user &&
          message.status === MessageStatus.sent &&
          message.replyTrigger !== false &&
          message.createdAt > options.afterUserCreatedAt!
      );
    }

    const latestAssistantIndex = activeMessages.reduce(
      (latestIndex, message, index) =>
        message.role === MessageRole.assistant ? index : latestIndex,
      -1
    );

    return activeMessages
      .slice(latestAssistantIndex + 1)
      .filter(
        message =>
          message.role === MessageRole.user &&
          message.status === MessageStatus.sent &&
          message.replyTrigger !== false
      );
  }

  private async hasUserMessageAfter(
    conversationId: MongoObjectId,
    after: Date
  ): Promise<boolean> {
    const count = await this.messageModel.count({
      conversationId,
      role: MessageRole.user,
      status: MessageStatus.sent,
      replyTrigger: { $ne: false },
      isArchived: { $ne: true },
      createdAt: {
        $gt: after,
      },
    } as never);

    return count > 0;
  }

  private buildQueuedBeforeReplyResult(
    pendingUserMessages: MessageEntity[]
  ): BeforeReplyResult {
    const latestUserMessage =
      pendingUserMessages[pendingUserMessages.length - 1];
    const searchableTexts = pendingUserMessages
      .map(message => this.buildSearchableTextFromMessage(message))
      .filter(Boolean);

    return {
      messagePayload: {
        type: MessageType.text,
        content: latestUserMessage.content,
      },
      searchableText: this.buildQueuedSearchableText(searchableTexts),
      userMessage: latestUserMessage,
      currentTurnMessages: pendingUserMessages,
      deferReply: false,
      isDuplicate: false,
    };
  }

  private resolveCurrentTurnMessages(
    before: BeforeReplyResult
  ): MessageEntity[] {
    return before.currentTurnMessages?.length
      ? before.currentTurnMessages
      : [before.userMessage];
  }

  private buildPreparedIncomingMessageFromStored(
    message: MessageEntity
  ): PreparedIncomingMessage {
    return {
      type: this.normalizeMessageType(message.type),
      content: message.content?.trim() || '',
      quotedMessageId: this.stringifyOptionalObjectId(message.quotedMessageId),
      quotedMessageRole: message.quotedMessageRole,
      quotedMessageContent: message.quotedMessageContent?.trim() || undefined,
      mediaObjectKey: message.mediaObjectKey?.trim() || undefined,
      mediaUrl: message.mediaUrl?.trim() || undefined,
      mediaMimeType: message.mediaMimeType?.trim() || undefined,
      mediaDurationMs: message.mediaDurationMs,
      mediaAnalysis: message.mediaAnalysis?.trim() || undefined,
      mediaTranscript: message.mediaTranscript?.trim() || undefined,
    };
  }

  private buildQueuedSearchableText(searchableTexts: string[]): string {
    if (searchableTexts.length <= 1) {
      return searchableTexts[0] ?? '';
    }

    return `用户连续输入（按发送顺序，共${
      searchableTexts.length
    }条）：\n${searchableTexts
      .map((content, index) => `${index + 1}. ${content}`)
      .join('\n')}`;
  }

  private buildSearchableTextFromMessage(message: MessageEntity): string {
    if (message.type === MessageType.image) {
      return this.buildImageSearchableText(
        message.mediaAnalysis,
        message.content
      );
    }

    if (message.type === MessageType.voice) {
      return message.mediaTranscript?.trim() || message.content?.trim() || '';
    }

    return message.content?.trim() || '';
  }

  private parseOptionalDate(value?: string): Date | undefined {
    if (!value?.trim()) {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private buildSendMessageResult(
    before: BeforeReplyResult,
    after?: AfterReplyResult
  ): SendConversationMessageResult {
    const assistantMessages = (
      after?.assistantMessages ??
      before.immediateAssistantMessages ??
      []
    ).slice(0, MAX_ASSISTANT_REPLY_SEGMENTS);

    return {
      userMessage: this.messageService.buildConversationMessageItem(
        before.userMessage
      ),
      assistantMessage: this.buildLegacyAssistantMessageItem(assistantMessages),
      assistantMessages: assistantMessages.length
        ? assistantMessages.map(message =>
            this.messageService.buildConversationMessageItem(message)
          )
        : undefined,
      chatQuota: before.chatQuota,
    };
  }

  private buildLegacyAssistantMessageItem(
    messages: MessageEntity[]
  ): ConversationMessageItem | undefined {
    if (messages.length === 0) {
      return undefined;
    }

    if (messages.length === 1) {
      return this.messageService.buildConversationMessageItem(messages[0]);
    }

    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    const legacyMessage = new MessageEntity();
    Object.assign(legacyMessage, firstMessage, {
      content: messages
        .map(message => message.content?.trim())
        .filter(Boolean)
        .join('</fenge>'),
      type: MessageType.text,
      mediaObjectKey: '',
      mediaUrl: '',
      mediaMimeType: '',
      mediaAnalysis: '',
      mediaTranscript: '',
      mediaDurationMs: undefined,
      replyGroupId: '',
      replySegmentIndex: undefined,
      updatedAt: lastMessage.updatedAt,
    });

    return this.messageService.buildConversationMessageItem(legacyMessage);
  }

  private buildConversationSummary(
    conversation: ConversationEntity,
    agent?: AgentEntity | null,
    latestMessage?: MessageEntity | null
  ): ConversationSummary {
    const isSharedConversation =
      conversation.accessRole === 'shared' ||
      Boolean(
        agent?.createdUserId &&
          this.stringifyObjectId(agent.createdUserId) !==
            this.stringifyObjectId(conversation.userId)
      );

    return {
      id: this.stringifyObjectId(conversation.id),
      agentId: this.stringifyObjectId(agent?.id ?? conversation.agentId),
      agentName: agent?.name?.trim() || '联系人资料暂不可用',
      agentAvatar: this.postImageService.resolveForResponse(
        agent?.avatar?.trim() || ''
      ),
      agentSex: agent?.sex ?? 0,
      agentCallMe: isSharedConversation
        ? conversation.agentCallsUser?.trim() || ''
        : agent?.agentCallMe?.trim() || '',
      iCallAgent: isSharedConversation
        ? conversation.userCallsAgent?.trim() || agent?.name?.trim() || ''
        : agent?.iCallAgent?.trim() || '',
      agentIsDefault: Boolean(
        agent?.isDefault &&
          agent.createdUserId &&
          this.stringifyObjectId(agent.createdUserId) ===
            this.stringifyObjectId(conversation.userId)
      ),
      agentAccessRole: isSharedConversation ? 'shared' : 'owner',
      preview: this.buildPreview(agent, latestMessage),
      isMessenger: Boolean(agent?.messengerOfAgentId),
      updatedAt: conversation.updatedAt?.toISOString?.() ?? '',
      createdAt: conversation.createdAt?.toISOString?.() ?? '',
    };
  }

  private buildPreview(
    agent?: AgentEntity | null,
    latestMessage?: MessageEntity | null
  ): string {
    if (latestMessage?.type === MessageType.voice) {
      const label = this.buildVoicePreviewLabel(latestMessage);
      return latestMessage.role === MessageRole.user ? `你：${label}` : label;
    }

    if (latestMessage?.type === MessageType.image) {
      const label = '[图片]';
      return latestMessage.role === MessageRole.user ? `你：${label}` : label;
    }

    const latestContent = latestMessage?.content?.trim();

    if (latestContent) {
      return latestMessage?.role === MessageRole.user
        ? `你：${latestContent}`
        : latestContent;
    }

    if (!agent) {
      return '该联系人资料暂不可用';
    }

    const iCallAgent = agent.iCallAgent?.trim();
    const agentCallMe = agent.agentCallMe?.trim();

    if (iCallAgent && agentCallMe) {
      return `你称呼他为${iCallAgent}，他会叫你${agentCallMe}`;
    }

    if (agent.description?.trim()) {
      return agent.description.trim();
    }

    return '点击开始和他对话';
  }

  private normalizeOptionalConversationPageSize(
    value?: number | string
  ): number | undefined {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }

    return Math.min(Math.floor(parsed), 50);
  }

  private normalizeConversationPage(value?: number | string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }

  private normalizeMessageContent(rawValue?: string): string {
    const value = rawValue?.trim();

    if (!value) {
      throw new AppError(
        'INVALID_MESSAGE_CONTENT',
        'message content is required'
      );
    }

    if (value.length > 2000) {
      throw new AppError(
        'INVALID_MESSAGE_CONTENT',
        'message content must be 2000 characters or fewer'
      );
    }

    return value;
  }

  private async prepareIncomingMessage(
    payload: SendConversationMessageDTO | undefined,
    runtime: ReplyRuntime
  ): Promise<PreparedIncomingMessage> {
    const message = this.normalizeIncomingMessage(payload);

    switch (message.type) {
      case MessageType.voice:
        return {
          ...message,
          mediaTranscript:
            (await this.transcribeVoiceForConversation(message)) || '',
        };
      case MessageType.image: {
        const imageAnalysis = await this.describeImageForConversation(
          message,
          runtime
        );

        return {
          ...message,
          mediaAnalysis: imageAnalysis?.mediaAnalysis,
          visualAppearanceObservations: imageAnalysis?.observations,
        };
      }
      case MessageType.text:
      default:
        return message;
    }
  }

  private async attachQuotedMessageSnapshot(
    conversation: ConversationEntity,
    message: PreparedIncomingMessage
  ): Promise<void> {
    const quotedMessageId = message.quotedMessageId?.trim();

    if (!quotedMessageId) {
      return;
    }

    const quotedMessage = await this.findMessageById(
      this.parseObjectId(quotedMessageId),
      conversation.id
    );

    if (!quotedMessage || quotedMessage.isArchived) {
      throw new AppError(
        'QUOTED_MESSAGE_NOT_FOUND',
        'quoted message not found',
        404
      );
    }

    message.quotedMessageRole = quotedMessage.role;
    message.quotedMessageContent =
      this.buildQuotedMessageSnapshot(quotedMessage);
  }

  private buildQuotedMessageSnapshot(message: MessageEntity): string {
    const text = this.buildMessageSearchableText({
      type: message.type,
      content: message.content,
      mediaAnalysis: message.mediaAnalysis,
      mediaTranscript: message.mediaTranscript,
    }).trim();

    return text.slice(0, 500);
  }

  private async resolveShortTurnReceptionForMessage(
    payload: PreparedIncomingMessage,
    message: MessageEntity
  ): Promise<ShortTurnReceptionDecision> {
    const initial = resolveShortTurnReception({
      messageType: payload.type,
      content: payload.content,
    });

    if (initial.reason !== 'ack_without_context') {
      return initial;
    }

    const previousAssistant = await this.findPreviousAssistantMessage(message);
    return resolveShortTurnReception({
      messageType: payload.type,
      content: payload.content,
      previousAssistantContent:
        previousAssistant?.mediaTranscript?.trim() ||
        previousAssistant?.content?.trim() ||
        '',
    });
  }

  private normalizeIncomingMessage(payload?: SendConversationMessageDTO): {
    type: MessageType;
    content: string;
    quotedMessageId?: string;
    mediaObjectKey?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaDurationMs?: number;
  } {
    const type = this.normalizeMessageType(payload?.type);

    switch (type) {
      case MessageType.voice:
        return this.normalizeVoiceIncomingMessage(payload);
      case MessageType.image:
        return this.normalizeImageIncomingMessage(payload);
      case MessageType.text:
      default:
        return {
          type,
          content: this.normalizeMessageContent(payload?.content),
          quotedMessageId: payload?.quotedMessageId?.trim() || undefined,
        };
    }
  }

  private normalizeVoiceIncomingMessage(payload?: SendConversationMessageDTO): {
    type: MessageType.voice;
    content: string;
    mediaObjectKey?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaDurationMs?: number;
  } {
    const explicitUrl = payload?.mediaUrl?.trim() || '';
    const objectKey = this.normalizeMediaObjectKey(
      payload?.objectKey,
      explicitUrl
    );
    const durationMs = this.normalizeVoiceDuration(payload?.durationMs);
    const mimeType = payload?.mimeType?.trim() || '';

    if (!objectKey) {
      throw new AppError(
        'INVALID_MESSAGE_VOICE',
        'voice message asset is required',
        400
      );
    }

    return {
      type: MessageType.voice,
      content: '[语音]',
      mediaObjectKey: objectKey,
      mediaUrl: explicitUrl || undefined,
      mediaMimeType: mimeType || undefined,
      mediaDurationMs: durationMs,
    };
  }

  private async transcribeVoiceForConversation(payload: {
    mediaUrl?: string;
    mediaObjectKey?: string;
    mediaMimeType?: string;
  }): Promise<string | undefined> {
    // DashScope qwen3-asr-flash 需要可公网访问的音频 URL，内联 base64 data URL 不被接受。
    const audioUrl =
      payload.mediaUrl?.trim() ||
      this.resolveMediaUrlFromObjectKey(payload.mediaObjectKey);

    if (!audioUrl) {
      this.logger.error(
        '[conversation] voice transcription skipped: no accessible audio URL, objectKey=%s',
        payload.mediaObjectKey || ''
      );
      return undefined;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const transcript = await this.openAIService.createTranscription({
          audioUrl,
        });
        const content = transcript.trim();

        if (content) {
          return content;
        }

        this.logger.error(
          '[conversation] voice transcription returned empty content, objectKey=%s, attempt=%d',
          payload.mediaObjectKey || '',
          attempt + 1
        );
        // 重试前等待 500ms
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        this.logger.error(
          '[conversation] voice transcription request failed, objectKey=%s, attempt=%d/2, reason=%s',
          payload.mediaObjectKey || '',
          attempt + 1,
          this.describeReplyError(error)
        );
        // 重试前等待 800ms
        if (attempt === 0) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
    }

    return undefined;
  }

  private normalizeImageIncomingMessage(payload?: SendConversationMessageDTO): {
    type: MessageType.image;
    content: string;
    mediaObjectKey?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
  } {
    const explicitUrl = payload?.mediaUrl?.trim() || '';
    const objectKey = this.normalizeMediaObjectKey(
      payload?.objectKey,
      explicitUrl
    );
    const mimeType = payload?.mimeType?.trim() || '';

    if (!objectKey) {
      throw new AppError(
        'INVALID_MESSAGE_IMAGE',
        'image message asset is required',
        400
      );
    }

    return {
      type: MessageType.image,
      content: '[图片]',
      mediaObjectKey: objectKey,
      mediaUrl: explicitUrl || undefined,
      mediaMimeType: mimeType || undefined,
    };
  }

  private normalizeMediaObjectKey(
    rawObjectKey?: string,
    rawMediaUrl?: string
  ): string {
    const objectKey = rawObjectKey?.trim() || '';

    if (objectKey) {
      return objectKey;
    }

    const mediaUrl = rawMediaUrl?.trim() || '';

    if (!mediaUrl) {
      return '';
    }

    const normalized = this.postImageService
      .normalizeForStorage(mediaUrl)
      .trim();

    return normalized && normalized !== mediaUrl ? normalized : '';
  }

  private normalizeMemorialAgentPhotoObjectKeys(value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new AppError(
        'INVALID_MEMORIAL_AGENT_PHOTOS',
        '请上传 TA 的照片',
        400
      );
    }

    const objectKeys = value
      .map(item =>
        this.normalizeMemorialPhotoObjectKey(
          item,
          'INVALID_MEMORIAL_AGENT_PHOTOS',
          '请上传 TA 的照片'
        )
      )
      .filter(Boolean);

    if (objectKeys.length === 0) {
      throw new AppError(
        'INVALID_MEMORIAL_AGENT_PHOTOS',
        '请上传 TA 的照片',
        400
      );
    }

    if (objectKeys.length > 3) {
      throw new AppError(
        'INVALID_MEMORIAL_AGENT_PHOTOS',
        'TA 的照片最多上传 3 张',
        400
      );
    }

    return Array.from(new Set(objectKeys));
  }

  private normalizeMemorialPhotoObjectKey(
    value: unknown,
    code: string,
    message: string
  ): string {
    const rawValue = typeof value === 'string' ? value.trim() : '';

    if (!rawValue) {
      throw new AppError(code, message, 400);
    }

    if (rawValue.length > 1024) {
      throw new AppError(code, '图片引用过长，请重新上传', 400);
    }

    const objectKey = this.postImageService
      .normalizeForStorage(rawValue)
      .trim();

    if (!objectKey || /^https?:\/\//i.test(objectKey)) {
      throw new AppError(code, '图片上传结果无效，请重新上传', 400);
    }

    return objectKey;
  }

  private normalizeMemorialCustomPrompt(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value !== 'string') {
      throw new AppError(
        'INVALID_MEMORIAL_CUSTOM_PROMPT',
        '提示词格式不正确',
        400
      );
    }

    const normalizedForLength = value.replace(/\s+/g, ' ').trim();

    if (normalizedForLength.length > MEMORIAL_PHOTO_CUSTOM_PROMPT_MAX_LENGTH) {
      throw new AppError(
        'INVALID_MEMORIAL_CUSTOM_PROMPT',
        `提示词最多 ${MEMORIAL_PHOTO_CUSTOM_PROMPT_MAX_LENGTH} 字`,
        400
      );
    }

    return normalizeMemorialPhotoCustomPrompt(value);
  }

  private resolveRequiredMemorialPhotoUrl(objectKey: string): string {
    const mediaUrl = this.resolveMediaUrlFromObjectKey(objectKey);

    if (!mediaUrl) {
      throw new AppError(
        'MEMORIAL_PHOTO_ASSET_UNAVAILABLE',
        '图片暂不可访问，请重新上传后再试',
        400
      );
    }

    return mediaUrl;
  }

  private buildMemorialPhotoFileName(
    mimeType: string,
    createdAt: Date
  ): string {
    return `memorial-photo-${createdAt.getTime()}${this.resolveImageExtension(
      mimeType
    )}`;
  }

  private resolveImageExtension(mimeType: string): string {
    const value = mimeType.trim().toLowerCase();

    if (value === 'image/jpeg' || value === 'image/jpg') {
      return '.jpg';
    }
    if (value === 'image/webp') {
      return '.webp';
    }
    if (value === 'image/gif') {
      return '.gif';
    }

    return '.png';
  }

  private async describeImageForConversation(
    payload: {
      mediaUrl?: string;
      mediaObjectKey?: string;
      mediaMimeType?: string;
    },
    runtime: ReplyRuntime
  ): Promise<ConversationImageAnalysisResult | undefined> {
    const imageUrl =
      payload.mediaUrl?.trim() ||
      this.resolveMediaUrlFromObjectKey(payload.mediaObjectKey);

    if (!imageUrl) {
      return undefined;
    }

    try {
      const visualMemories = await this.listVisualAppearanceMemoriesForImage(
        runtime
      );
      const referenceAvatarUrl = this.resolveAgentAvatarReferenceUrl(
        runtime.agent
      );
      const imageContent: Array<Record<string, unknown>> = [
        {
          type: 'text',
          text: '待分析的用户聊天图片：',
        },
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
          },
        },
      ];

      if (referenceAvatarUrl && referenceAvatarUrl !== imageUrl) {
        imageContent.push(
          {
            type: 'text',
            text: '当前角色参考头像，仅用于判断“是否可能是当前角色”：',
          },
          {
            type: 'image_url',
            image_url: {
              url: referenceAvatarUrl,
            },
          }
        );
      }

      imageContent.push({
        type: 'text',
        text: this.buildImageIdentityReference(runtime, visualMemories),
      });

      const response = await this.openAIService.createVisionChatCompletion({
        model: this.openAIService.getVisionModel(),
        temperature: 0.2,
        topP: 0.8,
        max_tokens: CONVERSATION_IMAGE_ANALYSIS_MAX_TOKENS,
        reasoningSplit: false,
        messages: [
          {
            role: 'system',
            content: CONVERSATION_IMAGE_ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: imageContent,
          } as unknown as ChatCompletionMessageParam,
        ],
      });

      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content.trim()
          : '';

      return this.parseConversationImageAnalysis(content, runtime);
    } catch (error) {
      this.logger.error(
        '[conversation] image analysis failed, objectKey=%s, url=%s, reason=%s',
        payload.mediaObjectKey || '',
        imageUrl,
        this.describeReplyError(error)
      );
      return undefined;
    }
  }

  private async listVisualAppearanceMemoriesForImage(
    runtime: ReplyRuntime
  ): Promise<
    Array<{
      value: string;
      status?: string;
      supportCount?: number;
    }>
  > {
    if (
      !this.agentProfileFactService ||
      typeof this.agentProfileFactService.listVisualAppearanceMemories !==
        'function'
    ) {
      return [];
    }

    try {
      return await this.agentProfileFactService.listVisualAppearanceMemories({
        userId: runtime.conversation.userId,
        agentId: runtime.agent?.id ?? runtime.conversation.agentId,
        limit: 8,
      });
    } catch (error) {
      this.logger.error(
        '[conversation] visual appearance memory lookup failed, conversationId=%s, reason=%s',
        this.stringifyObjectId(runtime.conversation.id),
        this.describeReplyError(error)
      );
      return [];
    }
  }

  private buildImageIdentityReference(
    runtime: ReplyRuntime,
    visualMemories: Array<{
      value: string;
      status?: string;
      supportCount?: number;
    }>
  ): string {
    const agentName = runtime.agent?.name?.trim() || '当前角色';
    const agentAddress = runtime.agent?.iCallAgent?.trim();
    const lines = [
      `身份参考：当前角色是${agentName}${
        agentAddress && agentAddress !== agentName
          ? `，用户通常称呼TA为${agentAddress}`
          : ''
      }。`,
      this.buildImageRelationshipInferenceGuide(agentAddress || agentName),
    ];

    if (visualMemories.length) {
      lines.push(
        '历史视觉记忆（含候选，只能辅助比较）：',
        ...visualMemories.slice(0, 8).map(memory => {
          const state = memory.status === 'active' ? '重复观察' : '单次候选';
          return `- [${state}] ${memory.value.trim().slice(0, 60)}`;
        })
      );
    } else {
      lines.push('历史视觉记忆：暂无。');
    }

    lines.push('请分析待分析图片，而不是把参考头像当成用户发送内容。');
    return lines.join('\n');
  }

  private buildImageRelationshipInferenceGuide(userCallsAgent: string): string {
    const relation = userCallsAgent.trim();
    const isGrandparent = /^(?:爷爷|奶奶|外公|外婆|姥爷|姥姥|祖父|祖母)$/.test(
      relation
    );
    const isParent = /^(?:爸爸|爸|父亲|妈妈|妈|母亲)$/.test(relation);
    const isPartner = /^(?:老公|老婆|丈夫|妻子|爱人|伴侣)$/.test(relation);
    const guide = [
      '关系推测提示：人物年龄阶段、照片年代感和用户文字优先于聊天对象身份；不要只因当前角色是谁就把图中人物归为当前角色。',
      '若人物明显比当前角色关系应有年龄更年轻，应优先考虑用户本人、用户父母、当前角色子女或其他家人；无法区分时用low或unknown。',
      'family.name可填爸爸、妈妈、儿子、女儿、孙子、孙女、外孙、外孙女等常用称呼；用户本人请用target=user。',
    ];

    if (isGrandparent) {
      guide.push(
        '当前角色是祖辈时：老人旧照或有明确旧照年代感才优先候选当前角色；中年人可能是用户爸爸/妈妈或当前角色中年照；年轻人、儿童可能是用户本人或其他晚辈。'
      );
    } else if (isParent) {
      guide.push(
        '当前角色是父母时：中年或老年人可候选当前角色；年轻人、儿童可能是用户本人或兄弟姐妹；更年长的人可能是用户祖辈。'
      );
    } else if (isPartner) {
      guide.push(
        '当前角色是伴侣时：同龄成人且年代感匹配时才优先候选当前角色；儿童、老人或代际明显不符的人更可能是家人或未知。'
      );
    }

    return guide.join('\n');
  }

  private resolveAgentAvatarReferenceUrl(agent: AgentEntity | null): string {
    const avatar = agent?.avatar?.trim();

    if (!avatar) {
      return '';
    }

    const resolved = this.postImageService.resolveForResponse(avatar).trim();

    if (/^https?:\/\//i.test(resolved)) {
      return resolved;
    }

    const objectUrl = this.resolveMediaUrlFromObjectKey(avatar);
    return /^https?:\/\//i.test(objectUrl) ? objectUrl : '';
  }

  private parseConversationImageAnalysis(
    content: string,
    runtime: ReplyRuntime
  ): ConversationImageAnalysisResult | undefined {
    const normalizedContent = content?.trim();

    if (!normalizedContent) {
      return undefined;
    }

    const parsed = this.parseAssistantReplyEnvelope(normalizedContent);

    if (!parsed) {
      return {
        mediaAnalysis: normalizedContent.slice(0, 300),
        observations: [],
      };
    }

    const summary = this.normalizeImageAnalysisText(parsed.summary, 120);
    const people = (Array.isArray(parsed.people) ? parsed.people : [])
      .slice(0, 4)
      .map((person, index) => this.normalizeImagePerson(person, index))
      .filter((person): person is ConversationImagePersonAnalysis =>
        Boolean(person)
      );
    const mediaAnalysis = this.formatConversationImageAnalysis(
      summary,
      people,
      runtime.agent
    );

    if (!mediaAnalysis) {
      return undefined;
    }

    return {
      mediaAnalysis,
      observations: people.map(person => ({
        personId: person.id,
        identityTarget: person.identity.target,
        identityName: person.identity.name,
        identityConfidence: person.identity.confidence,
        traits: person.stableTraits,
      })),
    };
  }

  private normalizeImagePerson(
    value: unknown,
    index: number
  ): ConversationImagePersonAnalysis | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const person = value as Record<string, unknown>;
    const identity =
      person.identity && typeof person.identity === 'object'
        ? (person.identity as Record<string, unknown>)
        : {};
    const target = this.normalizeVisualIdentityTarget(identity.target);
    const basis =
      this.normalizeImageAnalysisText(identity.basis, 20) || undefined;
    const confidence = this.constrainVisualIdentityConfidence({
      target,
      confidence: this.normalizeVisualIdentityConfidence(identity.confidence),
      basis,
    });
    const stableTraits = (
      Array.isArray(person.stableTraits) ? person.stableTraits : []
    )
      .map(trait => this.normalizeVisualAppearanceTrait(trait))
      .filter((trait): trait is AgentVisualAppearanceTrait => Boolean(trait))
      .slice(0, 4);

    return {
      id: this.normalizeImageAnalysisText(person.id, 8) || `P${index + 1}`,
      visible: this.normalizeImageAnalysisText(person.visible, 60),
      identity: {
        target,
        name: this.normalizeImageAnalysisText(identity.name, 16) || undefined,
        confidence,
        basis,
      },
      stableTraits,
    };
  }

  private constrainVisualIdentityConfidence(options: {
    target: AgentVisualIdentityTarget;
    confidence: AgentVisualIdentityConfidence;
    basis?: string;
  }): AgentVisualIdentityConfidence {
    if (
      options.target === 'unknown' ||
      options.confidence === 'low' ||
      this.hasStrongVisualIdentityBasis(options.basis)
    ) {
      return options.confidence;
    }

    return this.hasWeakRelationshipOnlyIdentityBasis(options.basis)
      ? 'low'
      : options.confidence;
  }

  private hasStrongVisualIdentityBasis(value?: string): boolean {
    return /参考头像|头像|历史视觉|视觉记忆|五官|脸型|眼镜|胡须|发型|相似|接近|特征|照片文字|用户文字|用户说明|明确说明/.test(
      value || ''
    );
  }

  private hasWeakRelationshipOnlyIdentityBasis(value?: string): boolean {
    return /用户称呼|当前角色|聊天对象|关系推测|年龄阶段|年龄|性别|年代感|长辈|祖辈|父母|晚辈/.test(
      value || ''
    );
  }

  private normalizeVisualAppearanceTrait(
    value: unknown
  ): AgentVisualAppearanceTrait | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const trait = value as Record<string, unknown>;
    const kind = this.normalizeVisualAppearanceTraitKind(trait.kind);
    const traitValue = this.normalizeImageAnalysisText(trait.value, 24);

    return kind && traitValue && !/不清楚|未知|无法判断/.test(traitValue)
      ? { kind, value: traitValue }
      : null;
  }

  private normalizeVisualAppearanceTraitKind(
    value: unknown
  ): AgentVisualAppearanceTraitKind | null {
    switch (value) {
      case 'hair_color':
      case 'hair_length':
      case 'face_shape':
      case 'eyewear':
      case 'facial_hair':
      case 'build':
      case 'distinctive':
        return value;
      default:
        return null;
    }
  }

  private normalizeVisualIdentityTarget(
    value: unknown
  ): AgentVisualIdentityTarget {
    switch (value) {
      case 'agent':
      case 'user':
      case 'family':
      case 'unknown':
        return value;
      default:
        return 'unknown';
    }
  }

  private normalizeVisualIdentityConfidence(
    value: unknown
  ): AgentVisualIdentityConfidence {
    switch (value) {
      case 'high':
      case 'medium':
      case 'low':
        return value;
      default:
        return 'low';
    }
  }

  private normalizeImageAnalysisText(value: unknown, limit: number): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
      : '';
  }

  private formatConversationImageAnalysis(
    summary: string,
    people: ConversationImagePersonAnalysis[],
    agent: AgentEntity | null
  ): string {
    const lines = summary ? [`画面：${summary}`] : [];
    const identityGuesses = people
      .filter(person => person.identity.target !== 'unknown')
      .map(person => {
        const subject = this.formatImageIdentitySubject(person.identity, agent);
        const wording = this.formatImageIdentityConfidenceWording(
          person.identity.confidence
        );
        const basis = person.identity.basis
          ? `，依据：${person.identity.basis}`
          : '';
        return `${person.id}${wording}${subject}${basis}`;
      });

    if (identityGuesses.length) {
      lines.push(`身份推测（非事实）：${identityGuesses.join('；')}`);
    }

    const appearance = people
      .filter(
        person =>
          person.identity.target !== 'unknown' &&
          person.identity.confidence !== 'low' &&
          person.stableTraits.length > 0
      )
      .map(
        person =>
          `${person.id}：${person.stableTraits
            .map(trait => trait.value)
            .join('、')}`
      );

    if (appearance.length) {
      lines.push(`可记形象：${appearance.join('；')}`);
    }

    return lines.join('\n').slice(0, 600);
  }

  private formatImageIdentityConfidenceWording(
    confidence: AgentVisualIdentityConfidence
  ): string {
    switch (confidence) {
      case 'high':
        return '很像';
      case 'medium':
        return '可能是';
      case 'low':
      default:
        return '也许是';
    }
  }

  private formatImageIdentitySubject(
    identity: ConversationImageIdentityGuess,
    agent: AgentEntity | null
  ): string {
    if (identity.target === 'agent') {
      return `当前角色${agent?.name?.trim() || ''}`;
    }
    if (identity.target === 'user') {
      return '用户本人';
    }
    if (identity.target === 'family') {
      return identity.name?.trim() ? `家人${identity.name.trim()}` : '某位家人';
    }

    return '身份未知的人';
  }

  private async createAssistantReplyMessages(options: {
    conversationId: MongoObjectId;
    userId: MongoObjectId;
    agentId: MongoObjectId;
    replySegments: string[];
    userQuery?: string;
    replyTime: Date;
    usage: {
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    routing?: ReplyRoutingAudit;
  }): Promise<MessageEntity[]> {
    const replyGroupId = new MongoObjectId().toHexString();
    const messages: MessageEntity[] = [];
    const replySegments = options.replySegments.slice(
      0,
      MAX_ASSISTANT_REPLY_SEGMENTS
    );
    const replyVisibleCharacters = countReplyVisibleCharacters(replySegments);

    for (const [index, segment] of replySegments.entries()) {
      const segmentTime = new Date(options.replyTime.getTime() + index);
      const isFirstSegment = index === 0;

      messages.push(
        await this.saveMessage({
          conversationId: options.conversationId,
          userId: options.userId,
          agentId: options.agentId,
          role: MessageRole.assistant,
          type: MessageType.text,
          content: segment,
          status: MessageStatus.sent,
          replyGroupId,
          replySegmentIndex: index,
          model: isFirstSegment ? options.usage.model : undefined,
          promptTokens: isFirstSegment ? options.usage.promptTokens : undefined,
          completionTokens: isFirstSegment
            ? options.usage.completionTokens
            : undefined,
          totalTokens: isFirstSegment ? options.usage.totalTokens : undefined,
          replyVisibleCharacters: isFirstSegment
            ? replyVisibleCharacters
            : undefined,
          ...(isFirstSegment
            ? this.buildReplyRoutingMessageFields(options.routing)
            : {}),
          traceId: this.chatTraceService?.getCurrentTraceId(),
          createdAt: segmentTime,
          updatedAt: segmentTime,
        })
      );
    }

    return messages;
  }

  private async createAssistantVoiceReplyMessages(options: {
    runtime: ReplyRuntime;
    before: BeforeReplyResult;
    replySegments: string[];
    replyTime: Date;
    usage: {
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    routing?: ReplyRoutingAudit;
  }): Promise<MessageEntity[] | undefined> {
    const hasLongReply =
      countReplyVisibleCharacters(
        options.replySegments.slice(0, MAX_ASSISTANT_REPLY_SEGMENTS)
      ) >= ASSISTANT_AUTO_VOICE_MIN_CHARACTERS;

    if (
      options.before.messagePayload.type !== MessageType.voice &&
      !hasLongReply
    ) {
      return undefined;
    }

    const voiceTimbre = await this.findActiveVoiceTimbreForAgent(
      options.runtime.agent
    );

    if (!voiceTimbre) {
      return undefined;
    }

    const replyContent = options.replySegments
      .slice(0, MAX_ASSISTANT_REPLY_SEGMENTS)
      .join('');
    const replyVisibleCharacters = countReplyVisibleCharacters(
      options.replySegments.slice(0, MAX_ASSISTANT_REPLY_SEGMENTS)
    );
    const synthesizedVoice = await this.synthesizeAssistantVoiceReply(
      replyContent,
      voiceTimbre
    );

    if (!synthesizedVoice) {
      return undefined;
    }

    const message = await this.saveMessage({
      conversationId: options.runtime.conversation.id,
      userId: options.runtime.conversation.userId,
      agentId: options.runtime.conversation.agentId,
      role: MessageRole.assistant,
      type: MessageType.voice,
      content: synthesizedVoice.transcript,
      status: MessageStatus.sent,
      mediaObjectKey: synthesizedVoice.mediaObjectKey,
      mediaMimeType: synthesizedVoice.mediaMimeType,
      mediaTranscript: synthesizedVoice.transcript,
      mediaDurationMs: synthesizedVoice.mediaDurationMs,
      model: options.usage.model,
      promptTokens: options.usage.promptTokens,
      completionTokens: options.usage.completionTokens,
      totalTokens: options.usage.totalTokens,
      replyVisibleCharacters,
      ...this.buildReplyRoutingMessageFields(options.routing),
      traceId: this.chatTraceService?.getCurrentTraceId(),
      createdAt: options.replyTime,
      updatedAt: options.replyTime,
    });

    return [message];
  }

  private async synthesizeAssistantVoiceReply(
    replyContent: string,
    voiceTimbre: VoiceTimbreEntity
  ): Promise<SynthesizedAssistantVoiceReply | undefined> {
    const transcript = this.buildAssistantReplySpeechText(replyContent);

    if (!transcript) {
      return undefined;
    }

    try {
      const synthesized = await this.synthesizeByVoiceTimbre({
        text: transcript,
        voiceTimbre,
      });
      try {
        await this.voiceTimbreLibraryService.markUsed(voiceTimbre);
      } catch (error) {
        this.logger.error(
          '[conversation] voice timbre usage timestamp update failed, timbreId=%s, reason=%s',
          this.stringifyObjectId(voiceTimbre.id),
          this.describeReplyError(error)
        );
      }
      const stored = await this.storeAssistantVoiceAsset({
        audioBuffer: synthesized.audioBuffer,
        mimeType: synthesized.mimeType,
      });

      return {
        mediaObjectKey: stored.mediaObjectKey,
        mediaMimeType: stored.mediaMimeType,
        mediaDurationMs: this.extractAudioDurationMs(
          synthesized.audioBuffer,
          stored.mediaMimeType || synthesized.mimeType
        ),
        transcript,
      };
    } catch (error) {
      this.logger.error(
        '[conversation] assistant voice synthesis failed, reason=%s',
        this.describeReplyError(error)
      );
      return undefined;
    }
  }

  private async synthesizeByVoiceTimbre(input: {
    text: string;
    voiceTimbre: VoiceTimbreEntity;
  }): Promise<{
    audioUrl: string;
    audioBuffer: Buffer;
    mimeType?: string;
  }> {
    if (input.voiceTimbre.provider === VoiceTimbreProvider.minimax) {
      return this.minimaxVoiceSpeechService.synthesize({
        text: input.text,
        voiceId: input.voiceTimbre.providerVoiceId,
        model: input.voiceTimbre.previewModel,
        languageBoost: input.voiceTimbre.cloneLanguage,
        speed: input.voiceTimbre.speechSpeed,
        volume: input.voiceTimbre.speechVolume,
        pitch: input.voiceTimbre.speechPitch,
      });
    }

    if (input.voiceTimbre.provider === VoiceTimbreProvider.cosyvoice) {
      return this.cosyVoiceSpeechService.synthesize({
        text: input.text,
        voiceId: input.voiceTimbre.providerVoiceId,
        model: input.voiceTimbre.previewModel,
        languageHint: input.voiceTimbre.cloneLanguage,
        speed: input.voiceTimbre.speechSpeed,
        volume: input.voiceTimbre.speechVolume,
        pitch: input.voiceTimbre.speechPitch,
      });
    }

    if (input.voiceTimbre.provider === VoiceTimbreProvider.qwen) {
      const synthesized = await this.qwenVoiceSpeechService.synthesize({
        text: input.text,
        voiceId: input.voiceTimbre.providerVoiceId,
        model: input.voiceTimbre.previewModel,
        language: input.voiceTimbre.cloneLanguage,
      });
      const speechSpeed = this.voiceSpeechSetting(
        input.voiceTimbre.speechSpeed,
        1,
        0.5,
        2
      );
      const speechVolume = this.voiceSpeechSetting(
        input.voiceTimbre.speechVolume,
        1,
        0.25,
        2
      );
      if (speechSpeed === 1 && speechVolume === 1) {
        return synthesized;
      }
      const adjusted = await this.voiceFfmpegService.adjustSpeechOutput({
        buffer: synthesized.audioBuffer,
        fileName: synthesized.mimeType.includes('mpeg')
          ? 'speech.mp3'
          : 'speech.wav',
        speechSpeed,
        speechVolume,
      });
      return {
        audioUrl: '',
        audioBuffer: adjusted.buffer,
        mimeType: adjusted.contentType,
      };
    }

    throw new AppError(
      'VOICE_TIMBRE_PROVIDER_UNSUPPORTED',
      'voice timbre provider is not supported for speech synthesis',
      400
    );
  }

  private voiceSpeechSetting(
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
  }

  private async findActiveVoiceTimbreForAgent(
    agent?: AgentEntity | null
  ): Promise<VoiceTimbreEntity | undefined> {
    const voiceTimbreId = this.normalizeObjectId(agent?.voiceTimbreId);

    if (!voiceTimbreId) {
      return undefined;
    }

    const timbre =
      (await this.voiceTimbreModel.findOne({
        where: {
          id: voiceTimbreId,
          status: VoiceTimbreStatus.active,
        },
      })) ??
      (await this.voiceTimbreModel.findOne({
        where: {
          _id: voiceTimbreId,
          status: VoiceTimbreStatus.active,
        } as never,
      }));

    if (!timbre) {
      this.logger.error(
        '[conversation] active voice timbre not found, agentId=%s, voiceTimbreId=%s',
        this.stringifyObjectId(agent?.id),
        this.stringifyObjectId(voiceTimbreId)
      );
      return undefined;
    }

    return timbre;
  }

  private buildAssistantReplySpeechText(replyContent: string): string {
    const segments = this.parseAssistantReplyCandidates(replyContent)
      .map(segment => this.sanitizeAssistantSegment(segment))
      .filter(Boolean)
      .slice(0, MAX_ASSISTANT_REPLY_SEGMENTS);

    if (segments.length === 0) {
      return '';
    }

    return segments
      .map(segment =>
        /[。！？!?]$/.test(segment.trim())
          ? segment.trim()
          : `${segment.trim()}。`
      )
      .join('');
  }

  private async storeAssistantVoiceAsset(input: {
    audioBuffer: Buffer;
    mimeType?: string;
  }): Promise<{
    mediaObjectKey: string;
    mediaMimeType?: string;
  }> {
    const mimeType = input.mimeType?.trim() || 'audio/wav';
    const fileName = this.buildAssistantVoiceFileName(mimeType);

    try {
      if (this.tencentCosService.isEnabled()) {
        const uploaded = await this.tencentCosService.putBuffer(
          input.audioBuffer,
          {
            folder: 'conversation-voice-replies',
            fileName,
            contentType: mimeType,
          }
        );

        return {
          mediaObjectKey: uploaded.objectKey,
          mediaMimeType: mimeType,
        };
      }

      if (this.ossService.isEnabled()) {
        const uploaded = await this.ossService.putBuffer(input.audioBuffer, {
          folder: 'conversation-voice-replies',
          fileName,
          contentType: mimeType,
        });

        return {
          mediaObjectKey: uploaded.objectKey,
          mediaMimeType: mimeType,
        };
      }
    } catch (error) {
      this.logger.error(
        '[conversation] assistant voice asset upload failed, reason=%s',
        this.describeReplyError(error)
      );
    }

    throw new AppError(
      'VOICE_REPLY_STORAGE_UNAVAILABLE',
      'assistant voice reply storage is unavailable',
      503
    );
  }

  private buildAssistantVoiceFileName(mimeType?: string): string {
    return `assistant_reply_${Date.now()}.${this.resolveAudioExtension(
      mimeType
    )}`;
  }

  private resolveAudioExtension(mimeType?: string): string {
    const normalized = mimeType?.trim().toLowerCase() || '';

    if (normalized.includes('mpeg')) {
      return 'mp3';
    }
    if (normalized.includes('aac')) {
      return 'aac';
    }
    if (normalized.includes('ogg')) {
      return 'ogg';
    }
    if (normalized.includes('webm')) {
      return 'webm';
    }

    return 'wav';
  }

  private extractAudioDurationMs(
    audioBuffer: Buffer,
    mimeType?: string
  ): number | undefined {
    return (
      this.extractWavDurationMs(audioBuffer, mimeType) ||
      this.extractMp3DurationMs(audioBuffer, mimeType) ||
      this.extractAdtsAacDurationMs(audioBuffer, mimeType)
    );
  }

  private extractWavDurationMs(
    audioBuffer: Buffer,
    mimeType?: string
  ): number | undefined {
    if (
      !Buffer.isBuffer(audioBuffer) ||
      audioBuffer.length < 44 ||
      !mimeType?.toLowerCase().includes('wav')
    ) {
      return undefined;
    }

    if (
      audioBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
      audioBuffer.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      return undefined;
    }

    let offset = 12;
    let byteRate = 0;
    let dataSize = 0;

    while (offset + 8 <= audioBuffer.length) {
      const chunkId = audioBuffer.toString('ascii', offset, offset + 4);
      const chunkSize = audioBuffer.readUInt32LE(offset + 4);
      const chunkStart = offset + 8;

      if (
        chunkId === 'fmt ' &&
        chunkSize >= 16 &&
        chunkStart + 12 <= audioBuffer.length
      ) {
        byteRate = audioBuffer.readUInt32LE(chunkStart + 8);
      }

      if (chunkId === 'data') {
        dataSize =
          chunkSize === 0xffffffff
            ? audioBuffer.length - chunkStart
            : Math.min(chunkSize, audioBuffer.length - chunkStart);
        break;
      }

      offset = chunkStart + chunkSize + (chunkSize % 2);
    }

    if (byteRate <= 0 || dataSize <= 0) {
      return undefined;
    }

    return this.normalizeVoiceDuration((dataSize / byteRate) * 1000);
  }

  private extractMp3DurationMs(
    audioBuffer: Buffer,
    mimeType?: string
  ): number | undefined {
    if (
      !Buffer.isBuffer(audioBuffer) ||
      audioBuffer.length < 4 ||
      !this.isMp3MimeOrBuffer(audioBuffer, mimeType)
    ) {
      return undefined;
    }

    let offset = this.skipId3v2Header(audioBuffer);
    let totalSamples = 0;
    let sampleRate = 0;
    let frameCount = 0;

    while (offset + 4 <= audioBuffer.length) {
      const header = audioBuffer.readUInt32BE(offset);
      const frame = this.parseMp3FrameHeader(header);

      if (!frame) {
        offset += 1;
        continue;
      }

      if (offset + frame.frameSize > audioBuffer.length) {
        break;
      }

      totalSamples += frame.samplesPerFrame;
      sampleRate = frame.sampleRate;
      frameCount += 1;
      offset += frame.frameSize;
    }

    if (frameCount <= 0 || totalSamples <= 0 || sampleRate <= 0) {
      return undefined;
    }

    return Math.max(1, Math.round((totalSamples / sampleRate) * 1000));
  }

  private isMp3MimeOrBuffer(audioBuffer: Buffer, mimeType?: string): boolean {
    const normalized = mimeType?.trim().toLowerCase() || '';
    if (normalized.includes('mpeg') || normalized.includes('mp3')) {
      return true;
    }

    if (audioBuffer.toString('ascii', 0, 3) === 'ID3') {
      return true;
    }

    return (
      audioBuffer.length >= 2 &&
      audioBuffer[0] === 0xff &&
      (audioBuffer[1] & 0xe0) === 0xe0
    );
  }

  private skipId3v2Header(audioBuffer: Buffer): number {
    if (
      audioBuffer.length < 10 ||
      audioBuffer.toString('ascii', 0, 3) !== 'ID3'
    ) {
      return 0;
    }

    const size =
      ((audioBuffer[6] & 0x7f) << 21) |
      ((audioBuffer[7] & 0x7f) << 14) |
      ((audioBuffer[8] & 0x7f) << 7) |
      (audioBuffer[9] & 0x7f);
    const hasFooter = Boolean(audioBuffer[5] & 0x10);

    return Math.min(audioBuffer.length, 10 + size + (hasFooter ? 10 : 0));
  }

  private parseMp3FrameHeader(header: number):
    | {
        frameSize: number;
        sampleRate: number;
        samplesPerFrame: number;
      }
    | undefined {
    if ((header & 0xffe00000) !== 0xffe00000) {
      return undefined;
    }

    const versionBits = (header >> 19) & 0x03;
    const layerBits = (header >> 17) & 0x03;
    const bitrateIndex = (header >> 12) & 0x0f;
    const sampleRateIndex = (header >> 10) & 0x03;
    const padding = (header >> 9) & 0x01;

    if (
      versionBits === 1 ||
      layerBits === 0 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleRateIndex === 3
    ) {
      return undefined;
    }

    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3;
    const sampleRate = this.resolveMp3SampleRate(version, sampleRateIndex);
    const bitrate = this.resolveMp3Bitrate(version, layer, bitrateIndex);

    if (!sampleRate || !bitrate) {
      return undefined;
    }

    const samplesPerFrame =
      layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
    const frameSize =
      layer === 1
        ? Math.floor(((12 * bitrate) / sampleRate + padding) * 4)
        : Math.floor(
            ((layer === 3 && version !== 1 ? 72 : 144) * bitrate) / sampleRate +
              padding
          );

    if (frameSize <= 4) {
      return undefined;
    }

    return {
      frameSize,
      sampleRate,
      samplesPerFrame,
    };
  }

  private resolveMp3SampleRate(
    version: 1 | 2 | 2.5,
    index: number
  ): number | undefined {
    const baseRates = [44100, 48000, 32000];
    const baseRate = baseRates[index];
    if (!baseRate) {
      return undefined;
    }

    if (version === 1) {
      return baseRate;
    }

    return version === 2 ? baseRate / 2 : baseRate / 4;
  }

  private resolveMp3Bitrate(
    version: 1 | 2 | 2.5,
    layer: 1 | 2 | 3,
    index: number
  ): number | undefined {
    const mpeg1Layer1 = [
      0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
    ];
    const mpeg1Layer2 = [
      0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
    ];
    const mpeg1Layer3 = [
      0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
    ];
    const mpeg2Layer1 = [
      0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
    ];
    const mpeg2Layer23 = [
      0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
    ];

    const table =
      version === 1
        ? layer === 1
          ? mpeg1Layer1
          : layer === 2
          ? mpeg1Layer2
          : mpeg1Layer3
        : layer === 1
        ? mpeg2Layer1
        : mpeg2Layer23;
    const bitrateKbps = table[index];

    return bitrateKbps ? bitrateKbps * 1000 : undefined;
  }

  private extractAdtsAacDurationMs(
    audioBuffer: Buffer,
    mimeType?: string
  ): number | undefined {
    if (
      !Buffer.isBuffer(audioBuffer) ||
      audioBuffer.length < 7 ||
      !this.isAacMimeOrBuffer(audioBuffer, mimeType)
    ) {
      return undefined;
    }

    let offset = 0;
    let frameCount = 0;
    let sampleRate = 0;

    while (offset + 7 <= audioBuffer.length) {
      if (
        audioBuffer[offset] !== 0xff ||
        (audioBuffer[offset + 1] & 0xf0) !== 0xf0
      ) {
        offset += 1;
        continue;
      }

      const sampleRateIndex = (audioBuffer[offset + 2] >> 2) & 0x0f;
      const nextSampleRate = this.resolveAacSampleRate(sampleRateIndex);
      const frameLength =
        ((audioBuffer[offset + 3] & 0x03) << 11) |
        (audioBuffer[offset + 4] << 3) |
        ((audioBuffer[offset + 5] & 0xe0) >> 5);

      if (
        !nextSampleRate ||
        frameLength < 7 ||
        offset + frameLength > audioBuffer.length
      ) {
        offset += 1;
        continue;
      }

      sampleRate = nextSampleRate;
      frameCount += 1;
      offset += frameLength;
    }

    if (frameCount <= 0 || sampleRate <= 0) {
      return undefined;
    }

    return Math.max(1, Math.round(((frameCount * 1024) / sampleRate) * 1000));
  }

  private isAacMimeOrBuffer(audioBuffer: Buffer, mimeType?: string): boolean {
    const normalized = mimeType?.trim().toLowerCase() || '';
    if (normalized.includes('aac')) {
      return true;
    }

    return (
      audioBuffer.length >= 2 &&
      audioBuffer[0] === 0xff &&
      (audioBuffer[1] & 0xf0) === 0xf0
    );
  }

  private resolveAacSampleRate(index: number): number | undefined {
    const sampleRates = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000,
      11025, 8000, 7350,
    ];

    return sampleRates[index];
  }

  private normalizeMessageType(rawValue?: string): MessageType {
    const value = rawValue?.trim().toLowerCase();
    if (value === MessageType.voice) {
      return MessageType.voice;
    }
    if (value === MessageType.image) {
      return MessageType.image;
    }
    return MessageType.text;
  }

  private normalizeVoiceDuration(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    const durationMs = Math.round(value);
    return durationMs <= 10 * 60 * 1000 ? durationMs : undefined;
  }

  private resolveMediaUrlFromObjectKey(objectKey?: string): string {
    const normalizedObjectKey = objectKey?.trim();

    if (!normalizedObjectKey || !this.tencentCosService.isEnabled()) {
      return '';
    }

    try {
      return this.tencentCosService.getPublicUrl(normalizedObjectKey);
    } catch {
      return '';
    }
  }

  private buildMessageSearchableText(payload: PreparedIncomingMessage): string {
    switch (payload.type) {
      case MessageType.image:
        return this.buildImageSearchableText(
          payload.mediaAnalysis,
          payload.content
        );
      case MessageType.voice: {
        const transcript = payload.mediaTranscript?.trim();
        if (!transcript) return '';
        return `语音：${transcript}`;
      }
      case MessageType.text:
      default:
        return payload.content?.trim() || '';
    }
  }

  private buildImageSearchableText(
    mediaAnalysis?: string,
    fallbackContent?: string
  ): string {
    const analysis = mediaAnalysis?.trim();

    if (analysis) {
      return `用户发送了一张图片：\n${analysis}`;
    }

    return fallbackContent?.trim() || '';
  }

  private buildVoicePreviewLabel(message: MessageEntity): string {
    const durationMs = this.normalizeVoiceDuration(message.mediaDurationMs);
    if (!durationMs) {
      return '[语音]';
    }

    const seconds = Math.max(1, Math.round(durationMs / 1000));
    return `[语音] ${seconds}"`;
  }

  private async reflowAssistantReplyBubbles(options: {
    userQuery: string;
    replySegments: string[];
  }): Promise<AssistantBubbleReflowResult> {
    const inspected = inspectReplyBubbleStructure(options.replySegments);

    if (!inspected.requiresReflow) {
      return {
        segments: inspected.segments,
        usage: {},
        attempted: false,
        succeeded: true,
        issues: inspected.issues,
      };
    }

    let reflowUsage: ReplyUsage = {};

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0.1,
          topP: 0.8,
          max_tokens: ASSISTANT_BUBBLE_REFLOW_MAX_TOKENS,
          trace: {
            stage: ChatTraceStage.generate,
            operation: 'generate.bubble_reflow',
          },
          messages: [
            {
              role: 'system',
              content: [
                '你只负责把已有聊天回复重新组织成自然聊天气泡，不新增事实、态度、问题、劝告或称呼。',
                `默认一颗，只有独立沟通动作切换时才换泡，最多 ${MAX_ASSISTANT_REPLY_SEGMENTS} 颗。`,
                '删除纯舞台动作和完全重复句；保留原回复的有效信息与关系语气。',
                '只输出中文正文，需要换泡时用空行分隔，不要输出 JSON、编号或解释。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery,
                candidateBubbles: inspected.segments,
                structureIssues: inspected.issues,
              }),
            },
          ],
        },
        {
          timeout: ASSISTANT_BUBBLE_REFLOW_TIMEOUT_MS,
          maxRetries: 0,
        }
      );
      const usage = this.extractUsageFromResponse(response);
      reflowUsage = usage;
      const responseContent =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const replyTruncated = this.checkAssistantCompletionTruncated(response);
      if (replyTruncated) {
        this.logger.error(
          '[conversation] bubble reflow completion truncated by token limit'
        );
      }
      const parsedReply = this.parseAssistantReply(responseContent);
      const reflowedSegments = this.normalizeModelFirstReplySegments(
        parsedReply.segments,
        options.userQuery
      );
      const reflowedInspection = inspectReplyBubbleStructure(reflowedSegments);

      if (reflowedInspection.requiresReflow) {
        throw new AppError(
          'ASSISTANT_BUBBLE_REFLOW_INVALID',
          'Bubble reflow did not produce a valid structure',
          502
        );
      }

      return {
        segments: reflowedInspection.segments,
        usage,
        attempted: true,
        succeeded: true,
        issues: inspected.issues,
        trace: this.buildAssistantGenerationAttemptTrace({
          attempt: 'bubble_reflow',
          responseContent,
          userQuery: options.userQuery,
          model:
            typeof response.model === 'string' ? response.model : undefined,
          usage,
        }),
      };
    } catch (error) {
      this.logger?.warn?.(
        '[conversation] bubble reflow failed, issues=%s, reason=%s',
        inspected.issues.join(','),
        this.describeReplyError(error)
      );
      const fallbackSegments = compactReplyBubblesPreservingContent(
        inspected.segments
      );

      return {
        segments: fallbackSegments.length
          ? fallbackSegments
          : [ASSISTANT_REPLY_FAILED_CONTENT],
        usage: reflowUsage,
        attempted: true,
        succeeded: false,
        issues: inspected.issues,
      };
    }
  }

  private normalizeAssistantReplySegments(
    value?: string | string[],
    userQuery = ''
  ): string[] {
    const parsedSegments = Array.isArray(value)
      ? value
      : this.parseAssistantReplyCandidates(value);
    const naturalSegments = this.normalizeModelFirstReplySegments(
      parsedSegments,
      userQuery
    );

    if (naturalSegments.length > 0) {
      return naturalSegments;
    }

    // 从原始文本中尝试提取中文内容（处理畸形 JSON 输出的兜底）
    const rawText = Array.isArray(value)
      ? value.join(' ')
      : typeof value === 'string'
      ? value
      : '';
    if (rawText) {
      const extractAttempt = this.extractTextFromJsonArtifact(rawText);
      const chineseSegments = this.extractChineseTextSegments(
        extractAttempt ?? rawText
      );
      if (chineseSegments.length > 0) {
        return chineseSegments.map(s => this.stripAssistantMarkup(s).trim());
      }
    }

    throw new AppError(
      'ASSISTANT_REPLY_NO_USABLE_TEXT',
      'assistant reply did not contain usable text',
      502
    );
  }

  private checkAssistantCompletionTruncated(response: {
    choices?: Array<{
      finish_reason?: unknown;
    }>;
  }): boolean {
    if (response.choices?.[0]?.finish_reason !== 'length') {
      return false;
    }

    return true;
  }

  private buildAssistantGenerationAttemptTrace(options: {
    attempt: AssistantGenerationAttemptTrace['attempt'];
    responseContent: string;
    parsedSegments?: string[];
    userQuery: string;
    model?: string;
    usage?: ReplyUsage;
    errorCode?: string;
  }): AssistantGenerationAttemptTrace {
    const parsedReply = this.parseAssistantReply(options.responseContent);
    const parsedSegments = options.parsedSegments || parsedReply.segments;
    const segmentTraces = parsedSegments.map(segment =>
      this.inspectAssistantSegmentSanitization(segment, options.userQuery)
    );
    const acceptedSegments = inspectReplyBubbleStructure(
      segmentTraces.map(item => item.output).filter(Boolean)
    ).segments;

    return {
      attempt: options.attempt,
      model: options.model,
      usage: options.usage || {},
      rawContent: options.responseContent,
      parsedSegments,
      acceptedSegments,
      segmentTraces,
      errorCode:
        options.errorCode ||
        (acceptedSegments.length
          ? undefined
          : 'ASSISTANT_REPLY_NO_USABLE_TEXT'),
    };
  }

  private materializeParticipationReplySegments(
    segments: string[],
    strategy?: ReplyBrief['participationStrategy']
  ): string[] {
    // 兼容旧链路的执行记录；拆泡只依据最终正文，不再依据参与策略强制两泡。
    void strategy;
    return splitReplyContentForDelivery(segments);
  }

  private finalizeParticipationReplySegments(
    segments: string[],
    strategy?: ReplyBrief['participationStrategy']
  ): {
    segments: string[];
    execution?: 'two_segments' | 'single_fallback';
    fallbackReason?: 'model_single_segment';
  } {
    const materialized = this.materializeParticipationReplySegments(
      segments,
      strategy
    );

    if (!strategy) {
      return { segments: materialized };
    }
    if (materialized.length !== 2) {
      return {
        segments: materialized,
        execution: 'single_fallback',
        fallbackReason: 'model_single_segment',
      };
    }
    return {
      segments: materialized,
      execution: 'two_segments',
    };
  }

  private applyConversationStrategyToSegments(
    segments: string[],
    replyBrief: ReplyBrief,
    userQuery = ''
  ): string[] {
    const closesCorrection =
      replyBrief.conversationPlan?.turnClosure === 'close' &&
      (replyBrief.primaryScene === 'correction' ||
        replyBrief.intents.some(item => item.intent === 'correct_assistant'));

    if (!closesCorrection || !segments.length) {
      return segments;
    }

    const result = [...segments];
    while (result.length && /[?？]\s*$/u.test(result[result.length - 1])) {
      if (result.length > 1) {
        result.pop();
        continue;
      }

      const segment = result[0];
      const statementEnd = Math.max(
        segment.lastIndexOf('。'),
        segment.lastIndexOf('！'),
        segment.lastIndexOf('!')
      );
      if (statementEnd < 0) {
        break;
      }

      result[0] = segment.slice(0, statementEnd + 1).trim();
      break;
    }

    const filtered = result.filter(Boolean);
    const relationCorrection = userQuery
      .replace(/\s+/gu, '')
      .match(
        /不是我[\u4e00-\u9fff]{1,4}[，,、；;]*(?:他|她|这人|那人)?是我([\u4e00-\u9fff]{1,4})(?:[。！？!?]|$)/u
      )?.[1];
    if (
      relationCorrection &&
      !filtered.some(segment => segment.includes(relationCorrection))
    ) {
      filtered.push(`是你${relationCorrection}`);
    }

    return filtered.length ? filtered : segments;
  }

  private normalizeModelFirstReplySegments(
    segments: string[],
    userQuery = ''
  ): string[] {
    const sanitized = segments
      .map(
        segment =>
          this.inspectAssistantSegmentSanitization(segment, userQuery, {
            dropSemanticRisks: !this.replyGuardrailService,
          }).output
      )
      .filter(Boolean);

    return inspectReplyBubbleStructure(sanitized).segments;
  }

  private extractUsageFromResponse(response: {
    model?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
  }): {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } {
    const model =
      typeof response?.model === 'string' ? response.model.trim() : '';

    return {
      model: model || undefined,
      promptTokens: this.normalizeTokenCount(response?.usage?.prompt_tokens),
      completionTokens: this.normalizeTokenCount(
        response?.usage?.completion_tokens
      ),
      totalTokens: this.normalizeTokenCount(response?.usage?.total_tokens),
    };
  }

  private mergeReplyUsage(
    primary: ReplyUsage,
    additional?: ReplyUsage
  ): ReplyUsage {
    if (!additional) {
      return primary;
    }

    const sum = (
      left: number | undefined,
      right: number | undefined
    ): number | undefined => {
      if (left === undefined && right === undefined) {
        return undefined;
      }

      return (left ?? 0) + (right ?? 0);
    };

    return {
      model: primary.model || additional.model,
      promptTokens: sum(primary.promptTokens, additional.promptTokens),
      completionTokens: sum(
        primary.completionTokens,
        additional.completionTokens
      ),
      totalTokens: sum(primary.totalTokens, additional.totalTokens),
    };
  }

  private parseAssistantReply(
    value?: string,
    allowedToolNames: AgentChatToolName[] = []
  ): ParsedAssistantReply {
    const content = value?.trim();

    if (!content) {
      return {
        segments: [],
        claims: [],
        ...(allowedToolNames.length
          ? { toolDecisions: [], invalidToolDecisionCount: 0 }
          : {}),
      };
    }

    const parsed = this.parseAssistantReplyEnvelope(content);

    const toolDecisionResult = normalizeAgentChatToolDecisions(
      parsed?.toolDecisions,
      allowedToolNames
    );
    return {
      segments: this.parseAssistantReplyCandidates(content),
      claims: this.normalizeAssistantFactClaims(parsed?.claims),
      ...(allowedToolNames.length
        ? {
            toolDecisions: toolDecisionResult.decisions,
            invalidToolDecisionCount: toolDecisionResult.invalidCount,
          }
        : {}),
    };
  }

  private normalizeAssistantFactClaims(value: unknown): AssistantFactClaim[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item): AssistantFactClaim | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const raw = item as Record<string, unknown>;
        const text =
          typeof raw.text === 'string' ? raw.text.trim().slice(0, 160) : '';
        const kind = this.normalizeAssistantFactClaimKind(raw.kind);
        const mode = this.normalizeAssistantFactClaimMode(raw.mode);
        const subjectRef =
          typeof raw.subjectRef === 'string'
            ? raw.subjectRef.trim().slice(0, 64)
            : '';
        const evidenceIds = Array.isArray(raw.evidenceIds)
          ? Array.from(
              new Set(
                raw.evidenceIds
                  .map(id => (typeof id === 'string' ? id.trim() : ''))
                  .filter(Boolean)
              )
            ).slice(0, 8)
          : [];

        if (!text || !kind) {
          return null;
        }

        return {
          text,
          kind,
          mode,
          ...(subjectRef ? { subjectRef } : {}),
          evidenceIds,
        };
      })
      .filter((claim): claim is AssistantFactClaim => Boolean(claim))
      .slice(0, 12);
  }

  private normalizeAssistantFactClaimKind(
    value: unknown
  ): AssistantFactClaimKind | null {
    switch (value) {
      case 'memory':
      case 'identity':
      case 'relationship':
      case 'real_world':
      case 'other':
        return value;
      default:
        return null;
    }
  }

  private normalizeAssistantFactClaimMode(
    value: unknown
  ): AssistantFactClaimMode {
    switch (value) {
      case 'attributed_to_user':
      case 'conversational_uptake':
      case 'autonomous_fact':
      case 'soft_imagination':
        return value;
      default:
        return 'autonomous_fact';
    }
  }

  private parseAssistantReplyCandidates(value?: string): string[] {
    const content = value?.trim();

    if (!content) {
      return [];
    }

    const parsed = this.parseAssistantReplyEnvelope(content);

    if (parsed) {
      const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';

      if (text) {
        return [this.stripAssistantMarkup(text).trim()];
      }

      const rawSegments = Array.isArray(parsed?.segments)
        ? parsed.segments
        : [];
      const segments = rawSegments
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);

      if (segments.length > 0) {
        return segments.map(segment =>
          this.stripAssistantMarkup(segment).trim()
        );
      }
    }

    return this.extractSegmentsFromContent(content);
  }

  private parseAssistantReplyEnvelope(
    content: string
  ): Record<string, unknown> | null {
    const candidates = [content];
    const withoutFence = content
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    if (withoutFence && withoutFence !== content) {
      candidates.push(withoutFence);
    }

    const objectStart = withoutFence.indexOf('{');
    const objectEnd = withoutFence.lastIndexOf('}');

    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(withoutFence.slice(objectStart, objectEnd + 1));
    }

    const repairedKnownKeys = withoutFence.replace(
      /([{,]\s*):?\s*(segments|claims|toolDecisions|text)\s*:/g,
      '$1"$2":'
    );
    if (repairedKnownKeys !== withoutFence) {
      candidates.push(repairedKnownKeys);
    }

    for (const candidate of Array.from(new Set(candidates))) {
      try {
        const parsed = JSON.parse(candidate);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Try the next recoverable envelope, then fall back to plain text.
      }
    }

    return null;
  }

  private extractSegmentsFromContent(value?: string): string[] {
    const content = value?.trim();

    if (!content) {
      return [];
    }

    // 兜底：剥离不完整 JSON 信封（如 {"":["… 或 {"segments":[…）
    const jsonFallback = this.extractTextFromJsonArtifact(content);
    const effectiveContent = jsonFallback ?? content;

    const legacySegments = splitConversationMessageSegments(effectiveContent);

    if (
      legacySegments.length > 1 ||
      (legacySegments.length > 0 &&
        hasConversationMessageSegmentSeparator(effectiveContent))
    ) {
      return legacySegments;
    }

    const paragraphSegments = effectiveContent
      .split(/\n\s*\n+/)
      .map(item => item.trim())
      .filter(Boolean);

    if (paragraphSegments.length > 1) {
      return paragraphSegments;
    }

    return [effectiveContent];
  }

  // 从不完整/畸形的 JSON 信封中提取纯文本正文
  private extractTextFromJsonArtifact(value?: string): string | undefined {
    const content = value?.trim();
    if (!content || !content.startsWith('{')) return undefined;

    // {"":["text"…  — 空键数组格式
    const emptyKeyMatch = /\{"":\s*\[?\s*"([^"]+)/.exec(content);
    if (emptyKeyMatch?.[1]) {
      return emptyKeyMatch[1].trim();
    }

    // {"segments":["text"… or {"text":"text"…
    const namedMatch = /\{"(?:segments|text)"\s*:\s*\[?\s*"([^"]+)/.exec(
      content
    );
    if (namedMatch?.[1]) {
      return namedMatch[1].trim();
    }

    // {"anyKey":"value"}
    const simpleMatch = /^\{\s*"[^"]*"\s*:\s*"([^"]+)"/.exec(content);
    if (simpleMatch?.[1]) {
      return simpleMatch[1].trim();
    }

    return undefined;
  }

  // 从纯文本中提取中文句子（兜底提取，处理模型返回畸形JSON的场景）
  private extractChineseTextSegments(value?: string): string[] {
    const content = value?.trim();
    if (!content) return [];

    // 匹配连续中文（含常见标点）片段，排除纯JSON语法字符
    const matches = content.match(
      /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u300c\u300d\u300e\u300f\u3010\u3011\u300a\u300b\uff08\uff09\u201c\u201d\u2018\u2019\u3001\uff0c\u3002\uff1b\uff1a\uff1f\uff01\u2026\u2014\uff5e]+/g
    );
    if (!matches || matches.length === 0) return [];

    // 过滤掉太短的片段和JSON残留
    const MIN_CHINESE_CHARS = 2;
    const jsonKeywords = [
      'segments',
      'claims',
      'toolDecisions',
      'text',
      'type',
      'kind',
      'mode',
      'source',
      'id',
    ];
    return matches
      .map(m => m.trim())
      .filter(m => {
        const chineseChars = m.replace(/[^一-鿿]/g, '').length;
        if (chineseChars < MIN_CHINESE_CHARS) return false;
        const lower = m.toLowerCase();
        return jsonKeywords.every(kw => !lower.includes(kw));
      });
  }

  private sanitizeAssistantSegment(value?: string, userQuery = ''): string {
    return this.inspectAssistantSegmentSanitization(value, userQuery).output;
  }

  private sanitizeAssistantSegmentsForFinalOutput(
    segments: string[],
    userQuery = ''
  ): string[] {
    const sanitized = inspectReplyBubbleStructure(
      segments
        .map(
          segment =>
            this.inspectAssistantSegmentSanitization(segment, userQuery, {
              dropSemanticRisks: true,
            }).output
        )
        .filter(Boolean)
    ).segments;

    return sanitized.length ? sanitized : [ASSISTANT_REPLY_FAILED_CONTENT];
  }

  private inspectAssistantSegmentSanitization(
    value?: string,
    userQuery = '',
    options: {
      dropSemanticRisks?: boolean;
    } = {}
  ): AssistantSegmentSanitizationTrace {
    const content = value?.trim() || '';

    if (!content) {
      return {
        input: '',
        normalized: '',
        output: '',
        dropped: true,
        messageSafetyMatches: [],
        presenceSafetyMatches: [],
      };
    }

    let normalized = this.stripAssistantMarkup(content);
    normalized = stripPromptLeakageContent(normalized);
    normalized = this.stripAssistantStageDirection(normalized);
    normalized = normalized.replace(DISCOURAGED_ASSISTANT_EMOJI_PATTERN, '');
    normalized = normalized.replace(/^(?:人|助手|回复)\s*[：:，,、-]?\s*/, '');
    const hasChinese = /[\u3400-\u9FFF]/.test(normalized);

    if (hasChinese) {
      normalized = normalized.replace(
        /(^|[\s，。！？、；：,.!?;:（）()【】[\]'"“”‘’<>《》-])([A-Za-z]{2,})(?=$|[\s，。！？、；：,.!?;:（）()【】[\]'"“”‘’<>《》-])/g,
        (_, prefix: string) => prefix
      );
    }

    normalized = normalized
      .replace(/^[，。！？、；：,.!?;:]+/, '')
      .replace(/[，。；：,.;:]+$/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([，。！？、；：])/g, '$1')
      .replace(/([（【《“‘])\s+/g, '$1')
      .replace(/\s+([）】》”’])/g, '$1')
      .trim();

    const messageSafetyMatches =
      findUnsafeAssistantMessageContentMatches(normalized);
    const presenceSafetyMatches = this.findUnsafeAssistantPresenceClaimMatches(
      normalized,
      userQuery
    );
    const structuralSafetyMatches = messageSafetyMatches.filter(match =>
      [
        'url',
        'media_file',
        'legacy_media_path',
        'prompt_leakage',
        'technical_fragment',
      ].includes(match.rule)
    );
    const semanticSafetyMatches = messageSafetyMatches.filter(
      match => !structuralSafetyMatches.includes(match)
    );
    const dropped =
      structuralSafetyMatches.length > 0 ||
      (options.dropSemanticRisks === true &&
        (semanticSafetyMatches.length > 0 || presenceSafetyMatches.length > 0));

    return {
      input: content,
      normalized,
      output: dropped ? '' : normalized,
      dropped,
      messageSafetyMatches,
      presenceSafetyMatches,
    };
  }

  private stripAssistantMarkup(value: string): string {
    return (
      stripConversationMessageSegmentMarkup(value)
        .replace(/<\/?fense\s*>/gi, ' ')
        .replace(/<\/?fense(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/gi, ' ')
        .replace(/<\/?fenge\s*>/gi, ' ')
        .replace(/<\/?fenge(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/gi, ' ')
        .replace(
          /<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?:\s+[^<>]*)?>/g,
          ' '
        )
        .replace(
          /<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/g,
          ' '
        )
        // 身份前缀：作为{名称}[，]{你}[…]说： → 只保留实际内容
        // 变体：作为XX，你说： / 作为XX，说： / 作为XX，你轻声说：
        .replace(
          /^作为[\u4e00-\u9fff\w·-]{1,20}[，,]?\s*(?:你[\u4e00-\u9fff\s，,]{0,12})?说[：:]\s*/g,
          ''
        )
    );
  }

  private findUnsafeAssistantPresenceClaimMatches(
    value: string,
    userQuery = ''
  ): AssistantPresenceSafetyMatch[] {
    const primaryScene = routeReplyScene({
      currentQuery: userQuery,
    }).primaryScene?.scene;
    const valueToCheck =
      primaryScene === 'dream_companionship'
        ? value.replace(/(?:梦里|梦中)[^，。！？!?]{0,48}/g, '')
        : primaryScene === 'afterlife_status' &&
          !/(?:现实|醒来|醒着|屋里|房间|床边|身边|旁边|这里|这儿)/.test(value)
        ? value.replace(
            /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,20}(?:看见|看到|看着|看在眼里)[^，。！？!?]{0,20}/g,
            ''
          )
        : value;

    const matches: AssistantPresenceSafetyMatch[] = [];

    UNSAFE_ASSISTANT_PRESENCE_PATTERNS.forEach((pattern, patternIndex) => {
      const match = pattern.exec(valueToCheck);
      pattern.lastIndex = 0;

      if (match?.[0]) {
        matches.push({
          patternIndex,
          pattern: pattern.source,
          matchedText: match[0],
        });
      }
    });

    return matches;
  }

  private stripAssistantStageDirection(value: string): string {
    return value
      .replace(
        /^\s*[（(【[]\s*(?:声音|语气|动作|神情|表情|轻声|温柔|温和|哽咽|微笑|叹气|沉默|带着)[^）)】\]]{0,32}[）)】\]]\s*/,
        ''
      )
      .trim();
  }

  private buildReplyRoutingMessageFields(routing?: ReplyRoutingAudit): {
    replyIntentTarget?: string;
    replyIntentTimeScope?: string;
    replyIntent?: string;
    replyIntentSubIntent?: string;
    replyIntentSecondary?: string[];
    replyIntents?: MessageEntity['replyIntents'];
    replyIntentConfidence?: number;
    replyIntentSource?: string;
    replyPlanningMode?: string;
    replyPlanningReason?: string;
    replyIntentModelCallCount?: number;
    replyScene?: string;
    replySecondaryScenes?: string[];
    replyRoutingSource?: string;
    replyBriefVersion?: string;
    replyTurnContractVersion?: string;
    replyTurnContractFocusDimensions?: string[];
    replyBriefMode?: string;
    replyBriefStrictGrounding?: boolean;
    replyBriefFactClaimMode?: string;
    replyBriefMaxSegments?: number;
    replyBriefComplexityHint?: string;
    replyBriefTurnClosure?: string;
    replyBriefLengthClass?: string;
    replyBriefTargetCharacters?: number;
    replyBriefReviewCharacters?: number;
    replyRelationshipSignals?: string[];
    replyFallbackSource?: string;
    replyGenerationFailureStage?: string;
    replyGenerationFailureCode?: string;
    replyGenerationRecoveryAttempted?: boolean;
    replyGenerationRecoverySucceeded?: boolean;
    replyBubbleReflowAttempted?: boolean;
    replyBubbleReflowSucceeded?: boolean;
    replyBubbleStructureIssues?: string[];
    replyGuardrailRewritten?: boolean;
    replyGuardrailReason?: string;
    replyGuardrailInterventionLevel?: string;
    replyGuardrailRevisionAttempted?: boolean;
    replyGuardrailRevisionRoundCount?: number;
    replyGuardrailFinalReviewResult?: string;
    replyGuardrailReviewMode?: string;
    replyGuardrailFocuses?: string[];
    replyQualityAuditVersion?: string;
    replyQualityActivatedDimensions?: string[];
    replyQualityInitialFailedDimensions?: string[];
    replyQualityFinalFailedDimensions?: string[];
    replyQualityRecoveredDimensions?: string[];
    replyContentEchoPassed?: boolean;
    replyContentEchoUnitCount?: number;
    replyEvidenceCount?: number;
    replyFactClaimCount?: number;
    replyUnsupportedClaimCount?: number;
    replyPromptVersion?: string;
    replySystemPromptCharacters?: number;
    replyHistoryMessageCount?: number;
    replyRelevantMemoryCount?: number;
    replyConversationReadingAnchorCount?: number;
    replyStrategyVersion?: string;
    replyStrategySource?: string;
    replyParticipationStrategy?: string;
    replyParticipationExecution?: string;
    replyParticipationFallbackReason?: string;
    replyConversationStance?: string;
    replyConversationStanceTarget?: string;
    replyConversationMoves?: string[];
    replyConversationMoveGoals?: string[];
    replySocialStrategy?: string;
    replyStrategyPurpose?: string;
    replyQuestionNeed?: string;
    replyConversationTurnClosure?: string;
    replyUserConversationState?: string;
    replyOpenLoop?: string;
    replyContinuationGoal?: string;
    replyAssistantContribution?: string;
    replyMustContribute?: string;
    replyAvoidRepeatingMove?: string;
    replyClosureReadiness?: string;
    replyPersonaActivations?: string[];
    replyPersonaSource?: string;
    replyRealityDependencyKinds?: string[];
    replyCorrectionFactMode?: string;
    replyActiveContributionSource?: string;
    replyStrategyRepeatedMoves?: string[];
    replyStrategyAlternative?: string;
    replyCareMotive?: string;
    replyCareFocus?: string;
    replyCareStyleSource?: string;
    replyDreamPlan?: MessageEntity['replyDreamPlan'];
    replyStateProtocol?: MessageEntity['replyStateProtocol'];
    replyExperiencePlanVersion?: string;
    replyProfileTier?: string;
    replyProfileScore?: number;
    replyProfileDimensionCount?: number;
    replyProfileTrustedFactCount?: number;
    replyRelationshipStage?: string;
    replyRelationshipMaturity?: string;
    replyRelationshipState?: string;
    replyRelationshipUserTurnCount?: number;
    replyRelationshipActiveDayCount?: number;
    replyConversationDepth?: string;
    replyExperienceFactScope?: string;
    replyExperienceIntimacyLevel?: string;
    replyExperienceContributionMode?: string;
    replyExperienceMemoryPolicy?: string;
    replyExperienceQuestionPolicy?: string;
    replyExperienceClosurePolicy?: string;
    replyMemoryPlan?: MessageEntity['replyMemoryPlan'];
    replyMemoryCandidateCount?: number;
    replyMemorySelectedCandidateKeys?: string[];
    replyMemoryRetrievalMode?: string;
    replyMemoryRetrievalRequestCount?: number;
    replyMemoryRetrievalConceptCount?: number;
    replyMemoryRetrievedEvidenceCount?: number;
    replyMemoryUsedEvidenceIds?: string[];
    replyMemoryUsedClaimCount?: number;
  } {
    const responseIntents = routing?.route?.responseIntents?.length
      ? routing.route.responseIntents
      : routing?.intent?.intents;
    const primaryIntent = responseIntents?.[0];

    return {
      replyIntentTarget: primaryIntent?.target,
      replyIntentTimeScope: primaryIntent?.timeScope,
      replyIntent: primaryIntent?.intent,
      replyIntentSubIntent: primaryIntent?.subIntent,
      replyIntentSecondary: responseIntents?.slice(1).map(item => item.intent),
      replyIntents: responseIntents?.map(item => ({ ...item })),
      replyIntentConfidence: routing?.intent?.confidence,
      replyIntentSource: routing?.intent?.source,
      replyPlanningMode: routing?.replyPlanningMode?.trim() || undefined,
      replyPlanningReason: routing?.replyPlanningReason?.trim() || undefined,
      replyIntentModelCallCount: routing?.replyIntentModelCallCount,
      replyScene: routing?.route?.primaryScene?.scene,
      replySecondaryScenes: routing?.route?.secondaryScenes.map(
        scene => scene.scene
      ),
      replyRoutingSource: routing?.route?.routingSource,
      replyBriefVersion: routing?.brief?.version,
      replyTurnContractVersion:
        routing?.turnContractVersion?.trim() || undefined,
      replyTurnContractFocusDimensions:
        routing?.turnContractFocusDimensions?.filter(Boolean),
      replyBriefMode: routing?.brief?.mode,
      replyBriefStrictGrounding: routing?.brief?.strictGrounding,
      replyBriefFactClaimMode: routing?.brief?.factClaimMode,
      replyBriefMaxSegments: routing?.brief?.bubblePlan?.maxSegments,
      replyBriefComplexityHint: routing?.brief?.bubblePlan?.complexityHint,
      replyBriefTurnClosure: routing?.brief?.bubblePlan?.turnClosure,
      replyBriefLengthClass: routing?.brief?.lengthPlan?.lengthClass,
      replyBriefTargetCharacters: routing?.brief?.lengthPlan?.targetCharacters,
      replyBriefReviewCharacters: routing?.brief?.lengthPlan?.reviewCharacters,
      replyRelationshipSignals: routing?.brief?.relationshipContext?.map(
        item => item.key
      ),
      replyFallbackSource: routing?.fallbackSource?.trim() || undefined,
      replyGenerationFailureStage:
        routing?.generationFailureStage?.trim() || undefined,
      replyGenerationFailureCode:
        routing?.generationFailureCode?.trim() || undefined,
      replyGenerationRecoveryAttempted:
        typeof routing?.generationRecoveryAttempted === 'boolean'
          ? routing.generationRecoveryAttempted
          : undefined,
      replyGenerationRecoverySucceeded:
        typeof routing?.generationRecoverySucceeded === 'boolean'
          ? routing.generationRecoverySucceeded
          : undefined,
      replyBubbleReflowAttempted:
        typeof routing?.bubbleReflowAttempted === 'boolean'
          ? routing.bubbleReflowAttempted
          : undefined,
      replyBubbleReflowSucceeded:
        typeof routing?.bubbleReflowSucceeded === 'boolean'
          ? routing.bubbleReflowSucceeded
          : undefined,
      replyBubbleStructureIssues: routing?.bubbleStructureIssues?.length
        ? routing.bubbleStructureIssues
        : undefined,
      replyGuardrailRewritten:
        typeof routing?.guardrailRewritten === 'boolean'
          ? routing.guardrailRewritten
          : undefined,
      replyGuardrailReason: routing?.guardrailReason?.trim() || undefined,
      replyGuardrailInterventionLevel:
        routing?.guardrailInterventionLevel?.trim() || undefined,
      replyGuardrailRevisionAttempted:
        typeof routing?.guardrailRevisionAttempted === 'boolean'
          ? routing.guardrailRevisionAttempted
          : undefined,
      replyGuardrailRevisionRoundCount: routing?.guardrailRevisionRoundCount,
      replyGuardrailFinalReviewResult:
        routing?.guardrailFinalReviewResult?.trim() || undefined,
      replyGuardrailReviewMode:
        routing?.guardrailReviewMode?.trim() || undefined,
      replyGuardrailFocuses: routing?.guardrailFocuses?.filter(Boolean),
      replyQualityAuditVersion:
        routing?.qualityAuditVersion?.trim() || undefined,
      replyQualityActivatedDimensions:
        routing?.qualityActivatedDimensions?.filter(Boolean),
      replyQualityInitialFailedDimensions:
        routing?.qualityInitialFailedDimensions?.filter(Boolean),
      replyQualityFinalFailedDimensions:
        routing?.qualityFinalFailedDimensions?.filter(Boolean),
      replyQualityRecoveredDimensions:
        routing?.qualityRecoveredDimensions?.filter(Boolean),
      replyContentEchoPassed:
        typeof routing?.contentEchoPassed === 'boolean'
          ? routing.contentEchoPassed
          : undefined,
      replyContentEchoUnitCount:
        typeof routing?.contentEchoUnitCount === 'number'
          ? routing.contentEchoUnitCount
          : undefined,
      replyEvidenceCount: routing?.evidenceCount,
      replyFactClaimCount: routing?.factClaimCount,
      replyUnsupportedClaimCount: routing?.unsupportedClaimCount,
      replyPromptVersion: routing?.promptVersion?.trim() || undefined,
      replySystemPromptCharacters: routing?.systemPromptCharacters,
      replyHistoryMessageCount: routing?.historyMessageCount,
      replyRelevantMemoryCount: routing?.relevantMemoryCount,
      replyConversationReadingAnchorCount:
        routing?.conversationReadingAnchorCount,
      replyStrategyVersion: routing?.strategyVersion?.trim() || undefined,
      replyStrategySource: routing?.strategySource?.trim() || undefined,
      replyParticipationStrategy:
        routing?.participationStrategy?.trim() || undefined,
      replyParticipationExecution:
        routing?.participationExecution?.trim() || undefined,
      replyParticipationFallbackReason:
        routing?.participationFallbackReason?.trim() || undefined,
      replyConversationStance: routing?.conversationStance?.trim() || undefined,
      replyConversationStanceTarget:
        routing?.conversationStanceTarget?.trim() || undefined,
      replyConversationMoves: routing?.conversationMoves?.filter(Boolean),
      replyConversationMoveGoals:
        routing?.conversationMoveGoals?.filter(Boolean),
      replySocialStrategy: routing?.socialStrategy?.trim() || undefined,
      replyStrategyPurpose: routing?.strategyPurpose?.trim() || undefined,
      replyQuestionNeed: routing?.questionNeed?.trim() || undefined,
      replyConversationTurnClosure:
        routing?.conversationTurnClosure?.trim() || undefined,
      replyUserConversationState:
        routing?.userConversationState?.trim() || undefined,
      replyOpenLoop: routing?.openLoop?.trim() || undefined,
      replyContinuationGoal: routing?.continuationGoal?.trim() || undefined,
      replyAssistantContribution:
        routing?.assistantContribution?.trim() || undefined,
      replyMustContribute: routing?.mustContribute?.trim() || undefined,
      replyAvoidRepeatingMove: routing?.avoidRepeatingMove?.trim() || undefined,
      replyClosureReadiness: routing?.closureReadiness?.trim() || undefined,
      replyPersonaActivations: routing?.personaActivations?.filter(Boolean),
      replyPersonaSource: routing?.personaSource?.trim() || undefined,
      replyRealityDependencyKinds:
        routing?.realityDependencyKinds?.filter(Boolean),
      replyCorrectionFactMode: routing?.correctionFactMode?.trim() || undefined,
      replyActiveContributionSource:
        routing?.activeContributionSource?.trim() || undefined,
      replyStrategyRepeatedMoves:
        routing?.strategyRepeatedMoves?.filter(Boolean),
      replyStrategyAlternative:
        routing?.strategyAlternative?.trim() || undefined,
      replyCareMotive:
        routing?.brief?.careMotivation?.motive ||
        routing?.careMotive?.trim() ||
        undefined,
      replyCareFocus:
        routing?.brief?.careMotivation?.focus ||
        routing?.careFocus?.trim() ||
        undefined,
      replyCareStyleSource:
        routing?.brief?.careMotivation?.styleSource ||
        routing?.careStyleSource?.trim() ||
        undefined,
      replyDreamPlan:
        routing?.brief?.dreamCompanionPlan || routing?.dreamCompanionPlan,
      replyStateProtocol:
        routing?.brief?.stateProtocol || routing?.stateProtocolPlan,
      replyExperiencePlanVersion:
        routing?.brief?.experiencePlan?.version ||
        routing?.experiencePlanVersion?.trim() ||
        undefined,
      replyProfileTier:
        routing?.brief?.experiencePlan?.profileTier ||
        routing?.profileTier?.trim() ||
        undefined,
      replyProfileScore: routing?.brief?.experiencePlan?.profileScore,
      replyProfileDimensionCount:
        routing?.brief?.experiencePlan?.profileDimensionCount,
      replyProfileTrustedFactCount:
        routing?.brief?.experiencePlan?.profileTrustedFactCount,
      replyRelationshipStage:
        routing?.brief?.experiencePlan?.relationshipStage ||
        routing?.relationshipStage?.trim() ||
        undefined,
      replyRelationshipMaturity:
        routing?.brief?.experiencePlan?.relationshipMaturity,
      replyRelationshipState: routing?.brief?.experiencePlan?.relationshipState,
      replyRelationshipUserTurnCount:
        routing?.brief?.experiencePlan?.relationshipUserTurnCount,
      replyRelationshipActiveDayCount:
        routing?.brief?.experiencePlan?.relationshipActiveDayCount,
      replyConversationDepth:
        routing?.brief?.experiencePlan?.conversationDepth ||
        routing?.conversationDepth?.trim() ||
        undefined,
      replyExperienceFactScope: routing?.brief?.experiencePlan?.factScope,
      replyExperienceIntimacyLevel:
        routing?.brief?.experiencePlan?.intimacyLevel,
      replyExperienceContributionMode:
        routing?.brief?.experiencePlan?.contributionMode,
      replyExperienceMemoryPolicy: routing?.brief?.experiencePlan?.memoryPolicy,
      replyExperienceQuestionPolicy:
        routing?.brief?.experiencePlan?.questionPolicy,
      replyExperienceClosurePolicy:
        routing?.brief?.experiencePlan?.closurePolicy,
      replyMemoryPlan: routing?.memoryPlan
        ? {
            need: routing.memoryPlan.need,
            contextCoverage: routing.memoryPlan.contextCoverage,
            missingConcepts: [...routing.memoryPlan.missingConcepts],
            queries: routing.memoryPlan.queries.map(query => ({ ...query })),
            selectedFactKeys: routing.memoryPlan.selectedFactKeys
              ? [...routing.memoryPlan.selectedFactKeys]
              : undefined,
          }
        : undefined,
      replyMemoryCandidateCount: routing?.memoryCandidateCount,
      replyMemorySelectedCandidateKeys:
        routing?.memorySelectedCandidateKeys?.filter(Boolean),
      replyMemoryRetrievalMode:
        routing?.memoryRetrievalMode?.trim() || undefined,
      replyMemoryRetrievalRequestCount: routing?.memoryRetrievalRequestCount,
      replyMemoryRetrievalConceptCount: routing?.memoryRetrievalConceptCount,
      replyMemoryRetrievedEvidenceCount: routing?.memoryRetrievedEvidenceCount,
      replyMemoryUsedEvidenceIds:
        routing?.memoryUsedEvidenceIds?.filter(Boolean),
      replyMemoryUsedClaimCount: routing?.memoryUsedClaimCount,
    };
  }

  private async saveMessage(options: {
    conversationId: MongoObjectId;
    userId: MongoObjectId;
    agentId: MongoObjectId;
    role: MessageRole;
    type: MessageType;
    content: string;
    status: MessageStatus;
    replyGroupId?: string;
    replySegmentIndex?: number;
    clientRequestId?: string;
    traceId?: string;
    quotedMessageId?: MongoObjectId;
    quotedMessageRole?: MessageRole;
    quotedMessageContent?: string;
    mediaObjectKey?: string;
    mediaUrl?: string;
    mediaMimeType?: string;
    mediaAnalysis?: string;
    mediaTranscript?: string;
    mediaDurationMs?: number;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    replyVisibleCharacters?: number;
    replyIntentTarget?: string;
    replyIntentTimeScope?: string;
    replyIntent?: string;
    replyIntentSubIntent?: string;
    replyIntentSecondary?: string[];
    replyIntents?: MessageEntity['replyIntents'];
    replyIntentConfidence?: number;
    replyIntentSource?: string;
    replyPlanningMode?: string;
    replyPlanningReason?: string;
    replyIntentModelCallCount?: number;
    replyScene?: string;
    replySecondaryScenes?: string[];
    replyRoutingSource?: string;
    replyBriefVersion?: string;
    replyTurnContractVersion?: string;
    replyTurnContractFocusDimensions?: string[];
    replyBriefMode?: string;
    replyBriefStrictGrounding?: boolean;
    replyBriefFactClaimMode?: string;
    replyBriefMaxSegments?: number;
    replyBriefComplexityHint?: string;
    replyBriefTurnClosure?: string;
    replyBriefLengthClass?: string;
    replyBriefTargetCharacters?: number;
    replyBriefReviewCharacters?: number;
    replyRelationshipSignals?: string[];
    replyFallbackSource?: string;
    replyGenerationFailureStage?: string;
    replyGenerationFailureCode?: string;
    replyGenerationRecoveryAttempted?: boolean;
    replyGenerationRecoverySucceeded?: boolean;
    replyBubbleReflowAttempted?: boolean;
    replyBubbleReflowSucceeded?: boolean;
    replyBubbleStructureIssues?: string[];
    replyGuardrailRewritten?: boolean;
    replyGuardrailReason?: string;
    replyGuardrailInterventionLevel?: string;
    replyGuardrailRevisionAttempted?: boolean;
    replyGuardrailRevisionRoundCount?: number;
    replyGuardrailFinalReviewResult?: string;
    replyGuardrailReviewMode?: string;
    replyGuardrailFocuses?: string[];
    replyQualityAuditVersion?: string;
    replyQualityActivatedDimensions?: string[];
    replyQualityInitialFailedDimensions?: string[];
    replyQualityFinalFailedDimensions?: string[];
    replyQualityRecoveredDimensions?: string[];
    replyEvidenceCount?: number;
    replyFactClaimCount?: number;
    replyUnsupportedClaimCount?: number;
    replyPromptVersion?: string;
    replySystemPromptCharacters?: number;
    replyHistoryMessageCount?: number;
    replyRelevantMemoryCount?: number;
    replyConversationReadingAnchorCount?: number;
    replyStrategyVersion?: string;
    replyStrategySource?: string;
    replyParticipationStrategy?: string;
    replyParticipationExecution?: string;
    replyParticipationFallbackReason?: string;
    replyConversationStance?: string;
    replyConversationStanceTarget?: string;
    replyConversationMoves?: string[];
    replyConversationMoveGoals?: string[];
    replySocialStrategy?: string;
    replyStrategyPurpose?: string;
    replyQuestionNeed?: string;
    replyConversationTurnClosure?: string;
    replyUserConversationState?: string;
    replyOpenLoop?: string;
    replyContinuationGoal?: string;
    replyAssistantContribution?: string;
    replyMustContribute?: string;
    replyAvoidRepeatingMove?: string;
    replyClosureReadiness?: string;
    replyPersonaActivations?: string[];
    replyPersonaSource?: string;
    replyRealityDependencyKinds?: string[];
    replyCorrectionFactMode?: string;
    replyActiveContributionSource?: string;
    replyStrategyRepeatedMoves?: string[];
    replyStrategyAlternative?: string;
    replyCareMotive?: string;
    replyCareFocus?: string;
    replyCareStyleSource?: string;
    replyDreamPlan?: MessageEntity['replyDreamPlan'];
    replyStateProtocol?: MessageEntity['replyStateProtocol'];
    replyExperiencePlanVersion?: string;
    replyProfileTier?: string;
    replyProfileScore?: number;
    replyProfileDimensionCount?: number;
    replyProfileTrustedFactCount?: number;
    replyRelationshipStage?: string;
    replyRelationshipMaturity?: string;
    replyRelationshipState?: string;
    replyRelationshipUserTurnCount?: number;
    replyRelationshipActiveDayCount?: number;
    replyConversationDepth?: string;
    replyExperienceFactScope?: string;
    replyExperienceIntimacyLevel?: string;
    replyExperienceContributionMode?: string;
    replyExperienceMemoryPolicy?: string;
    replyExperienceQuestionPolicy?: string;
    replyExperienceClosurePolicy?: string;
    replyMemoryPlan?: MessageEntity['replyMemoryPlan'];
    replyMemoryCandidateCount?: number;
    replyMemorySelectedCandidateKeys?: string[];
    replyMemoryRetrievalMode?: string;
    replyMemoryRetrievalRequestCount?: number;
    replyMemoryRetrievalConceptCount?: number;
    replyMemoryRetrievedEvidenceCount?: number;
    replyMemoryUsedEvidenceIds?: string[];
    replyMemoryUsedClaimCount?: number;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<MessageEntity> {
    const message = new MessageEntity();
    message.conversationId = options.conversationId;
    message.userId = options.userId;
    message.agentId = options.agentId;
    message.role = options.role;
    message.type = options.type;
    message.content = options.content;
    message.status = options.status;
    message.replyGroupId = options.replyGroupId?.trim() || '';
    message.replySegmentIndex =
      typeof options.replySegmentIndex === 'number' &&
      Number.isFinite(options.replySegmentIndex) &&
      options.replySegmentIndex >= 0
        ? Math.floor(options.replySegmentIndex)
        : undefined;
    message.clientRequestId = options.clientRequestId?.trim() || undefined;
    message.traceId =
      options.traceId?.trim() || this.chatTraceService?.getCurrentTraceId();
    message.quotedMessageId = options.quotedMessageId;
    message.quotedMessageRole = options.quotedMessageRole;
    message.quotedMessageContent = options.quotedMessageContent?.trim() || '';
    message.mediaObjectKey = options.mediaObjectKey?.trim() || '';
    message.mediaUrl = options.mediaUrl?.trim() || '';
    message.mediaMimeType = options.mediaMimeType?.trim() || '';
    message.mediaAnalysis = options.mediaAnalysis?.trim() || '';
    message.mediaTranscript = options.mediaTranscript?.trim() || '';
    message.mediaDurationMs = this.normalizeVoiceDuration(
      options.mediaDurationMs
    );
    message.model = options.model?.trim() || '';
    message.promptTokens = this.normalizeTokenCount(options.promptTokens);
    message.completionTokens = this.normalizeTokenCount(
      options.completionTokens
    );
    message.totalTokens = this.normalizeTokenCount(options.totalTokens);
    message.replyVisibleCharacters = this.normalizeTokenCount(
      options.replyVisibleCharacters
    );
    message.replyIntentTarget = options.replyIntentTarget?.trim() || undefined;
    message.replyIntentTimeScope =
      options.replyIntentTimeScope?.trim() || undefined;
    message.replyIntent = options.replyIntent?.trim() || undefined;
    message.replyIntentSubIntent =
      options.replyIntentSubIntent?.trim() || undefined;
    message.replyIntentSecondary =
      options.replyIntentSecondary?.filter(Boolean);
    message.replyIntents = options.replyIntents?.map(item => ({ ...item }));
    message.replyIntentConfidence = this.normalizeConfidence(
      options.replyIntentConfidence
    );
    message.replyIntentSource = options.replyIntentSource?.trim() || undefined;
    message.replyPlanningMode = options.replyPlanningMode?.trim() || undefined;
    message.replyPlanningReason =
      options.replyPlanningReason?.trim() || undefined;
    message.replyIntentModelCallCount = this.normalizeTokenCount(
      options.replyIntentModelCallCount
    );
    message.replyScene = options.replyScene?.trim() || undefined;
    message.replySecondaryScenes =
      options.replySecondaryScenes?.filter(Boolean);
    message.replyRoutingSource =
      options.replyRoutingSource?.trim() || undefined;
    message.replyBriefVersion = options.replyBriefVersion?.trim() || undefined;
    Object.assign(message, {
      replyTurnContractVersion:
        options.replyTurnContractVersion?.trim() || undefined,
      replyTurnContractFocusDimensions:
        options.replyTurnContractFocusDimensions?.filter(Boolean),
    });
    message.replyBriefMode = options.replyBriefMode?.trim() || undefined;
    message.replyBriefStrictGrounding = options.replyBriefStrictGrounding;
    message.replyBriefFactClaimMode =
      options.replyBriefFactClaimMode?.trim() || undefined;
    message.replyBriefMaxSegments = this.normalizeTokenCount(
      options.replyBriefMaxSegments
    );
    message.replyBriefComplexityHint =
      options.replyBriefComplexityHint?.trim() || undefined;
    message.replyBriefTurnClosure =
      options.replyBriefTurnClosure?.trim() || undefined;
    message.replyBriefLengthClass =
      options.replyBriefLengthClass?.trim() || undefined;
    message.replyBriefTargetCharacters = this.normalizeTokenCount(
      options.replyBriefTargetCharacters
    );
    message.replyBriefReviewCharacters = this.normalizeTokenCount(
      options.replyBriefReviewCharacters
    );
    message.replyRelationshipSignals =
      options.replyRelationshipSignals?.filter(Boolean);
    message.replyFallbackSource =
      options.replyFallbackSource?.trim() || undefined;
    message.replyGenerationFailureStage =
      options.replyGenerationFailureStage?.trim() || undefined;
    message.replyGenerationFailureCode =
      options.replyGenerationFailureCode?.trim() || undefined;
    message.replyGenerationRecoveryAttempted =
      options.replyGenerationRecoveryAttempted;
    message.replyGenerationRecoverySucceeded =
      options.replyGenerationRecoverySucceeded;
    message.replyBubbleReflowAttempted = options.replyBubbleReflowAttempted;
    message.replyBubbleReflowSucceeded = options.replyBubbleReflowSucceeded;
    message.replyBubbleStructureIssues =
      options.replyBubbleStructureIssues?.filter(Boolean);
    message.replyGuardrailRewritten = options.replyGuardrailRewritten;
    message.replyGuardrailReason =
      options.replyGuardrailReason?.trim() || undefined;
    message.replyGuardrailInterventionLevel =
      options.replyGuardrailInterventionLevel?.trim() || undefined;
    message.replyGuardrailRevisionAttempted =
      options.replyGuardrailRevisionAttempted;
    message.replyGuardrailRevisionRoundCount = this.normalizeTokenCount(
      options.replyGuardrailRevisionRoundCount
    );
    message.replyGuardrailFinalReviewResult =
      options.replyGuardrailFinalReviewResult?.trim() || undefined;
    message.replyGuardrailReviewMode =
      options.replyGuardrailReviewMode?.trim() || undefined;
    message.replyGuardrailFocuses =
      options.replyGuardrailFocuses?.filter(Boolean);
    Object.assign(message, {
      replyQualityAuditVersion:
        options.replyQualityAuditVersion?.trim() || undefined,
      replyQualityActivatedDimensions:
        options.replyQualityActivatedDimensions?.filter(Boolean),
      replyQualityInitialFailedDimensions:
        options.replyQualityInitialFailedDimensions?.filter(Boolean),
      replyQualityFinalFailedDimensions:
        options.replyQualityFinalFailedDimensions?.filter(Boolean),
      replyQualityRecoveredDimensions:
        options.replyQualityRecoveredDimensions?.filter(Boolean),
    });
    message.replyEvidenceCount = this.normalizeTokenCount(
      options.replyEvidenceCount
    );
    message.replyFactClaimCount = this.normalizeTokenCount(
      options.replyFactClaimCount
    );
    message.replyUnsupportedClaimCount = this.normalizeTokenCount(
      options.replyUnsupportedClaimCount
    );
    message.replyPromptVersion =
      options.replyPromptVersion?.trim() || undefined;
    message.replySystemPromptCharacters = this.normalizeTokenCount(
      options.replySystemPromptCharacters
    );
    message.replyHistoryMessageCount = this.normalizeTokenCount(
      options.replyHistoryMessageCount
    );
    message.replyRelevantMemoryCount = this.normalizeTokenCount(
      options.replyRelevantMemoryCount
    );
    message.replyConversationReadingAnchorCount = this.normalizeTokenCount(
      options.replyConversationReadingAnchorCount
    );
    message.replyStrategyVersion =
      options.replyStrategyVersion?.trim() || undefined;
    message.replyStrategySource =
      options.replyStrategySource?.trim() || undefined;
    message.replyParticipationStrategy =
      options.replyParticipationStrategy?.trim() || undefined;
    message.replyParticipationExecution =
      options.replyParticipationExecution?.trim() || undefined;
    message.replyParticipationFallbackReason =
      options.replyParticipationFallbackReason?.trim() || undefined;
    message.replyConversationStance =
      options.replyConversationStance?.trim() || undefined;
    message.replyConversationStanceTarget =
      options.replyConversationStanceTarget?.trim() || undefined;
    message.replyConversationMoves =
      options.replyConversationMoves?.filter(Boolean);
    message.replyConversationMoveGoals =
      options.replyConversationMoveGoals?.filter(Boolean);
    message.replySocialStrategy =
      options.replySocialStrategy?.trim() || undefined;
    message.replyStrategyPurpose =
      options.replyStrategyPurpose?.trim() || undefined;
    message.replyQuestionNeed = options.replyQuestionNeed?.trim() || undefined;
    message.replyConversationTurnClosure =
      options.replyConversationTurnClosure?.trim() || undefined;
    message.replyUserConversationState =
      options.replyUserConversationState?.trim() || undefined;
    message.replyOpenLoop = options.replyOpenLoop?.trim() || undefined;
    message.replyContinuationGoal =
      options.replyContinuationGoal?.trim() || undefined;
    message.replyAssistantContribution =
      options.replyAssistantContribution?.trim() || undefined;
    message.replyMustContribute =
      options.replyMustContribute?.trim() || undefined;
    message.replyAvoidRepeatingMove =
      options.replyAvoidRepeatingMove?.trim() || undefined;
    message.replyClosureReadiness =
      options.replyClosureReadiness?.trim() || undefined;
    message.replyPersonaActivations =
      options.replyPersonaActivations?.filter(Boolean);
    message.replyPersonaSource =
      options.replyPersonaSource?.trim() || undefined;
    message.replyRealityDependencyKinds =
      options.replyRealityDependencyKinds?.filter(Boolean);
    message.replyCorrectionFactMode =
      options.replyCorrectionFactMode?.trim() || undefined;
    message.replyActiveContributionSource =
      options.replyActiveContributionSource?.trim() || undefined;
    message.replyStrategyRepeatedMoves =
      options.replyStrategyRepeatedMoves?.filter(Boolean);
    message.replyStrategyAlternative =
      options.replyStrategyAlternative?.trim() || undefined;
    message.replyCareMotive = options.replyCareMotive?.trim() || undefined;
    message.replyCareFocus = options.replyCareFocus?.trim() || undefined;
    message.replyCareStyleSource =
      options.replyCareStyleSource?.trim() || undefined;
    message.replyDreamPlan = options.replyDreamPlan;
    message.replyStateProtocol = options.replyStateProtocol
      ? { ...options.replyStateProtocol }
      : undefined;
    message.replyExperiencePlanVersion =
      options.replyExperiencePlanVersion?.trim() || undefined;
    message.replyProfileTier = options.replyProfileTier?.trim() || undefined;
    message.replyProfileScore = this.normalizeTokenCount(
      options.replyProfileScore
    );
    message.replyProfileDimensionCount = this.normalizeTokenCount(
      options.replyProfileDimensionCount
    );
    message.replyProfileTrustedFactCount = this.normalizeTokenCount(
      options.replyProfileTrustedFactCount
    );
    message.replyRelationshipStage =
      options.replyRelationshipStage?.trim() || undefined;
    message.replyRelationshipMaturity =
      options.replyRelationshipMaturity?.trim() || undefined;
    message.replyRelationshipState =
      options.replyRelationshipState?.trim() || undefined;
    message.replyRelationshipUserTurnCount = this.normalizeTokenCount(
      options.replyRelationshipUserTurnCount
    );
    message.replyRelationshipActiveDayCount = this.normalizeTokenCount(
      options.replyRelationshipActiveDayCount
    );
    message.replyConversationDepth =
      options.replyConversationDepth?.trim() || undefined;
    message.replyExperienceFactScope =
      options.replyExperienceFactScope?.trim() || undefined;
    message.replyExperienceIntimacyLevel =
      options.replyExperienceIntimacyLevel?.trim() || undefined;
    message.replyExperienceContributionMode =
      options.replyExperienceContributionMode?.trim() || undefined;
    message.replyExperienceMemoryPolicy =
      options.replyExperienceMemoryPolicy?.trim() || undefined;
    message.replyExperienceQuestionPolicy =
      options.replyExperienceQuestionPolicy?.trim() || undefined;
    message.replyExperienceClosurePolicy =
      options.replyExperienceClosurePolicy?.trim() || undefined;
    message.replyMemoryPlan = options.replyMemoryPlan
      ? {
          need: options.replyMemoryPlan.need,
          contextCoverage: options.replyMemoryPlan.contextCoverage,
          missingConcepts: options.replyMemoryPlan.missingConcepts
            ? [...options.replyMemoryPlan.missingConcepts]
            : undefined,
          queries: options.replyMemoryPlan.queries.map(query => ({ ...query })),
          selectedFactKeys: options.replyMemoryPlan.selectedFactKeys
            ? [...options.replyMemoryPlan.selectedFactKeys]
            : undefined,
        }
      : undefined;
    message.replyMemoryCandidateCount = this.normalizeTokenCount(
      options.replyMemoryCandidateCount
    );
    message.replyMemorySelectedCandidateKeys =
      options.replyMemorySelectedCandidateKeys?.filter(Boolean);
    message.replyMemoryRetrievalMode =
      options.replyMemoryRetrievalMode?.trim() || undefined;
    message.replyMemoryRetrievalRequestCount = this.normalizeTokenCount(
      options.replyMemoryRetrievalRequestCount
    );
    message.replyMemoryRetrievalConceptCount = this.normalizeTokenCount(
      options.replyMemoryRetrievalConceptCount
    );
    message.replyMemoryRetrievedEvidenceCount = this.normalizeTokenCount(
      options.replyMemoryRetrievedEvidenceCount
    );
    message.replyMemoryUsedEvidenceIds =
      options.replyMemoryUsedEvidenceIds?.filter(Boolean);
    message.replyMemoryUsedClaimCount = this.normalizeTokenCount(
      options.replyMemoryUsedClaimCount
    );
    message.createdAt = options.createdAt;
    message.updatedAt = options.updatedAt;

    return this.messageModel.save(message);
  }

  private queueMilvusIndexForMessage(options: {
    message: MessageEntity;
    conversation: ConversationEntity;
    userId: string;
    searchableText: string;
  }): void {
    if (process.env.CHAT_SKIP_MEMORY_WRITE === 'true') {
      return;
    }
    const searchableText = options.searchableText?.trim();

    if (!searchableText) {
      return;
    }

    void this.milvusService
      .indexConversationMessage({
        messageId: this.stringifyObjectId(options.message.id),
        userId: options.userId,
        conversationId: this.stringifyObjectId(options.conversation.id),
        agentId: this.stringifyObjectId(options.conversation.agentId),
        role: options.message.role,
        type: options.message.type,
        searchableText,
        createdAt: options.message.createdAt,
      })
      .catch(error => {
        this.logger.error(
          '[conversation] memory index failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
          this.stringifyObjectId(options.conversation.id),
          this.stringifyObjectId(options.message.id),
          options.userId,
          this.describeReplyError(error)
        );
      });
  }

  private async touchConversation(
    conversation: ConversationEntity,
    updatedAt: Date
  ): Promise<void> {
    conversation.updatedAt = updatedAt;
    await this.conversationModel.save(conversation);
  }

  private async getConversationForUser(
    auth: AuthenticatedUserPayload,
    conversationId: string
  ): Promise<ConversationEntity> {
    const userId = this.parseObjectId(auth.sub);
    const objectId = this.parseObjectId(conversationId);
    const conversation = await this.findConversationById(objectId, userId);

    if (!conversation) {
      throw new AppError(
        'CONVERSATION_NOT_FOUND',
        'conversation not found',
        404
      );
    }

    return conversation;
  }

  private async resolveConversationAgent(
    conversation: ConversationEntity,
    agent: AgentEntity | null
  ): Promise<AgentEntity | null> {
    if (!agent) {
      return null;
    }

    const isOwner =
      this.stringifyObjectId(agent.createdUserId) ===
      this.stringifyObjectId(conversation.userId);

    if (isOwner) {
      return agent;
    }

    const member = await this.agentShareMemberModel.findOne({
      where: {
        agentId: agent.id,
        userId: conversation.userId,
        status: AgentShareMemberStatus.active,
      },
    });

    if (!member) {
      throw new AppError(
        'AGENT_SHARE_ACCESS_REVOKED',
        'shared agent access is no longer active',
        403
      );
    }

    const agentCallsUser =
      member.agentCallsUser?.trim() ||
      conversation.agentCallsUser?.trim() ||
      '';
    const userCallsAgent =
      member.userCallsAgent?.trim() ||
      conversation.userCallsAgent?.trim() ||
      agent.name?.trim() ||
      '';

    return {
      ...agent,
      agentCallMe: agentCallsUser,
      iCallAgent: userCallsAgent,
      isDefault: false,
    } as AgentEntity;
  }

  private isMessengerAgent(agent: AgentEntity | null): boolean {
    return Boolean(agent?.messengerOfAgentId);
  }

  private async findConversationById(
    conversationId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<ConversationEntity | null> {
    const conversationById = await this.conversationModel.findOne({
      where: {
        id: conversationId,
        userId,
      },
    });

    if (conversationById) {
      return conversationById;
    }

    return this.conversationModel.findOne({
      where: {
        _id: conversationId,
        userId,
      } as never,
    });
  }

  private async findAgentById(
    value: MongoObjectId | string | undefined
  ): Promise<AgentEntity | null> {
    const objectId = this.normalizeObjectId(value);

    if (!objectId) {
      return null;
    }

    const agentById = await this.agentModel.findOne({
      where: {
        id: objectId,
      },
    });

    if (agentById) {
      return agentById;
    }

    return this.agentModel.findOne({
      where: {
        _id: objectId,
      } as never,
    });
  }

  private async findLatestMessage(
    conversationId: MongoObjectId | string | undefined
  ): Promise<MessageEntity | null> {
    const objectId = this.normalizeObjectId(conversationId);

    if (!objectId) {
      return null;
    }

    return this.messageModel.findOne({
      where: {
        conversationId: objectId,
        role: { $in: [MessageRole.user, MessageRole.assistant] },
        isArchived: { $ne: true },
      } as never,
      order: {
        createdAt: 'DESC',
      },
    });
  }

  private async listAgentsByIds(
    values: Array<MongoObjectId | string | undefined>
  ): Promise<Map<string, AgentEntity | null>> {
    const ids = this.uniqueObjectIds(values);
    const result = new Map<string, AgentEntity | null>();

    if (ids.length === 0) {
      return result;
    }

    if (typeof this.agentModel.find !== 'function') {
      const agents = await Promise.all(ids.map(id => this.findAgentById(id)));
      ids.forEach((id, index) => {
        result.set(this.stringifyObjectId(id), agents[index] ?? null);
      });
      return result;
    }

    const agents = await this.agentModel.find({
      where: {
        _id: {
          $in: ids,
        },
      } as never,
    });

    for (const agent of agents) {
      result.set(this.stringifyObjectId(agent.id), agent);
    }

    for (const id of ids) {
      const key = this.stringifyObjectId(id);
      if (!result.has(key)) {
        result.set(key, null);
      }
    }

    return result;
  }

  private async listLatestMessagesByConversationIds(
    values: Array<MongoObjectId | string | undefined>
  ): Promise<Map<string, MessageEntity | null>> {
    const ids = this.uniqueObjectIds(values);
    const result = new Map<string, MessageEntity | null>();

    if (ids.length === 0) {
      return result;
    }

    if (typeof this.messageModel.aggregate !== 'function') {
      const messages = await Promise.all(
        ids.map(id => this.findLatestMessage(id))
      );
      ids.forEach((id, index) => {
        result.set(this.stringifyObjectId(id), messages[index] ?? null);
      });
      return result;
    }

    const rows = await this.messageModel
      .aggregate<{ _id: MongoObjectId; message: MessageEntity }>([
        {
          $match: {
            conversationId: { $in: ids },
            role: { $in: [MessageRole.user, MessageRole.assistant] },
            isArchived: { $ne: true },
          },
        },
        {
          $sort: {
            createdAt: -1,
          },
        },
        {
          $group: {
            _id: '$conversationId',
            message: { $first: '$$ROOT' },
          },
        },
      ])
      .toArray();

    for (const row of rows) {
      result.set(this.stringifyObjectId(row._id), row.message);
    }

    for (const id of ids) {
      const key = this.stringifyObjectId(id);
      if (!result.has(key)) {
        result.set(key, null);
      }
    }

    return result;
  }

  private uniqueObjectIds(
    values: Array<MongoObjectId | string | undefined>
  ): MongoObjectId[] {
    const result = new Map<string, MongoObjectId>();

    for (const value of values) {
      const objectId = this.normalizeObjectId(value);
      if (objectId) {
        result.set(this.stringifyObjectId(objectId), objectId);
      }
    }

    return [...result.values()];
  }

  private isDeicticFactRejection(value: string): boolean {
    return /(?:没有这(?:回)?事|没这(?:回)?事|根本没这回事|不是这样的?|我不记得.{0,8}(?:有|发生|这事)|你(?:又|在)?(?:瞎编|胡编|乱编|乱说)|别(?:再)?编)/.test(
      value
    );
  }

  private findPreviousAssistantMessage(
    message: MessageEntity
  ): Promise<MessageEntity | null> {
    return this.messageModel.findOne({
      where: {
        conversationId: message.conversationId,
        role: MessageRole.assistant,
        status: MessageStatus.sent,
        isArchived: { $ne: true },
        createdAt: { $lt: message.createdAt },
      } as never,
      order: {
        createdAt: 'DESC',
      },
    });
  }

  private async findMessageById(
    messageId: MongoObjectId,
    conversationId: MongoObjectId
  ): Promise<MessageEntity | null> {
    const messageById = await this.messageModel.findOne({
      where: {
        id: messageId,
        conversationId,
        isArchived: { $ne: true },
      } as never,
    });

    if (messageById) {
      return messageById;
    }

    return this.messageModel.findOne({
      where: {
        _id: messageId,
        conversationId,
        isArchived: { $ne: true },
      } as never,
    });
  }

  private findUserMessageByClientRequestId(
    conversationId: MongoObjectId,
    userId: MongoObjectId,
    clientRequestId: string
  ): Promise<MessageEntity | null> {
    return this.messageModel.findOne({
      where: {
        conversationId,
        userId,
        role: MessageRole.user,
        clientRequestId,
        isArchived: { $ne: true },
      } as never,
    });
  }

  private findMemorialPhotoByClientRequestId(
    conversationId: MongoObjectId,
    userId: MongoObjectId,
    clientRequestId: string
  ): Promise<MessageEntity | null> {
    return this.messageModel.findOne({
      where: {
        conversationId,
        userId,
        role: MessageRole.assistant,
        type: MessageType.image,
        clientRequestId,
        isArchived: { $ne: true },
      } as never,
    });
  }

  private async acquireMemorialPhotoLock(
    conversationId: string,
    clientRequestId: string
  ): Promise<{ acquired: boolean; token: string }> {
    const token = `${Date.now()}:${Math.random().toString(16).slice(2)}`;

    if (!this.redisService) {
      return { acquired: true, token };
    }

    const result = await this.redisService?.set(
      this.getMemorialPhotoLockKey(conversationId, clientRequestId),
      token,
      'PX',
      MEMORIAL_PHOTO_LOCK_TTL_MS,
      'NX'
    );

    return { acquired: result === 'OK', token };
  }

  private async releaseMemorialPhotoLock(
    conversationId: string,
    clientRequestId: string,
    token: string
  ): Promise<void> {
    if (!this.redisService) {
      return;
    }

    const key = this.getMemorialPhotoLockKey(conversationId, clientRequestId);

    if ((await this.redisService?.get(key)) === token) {
      await this.redisService?.del(key);
    }
  }

  private getMemorialPhotoLockKey(
    conversationId: string,
    clientRequestId: string
  ): string {
    const normalizedRequestId = encodeURIComponent(clientRequestId);

    return `conversation:memorial-photo:lock:${conversationId}:${normalizedRequestId}`;
  }

  private stringifyOptionalObjectId(
    value: MongoObjectId | undefined
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = this.stringifyObjectId(value).trim();
    return normalized || undefined;
  }

  private normalizeTokenCount(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private normalizeConfidence(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.min(1, value));
  }

  private normalizeFeedbackType(
    value: unknown
  ): ConversationMessageFeedbackType {
    switch (value) {
      case ConversationMessageFeedbackType.accurate:
        return ConversationMessageFeedbackType.accurate;
      case ConversationMessageFeedbackType.unlike:
        return ConversationMessageFeedbackType.unlike;
      case ConversationMessageFeedbackType.wrongFact:
        return ConversationMessageFeedbackType.wrongFact;
      case ConversationMessageFeedbackType.fabricated:
        return ConversationMessageFeedbackType.fabricated;
      case ConversationMessageFeedbackType.uncomfortable:
        return ConversationMessageFeedbackType.uncomfortable;
      case ConversationMessageFeedbackType.other:
      default:
        return ConversationMessageFeedbackType.other;
    }
  }

  private normalizeFeedbackContent(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 500) : '';
  }

  private truncateFeedbackSnapshot(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  }

  private normalizeObjectId(
    value: MongoObjectId | string | undefined
  ): MongoObjectId | null {
    if (!value) {
      return null;
    }

    if (value instanceof MongoObjectId) {
      return value;
    }

    try {
      return new MongoObjectId(value);
    } catch {
      return null;
    }
  }

  private parseObjectId(value: string): MongoObjectId {
    try {
      return new MongoObjectId(value);
    } catch {
      throw new AppError('INVALID_ID', 'id is invalid', 400);
    }
  }

  private stringifyObjectId(value?: MongoObjectId | null): string {
    return value?.toHexString?.() ?? String(value);
  }

  private describeReplyError(error: unknown): string {
    if (error instanceof AppError) {
      return `code=${error.code} status=${error.status} message=${error.message}`;
    }

    if (error instanceof Error) {
      const details: string[] = [];
      const status = (error as { status?: unknown }).status;
      const code = (error as { code?: unknown }).code;
      const type = (error as { type?: unknown }).type;
      const cause = (error as { cause?: unknown }).cause;

      if (typeof status === 'number') {
        details.push(`status=${status}`);
      }

      if (typeof code === 'string' && code) {
        details.push(`code=${code}`);
      }

      if (typeof type === 'string' && type) {
        details.push(`type=${type}`);
      }

      if (cause instanceof Error && cause.message) {
        details.push(`cause=${cause.message}`);
      } else if (typeof cause === 'string' && cause) {
        details.push(`cause=${cause}`);
      }

      return details.length > 0
        ? `${error.name}: ${error.message} (${details.join(' ')})`
        : `${error.name}: ${error.message}`;
    }

    return String(error);
  }

  private wrapReplyError(error: unknown): never {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      'MINIMAX_REPLY_FAILED',
      'failed to generate assistant reply',
      502
    );
  }
}
