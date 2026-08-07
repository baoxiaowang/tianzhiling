import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  hasConversationMessageSegmentSeparator,
  splitConversationMessageSegments,
  stripConversationMessageSegmentMarkup,
} from '../common/conversation-message-segments';
import {
  ConversationChatImportItemEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageSource,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { TencentCosService } from './tencent-cos.service';
import { AgentProfileFactService } from './agents/agent-profile-fact.service';

const MESSAGE_SEGMENT_LIMIT = 4;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 100;

export interface ListConversationMessagesOptions {
  beforeCreatedAt?: string;
  pageSize?: number | string;
  lightweight?: boolean | string;
}

export interface ConversationMessageItem {
  id: string;
  conversationId: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  segments: string[];
  status: MessageStatus;
  source?: MessageSource;
  import?: {
    batchId?: string;
    itemId?: string;
    importedAt?: string;
    occurredAt?: string;
    rawTimeText?: string;
    timePrecision?: string;
    timeConfidence?: string;
    screenshotId?: string;
    sequence?: number;
    recognitionConfidence?: number;
    quotaExempt?: boolean;
    replyTrigger?: boolean;
  };
  voice?: {
    objectKey?: string;
    url?: string;
    mimeType?: string;
    durationMs?: number;
    transcript?: string;
  };
  image?: {
    objectKey?: string;
    url?: string;
    mimeType?: string;
    analysis?: string;
  };
  quote?: {
    messageId?: string;
    role?: MessageRole;
    content?: string;
  };
  usage?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  updatedAt: string;
  createdAt: string;
}

export interface ConversationMessageListResult {
  items: ConversationMessageItem[];
  pageSize?: number;
  hasMore?: boolean;
}

@Provide()
export class MessageService {
  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(ConversationChatImportItemEntity)
  chatImportItemModel: MongoRepository<ConversationChatImportItemEntity>;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  @Inject()
  tencentCosService: TencentCosService;

  async listMessages(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    options: ListConversationMessagesOptions = {}
  ): Promise<ConversationMessageListResult> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const pageSize = this.normalizeOptionalPageSize(options.pageSize);
    const beforeCreatedAt = this.normalizeOptionalDate(options.beforeCreatedAt);
    const lightweight = this.normalizeBoolean(options.lightweight);
    const where: Record<string, unknown> = {
      conversationId: conversation.id,
      isArchived: { $ne: true },
    };

    if (beforeCreatedAt) {
      where.createdAt = { $lt: beforeCreatedAt };
    }

    if (!pageSize) {
      const messages = await this.messageModel.find({
        where: where as never,
        order: {
          createdAt: 'ASC',
        },
      });

      return {
        items: messages
          .filter(message => !message.isArchived)
          .map(message =>
            this.buildConversationMessageItem(message, { lightweight })
          ),
      };
    }

    const messages = await this.messageModel.find({
      where: {
        ...where,
      } as never,
      order: {
        createdAt: 'DESC',
      },
      take: pageSize + 1,
    });
    const pageMessages = messages
      .filter(message => !message.isArchived)
      .slice(0, pageSize)
      .reverse();

    return {
      items: pageMessages.map(message =>
        this.buildConversationMessageItem(message, { lightweight })
      ),
      pageSize,
      hasMore: messages.length > pageSize,
    };
  }

  async deleteMessage(
    auth: AuthenticatedUserPayload,
    conversationId: string,
    messageId: string,
    options: { deleteImportedMemory?: boolean } = {}
  ): Promise<{ archivedMemoryCount: number }> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const objectId = this.parseObjectId(messageId);
    const message = await this.findMessageById(objectId, conversation.id);

    if (!message) {
      throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    }

    if (message.isArchived) {
      return { archivedMemoryCount: 0 };
    }

    const now = new Date();
    message.isArchived = true;
    message.archivedAt = now;
    message.updatedAt = now;

    await this.messageModel.save(message);

    let archivedMemoryCount = 0;
    if (
      message.source === MessageSource.wechatImport &&
      options.deleteImportedMemory === true
    ) {
      archivedMemoryCount =
        await this.agentProfileFactService.removeHistoricalSourceMessage({
          userId: message.userId,
          agentId: message.agentId,
          sourceMessageId: message.id,
        });
    }

    if (message.importItemId) {
      const item =
        (await this.chatImportItemModel.findOne({
          where: { id: message.importItemId },
        })) ||
        (await this.chatImportItemModel.findOne({
          where: { _id: message.importItemId } as never,
        }));
      if (item) {
        item.isDeleted = true;
        item.updatedAt = now;
        await this.chatImportItemModel.save(item);
      }
    }

    return { archivedMemoryCount };
  }

  buildConversationMessageItem(
    message: MessageEntity,
    options: { lightweight?: boolean } = {}
  ): ConversationMessageItem {
    const type = this.normalizeMessageType(message.type);
    const segments =
      type === MessageType.text ? this.extractSegmentsFromContent(message) : [];
    const content =
      type === MessageType.text
        ? this.normalizeTextContentForClient(message.content, segments)
        : message.content;

    return {
      id: this.stringifyObjectId(message.id),
      conversationId: this.stringifyObjectId(message.conversationId),
      role: message.role,
      type,
      content,
      segments,
      status: message.status,
      source: message.source,
      import: this.buildImportItem(message),
      voice: this.buildVoiceItem(message, type),
      image:
        type === MessageType.image
          ? {
              objectKey: message.mediaObjectKey?.trim() || undefined,
              url: this.buildClientMediaUrlField(message),
              mimeType: message.mediaMimeType?.trim() || undefined,
              analysis: message.mediaAnalysis?.trim() || undefined,
            }
          : undefined,
      quote: this.buildQuoteItem(message),
      usage: options.lightweight ? undefined : this.buildUsageItem(message),
      updatedAt: message.updatedAt?.toISOString?.() ?? '',
      createdAt: message.createdAt?.toISOString?.() ?? '',
    };
  }

  private buildImportItem(
    message: MessageEntity
  ): ConversationMessageItem['import'] {
    if (message.source !== MessageSource.wechatImport) {
      return undefined;
    }

    return {
      batchId: message.importBatchId
        ? this.stringifyObjectId(message.importBatchId)
        : undefined,
      itemId: message.importItemId
        ? this.stringifyObjectId(message.importItemId)
        : undefined,
      importedAt: message.importedAt?.toISOString?.(),
      occurredAt: message.sourceOccurredAt?.toISOString?.(),
      rawTimeText: message.sourceRawTimeText?.trim() || undefined,
      timePrecision: message.sourceTimePrecision?.trim() || undefined,
      timeConfidence: message.sourceTimeConfidence?.trim() || undefined,
      screenshotId: message.sourceScreenshotId?.trim() || undefined,
      sequence: this.normalizeTokenCount(message.sourceSequence),
      recognitionConfidence:
        typeof message.recognitionConfidence === 'number'
          ? message.recognitionConfidence
          : undefined,
      quotaExempt: message.quotaExempt === true,
      replyTrigger: message.replyTrigger !== false,
    };
  }

  private buildQuoteItem(
    message: MessageEntity
  ): ConversationMessageItem['quote'] {
    const messageId = message.quotedMessageId
      ? this.stringifyObjectId(message.quotedMessageId)
      : '';
    const content = message.quotedMessageContent?.trim() || '';

    if (!messageId && !content) {
      return undefined;
    }

    return {
      messageId: messageId || undefined,
      role: message.quotedMessageRole,
      content: content || undefined,
    };
  }

  private buildUsageItem(message: MessageEntity):
    | {
        model?: string;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      }
    | undefined {
    const model = message.model?.trim() || '';
    const promptTokens = this.normalizeTokenCount(message.promptTokens);
    const completionTokens = this.normalizeTokenCount(message.completionTokens);
    const totalTokens = this.normalizeTokenCount(message.totalTokens);

    if (!model && !promptTokens && !completionTokens && !totalTokens) {
      return undefined;
    }

    return {
      model: model || undefined,
      promptTokens,
      completionTokens,
      totalTokens,
    };
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

  private buildVoiceItem(
    message: MessageEntity,
    type: MessageType
  ): ConversationMessageItem['voice'] | undefined {
    const canExposeVoice =
      type === MessageType.voice ||
      (type === MessageType.text && message.role === MessageRole.assistant);

    if (!canExposeVoice) {
      return undefined;
    }

    const objectKey = message.mediaObjectKey?.trim() || undefined;
    const url = this.buildClientMediaUrlField(message);
    const mimeType = message.mediaMimeType?.trim() || undefined;
    const durationMs = this.normalizeVoiceDuration(message.mediaDurationMs);
    const transcript = message.mediaTranscript?.trim() || undefined;

    if (type === MessageType.text && !objectKey && !message.mediaUrl?.trim()) {
      return undefined;
    }

    if (!objectKey && !url && !mimeType && !durationMs && !transcript) {
      return undefined;
    }

    return {
      objectKey,
      url,
      mimeType,
      durationMs,
      transcript,
    };
  }

  private buildClientMediaUrlField(message: MessageEntity): string | undefined {
    const objectKey = message.mediaObjectKey?.trim();

    if (objectKey) {
      return undefined;
    }

    return this.resolveMediaUrl(message);
  }

  private normalizeVoiceDuration(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    const durationMs = Math.round(value);
    return durationMs <= 10 * 60 * 1000 ? durationMs : undefined;
  }

  private resolveMediaUrl(message: MessageEntity): string | undefined {
    const explicitUrl = message.mediaUrl?.trim();
    if (explicitUrl) {
      return explicitUrl;
    }

    const objectKey = message.mediaObjectKey?.trim();
    if (!objectKey) {
      return undefined;
    }

    return this.resolveVoiceUrlFromObjectKey(objectKey) || undefined;
  }

  private resolveVoiceUrlFromObjectKey(objectKey?: string): string {
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

  private extractSegmentsFromContent(message: MessageEntity): string[] {
    if (this.isStoredAssistantReplySegment(message)) {
      const content = stripConversationMessageSegmentMarkup(
        message.content?.trim() || ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      return content ? [content] : [];
    }

    const value = message.content;
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
      return legacySegments.slice(0, MESSAGE_SEGMENT_LIMIT);
    }

    const paragraphSegments = content
      .split(/\n\s*\n+/)
      .map(item => item.trim())
      .filter(Boolean);

    if (paragraphSegments.length > 1) {
      return paragraphSegments.slice(0, MESSAGE_SEGMENT_LIMIT);
    }

    return [content];
  }

  private isStoredAssistantReplySegment(message: MessageEntity): boolean {
    return (
      message.role === MessageRole.assistant &&
      message.type === MessageType.text &&
      Boolean(message.replyGroupId?.trim()) &&
      typeof message.replySegmentIndex === 'number' &&
      Number.isFinite(message.replySegmentIndex)
    );
  }

  private normalizeTextContentForClient(
    value: string | undefined,
    segments: string[]
  ): string {
    if (segments.length > 1) {
      return segments.join('</fenge>');
    }

    return stripConversationMessageSegmentMarkup(value?.trim() || '')
      .replace(/\s+/g, ' ')
      .trim();
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

  private async findMessageById(
    messageId: MongoObjectId,
    conversationId: MongoObjectId
  ): Promise<MessageEntity | null> {
    const messageById = await this.messageModel.findOne({
      where: {
        id: messageId,
        conversationId,
      },
    });

    if (messageById) {
      return messageById;
    }

    return this.messageModel.findOne({
      where: {
        _id: messageId,
        conversationId,
      } as never,
    });
  }

  private normalizeTokenCount(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private parseObjectId(value: string): MongoObjectId {
    try {
      return new MongoObjectId(value);
    } catch {
      throw new AppError('INVALID_ID', 'id is invalid', 400);
    }
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private normalizeOptionalPageSize(
    value: number | string | null | undefined
  ): number | null {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_MESSAGE_PAGE_SIZE;
    }

    return Math.min(Math.floor(parsed), MAX_MESSAGE_PAGE_SIZE);
  }

  private normalizeBoolean(
    value: boolean | string | null | undefined
  ): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  private normalizeOptionalDate(value: string | undefined): Date | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('INVALID_CURSOR', 'beforeCreatedAt is invalid', 400);
    }

    return parsed;
  }
}
