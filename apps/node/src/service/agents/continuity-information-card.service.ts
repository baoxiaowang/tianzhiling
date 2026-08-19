import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  UserAccountEntity,
  UserLoginAccountStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  buildContinuityInformationCardPrompt,
  buildEmptyContinuityInformationCardStore,
  ContinuityInformationCard,
  ContinuityInformationCardStore,
  CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX,
  expireContinuityInformationCards,
  markContinuityInformationCardOffered,
  parseContinuityInformationCardStore,
  selectContinuityInformationCard,
  serializeContinuityInformationCardStore,
  upsertContinuityInformationCards,
} from './continuity-information-card';
import {
  extractContinuityInformationCards,
  shouldInspectHistoricalContinuityMessage,
} from './continuity-information-card-extractor';

export interface PrepareContinuityInformationCardTurnOptions {
  conversation: ConversationEntity;
  currentQuery: string;
  currentTurnMessages: MessageEntity[];
  now?: Date;
}

export interface PreparedContinuityInformationCardTurn {
  cardId: string;
  prompt: string;
  sourceMessageId: string;
  stateMessageId: string;
}

export interface CaptureContinuityInformationCardOptions {
  message: MessageEntity;
  searchableText: string;
  now?: Date;
}

export interface ContinuityCardBackfillSummary {
  jobId: string;
  cutoffAt: Date;
  eligibleUserCount: number;
  conversationCount: number;
  scannedMessageCount: number;
  candidateMessageCount: number;
  generatedCardCount: number;
  activeCardCount: number;
  expiredCardCount: number;
  updatedConversationCount: number;
}

export interface ContinuityCardBackfillStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'unknown';
  generatedCardCount?: number;
  activeCardCount?: number;
  expiredCardCount?: number;
  updatedConversationCount?: number;
  completedAt?: string;
}

interface BackfillConversationPlan {
  conversation: ConversationEntity;
  cards: ContinuityInformationCard[];
}

const BACKFILL_JOB_ID = 'continuity-card-backfill-20260819-v1';
const BACKFILL_MARKER_MESSAGE_PREFIX =
  '__TZL_CONTINUITY_CARD_BACKFILL_20260819_V1__:';
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BACKFILL_LOCK_MS = 6 * 60 * 60 * 1000;
const RETURN_GAP_MS = 12 * 60 * 60 * 1000;
const STORAGE_QUEUES = new Map<string, Promise<void>>();
let backfillRunning = false;

