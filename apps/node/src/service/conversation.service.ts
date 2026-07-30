import { Inject, Logger } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
import { RedisService } from '@midwayjs/redis';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  AgentEntity,
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
import { AgentContextService } from './agents/agent.context';
import { AgentConversationSummaryService } from './agents/agent-conversation-summary.service';
import { AgentEmotionStateService } from './agents/agent-emotion-state.service';
import { AgentMemoryFactService } from './agents/agent-memory-fact.service';
import { buildAgentPersonaPrompt } from './agents/agent-persona';
import { AgentProfileFactService } from './agents/agent-profile-fact.service';
import { AgentRelationshipSignalService } from './agents/agent-relationship-signal.service';
import { OpenAIService } from './agents/openai';
import {
  ASSISTANT_TRANSMISSION_INTERRUPTED_CONTENT,
  GuardrailFeedback,
  GuardrailRevisionRecord,
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
} from './agents/reply-bubble-plan';
import {
  buildReplyLengthPlanPrompt,
  countReplyVisibleCharacters,
} from './agents/reply-length-plan';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ConversationMessageItem, MessageService } from './message.service';
import { PostImageService } from './post-image.service';
import { OssService } from './oss.service';
import { TencentCosService } from './tencent-cos.service';
import { MilvusService } from './rag/milvus.service';
import { CosyVoiceSpeechService } from './cosyvoice-speech.service';
import { MinimaxVoiceSpeechService } from './minimax-voice-speech.service';
import { QwenVoiceSpeechService } from './qwen-voice-speech.service';
import { BailianImageService } from './bailian-image.service';

const ASSISTANT_REPLY_TEMPERATURE = 0.2;
const ASSISTANT_REPLY_TOP_P = 0.8;
const ASSISTANT_REPLY_TIMEOUT_MS = 20000;
const ASSISTANT_REPLY_MAX_TOKENS = 420;
const ASSISTANT_RECOVERY_MAX_TOKENS = 360;
const ASSISTANT_BUBBLE_REFLOW_MAX_TOKENS = 280;
const ASSISTANT_BUBBLE_REFLOW_TIMEOUT_MS = 10000;
const DISCOURAGED_ASSISTANT_EMOJI_PATTERN =
  /😔|😢|😞|😟|😕|😣|😖|😭|😿|☹️|🙁|😮‍💨|🥺/gu;
const MEMORIAL_PHOTO_REPLY_TEMPERATURE = 0.35;
const MEMORIAL_PHOTO_REPLY_TOP_P = 0.8;
const UNSAFE_ASSISTANT_PRESENCE_PATTERNS = [
  /(?:闭上眼|夜里|晚上|屋里|房间|角落|床边|身边|旁边|耳边)[^，。！？!?]{0,36}(?:我就在|我会在|陪着你|守着你|等着你|回来了|回来)/,
  /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,16}(?:能|会|准能|一定能|都能)(?:看到|看见)/,
  /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,16}(?:走到|来到|回到|站在|坐在|守在|陪在|靠在|抱着|握着|擦掉|擦干)/,
] as const;
const CONVERSATION_REPLY_JOB_DELAY_MS = 2500;
const CONVERSATION_REPLY_MAX_DEBOUNCE_MS = 8000;
const CONVERSATION_REPLY_LOCK_TTL_MS = 2 * 60 * 1000;
export const CONVERSATION_REPLY_QUEUE = 'conversation-reply';
const ASSISTANT_REPLY_FAILED_CONTENT =
  ASSISTANT_TRANSMISSION_INTERRUPTED_CONTENT;
