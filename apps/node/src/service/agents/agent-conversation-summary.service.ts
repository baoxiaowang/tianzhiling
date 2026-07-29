import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { stripPromptLeakageContent } from '../../common/message-content-safety';
import { OpenAIService } from './openai';

const SUMMARY_VERSION = 'continuity_summary_v2';
const RECENT_MESSAGES_TO_EXCLUDE = 12;
const MIN_NEW_MESSAGES_TO_SUMMARIZE = 8;
const MAX_SUMMARY_SOURCE_MESSAGES = 40;
const MAX_SUMMARY_LENGTH = 500;

@Provide()
export class AgentConversationSummaryService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  openAIService: OpenAIService;

  async refresh(conversation: ConversationEntity): Promise<void> {
    if (!this.openAIService?.isEnabled?.()) {
      return;
    }

    const messages = (
      await this.messageModel.find({
        where: {
          conversationId: conversation.id,
        },
        order: {
          createdAt: 'ASC',
        },
      })
    ).filter(
      message =>
        !message.isArchived &&
        message.status === MessageStatus.sent &&
        Boolean(this.buildMessageText(message))
    );
    const summaryEndIndex = messages.length - RECENT_MESSAGES_TO_EXCLUDE;

    if (summaryEndIndex < MIN_NEW_MESSAGES_TO_SUMMARIZE) {
      return;
    }

    const coveredMessageId = this.stringifyObjectId(
      conversation.continuitySummaryCoveredMessageId
    );
    const coveredIndex = coveredMessageId
      ? messages.findIndex(
          message => this.stringifyObjectId(message.id) === coveredMessageId
        )
      : -1;
    const newMessages = messages.slice(coveredIndex + 1, summaryEndIndex);

    if (newMessages.length < MIN_NEW_MESSAGES_TO_SUMMARIZE) {
      return;
    }

    const sourceMessages = newMessages.slice(-MAX_SUMMARY_SOURCE_MESSAGES);
    const transcript = sourceMessages
      .map(message => {
        const role =
          message.role === MessageRole.user
            ? '用户'
            : message.role === MessageRole.assistant
            ? '历史助手'
            : '系统';

        return `[${this.stringifyObjectId(
          message.id
        )}][${role}] ${this.buildMessageText(message)}`;
      })
      .join('\n');
    const result = await this.openAIService.generateText({
      temperature: 0,
      topP: 0.1,
      reasoningSplit: false,
      maxTokens: 500,
      systemPrompt: [
        '你是对话状态压缩器，只维护继续聊天所需的最小状态。',
        '只概括用户明确说过的话、当前话题和尚未结束的线索，不能补充事实。',
        '历史助手内容只能帮助理解对话顺序，不能成为用户经历、人物关系或共同记忆的来源。',
        '不要写散文，不保留无价值寒暄。每个字段不超过80字，没有则用空字符串。',
        '输出严格 JSON：{"topic":"","userState":"","responded":"","unresolved":""}。不要输出其他字段。',
      ].join('\n'),
      prompt: [
        conversation.continuitySummary?.trim()
          ? `已有摘要：${conversation.continuitySummary.trim()}`
          : '',
        '新增对话：',
        transcript,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    const summary = this.parseSummary(result.content);

    if (!summary) {
      return;
    }

    const lastCoveredMessage = sourceMessages[sourceMessages.length - 1];
    conversation.continuitySummary = summary;
    conversation.continuitySummaryCoveredMessageId = lastCoveredMessage.id;
    conversation.continuitySummaryEvidenceMessageIds = sourceMessages
      .filter(message => message.role === MessageRole.user)
      .map(message => message.id)
      .slice(-20);
    conversation.continuitySummaryVersion = SUMMARY_VERSION;
    conversation.continuitySummaryUpdatedAt = new Date();

    await this.conversationModel.save(conversation);
  }

  private parseSummary(value: string): string {
    const content = value?.trim();

    if (!content) {
      return '';
    }

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const legacySummary = this.normalizeSummaryField(parsed.summary);

      if (legacySummary) {
        return legacySummary.slice(0, MAX_SUMMARY_LENGTH);
      }

      const fields = [
        ['当前话题', this.normalizeSummaryField(parsed.topic)],
        ['用户状态', this.normalizeSummaryField(parsed.userState)],
        ['已经回应', this.normalizeSummaryField(parsed.responded)],
        ['未解决', this.normalizeSummaryField(parsed.unresolved)],
      ]
        .filter((item): item is [string, string] => Boolean(item[1]))
        .map(([label, text]) => `${label}：${text}`);

      return fields.join('\n').slice(0, MAX_SUMMARY_LENGTH);
    } catch {
      return '';
    }
  }

  private normalizeSummaryField(value: unknown): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, 120)
      : '';
  }

  private buildMessageText(message: MessageEntity): string {
    if (message.type === MessageType.voice) {
      return stripPromptLeakageContent(message.mediaTranscript);
    }

    if (message.type === MessageType.image) {
      return message.role === MessageRole.user
        ? stripPromptLeakageContent(message.mediaAnalysis)
        : '';
    }

    return stripPromptLeakageContent(message.content);
  }

  private stringifyObjectId(value?: MongoObjectId): string {
    return value?.toHexString?.() ?? (value ? String(value) : '');
  }
}
