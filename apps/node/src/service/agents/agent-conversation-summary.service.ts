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
import {
  countTurnMessages,
  groupMessagesIntoTurns,
  RECENT_HISTORY_TURNS,
} from '../../common/conversation-turns';
import { OpenAIService } from './openai';

const SUMMARY_VERSION = 'continuity_summary_v2';
const MIN_NEW_MESSAGES_TO_SUMMARIZE = 8;
const MAX_SUMMARY_SOURCE_MESSAGES = 40;
// 摘要现在同时承载少量稳定事实（廉价长期记忆），放宽长度避免事实被截掉。
const MAX_SUMMARY_LENGTH = 700;
const MAX_SUMMARY_STABLE_FACTS = 5;
/**
 * 摘要与历史层共用同一套“完整轮次”边界：最近 RECENT_HISTORY_TURNS 轮由原始历史承载，
 * 摘要只压缩更早的消息，消除“摘要覆盖一段、原始历史又只留几条”的独立参数冲突。
 * 多取一些消息用于还原轮次边界。
 */
const SUMMARY_MESSAGE_FETCH_LIMIT = 96;

@Provide()
export class AgentConversationSummaryService {
  private readonly refreshTasks = new Map<string, Promise<void>>();

  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  openAIService: OpenAIService;

  refresh(conversation: ConversationEntity): Promise<void> {
    if (!this.openAIService?.isEnabled?.()) {
      return Promise.resolve();
    }

    const conversationId = this.stringifyObjectId(conversation.id);
    const activeTask = this.refreshTasks.get(conversationId);

    if (activeTask) {
      return activeTask;
    }

    const task = this.refreshOnce(conversation).finally(() => {
      if (this.refreshTasks.get(conversationId) === task) {
        this.refreshTasks.delete(conversationId);
      }
    });
    this.refreshTasks.set(conversationId, task);

    return task;
  }

  private async refreshOnce(conversation: ConversationEntity): Promise<void> {
    const messages = (
      await this.messageModel.find({
        where: {
          conversationId: conversation.id,
          role: { $in: [MessageRole.user, MessageRole.assistant] },
          status: MessageStatus.sent,
          isArchived: { $ne: true },
        } as never,
        order: {
          createdAt: 'DESC',
        },
        take: SUMMARY_MESSAGE_FETCH_LIMIT,
      })
    )
      .filter(
        message =>
          !message.isArchived &&
          message.status === MessageStatus.sent &&
          (message.role === MessageRole.user ||
            message.role === MessageRole.assistant) &&
          Boolean(this.buildMessageText(message))
      )
      .sort((left, right) => {
        const createdAtDelta =
          left.createdAt.getTime() - right.createdAt.getTime();

        return createdAtDelta !== 0
          ? createdAtDelta
          : this.stringifyObjectId(left.id).localeCompare(
              this.stringifyObjectId(right.id)
            );
      });
    const summaryEndIndex = this.resolveSummaryEndIndex(messages);

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
      maxTokens: 700,
      systemPrompt: [
        '你是对话状态压缩器，只维护继续聊天所需的最小状态。',
        '只概括用户明确说过的话、当前话题和尚未结束的线索，不能补充事实。',
        '历史助手内容只能帮助理解对话顺序，不能成为用户经历、人物关系或共同记忆的来源。',
        '不要写散文，不保留无价值寒暄。每个字段不超过80字，没有则用空字符串。',
        // 摘要同时承担“廉价长期记忆”：只保留用户明确说过的稳定事实，
        // 让它们不随最近历史窗口滚出而丢失；这是旧结构化记忆流水线的轻量替代。
        '用户明确说过的稳定家人关系、身份、称呼，写入 stableFacts（最多5条，每条不超过30字）；已有 stableFacts 除非用户明确更正，否则原样保留。',
        '输出严格 JSON：{"topic":"","userState":"","responded":"","unresolved":"","stableFacts":[]}。不要输出其他字段。',
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

  /**
   * 摘要覆盖到“原始历史窗口”之前：最近 RECENT_HISTORY_TURNS 个完整轮次留给原始历史，
   * 这里返回可纳入摘要的消息条数（不含该窗口）。
   */
  private resolveSummaryEndIndex(messages: MessageEntity[]): number {
    const turns = groupMessagesIntoTurns(messages);
    const rawTurnCount = Math.min(RECENT_HISTORY_TURNS, turns.length);
    const rawMessageCount = countTurnMessages(
      turns.slice(turns.length - rawTurnCount)
    );

    return messages.length - rawMessageCount;
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

      const stableFacts = Array.isArray(parsed.stableFacts)
        ? Array.from(
            new Set(
              parsed.stableFacts
                .map(value => this.normalizeSummaryFact(value))
                .filter(Boolean)
            )
          ).slice(0, MAX_SUMMARY_STABLE_FACTS)
        : [];
      const fields = [
        ['当前话题', this.normalizeSummaryField(parsed.topic)],
        ['用户状态', this.normalizeSummaryField(parsed.userState)],
        ['已经回应', this.normalizeSummaryField(parsed.responded)],
        ['未解决', this.normalizeSummaryField(parsed.unresolved)],
        ['稳定事实', stableFacts.join('；')],
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

  /** 稳定事实必须短、去重；它们是随摘要长期保留的最小事实集。 */
  private normalizeSummaryFact(value: unknown): string {
    return typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, 30)
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
