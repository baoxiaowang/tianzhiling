import { Inject, Logger } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  AgentEntity,
  AgentMembershipEntity,
  AgentMembershipStatus,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { Provide } from '@midwayjs/core';
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
import { MinimaxVoiceSpeechService } from './minimax-voice-speech.service';

export interface ConversationSummary {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  agentSex: number;
  agentCallMe: string;
  iCallAgent: string;
  isVip: boolean;
  preview: string;
  updatedAt: string;
  createdAt: string;
}

export interface SendConversationMessageResult {
  userMessage: ConversationMessageItem;
  assistantMessage?: ConversationMessageItem;
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
  mediaUrl: string;
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
}

interface ReplyUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface ProcessReplyResult {
  replyContent: string;
  usage: ReplyUsage;
}

interface AfterReplyResult {
  assistantMessage: MessageEntity;
}

@Provide()
export class ConversationService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentMembershipEntity)
  agentMembershipModel: MongoRepository<AgentMembershipEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

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
    const vipAgentIds = await this.getVipAgentIdSet(
      userId,
      conversations.map(conversation => conversation.agentId)
    );

    return Promise.all(
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
          isVip: vipAgentIds.has(agentId),
          preview: this.buildPreview(agent, latestMessage),
          updatedAt: conversation.updatedAt?.toISOString?.() ?? '',
          createdAt: conversation.createdAt?.toISOString?.() ?? '',
        };
      })
    );
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
    const userMessage = await this.saveMessage({
      conversationId: runtime.conversation.id,
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
    };
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
      messages: context.messages,
    });
    const replyContent = this.normalizeAssistantReply(
      typeof response.choices?.[0]?.message?.content === 'string'
        ? response.choices[0].message.content
        : ''
    );

    return {
      replyContent,
      usage: this.extractUsageFromResponse(response),
    };
  }

  private async afterReply(
    runtime: ReplyRuntime,
    before: BeforeReplyResult,
    processed: ProcessReplyResult
  ): Promise<AfterReplyResult> {
    const replyTime = new Date();
    const assistantMessage = await this.createAssistantReplyMessage({
      conversationId: runtime.conversation.id,
      agent: runtime.agent,
      replyContent: processed.replyContent,
      preferVoiceReply: this.shouldPreferVoiceReply(before.messagePayload),
      replyTime,
      usage: processed.usage,
    });

    await this.touchConversation(runtime.conversation, replyTime);

    return {
      assistantMessage,
    };
  }

  private buildSendMessageResult(
    before: BeforeReplyResult,
    after?: AfterReplyResult
  ): SendConversationMessageResult {
    return {
      userMessage: this.messageService.buildConversationMessageItem(
        before.userMessage
      ),
      assistantMessage: after?.assistantMessage
        ? this.messageService.buildConversationMessageItem(
            after.assistantMessage
          )
        : undefined,
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
      payload.type === MessageType.voice && !payload.mediaTranscript?.trim()
    );
  }

  private shouldPreferVoiceReply(payload: PreparedIncomingMessage): boolean {
    return payload.type === MessageType.voice;
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
    const objectKey = payload?.objectKey?.trim() || '';
    const explicitUrl = payload?.mediaUrl?.trim() || '';
    const resolvedUrl =
      explicitUrl ||
      (objectKey ? this.resolveMediaUrlFromObjectKey(objectKey) : '');
    const durationMs = this.normalizeVoiceDuration(payload?.durationMs);
    const mimeType = payload?.mimeType?.trim() || '';

    if (!objectKey && !resolvedUrl) {
      throw new AppError(
        'INVALID_MESSAGE_VOICE',
        'voice message asset is required',
        400
      );
    }

    return {
      type: MessageType.voice,
      content: '[语音]',
      mediaObjectKey: objectKey || undefined,
      mediaUrl: !objectKey && resolvedUrl ? resolvedUrl : undefined,
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
    const objectKey = payload?.objectKey?.trim() || '';
    const explicitUrl = payload?.mediaUrl?.trim() || '';
    const resolvedUrl =
      explicitUrl ||
      (objectKey ? this.resolveMediaUrlFromObjectKey(objectKey) : '');
    const mimeType = payload?.mimeType?.trim() || '';

    if (!objectKey && !resolvedUrl) {
      throw new AppError(
        'INVALID_MESSAGE_IMAGE',
        'image message asset is required',
        400
      );
    }

    return {
      type: MessageType.image,
      content: '[图片]',
      mediaObjectKey: objectKey || undefined,
      mediaUrl: !objectKey && resolvedUrl ? resolvedUrl : undefined,
      mediaMimeType: mimeType || undefined,
    };
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

  private async createAssistantReplyMessage(options: {
    conversationId: MongoObjectId;
    agent?: AgentEntity | null;
    replyContent: string;
    preferVoiceReply: boolean;
    replyTime: Date;
    usage: {
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }): Promise<MessageEntity> {
    const voiceTimbre = options.preferVoiceReply
      ? await this.findActiveVoiceTimbreForAgent(options.agent)
      : undefined;
    const synthesizedVoice = voiceTimbre
      ? await this.synthesizeAssistantVoiceReply(
          options.replyContent,
          voiceTimbre
        )
      : undefined;

    if (synthesizedVoice) {
      return this.saveMessage({
        conversationId: options.conversationId,
        role: MessageRole.assistant,
        type: MessageType.voice,
        content: options.replyContent,
        status: MessageStatus.sent,
        mediaUrl: synthesizedVoice.mediaUrl,
        mediaMimeType: synthesizedVoice.mediaMimeType,
        mediaDurationMs: synthesizedVoice.mediaDurationMs,
        mediaTranscript: synthesizedVoice.transcript,
        model: options.usage.model,
        promptTokens: options.usage.promptTokens,
        completionTokens: options.usage.completionTokens,
        totalTokens: options.usage.totalTokens,
        createdAt: options.replyTime,
        updatedAt: options.replyTime,
      });
    }

    return this.saveMessage({
      conversationId: options.conversationId,
      role: MessageRole.assistant,
      type: MessageType.text,
      content: options.replyContent,
      status: MessageStatus.sent,
      model: options.usage.model,
      promptTokens: options.usage.promptTokens,
      completionTokens: options.usage.completionTokens,
      totalTokens: options.usage.totalTokens,
      createdAt: options.replyTime,
      updatedAt: options.replyTime,
    });
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
        sourceUrl: synthesized.audioUrl,
        mimeType: synthesized.mimeType,
      });

      return {
        mediaUrl: stored.mediaUrl,
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
      .filter(Boolean);

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
    sourceUrl: string;
    mimeType?: string;
  }): Promise<{
    mediaUrl: string;
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
          mediaUrl: uploaded.url,
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
          mediaUrl: uploaded.url,
          mediaMimeType: mimeType,
        };
      }
    } catch (error) {
      this.logger.warn(
        '[conversation] assistant voice asset upload failed, reason=%s',
        this.describeReplyError(error)
      );
    }

    return {
      mediaUrl: input.sourceUrl,
      mediaMimeType: mimeType,
    };
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

  private normalizeAssistantReply(value?: string): string {
    const segments = this.parseAssistantSegments(value)
      .map(segment => this.sanitizeAssistantSegment(segment))
      .filter(Boolean);

    if (segments.length > 0) {
      return segments.join('</fenge>');
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
        .filter(Boolean)
        .slice(0, 3);

      if (segments.length > 0) {
        return segments.map(segment =>
          segment.replace(/<\/fenge>/gi, ' ').trim()
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

    const legacySegments = content
      .split('</fenge>')
      .map(item => item.trim())
      .filter(Boolean);

    if (legacySegments.length > 1) {
      return legacySegments.slice(0, 3);
    }

    const paragraphSegments = content
      .split(/\n\s*\n+/)
      .map(item => item.trim())
      .filter(Boolean);

    if (paragraphSegments.length > 1) {
      return paragraphSegments.slice(0, 3);
    }

    return [content];
  }

  private sanitizeAssistantSegment(value?: string): string {
    const content = value?.trim() || '';

    if (!content) {
      return '';
    }

    const hasChinese = /[\u3400-\u9FFF]/.test(content);
    let normalized = content;

    if (hasChinese) {
      normalized = normalized.replace(
        /(^|[\s，。！？、；：,.!?;:（）()【】[\]'"“”‘’<>《》-])([A-Za-z]{2,})(?=$|[\s，。！？、；：,.!?;:（）()【】[\]'"“”‘’<>《》-])/g,
        (_, prefix: string) => prefix
      );
    }

    return normalized
      .replace(/\s+/g, ' ')
      .replace(/\s+([，。！？、；：])/g, '$1')
      .replace(/([（【《“‘])\s+/g, '$1')
      .replace(/\s+([）】》”’])/g, '$1')
      .trim();
  }

  private async saveMessage(options: {
    conversationId: MongoObjectId;
    role: MessageRole;
    type: MessageType;
    content: string;
    status: MessageStatus;
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
    message.role = options.role;
    message.type = options.type;
    message.content = options.content;
    message.status = options.status;
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

  private async getVipAgentIdSet(
    userId: MongoObjectId,
    agentIds: Array<MongoObjectId | string | undefined>
  ): Promise<Set<string>> {
    const uniqueAgentIds = new Map<string, MongoObjectId>();

    agentIds.forEach(agentId => {
      const objectId = this.normalizeObjectId(agentId);

      if (objectId) {
        uniqueAgentIds.set(this.stringifyObjectId(objectId), objectId);
      }
    });

    if (uniqueAgentIds.size === 0) {
      return new Set();
    }

    const memberships = await this.agentMembershipModel.find({
      where: {
        userId,
        agentId: { $in: [...uniqueAgentIds.values()] },
        status: AgentMembershipStatus.active,
      } as never,
    });
    const now = new Date();

    return new Set(
      memberships
        .filter(
          membership =>
            membership.lifetime ||
            Boolean(membership.expiredAt && membership.expiredAt > now)
        )
        .map(membership => this.stringifyObjectId(membership.agentId))
    );
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
      },
      order: {
        createdAt: 'DESC',
      },
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