@Provide()
export class ContinuityInformationCardService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @Inject()
  redisService: RedisService;

  async captureFromUserMessage(
    options: CaptureContinuityInformationCardOptions
  ): Promise<ContinuityInformationCard[]> {
    if (
      options.message.role !== MessageRole.user ||
      options.message.isArchived
    ) {
      return [];
    }
    const reconciled = await this.reconcileExistingCardFromUserMessage(options);
    if (reconciled) return [];
    const cards = extractContinuityInformationCards({
      inputs: [
        {
          message: options.message,
          text: options.searchableText,
        },
      ],
      now: options.now,
    });
    if (cards.length) {
      await this.persistCards(options.message.conversationId, cards);
    }
    return cards;
  }

  async prepareTurn(
    options: PrepareContinuityInformationCardTurnOptions
  ): Promise<PreparedContinuityInformationCardTurn | undefined> {
    const now = options.now ?? new Date();
    const stored = await this.findStateMessage(options.conversation.id);
    if (!stored) return undefined;
    const expired = expireContinuityInformationCards(stored.store, now);
    const isReturnTurn = await this.isReturnTurn(
      options.conversation.id,
      options.currentTurnMessages
    );
    const selected = selectContinuityInformationCard({
      store: expired,
      currentQuery: options.currentQuery,
      currentTurnMessageIds: options.currentTurnMessages.map(message =>
        this.stringifyObjectId(message.id)
      ),
      isReturnTurn,
      now,
    });
    const nextStore = selected
      ? markContinuityInformationCardOffered(expired, selected.id, now)
      : expired;
    const nextContent = serializeContinuityInformationCardStore(nextStore);
    if (nextContent !== stored.message.content) {
      stored.message.content = nextContent;
      stored.message.updatedAt = now;
      await this.messageModel.save(stored.message);
    }
    if (!selected) return undefined;
    return {
      cardId: selected.id,
      prompt: buildContinuityInformationCardPrompt(selected, now),
      sourceMessageId: selected.sourceMessageId,
      stateMessageId: this.stringifyObjectId(stored.message.id),
    };
  }

  async runProductionBackfillOnce(
    now = new Date()
  ): Promise<ContinuityCardBackfillSummary | undefined> {
    if (process.env.NODE_ENV !== 'production' || !this.redisService) {
      return undefined;
    }
    const completedKey = `chat:${BACKFILL_JOB_ID}:completed`;
    const lockKey = `chat:${BACKFILL_JOB_ID}:lock`;
    if (await this.redisService.get(completedKey)) return undefined;
    const durableMarker = await this.findBackfillMarker();
    if (durableMarker) {
      await this.redisService.set(
        completedKey,
        JSON.stringify(durableMarker.summary)
      );
      return undefined;
    }
    const lockToken = `${process.pid}:${now.getTime()}`;
    const acquired = await this.redisService.set(
      lockKey,
      lockToken,
      'PX',
      BACKFILL_LOCK_MS,
      'NX'
    );
    if (acquired !== 'OK') return undefined;
    backfillRunning = true;

    try {
      const cutoffAt = new Date(now.getTime() - BACKFILL_WINDOW_MS);
      const eligibleUserIds = await this.listRecentlyActiveUserIds(cutoffAt);
      const plans: BackfillConversationPlan[] = [];
      let markerConversation: ConversationEntity | undefined;
      const summary: ContinuityCardBackfillSummary = {
        jobId: BACKFILL_JOB_ID,
        cutoffAt,
        eligibleUserCount: eligibleUserIds.length,
        conversationCount: 0,
        scannedMessageCount: 0,
        candidateMessageCount: 0,
        generatedCardCount: 0,
        activeCardCount: 0,
        expiredCardCount: 0,
        updatedConversationCount: 0,
      };

      for (const userId of eligibleUserIds) {
        const conversations = await this.conversationModel.find({
          where: { userId } as never,
          order: { updatedAt: 'DESC' },
        });
        for (const conversation of conversations) {
          markerConversation ??= conversation;
          summary.conversationCount += 1;
          const messages = await this.messageModel.find({
            where: {
              conversationId: conversation.id,
              role: MessageRole.user,
              status: MessageStatus.sent,
              isArchived: { $ne: true },
              createdAt: { $gte: cutoffAt },
            } as never,
            order: { createdAt: 'ASC' },
            take: 240,
          });
          summary.scannedMessageCount += messages.length;
          const candidates = messages
            .map(message => ({
              message,
              text: this.buildSearchableText(message),
            }))
            .filter(item =>
              shouldInspectHistoricalContinuityMessage(item.text)
            );
          summary.candidateMessageCount += candidates.length;
          if (!candidates.length) continue;

          const cards = extractContinuityInformationCards({
            inputs: candidates,
            now,
          });
          if (!cards.length) continue;
          summary.generatedCardCount += cards.length;
          summary.activeCardCount += cards.filter(
            card => card.status === 'active'
          ).length;
          summary.expiredCardCount += cards.filter(
            card => card.status === 'expired'
          ).length;
          plans.push({ conversation, cards });
        }
      }

      this.logger.info(
        '[continuity-backfill] dry-run complete, jobId=%s users=%s conversations=%s scanned=%s candidates=%s cards=%s active=%s expired=%s',
        summary.jobId,
        summary.eligibleUserCount,
        summary.conversationCount,
        summary.scannedMessageCount,
        summary.candidateMessageCount,
        summary.generatedCardCount,
        summary.activeCardCount,
        summary.expiredCardCount
      );

      for (const plan of plans) {
        await this.persistCards(plan.conversation.id, plan.cards);
        summary.updatedConversationCount += 1;
      }
      const completedSummary = {
        ...summary,
        completedAt: new Date().toISOString(),
      };
      if (markerConversation) {
        await this.createBackfillMarker(markerConversation, completedSummary);
      }
      await this.redisService.set(
        completedKey,
        JSON.stringify(completedSummary)
      );
      this.logger.info(
        '[continuity-backfill] apply complete, jobId=%s updatedConversations=%s cards=%s active=%s expired=%s',
        summary.jobId,
        summary.updatedConversationCount,
        summary.generatedCardCount,
        summary.activeCardCount,
        summary.expiredCardCount
      );
      return summary;
    } catch (error) {
      this.logger.error(
        '[continuity-backfill] failed, jobId=%s reason=%s',
        BACKFILL_JOB_ID,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      backfillRunning = false;
      if ((await this.redisService.get(lockKey)) === lockToken) {
        await this.redisService.del(lockKey);
      }
    }
  }

  async getProductionBackfillStatus(): Promise<ContinuityCardBackfillStatus> {
    if (process.env.NODE_ENV !== 'production') {
      return { jobId: BACKFILL_JOB_ID, status: 'pending' };
    }
    if (!this.redisService) {
      return { jobId: BACKFILL_JOB_ID, status: 'unknown' };
    }
    try {
      const completed = await this.redisService.get(
        `chat:${BACKFILL_JOB_ID}:completed`
      );
      if (completed) {
        const parsed = JSON.parse(completed) as Record<string, unknown>;
        return {
          jobId: BACKFILL_JOB_ID,
          status: 'completed',
          ...this.pickBackfillStatusCounts(parsed),
          ...(typeof parsed.completedAt === 'string'
            ? { completedAt: parsed.completedAt }
            : {}),
        };
      }
      const running = await this.redisService.get(
        `chat:${BACKFILL_JOB_ID}:lock`
      );
      return {
        jobId: BACKFILL_JOB_ID,
        status: running || backfillRunning ? 'running' : 'pending',
      };
    } catch {
      return { jobId: BACKFILL_JOB_ID, status: 'unknown' };
    }
  }

  private async reconcileExistingCardFromUserMessage(
    options: CaptureContinuityInformationCardOptions
  ): Promise<boolean> {
    const text = options.searchableText.replace(/\s+/gu, ' ').trim();
    const severityUpdate =
      /(?:挺严重|很严重|比较严重|病危|进了ICU|进ICU|要手术|需要手术)/u.test(
        text
      );
    const healthResolved =
      /(?:已经|现在|后来)?(?:好多了|好起来了|康复了|出院了|没事了|恢复了)/u.test(
        text
      ) && !/(?:还没|没有|并没|没怎么).{0,4}(?:好|恢复|康复)/u.test(text);
    const resultResolved =
      /(?:结果|通知).{0,8}(?:出来了|出了|收到了)|(?:通过了|没通过|录取了)/u.test(
        text
      );
    if (!severityUpdate && !healthResolved && !resultResolved) return false;

    const stored = await this.findStateMessage(options.message.conversationId);
    if (!stored) return false;
    const now = options.now ?? new Date();
    const relevant = stored.store.cards
      .filter(card => card.status === 'active')
      .filter(card =>
        resultResolved
          ? card.eventKind === 'result_pending'
          : card.eventKind === 'health' || card.eventKind === 'family_health'
      )
      .sort(
        (left, right) =>
          (right.latestEvidenceAt ?? right.sourceOccurredAt).getTime() -
          (left.latestEvidenceAt ?? left.sourceOccurredAt).getTime()
      )[0];
    if (!relevant) return false;
    const updated: ContinuityInformationCard = {
      ...relevant,
      ...(severityUpdate
        ? {
            summary: `${relevant.summary}；用户后续说明情况严重`.slice(0, 120),
            retentionPolicy: 'until_resolved' as const,
            importance: 3 as const,
            status: 'active' as const,
            expiresAt: undefined,
          }
        : { status: 'resolved' as const }),
      latestEvidenceMessageId: this.stringifyObjectId(options.message.id),
      latestEvidenceAt:
        options.message.sourceOccurredAt ?? options.message.createdAt,
      updatedAt: now,
    };
    await this.persistCards(options.message.conversationId, [updated]);
    return true;
  }

  private async persistCards(
    conversationId: MongoObjectId,
    cards: ContinuityInformationCard[]
  ): Promise<void> {
    if (!cards.length) return;
    const queueKey = this.stringifyObjectId(conversationId);
    const previous = STORAGE_QUEUES.get(queueKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.persistCardsUnlocked(conversationId, cards));
    STORAGE_QUEUES.set(queueKey, current);
    try {
      await current;
    } finally {
      if (STORAGE_QUEUES.get(queueKey) === current) {
        STORAGE_QUEUES.delete(queueKey);
      }
    }
  }

  private async persistCardsUnlocked(
    conversationId: MongoObjectId,
    cards: ContinuityInformationCard[]
  ): Promise<void> {
    const now = new Date();
    const stored = await this.findStateMessage(conversationId);
    const base = stored?.store ?? buildEmptyContinuityInformationCardStore(now);
    const next = upsertContinuityInformationCards(
      expireContinuityInformationCards(base, now),
      cards,
      now
    );
    const content = serializeContinuityInformationCardStore(next);
    if (stored) {
      if (stored.message.content === content) return;
      stored.message.content = content;
      stored.message.updatedAt = now;
      await this.messageModel.save(stored.message);
      return;
    }
    const conversation = await this.conversationModel.findOne({
      where: { id: conversationId } as never,
    });
    if (!conversation) return;
    const message = this.buildArchivedSystemMessage(conversation, content, now);
    await this.messageModel.save(message);
  }

  private async findStateMessage(
    conversationId: MongoObjectId
  ): Promise<
    | { message: MessageEntity; store: ContinuityInformationCardStore }
    | undefined
  > {
    const messages = await this.messageModel.find({
      where: {
        conversationId,
        role: MessageRole.system,
        isArchived: true,
        content: {
          $regex: `^${CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX}`,
        },
      } as never,
      order: { updatedAt: 'DESC' },
      take: 2,
    });
    for (const message of messages) {
      const store = parseContinuityInformationCardStore(message.content);
      if (store) return { message, store };
    }
    return undefined;
  }

  private async isReturnTurn(
    conversationId: MongoObjectId,
    currentTurnMessages: MessageEntity[]
  ): Promise<boolean> {
    const earliest = [...currentTurnMessages].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
    )[0];
    if (!earliest) return false;
    const previous = await this.messageModel.findOne({
      where: {
        conversationId,
        role: MessageRole.user,
        status: MessageStatus.sent,
        isArchived: { $ne: true },
        createdAt: { $lt: earliest.createdAt },
      } as never,
      order: { createdAt: 'DESC' },
    });
    return Boolean(
      previous &&
        earliest.createdAt.getTime() - previous.createdAt.getTime() >=
          RETURN_GAP_MS
    );
  }

  private async listRecentlyActiveUserIds(
    cutoffAt: Date
  ): Promise<MongoObjectId[]> {
    const ids = new Map<string, MongoObjectId>();
    for (let skip = 0; ; skip += 500) {
      const accounts = await this.userAccountModel.find({
        where: {
          updatedAt: { $gte: cutoffAt },
          status: { $ne: UserLoginAccountStatus.canceled },
        } as never,
        order: { updatedAt: 'ASC' },
        skip,
        take: 500,
      });
      accounts.forEach(account =>
        ids.set(this.stringifyObjectId(account.userId), account.userId)
      );
      if (accounts.length < 500) break;
    }
    for (let skip = 0; ; skip += 500) {
      const conversations = await this.conversationModel.find({
        where: { updatedAt: { $gte: cutoffAt } } as never,
        order: { updatedAt: 'ASC' },
        skip,
        take: 500,
      });
      conversations.forEach(conversation =>
        ids.set(
          this.stringifyObjectId(conversation.userId),
          conversation.userId
        )
      );
      if (conversations.length < 500) break;
    }
    return Array.from(ids.values());
  }

  private async findBackfillMarker(): Promise<
    { message: MessageEntity; summary: Record<string, unknown> } | undefined
  > {
    const messages = await this.messageModel.find({
      where: {
        role: MessageRole.system,
        isArchived: true,
        content: { $regex: `^${BACKFILL_MARKER_MESSAGE_PREFIX}` },
      } as never,
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const message = messages[0];
    if (!message?.content.startsWith(BACKFILL_MARKER_MESSAGE_PREFIX)) {
      return undefined;
    }
    try {
      const summary = JSON.parse(
        message.content.slice(BACKFILL_MARKER_MESSAGE_PREFIX.length)
      ) as Record<string, unknown>;
      return { message, summary };
    } catch {
      return undefined;
    }
  }

  private async createBackfillMarker(
    conversation: ConversationEntity,
    summary: Record<string, unknown>
  ): Promise<void> {
    if (await this.findBackfillMarker()) return;
    const now = new Date();
    const message = this.buildArchivedSystemMessage(
      conversation,
      `${BACKFILL_MARKER_MESSAGE_PREFIX}${JSON.stringify(summary)}`,
      now
    );
    await this.messageModel.save(message);
  }

  private buildArchivedSystemMessage(
    conversation: ConversationEntity,
    content: string,
    now: Date
  ): MessageEntity {
    const message = new MessageEntity();
    message.conversationId = conversation.id;
    message.userId = conversation.userId;
    message.agentId = conversation.agentId;
    message.role = MessageRole.system;
    message.type = MessageType.text;
    message.content = content;
    message.status = MessageStatus.sent;
    message.quotaExempt = true;
    message.replyTrigger = false;
    message.isArchived = true;
    message.archivedAt = now;
    message.createdAt = now;
    message.updatedAt = now;
    return message;
  }

  private pickBackfillStatusCounts(
    value: Record<string, unknown>
  ): Pick<
    ContinuityCardBackfillStatus,
    | 'generatedCardCount'
    | 'activeCardCount'
    | 'expiredCardCount'
    | 'updatedConversationCount'
  > {
    const result: Pick<
      ContinuityCardBackfillStatus,
      | 'generatedCardCount'
      | 'activeCardCount'
      | 'expiredCardCount'
      | 'updatedConversationCount'
    > = {};
    for (const key of [
      'generatedCardCount',
      'activeCardCount',
      'expiredCardCount',
      'updatedConversationCount',
    ] as const) {
      if (typeof value[key] === 'number') result[key] = value[key] as number;
    }
    return result;
  }

  private buildSearchableText(message: MessageEntity): string {
    return (message.mediaTranscript?.trim() || message.content?.trim() || '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private stringifyObjectId(value: MongoObjectId | undefined): string {
    if (!value) return '';
    return typeof (value as { toHexString?: () => string }).toHexString ===
      'function'
      ? (value as { toHexString: () => string }).toHexString()
      : String(value);
  }
}
