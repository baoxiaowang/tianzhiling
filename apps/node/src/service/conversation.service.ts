import { Inject, Logger } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
import { RedisService } from '@midwayjs/redis';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
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
  containsUnsafeAssistantMessageContent,
  stripPromptLeakageContent,
} from '../common/message-content-safety';
import {
  hasConversationMessageSegmentSeparator,
  splitConversationMessageSegments,
  stripConversationMessageSegmentMarkup,
} from '../common/conversation-message-segments';
import {
  SendConversationMessageDTO,
  TranscribeConversationVoiceDTO,
} from '../dto/conversation.dto';
import { AgentContextService } from './agents/agent.context';
import { OpenAIService } from './agents/openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ConversationMessageItem, MessageService } from './message.service';
import { PostImageService } from './post-image.service';
import { OssService } from './oss.service';
import { TencentCosService } from './tencent-cos.service';
import { MilvusService } from './rag/milvus.service';
import { CosyVoiceSpeechService } from './cosyvoice-speech.service';
import { MinimaxVoiceSpeechService } from './minimax-voice-speech.service';
import { QwenVoiceSpeechService } from './qwen-voice-speech.service';

const ASSISTANT_REPLY_SEGMENT_LIMIT = 4;
const ASSISTANT_REPLY_TEMPERATURE = 0.2;
const ASSISTANT_REPLY_TOP_P = 0.8;
const UNSAFE_ASSISTANT_PRESENCE_PATTERNS = [
  /(?:闭上眼|梦里|夜里|晚上|屋里|房间|角落|床边|身边|旁边|耳边)[^，。！？!?]{0,36}(?:我就在|我会在|陪着你|守着你|等着你|回来了|回来)/,
  /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,16}(?:能|会|准能|一定能|都能)(?:听到|听见|看到|看见)/,
  /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷)[^，。！？!?]{0,16}(?:走到|来到|回到|站在|坐在|守在|陪在|靠在|抱着|握着|擦掉|擦干)/,
] as const;
const CONVERSATION_REPLY_JOB_DELAY_MS = 1200;
const CONVERSATION_REPLY_LOCK_TTL_MS = 2 * 60 * 1000;
export const CONVERSATION_REPLY_QUEUE = 'conversation-reply';
const NON_VIP_CHAT_LIMIT_POLICY = {
  trialDays: 3, // 3 天试用期
  trialPerAgentLimit: 30, // 3 天内每个 agent 30 句
  dailyPerAgentLimit: 3, // 3 天后每天每个 agent 3 句
  dayBoundaryOffsetMinutes: 8 * 60, // 按北京时间切日
} as const;

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

export interface VoiceTranscriptionResult {
  transcript: string;
}

interface PreparedIncomingMessage {
  type: MessageType;
  content: string;
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

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  agentContextService: AgentContextService;

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

    if (before.deferReply) {
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

    if (messageType !== MessageType.text) {
      throw new AppError(
        'ASYNC_CONVERSATION_MESSAGE_UNSUPPORTED',
        'async conversation messages only support text',
        400
      );
    }

    const before = await this.beforeReply(runtime, {
      ...payload,
      type: MessageType.text,
    });
    const shouldReply = !before.deferReply;

    if (shouldReply) {
      await this.enqueueConversationReplyJob({
        conversationId: this.stringifyObjectId(runtime.conversation.id),
        userId: auth.sub,
      });
    }

    return {
      ...this.buildSendMessageResult(before),
      replyPending: shouldReply,
    };
  }

  async processConversationReplyJob(
    data: ConversationReplyJobData
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
    const messagePayload = await this.prepareIncomingMessage(payload);
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

    const rule = this.resolveNonVipChatLimitRule(user, now);
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
      return `非会员注册前${NON_VIP_CHAT_LIMIT_POLICY.trialDays}天内，每位亲友可主动聊${limit}句。开通会员后可继续畅聊。`;
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
    user: UserEntity,
    now: Date
  ): NonVipChatLimitRule {
    const registeredAt = this.normalizeUserRegisteredAt(user);
    const trialEndsAt = new Date(
      registeredAt.getTime() +
        NON_VIP_CHAT_LIMIT_POLICY.trialDays * 24 * 60 * 60 * 1000
    );

    if (now < trialEndsAt) {
      return {
        policy: 'trial',
        limit: NON_VIP_CHAT_LIMIT_POLICY.trialPerAgentLimit,
        windowStart: registeredAt,
        windowEnd: trialEndsAt,
      };
    }

    const windowStart = this.getBeijingDayStart(now);
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

    return {
      policy: 'daily',
      limit: NON_VIP_CHAT_LIMIT_POLICY.dailyPerAgentLimit,
      windowStart,
      windowEnd,
    };
  }

  private normalizeUserRegisteredAt(user: UserEntity): Date {
    const registeredAt = new Date(user.createdAt ?? 0);

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

  private async processReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult
  ): Promise<ProcessReplyResult> {
    const context = await this.agentContextService.buildConversationContext({
      auth: runtime.auth,
      conversation: runtime.conversation,
      agent: runtime.agent,
      currentQuery: before.searchableText,
    });
    const response = await this.openAIService.createChatCompletion({
      temperature: ASSISTANT_REPLY_TEMPERATURE,
      topP: ASSISTANT_REPLY_TOP_P,
      messages: context.messages,
    });
    const replySegments = this.normalizeAssistantReplySegments(
      typeof response.choices?.[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : ''
    );

    return {
      replySegments,
      usage: this.extractUsageFromResponse(response),
    };
  }

  private async afterReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult,
    processed: ProcessReplyResult
  ): Promise<AfterReplyResult> {
    const replyTime = new Date();
    const assistantMessages = await this.createAssistantReplyMessages({
      conversationId: runtime.conversation.id,
      userId: runtime.conversation.userId,
      agentId: runtime.conversation.agentId,
      replySegments: processed.replySegments,
      replyTime,
      usage: processed.usage,
    });

    await this.touchConversation(
      runtime.conversation,
      assistantMessages[assistantMessages.length - 1]?.updatedAt ?? replyTime
    );

    return {
      assistantMessages,
    };
  }