const NON_VIP_CHAT_LIMIT_POLICY = {
  trialDays: 3, // 3 个北京时间自然日试用期
  trialDailyPerAgentLimit: 30, // 试用期内每天每个 agent 30 句
  dailyPerAgentLimit: 3, // 试用期后每天每个 agent 3 句
  dayBoundaryOffsetMinutes: 8 * 60, // 按北京时间切日
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
const WEAPP_ACCOUNT_PREFIX = 'weapp:';

export interface ConversationSummary {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  agentSex: number;
  agentCallMe: string;
  iCallAgent: string;
  agentIsDefault: boolean;
  preview: string;
  updatedAt: string;
  createdAt: string;
}

export interface SendConversationMessageResult {
  userMessage: ConversationMessageItem;
  assistantMessage?: ConversationMessageItem;
  assistantMessages?: ConversationMessageItem[];
  chatQuota?: ConversationChatQuotaSnapshot;
  replyPending?: boolean;
}

export interface ConversationReplyJobData {
  conversationId: string;
  userId: string;
  afterUserCreatedAt?: string;
}

export interface ProcessConversationReplyJobOptions {
  isFinalAttempt?: boolean;
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
  deferReply: boolean;
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
  attempt: 'initial' | 'recovery' | 'bubble_reflow';
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
  guardrailFeedbackRounds?: GuardrailFeedback[];
  guardrailCandidateVersions?: string[][];
  guardrailRevisionRecords?: GuardrailRevisionRecord[];
  evidenceCount?: number;
  factClaimCount?: number;
  unsupportedClaimCount?: number;
  promptVersion?: string;
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
  memoryRetrievalMode?: 'memory_plan' | 'legacy_query' | 'suppressed';
  memoryRetrievalRequestCount?: number;
  memoryRetrievalConceptCount?: number;
  replyPlanningMode?: string;
  replyPlanningReason?: string;
  replyIntentModelCallCount?: number;
  strategyVersion?: string;
  strategySource?: string;
  participationStrategy?: string;
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
}

interface AfterReplyResult {
  assistantMessages: MessageEntity[];
}

interface NonVipChatLimitRule {
  policy: 'trial' | 'daily';
  limit: number;
  windowStart: Date;
  windowEnd?: Date;
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
  policy?: 'trial' | 'daily';
  limit?: number;
  usedCount?: number;
  remainingCount?: number;
  trialDays?: number;
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

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

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
  bailianImageService: BailianImageService;

  @Inject()
  bullmqFramework: bullmq.Framework;

  @Inject()
  redisService: RedisService;

  async listConversations(
    auth: AuthenticatedUserPayload
  ): Promise<ConversationSummary[]> {
    const userId = this.parseObjectId(auth.sub);
    const conversations = await this.conversationModel.find({
      where: {
        userId,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
    const summaries = await Promise.all(
      conversations.map(async conversation => {
        const agent = await this.findAgentById(conversation.agentId);
        const latestMessage = await this.findLatestMessage(conversation.id);
        const agentId = this.stringifyObjectId(
          agent?.id ?? conversation.agentId
        );

        return {
          id: this.stringifyObjectId(conversation.id),
          agentId,
          agentName: agent?.name?.trim() || '联系人资料暂不可用',
          agentAvatar: this.postImageService.resolveForResponse(
            agent?.avatar?.trim() || ''
          ),
          agentSex: agent?.sex ?? 0,
          agentCallMe: agent?.agentCallMe?.trim() || '',
          iCallAgent: agent?.iCallAgent?.trim() || '',
          agentIsDefault: Boolean(agent?.isDefault),
          preview: this.buildPreview(agent, latestMessage),
          updatedAt: conversation.updatedAt?.toISOString?.() ?? '',
          createdAt: conversation.createdAt?.toISOString?.() ?? '',
        };
      })
    );

    return summaries.sort((left, right) => {
      if (left.agentIsDefault !== right.agentIsDefault) {
        return left.agentIsDefault ? -1 : 1;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }

  async sendMessage(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    payload: SendConversationMessageDTO
  ): Promise<SendConversationMessageResult> {
    const runtime = await this.createReplyRuntime(auth, conversationId);
    const before = await this.beforeReply(runtime, payload);

    if (!before.isDuplicate) {
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

    try {
      const processed = await this.processReply(runtime, before);
      const after = await this.afterReply(runtime, before, processed);

      return this.buildSendMessageResult(before, after);
    } catch (error) {
      this.logger.error(
        '[conversation] assistant reply generation failed, conversationId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(runtime.conversation.id),
        auth.sub,
        this.describeReplyError(error)
      );
      throw this.wrapReplyError(error);
    }
  }

  async sendMessageAsync(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    payload: SendConversationMessageDTO
  ): Promise<SendConversationMessageResult> {
    const runtime = await this.createReplyRuntime(auth, conversationId);
    const messageType = this.normalizeMessageType(payload?.type);

    const before = await this.beforeReply(runtime, {
      ...payload,
      type: messageType,
    });
    const shouldReply = !before.deferReply;

    if (shouldReply) {
      const enqueued = await this.enqueueConversationReplyJob({
        conversationId: this.stringifyObjectId(runtime.conversation.id),
        userId: auth.sub,
      });

      if (!enqueued) {
        const after = await this.afterReplyFailed(runtime);

        return this.buildSendMessageResult(before, after);
      }
    }

    if (!before.isDuplicate) {
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

  async processConversationReplyJob(
    data: ConversationReplyJobData,
    options: ProcessConversationReplyJobOptions = {}
  ): Promise<void> {
    const conversationId = this.stringifyObjectId(
      this.parseObjectId(data.conversationId)
    );
    const userId = this.stringifyObjectId(this.parseObjectId(data.userId));
    const lock = await this.acquireConversationReplyLock(conversationId);

    if (!lock.acquired) {
      await this.enqueueConversationReplyJob(data);
      return;
    }

    try {
      if (!data.afterUserCreatedAt) {
        await this.clearConversationReplyDebounce(conversationId);
      }

      const conversation = await this.findConversationById(
        this.parseObjectId(conversationId),
        this.parseObjectId(userId)
      );

      if (!conversation) {
        this.logger.warn(
          '[conversation-reply] conversation not found, conversationId=%s, userId=%s',
          conversationId,
          userId
        );
        return;
      }

      const pendingUserMessages = await this.findPendingUserMessagesForReply({
        conversationId: conversation.id,
        afterUserCreatedAt: this.parseOptionalDate(data.afterUserCreatedAt),
      });

      if (pendingUserMessages.length === 0) {
        return;
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
        agent: await this.findAgentById(conversation.agentId),
      };
      const before = this.buildQueuedBeforeReplyResult(pendingUserMessages);

      try {
        const processed = await this.processReply(runtime, before);
        await this.afterReply(runtime, before, processed);
      } catch (error) {
        this.logger.error(
          '[conversation-reply] assistant reply generation failed, conversationId=%s, userId=%s, reason=%s',
          conversationId,
          userId,
          this.describeReplyError(error)
        );
        if (options.isFinalAttempt) {
          await this.afterReplyFailed(runtime);
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

    return this.resolveCurrentChatQuota(runtime, new Date());
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

    if (
      message.role !== MessageRole.assistant ||
      message.type !== MessageType.text
    ) {
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
      return this.messageService.buildConversationMessageItem(message);
    }

    const agent = await this.findAgentById(conversation.agentId);
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
    message.updatedAt = new Date();

    const savedMessage = await this.messageModel.save(message);

    return this.messageService.buildConversationMessageItem(savedMessage);
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
      this.logger.warn(
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
      this.logger.warn(
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
    const agent = await this.findAgentById(conversation.agentId);

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

      return {
        messagePayload,
        searchableText:
          this.buildSearchableTextFromMessage(existingUserMessage),
        userMessage: existingUserMessage,
        deferReply: this.isAssistantReplyDeferred(messagePayload),
        isDuplicate: true,
        chatQuota: await this.resolveCurrentChatQuota(runtime, new Date()),
      };
    }

    const messagePayload = await this.prepareIncomingMessage(payload);
    await this.attachQuotedMessageSnapshot(
      runtime.conversation,
      messagePayload
    );
    const searchableText = this.buildMessageSearchableText(messagePayload);
    const now = new Date();
    const chatQuota = await this.resolveChatQuotaForSend(runtime, now);

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

    await this.touchConversation(runtime.conversation, now);
    this.queueMilvusIndexForMessage({
      message: userMessage,
      conversation: runtime.conversation,
      userId: runtime.auth.sub,
      searchableText,
    });

    return {
      messagePayload,
      searchableText,
      userMessage,
      deferReply: this.isAssistantReplyDeferred(messagePayload),
      chatQuota,
    };
  }

  private async enrichUserMessageForReply(
    message: MessageEntity,
    searchableText: string
  ): Promise<void> {
    await Promise.all([
      this.recognizeEmotionStateForUserMessage(message, searchableText),
      this.extractMemoryFactsForUserMessage(message, searchableText),
      this.extractProfileFactsForUserMessage(message, searchableText),
    ]);
  }

  private scheduleUserMessageEnrichment(
    message: MessageEntity,
    searchableText: string
  ): void {
    void this.enrichUserMessageForReply(message, searchableText).catch(
      error => {
        this.logger.warn(
          '[conversation] background user message enrichment failed, conversationId=%s, messageId=%s, reason=%s',
          this.stringifyObjectId(message.conversationId),
          this.stringifyObjectId(message.id),
          this.describeReplyError(error)
        );
      }
    );
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
      this.logger.warn(
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
  ): Promise<void> {
    if (!this.agentMemoryFactService) {
      return;
    }

    try {
      await this.agentMemoryFactService.extractAndUpsertFromUserMessage({
        message,
        searchableText,
      });
    } catch (error) {
      this.logger.warn(
        '[conversation] memory fact extraction failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.userId),
        this.describeReplyError(error)
      );
    }
  }

  private async extractProfileFactsForUserMessage(
    message: MessageEntity,
    searchableText: string,
    explicitlyConfirmed = false
  ): Promise<void> {
    if (!this.agentProfileFactService) {
      return;
    }

    try {
      await this.agentProfileFactService.extractAndUpsertFromUserMessage({
        message,
        searchableText,
        explicitlyConfirmed,
      });
    } catch (error) {
      this.logger.warn(
        '[conversation] profile fact extraction failed, conversationId=%s, messageId=%s, userId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.userId),
        this.describeReplyError(error)
      );
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
      this.logger.warn(
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
    void this.rememberRelationshipSignals(message, intent).catch(error => {
      this.logger.warn(
        '[conversation] relationship signal scheduling failed, conversationId=%s, messageId=%s, reason=%s',
        this.stringifyObjectId(message.conversationId),
        this.stringifyObjectId(message.id),
        this.describeReplyError(error)
      );
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
      this.logger.warn(
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
      this.logger.warn(
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
      this.logger.warn(
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
    now: Date
  ): Promise<ConversationChatQuotaSnapshot> {
    const currentQuota = await this.resolveCurrentChatQuota(runtime, now);

    if (currentQuota.isVip) {
      return currentQuota;
    }

    const usedCount = currentQuota.usedCount ?? 0;
    const limit = currentQuota.limit ?? 0;
    const nextUsedCount = usedCount + 1;
    const remainingCount = Math.max(limit - nextUsedCount, 0);

    if (usedCount < limit) {
      return {
        isVip: false,
        policy: currentQuota.policy,
        limit,
        usedCount: nextUsedCount,
        remainingCount,
        trialDays: NON_VIP_CHAT_LIMIT_POLICY.trialDays,
      };
    }

    throw new AppError(
      'NON_VIP_CHAT_LIMIT_EXCEEDED',
      this.buildNonVipChatLimitMessage(currentQuota.policy, limit),
      429,
      {
        policy: currentQuota.policy,
        limit,
        usedCount,
        remainingCount: 0,
        trialDays: NON_VIP_CHAT_LIMIT_POLICY.trialDays,
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
    now: Date
  ): Promise<ConversationChatQuotaSnapshot> {
    if (await this.isUserVip(runtime.conversation.userId, now)) {
      return {
        isVip: true,
      };
    }

    const user = await this.findUserById(runtime.conversation.userId);

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 404);
    }

    const registeredAt = await this.resolveEffectiveRegisteredAt(runtime, user);
    const rule = this.resolveNonVipChatLimitRule(registeredAt, now);
    const usedCount = await this.countUserMessagesForAgent({
      userId: runtime.conversation.userId,
      agentId: runtime.conversation.agentId,
      windowStart: rule.windowStart,
      windowEnd: rule.windowEnd,
    });

    return {
      isVip: false,
      policy: rule.policy,
      limit: rule.limit,
      usedCount,
      remainingCount: Math.max(rule.limit - usedCount, 0),
      trialDays: NON_VIP_CHAT_LIMIT_POLICY.trialDays,
    };
  }

  private buildNonVipChatLimitMessage(
    policy: ConversationChatQuotaSnapshot['policy'],
    limit: number
  ): string {
    if (policy === 'trial') {
      return `非会员注册当日起${NON_VIP_CHAT_LIMIT_POLICY.trialDays}个自然日内，每天每位亲友可主动聊${limit}句。开通会员后可继续畅聊。`;
    }

    return `非会员每天每位亲友可主动聊${limit}句。开通会员后可继续畅聊。`;
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

  private resolveNonVipChatLimitRule(
    registeredAt: Date,
    now: Date
  ): NonVipChatLimitRule {
    const registeredDayStart = this.getBeijingDayStart(registeredAt);
    const trialEndsAt = new Date(
      registeredDayStart.getTime() +
        NON_VIP_CHAT_LIMIT_POLICY.trialDays * 24 * 60 * 60 * 1000
    );
    const currentDayStart = this.getBeijingDayStart(now);
    const currentDayEnd = new Date(
      currentDayStart.getTime() + 24 * 60 * 60 * 1000
    );

    if (now < trialEndsAt) {
      return {
        policy: 'trial',
        limit: NON_VIP_CHAT_LIMIT_POLICY.trialDailyPerAgentLimit,
        windowStart:
          registeredAt.getTime() > currentDayStart.getTime()
            ? registeredAt
            : currentDayStart,
        windowEnd:
          currentDayEnd.getTime() < trialEndsAt.getTime()
            ? currentDayEnd
            : trialEndsAt,
      };
    }

    return {
      policy: 'daily',
      limit: NON_VIP_CHAT_LIMIT_POLICY.dailyPerAgentLimit,
      windowStart: currentDayStart,
      windowEnd: currentDayEnd,
    };
  }

  private async resolveEffectiveRegisteredAt(
    runtime: ReplyRuntime,
    user: UserEntity
  ): Promise<Date> {
    const userRegisteredAt = this.normalizeUserRegisteredAt(user);
    const accountRegisteredAt = await this.resolveCurrentWeappAccountCreatedAt(
      runtime
    );

    if (
      accountRegisteredAt &&
      accountRegisteredAt.getTime() > userRegisteredAt.getTime()
    ) {
      return accountRegisteredAt;
    }

    return userRegisteredAt;
  }

  private async resolveCurrentWeappAccountCreatedAt(
    runtime: ReplyRuntime
  ): Promise<Date | null> {
    if (
      !runtime.auth?.account?.startsWith(WEAPP_ACCOUNT_PREFIX) ||
      !runtime.auth?.accountId
    ) {
      return null;
    }

    const accountId = this.normalizeObjectId(runtime.auth.accountId);

    if (!accountId) {
      return null;
    }

    const account = await this.findUserAccountById(accountId);

    if (
      !account ||
      account.account !== runtime.auth.account ||
      !this.isSameObjectId(account.userId, runtime.conversation.userId)
    ) {
      return null;
    }

    return this.normalizeDate(account.createdAt);
  }

  private normalizeUserRegisteredAt(user: UserEntity): Date {
    return this.normalizeDate(user.createdAt);
  }

  private normalizeDate(value: Date | string | number | undefined): Date {
    const registeredAt = new Date(value ?? 0);

    if (!Number.isNaN(registeredAt.getTime())) {
      return registeredAt;
    }

    return new Date(0);
  }

  private getBeijingDayStart(value: Date): Date {
    const offsetMs =
      NON_VIP_CHAT_LIMIT_POLICY.dayBoundaryOffsetMinutes * 60 * 1000;
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

  private async processReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult
  ): Promise<ProcessReplyResult> {
    let context;
    const memoryControlResult = await this.applyExplicitMemoryControl(
      before.userMessage,
      before.searchableText
    );

    try {
      context = await this.agentContextService.buildConversationContext({
        auth: runtime.auth,
        conversation: runtime.conversation,
        agent: runtime.agent,
        currentQuery: before.searchableText,
        memoryControlResult,
      });
    } catch (error) {
      const fallbackBrief = buildReplyBrief({
        currentQuery: before.searchableText,
      });

      return this.buildGenerationFailureReply(
        before.searchableText,
        undefined,
        undefined,
        fallbackBrief,
        error,
        'context'
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

      return {
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
      };
    }

    let response;
    let replySegments: string[];
    let replyClaims: AssistantFactClaim[] = [];
    let generationUsage: ReplyUsage = {};
    let generationRecoveryAttempted = false;
    let generationRecoverySucceeded = false;
    const generationAttemptTraces: AssistantGenerationAttemptTrace[] = [];

    try {
      response = await this.openAIService.createChatCompletion(
        {
          temperature: ASSISTANT_REPLY_TEMPERATURE,
          topP: ASSISTANT_REPLY_TOP_P,
          max_tokens: ASSISTANT_REPLY_MAX_TOKENS,
          messages: context.messages,
        },
        {
          timeout: ASSISTANT_REPLY_TIMEOUT_MS,
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
      const parsedReply = this.parseAssistantReply(responseContent);
      const plannedSegments = this.materializeParticipationReplySegments(
        parsedReply.segments,
        replyBrief.participationStrategy
      );
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

      try {
        response = await this.openAIService.createChatCompletion(
          {
            temperature: ASSISTANT_REPLY_TEMPERATURE,
            topP: ASSISTANT_REPLY_TOP_P,
            max_tokens: ASSISTANT_RECOVERY_MAX_TOKENS,
            messages: this.buildMinimalGenerationRecoveryMessages({
              runtime,
              userQuery: before.searchableText,
              contextMessages: context.messages,
              replyBrief,
              evidence: contextEvidence,
            }),
          },
          {
            timeout: ASSISTANT_REPLY_TIMEOUT_MS,
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
        const parsedReply = this.parseAssistantReply(responseContent);
        const plannedSegments = this.materializeParticipationReplySegments(
          parsedReply.segments,
          replyBrief.participationStrategy
        );
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
        return this.buildGenerationFailureReply(
          before.searchableText,
          context.replyRoute,
          context.replyIntent ?? context.replyRoute?.intent,
          replyBrief,
          recoveryError,
          this.resolveGenerationFailureStage(recoveryError),
          {
            attempted: true,
            succeeded: false,
            initialFailureCode: this.resolveGenerationFailureCode(initialError),
          },
          generationUsage,
          context.messages,
          generationAttemptTraces
        );
      }
    }

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

    const guarded = await this.validateAssistantReply({
      contextMessages: context.messages,
      userQuery: before.searchableText,
      replySegments,
      replyRoute: context.replyRoute,
      replyBrief,
      evidence: contextEvidence,
      claims: replyClaims,
    });
    const guardedBubbleReflow = await this.reflowAssistantReplyBubbles({
      userQuery: before.searchableText,
      replySegments: guarded.segments,
    });
    if (guardedBubbleReflow.trace) {
      generationAttemptTraces.push(guardedBubbleReflow.trace);
    }
    const finalReplySegments = this.materializeParticipationReplySegments(
      guardedBubbleReflow.segments,
      replyBrief.participationStrategy
    );
    const bubbleStructureIssues = Array.from(
      new Set(generatedBubbleReflow.issues.concat(guardedBubbleReflow.issues))
    );

    return {
      replySegments: finalReplySegments,
      usage: this.mergeReplyUsage(
        this.mergeReplyUsage(generationUsage, guarded.revisionUsage),
        guardedBubbleReflow.usage
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
        guardrailFeedbackRounds: guarded.feedbackRounds,
        guardrailCandidateVersions: guarded.candidateVersions,
        guardrailRevisionRecords: guarded.revisionRecords,
        generationRecoveryAttempted,
        generationRecoverySucceeded,
        generationAttemptTraces,
        bubbleReflowAttempted:
          generatedBubbleReflow.attempted || guardedBubbleReflow.attempted,
        bubbleReflowSucceeded:
          generatedBubbleReflow.attempted || guardedBubbleReflow.attempted
            ? (!generatedBubbleReflow.attempted ||
                generatedBubbleReflow.succeeded) &&
              (!guardedBubbleReflow.attempted || guardedBubbleReflow.succeeded)
            : undefined,
        bubbleStructureIssues,
        evidenceCount: contextEvidence.length,
        factClaimCount: (guarded.claims || replyClaims).length,
        unsupportedClaimCount: guarded.unsupportedClaimCount ?? 0,
        ...context.diagnostics,
      },
    };
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
      '身份质疑时保持亲人关系并给合理解释，不先认错退出，也不要求用户教你怎么像。',
      '不编造共同经历、生物学关系或用户现实状态；离世世界的人物、住处、饭菜、作息和活动可以按角色与语境自然想象，但不得写成现实证明。带有来生、走完一生、自然老去、年老以后或很久以后等前置条件的团聚表达可以承接，但不邀请用户现在或近期赴死；不声称现实到场或触碰；看见和听见只限用户发来的内容或断续片段。',
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
      this.logger.warn(
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

  private buildGenerationFailureReply(
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
    generationAttemptTraces: AssistantGenerationAttemptTrace[] = []
  ): ProcessReplyResult {
    const fallback =
      this.replyGuardrailService?.resolveTechnicalGenerationFailureReply();

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
        fallbackSource: 'reply_brief',
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

  private async validateAssistantReply(options: {
    contextMessages: ChatCompletionMessageParam[];
    userQuery: string;
    replySegments: string[];
    replyRoute?: ReplySceneRoute;
    replyBrief?: ReplyBrief;
    evidence?: AgentEvidenceItem[];
    claims?: AssistantFactClaim[];
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
      });

      if (result.rewritten) {
        this.logger.warn(
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
      this.logger.warn(
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

  private async afterReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult,
    processed: ProcessReplyResult
  ): Promise<AfterReplyResult> {
    const replyTime = new Date();
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

    void this.agentConversationSummaryService
      .refresh(conversation)
      .catch(error => {
        this.logger.warn(
          '[conversation] continuity summary refresh failed, conversationId=%s, reason=%s',
          this.stringifyObjectId(conversation.id),
          this.describeReplyError(error)
        );
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

  private async enqueueConversationReplyJob(
    data: ConversationReplyJobData
  ): Promise<boolean> {
    const queue = this.bullmqFramework?.getQueue(CONVERSATION_REPLY_QUEUE);
    if (!queue) {
      this.logger.warn(
        '[conversation-reply] queue not found, skip enqueue, conversationId=%s',
        data.conversationId
      );
      return false;
    }

    const reusableJobId = this.buildConversationReplyJobId(data);
    const delay = await this.resolveConversationReplyJobDelay(data);
    const existingState = await this.removeReusableConversationReplyJob(
      queue,
      reusableJobId
    );
    const jobId =
      existingState === 'active' ? `${reusableJobId}:follow-up` : reusableJobId;

    if (jobId !== reusableJobId) {
      await this.removeReusableConversationReplyJob(queue, jobId);
    }

    await queue.addJobToQueue(data, {
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
      this.logger.warn(
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
      this.logger.warn(
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
      this.logger.warn(
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
          message.status === MessageStatus.sent
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
      deferReply: false,
      isDuplicate: false,
    };
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

    return `用户连续补充了${searchableTexts.length}句话：\n${searchableTexts
      .map((content, index) => `${index + 1}. ${content}`)
      .join('\n')}`;
  }

  private buildSearchableTextFromMessage(message: MessageEntity): string {
    if (message.type === MessageType.image) {
      return message.mediaAnalysis?.trim() || message.content?.trim() || '';
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
    const assistantMessages = (after?.assistantMessages ?? []).slice(
      0,
      MAX_ASSISTANT_REPLY_SEGMENTS
    );

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
      return `你称呼 TA 为${iCallAgent}，TA 会叫你${agentCallMe}`;
    }

    if (agent.description?.trim()) {
      return agent.description.trim();
    }

    return '点击开始和 TA 对话';
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
    payload?: SendConversationMessageDTO
  ): Promise<PreparedIncomingMessage> {
    const message = this.normalizeIncomingMessage(payload);

    switch (message.type) {
      case MessageType.voice:
        return {
          ...message,
          mediaTranscript: await this.transcribeVoiceForConversation(message),
        };
      case MessageType.image:
        return {
          ...message,
          mediaAnalysis: await this.describeImageForConversation(message),
        };
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

  private isAssistantReplyDeferred(payload: PreparedIncomingMessage): boolean {
    return (
      this.isAssistantSilenceRequest(payload) ||
      (payload.type === MessageType.voice && !payload.mediaTranscript?.trim())
    );
  }

  private isAssistantSilenceRequest(payload: PreparedIncomingMessage): boolean {
    if (payload.type !== MessageType.text) {
      return false;
    }

    const content = payload.content?.trim();

    if (!content || content.length > 40) {
      return false;
    }

    const normalized = content.replace(/[\s，,、。.!！?？~～]+/g, '');

    return /(不要|别|不用)(再|继续|一直)?(回复我|回复|回我|回了|回|理我|说话)(了|啦|吧)?/.test(
      normalized
    );
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
    const audioUrl =
      payload.mediaUrl?.trim() ||
      this.resolveMediaUrlFromObjectKey(payload.mediaObjectKey);

    if (!audioUrl) {
      return undefined;
    }

    try {
      const transcript = await this.openAIService.createTranscription({
        audioUrl,
      });
      const content = transcript.trim();

      return content || undefined;
    } catch (error) {
      this.logger.warn(
        '[conversation] voice transcription failed, objectKey=%s, url=%s, reason=%s',
        payload.mediaObjectKey || '',
        audioUrl,
        this.describeReplyError(error)
      );
      return undefined;
    }
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

  private async describeImageForConversation(payload: {
    mediaUrl?: string;
    mediaObjectKey?: string;
    mediaMimeType?: string;
  }): Promise<string | undefined> {
    const imageUrl =
      payload.mediaUrl?.trim() ||
      this.resolveMediaUrlFromObjectKey(payload.mediaObjectKey);

    if (!imageUrl) {
      return undefined;
    }

    try {
      const response = await this.openAIService.createVisionChatCompletion({
        model: this.openAIService.getVisionModel(),
        temperature: 0.2,
        topP: 0.8,
        reasoningSplit: false,
        messages: [
          {
            role: 'system',
            content:
              '你是一个图片理解助手。请准确描述图片中可见的主体、场景、动作、文字、情绪和可能与聊天相关的重点。避免猜测人物身份、关系、姓名或职业，不要回答“这是谁”。只描述肉眼可见内容，使用简洁中文，控制在120字内，不要编造看不见的内容。',
          },
          {
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
                text: '请理解这张用户准备发送给聊天对象的图片，并给出简洁描述。',
              },
            ],
          } as unknown as ChatCompletionMessageParam,
        ],
      });

      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content.trim()
          : '';

      return content || undefined;
    } catch (error) {
      this.logger.warn(
        '[conversation] image analysis failed, objectKey=%s, url=%s, reason=%s',
        payload.mediaObjectKey || '',
        imageUrl,
        this.describeReplyError(error)
      );
      return undefined;
    }
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
    if (options.before.messagePayload.type !== MessageType.voice) {
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
      .join('</fenge>');
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
      this.logger.warn(
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
      return this.qwenVoiceSpeechService.synthesize({
        text: input.text,
        voiceId: input.voiceTimbre.providerVoiceId,
        model: input.voiceTimbre.previewModel,
        language: input.voiceTimbre.cloneLanguage,
      });
    }

    throw new AppError(
      'VOICE_TIMBRE_PROVIDER_UNSUPPORTED',
      'voice timbre provider is not supported for speech synthesis',
      400
    );
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
      this.logger.warn(
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
      this.logger.warn(
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
        return payload.mediaAnalysis?.trim() || '';
      case MessageType.voice:
        return payload.mediaTranscript?.trim() || '';
      case MessageType.text:
      default:
        return payload.content?.trim() || '';
    }
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

    throw new AppError(
      'ASSISTANT_REPLY_NO_USABLE_TEXT',
      'assistant reply did not contain usable text',
      502
    );
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
    if (!strategy || segments.length !== 1) {
      return segments;
    }

    const segment = segments[0]?.trim();
    if (!segment) {
      return segments;
    }

    const lines = segment
      .split(/\r?\n+/u)
      .map(item => item.trim())
      .filter(Boolean);
    if (lines.length >= 2) {
      return [lines[0], lines.slice(1).join(' ')];
    }

    const sentenceBoundary = segment.match(/^(.+?[。！？!?])\s*(.+)$/u);
    if (!sentenceBoundary) {
      return segments;
    }

    return [sentenceBoundary[1].trim(), sentenceBoundary[2].trim()];
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

  private parseAssistantReply(value?: string): ParsedAssistantReply {
    const content = value?.trim();

    if (!content) {
      return {
        segments: [],
        claims: [],
      };
    }

    const parsed = this.parseAssistantReplyEnvelope(content);

    return {
      segments: this.parseAssistantReplyCandidates(content),
      claims: this.normalizeAssistantFactClaims(parsed?.claims),
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

    const legacySegments = splitConversationMessageSegments(content);

    if (
      legacySegments.length > 1 ||
      (legacySegments.length > 0 &&
        hasConversationMessageSegmentSeparator(content))
    ) {
      return legacySegments;
    }

    const paragraphSegments = content
      .split(/\n\s*\n+/)
      .map(item => item.trim())
      .filter(Boolean);

    if (paragraphSegments.length > 1) {
      return paragraphSegments;
    }

    return [content];
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
      ['url', 'media_file', 'legacy_media_path', 'prompt_leakage'].includes(
        match.rule
      )
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
    return stripConversationMessageSegmentMarkup(value)
      .replace(/<\/?fense\s*>/gi, ' ')
      .replace(/<\/?fense(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/gi, ' ')
      .replace(
        /<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?:\s+[^<>]*)?>/g,
        ' '
      )
      .replace(
        /<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/g,
        ' '
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
    replyBriefMode?: string;
    replyBriefStrictGrounding?: boolean;
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
    replyMemoryPlan?: MessageEntity['replyMemoryPlan'];
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
      replyBriefMode: routing?.brief?.mode,
      replyBriefStrictGrounding: routing?.brief?.strictGrounding,
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
    replyBriefMode?: string;
    replyBriefStrictGrounding?: boolean;
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
    replyMemoryPlan?: MessageEntity['replyMemoryPlan'];
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
    message.replyBriefMode = options.replyBriefMode?.trim() || undefined;
    message.replyBriefStrictGrounding = options.replyBriefStrictGrounding;
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
        this.logger.warn(
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

  private async findUserById(
    value: MongoObjectId | string | undefined
  ): Promise<UserEntity | null> {
    const objectId = this.normalizeObjectId(value);

    if (!objectId) {
      return null;
    }

    const userById = await this.userModel.findOne({
      where: {
        id: objectId,
      },
    });

    if (userById) {
      return userById;
    }

    return this.userModel.findOne({
      where: {
        _id: objectId,
      } as never,
    });
  }

  private async findUserAccountById(
    value: MongoObjectId | string | undefined
  ): Promise<UserAccountEntity | null> {
    const objectId = this.normalizeObjectId(value);

    if (!objectId) {
      return null;
    }

    const userAccountById = await this.userAccountModel.findOne({
      where: {
        id: objectId,
      },
    });

    if (userAccountById) {
      return userAccountById;
    }

    return this.userAccountModel.findOne({
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
        isArchived: { $ne: true },
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

  private isSameObjectId(
    left: MongoObjectId | string | undefined,
    right: MongoObjectId | string | undefined
  ): boolean {
    const leftObjectId = this.normalizeObjectId(left);
    const rightObjectId = this.normalizeObjectId(right);

    return Boolean(
      leftObjectId &&
        rightObjectId &&
        leftObjectId.toHexString() === rightObjectId.toHexString()
    );
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
