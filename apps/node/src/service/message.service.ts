import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { TencentCosService } from './tencent-cos.service';

const MESSAGE_SEGMENT_LIMIT = 4;

export interface ConversationMessageItem {
  id: string;
  conversationId: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  segments: string[];
  status: MessageStatus;
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
  usage?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  updatedAt: string;
  createdAt: string;
}

@Provide()
export class MessageService {
  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  tencentCosService: TencentCosService;

  async listMessages(
    auth: AuthenticatedUserPayload,
    conversationId: string
  ): Promise<ConversationMessageItem[]> {
    const conversation = await this.getConversationForUser(
      auth,
      conversationId
    );
    const messages = await this.messageModel.find({
      where: {
        conversationId: conversation.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return messages.map(message => this.buildConversationMessageItem(message));
  }

  buildConversationMessageItem(
    message: MessageEntity
  ): ConversationMessageItem {
    const type = this.normalizeMessageType(message.type);
    const segments =
      type === MessageType.text
        ? this.extractSegmentsFromContent(message.content)
        : [];

    return {
      id: this.stringifyObjectId(message.id),
      conversationId: this.stringifyObjectId(message.conversationId),
      role: message.role,
      type,
      content: message.content,
      segments,
      status: message.status,
      voice:
        type === MessageType.voice
          ? {
              objectKey: message.mediaObjectKey?.trim() || undefined,
              url: this.buildClientMediaUrlField(message),
              mimeType: message.mediaMimeType?.trim() || undefined,
              durationMs: this.normalizeVoiceDuration(message.mediaDurationMs),
              transcript: message.mediaTranscript?.trim() || undefined,
            }
          : undefined,
      image:
        type === MessageType.image
          ? {
              objectKey: message.mediaObjectKey?.trim() || undefined,
              url: this.buildClientMediaUrlField(message),
              mimeType: message.mediaMimeType?.trim() || undefined,
              analysis: message.mediaAnalysis?.trim() || undefined,
            }
          : undefined,
      usage: this.buildUsageItem(message),
      updatedAt: message.updatedAt?.toISOString?.() ?? '',
      createdAt: message.createdAt?.toISOString?.() ?? '',
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
}