  private async enqueueConversationReplyJob(
    data: ConversationReplyJobData
  ): Promise<void> {
    const queue = this.bullmqFramework?.getQueue(CONVERSATION_REPLY_QUEUE);
    if (!queue) {
      this.logger.warn(
        '[conversation-reply] queue not found, skip enqueue, conversationId=%s',
        data.conversationId
      );
      return;
    }

    await queue.addJobToQueue(data, {
      jobId: `conversation-reply:${data.conversationId}:${Date.now()}:${Math.random()
        .toString(16)
        .slice(2)}`,
      delay: CONVERSATION_REPLY_JOB_DELAY_MS,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });
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
    const sentMessages = messages.filter(
      message => message.status === MessageStatus.sent && !message.isArchived
    );

    if (options.afterUserCreatedAt) {
      return sentMessages.filter(
        message =>
          message.role === MessageRole.user &&
          message.createdAt > options.afterUserCreatedAt!
      );
    }

    const latestAssistantIndex = sentMessages.reduce(
      (latestIndex, message, index) =>
        message.role === MessageRole.assistant ? index : latestIndex,
      -1
    );

    return sentMessages
      .slice(latestAssistantIndex + 1)
      .filter(message => message.role === MessageRole.user);
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
    const latestUserMessage = pendingUserMessages[pendingUserMessages.length - 1];
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
    const assistantMessages = after?.assistantMessages ?? [];

    return {
      userMessage: this.messageService.buildConversationMessageItem(
        before.userMessage
      ),
      assistantMessage: this.buildLegacyAssistantMessageItem(
        assistantMessages
      ),
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
    replyTime: Date;
    usage: {
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }): Promise<MessageEntity[]> {
    const replyGroupId = new MongoObjectId().toHexString();
    const messages: MessageEntity[] = [];

    for (const [index, segment] of options.replySegments.entries()) {
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
          createdAt: segmentTime,
          updatedAt: segmentTime,
        })
      );
    }

    return messages;
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
    const segments = this.parseAssistantSegments(replyContent)
      .map(segment => this.sanitizeAssistantSegment(segment))
      .filter(Boolean)
      .slice(0, ASSISTANT_REPLY_SEGMENT_LIMIT);

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

  private normalizeAssistantReplySegments(value?: string): string[] {
    const parsedSegments = this.parseAssistantSegments(value);
    const segments = parsedSegments
      .reduce<string[]>(
        (result, segment) =>
          result.concat(this.splitAssistantSegmentForChat(segment)),
        []
      )
      .map(segment => this.sanitizeAssistantSegment(segment))
      .filter(Boolean)
      .slice(0, ASSISTANT_REPLY_SEGMENT_LIMIT);

    if (segments.length > 0) {
      return segments;
    }

    throw new AppError(
      'MINIMAX_EMPTY_REPLY',
      'MiniMax returned an empty reply',
      502
    );
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

  private parseAssistantSegments(value?: string): string[] {
    const content = value?.trim();

    if (!content) {
      return [];
    }

    try {
      const parsed = JSON.parse(content) as {
        segments?: unknown;
      };
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
    } catch {
      // Fall back to legacy text splitting so older prompts still render.
    }

    return this.extractSegmentsFromContent(content);
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

  private splitAssistantSegmentForChat(value?: string): string[] {
    const content = value?.trim() || '';

    if (!content) {
      return [];
    }

    const shouldSplit =
      content.length > 18 || /[，。；;][^，。；;]{3,}/.test(content);

    if (!shouldSplit) {
      return [content];
    }

    const parts = content
      .split(/[，。；;]+/)
      .map(item => item.trim())
      .filter(Boolean);

    return parts.length > 1 ? parts : [content];
  }

  private sanitizeAssistantSegment(value?: string): string {
    const content = value?.trim() || '';

    if (!content) {
      return '';
    }

    let normalized = this.stripAssistantMarkup(content);
    normalized = stripPromptLeakageContent(normalized);
    normalized = this.stripAssistantStageDirection(normalized);
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

    if (
      containsUnsafeAssistantMessageContent(normalized) ||
      this.containsUnsafeAssistantPresenceClaim(normalized)
    ) {
      return '';
    }

    return normalized;
  }

  private stripAssistantMarkup(value: string): string {
    return stripConversationMessageSegmentMarkup(value)
      .replace(/<\/?fense\s*>/gi, ' ')
      .replace(/<\/?fense(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/gi, ' ')
      .replace(/<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?:\s+[^<>]*)?>/g, ' ')
      .replace(/<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/g, ' ');
  }

  private containsUnsafeAssistantPresenceClaim(value: string): boolean {
    return UNSAFE_ASSISTANT_PRESENCE_PATTERNS.some(pattern =>
      pattern.test(value)
    );
  }

  private stripAssistantStageDirection(value: string): string {
    return value
      .replace(
        /^\s*[（(【\[]\s*(?:声音|语气|动作|神情|表情|轻声|温柔|温和|哽咽|微笑|叹气|沉默|带着)[^）)】\]]{0,32}[）)】\]]\s*/,
        ''
      )
      .trim();
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

  private normalizeTokenCount(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return undefined;
    }

    return Math.floor(value);
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
