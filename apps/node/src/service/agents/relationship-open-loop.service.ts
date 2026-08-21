import { Init, Inject, Logger, Provide } from '@midwayjs/core';
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
  buildEmptyRelationshipOpenLoopStore,
  buildRelationshipOpenLoopPrompt,
  expireRelationshipOpenLoops,
  markRelationshipOpenLoopFinalObservation,
  parseRelationshipOpenLoopStore,
  reconcileRelationshipOpenLoopContextualUpdate,
  RELATIONSHIP_OPEN_LOOP_MESSAGE_PREFIX,
  RelationshipOpenLoopSelection,
  RelationshipOpenLoopStore,
  resolveRelationshipOpenLoopFromUserText,
  selectRelationshipOpenLoop,
  serializeRelationshipOpenLoopStore,
  upsertRelationshipOpenLoopDraft,
} from './relationship-open-loop';
import {
  CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX,
  parseContinuityInformationCardStore,
} from './continuity-information-card';
import {
  extractContinuityInformationCards,
  shouldInspectHistoricalContinuityMessage,
} from './continuity-information-card-extractor';
import { migrateLegacyContinuityStore } from './relationship-open-loop-legacy';
import {
  extractRelationshipOpenLoop,
  RelationshipOpenLoopExtraction,
} from './relationship-open-loop-extractor';

export interface CaptureRelationshipOpenLoopOptions {
  message: MessageEntity;
  searchableText: string;
  now?: Date;
}

export interface RelationshipOpenLoopCaptureAudit {
  extractionDecision: RelationshipOpenLoopExtraction['decision'];
  extractionReason: string;
  mutationAction: 'created_root' | 'created_child' | 'updated' | 'noop';
  taskId?: string;
  rootId?: string;
  state?: string;
  persistenceAction?: RelationshipOpenLoopPersistenceResult['action'];
  readbackVerified?: boolean;
  sourceMessageId: string;
}

export interface RelationshipOpenLoopPersistenceResult {
  action: 'created' | 'updated' | 'unchanged';
  message: MessageEntity;
  readbackVerified: true;
}

export interface PrepareRelationshipOpenLoopTurnOptions {
  conversation: ConversationEntity;
  currentQuery: string;
  currentTurnMessages: MessageEntity[];
  now?: Date;
}

export interface PreparedRelationshipOpenLoopTurn {
  status: 'selected' | 'no_store' | 'no_candidate';
  candidateCount: number;
  prompt?: string;
  taskId?: string;
  rootId?: string;
  stateMessageId?: string;
  sourceMessageIds?: string[];
  selectionReason?: RelationshipOpenLoopSelection['reason'];
  selectedAt?: Date;
}

export interface RelationshipOpenLoopFinalAudit {
  taskId: string;
  observed: boolean;
  confidence: 'high' | 'unknown' | 'none';
  assistantMessageIds: string[];
}

export interface RelationshipOpenLoopBackfillSummary {
  jobId: string;
  cutoffAt: Date;
  eligibleUserCount: number;
  conversationCount: number;
  scannedMessageCount: number;
  legacyCardCount: number;
  migratedLegacyCardCount: number;
  generatedTaskCount: number;
  activeTaskCount: number;
  expiredTaskCount: number;
  updatedConversationCount: number;
  verifiedConversationCount: number;
  failedConversationCount: number;
}

export interface RelationshipOpenLoopBackfillStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'partial_failed' | 'unknown';
  generatedTaskCount?: number;
  activeTaskCount?: number;
  expiredTaskCount?: number;
  migratedLegacyCardCount?: number;
  updatedConversationCount?: number;
  verifiedConversationCount?: number;
  failedConversationCount?: number;
  completedAt?: string;
}

const RETURN_GAP_MS = 12 * 60 * 60 * 1000;
const RECENT_VISIBLE_MESSAGE_LIMIT = 16;
const DISTRIBUTED_LOCK_TTL_MS = 15 * 1000;
const BACKFILL_JOB_ID = 'relationship-open-loop-backfill-20260821-v2';
const BACKFILL_MARKER_MESSAGE_PREFIX =
  '__TZL_RELATIONSHIP_OPEN_LOOP_BACKFILL_20260821_V2__:';
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BACKFILL_LOCK_MS = 6 * 60 * 60 * 1000;
const BACKFILL_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_QUEUES = new Map<string, Promise<unknown>>();
let backfillRunning = false;

@Provide()
export class RelationshipOpenLoopService {
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

  private productionBackfillTimer?: ReturnType<typeof setInterval>;

  @Init()
  initializeProductionBackfill(): void {
    if (process.env.NODE_ENV !== 'production') return;
    const trigger = async () => {
      try {
        await this.runProductionBackfillOnce();
        const status = await this.getProductionBackfillStatus();
        if (status.status === 'completed' && this.productionBackfillTimer) {
          clearInterval(this.productionBackfillTimer);
          this.productionBackfillTimer = undefined;
        }
      } catch (error) {
        this.logger?.error?.(
          '[relationship-open-loop-backfill] scheduled run failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
      }
    };
    // Do not start a full historical scan during application startup. The
    // service wakes periodically, while runProductionBackfillOnce enforces the
    // Shanghai low-traffic window and durable idempotency markers.
    this.productionBackfillTimer = setInterval(
      () => void trigger(),
      BACKFILL_RETRY_INTERVAL_MS
    );
    this.productionBackfillTimer.unref();
  }

  async captureFromUserMessage(
    options: CaptureRelationshipOpenLoopOptions
  ): Promise<RelationshipOpenLoopCaptureAudit> {
    const extraction = extractRelationshipOpenLoop({
      message: options.message,
      text: options.searchableText,
      now: options.now,
    });
    const baseAudit: RelationshipOpenLoopCaptureAudit = {
      extractionDecision: extraction.decision,
      extractionReason: extraction.reason,
      mutationAction: 'noop',
      sourceMessageId: extraction.sourceMessageId,
    };
    if (
      options.message.role !== MessageRole.user ||
      options.message.isArchived
    ) {
      return { ...baseAudit, extractionReason: 'not_visible_user_message' };
    }
    const contextualUpdate =
      extraction.decision === 'not_eligible' &&
      /(?:挺严重|很严重|比较严重|病危|进了?ICU|要手术|需要手术)/u.test(
        options.searchableText
      );
    if (
      (extraction.decision === 'not_eligible' && !contextualUpdate) ||
      extraction.decision === 'fact_verification_only'
    ) {
      return baseAudit;
    }

    let audit = baseAudit;
    await this.withStorageQueue(options.message.conversationId, async () => {
      const now = options.now ?? new Date();
      const stored = await this.loadUnifiedStore(
        options.message.conversationId,
        now
      );
      const store = expireRelationshipOpenLoops(stored.store, now);
      const mutation =
        extraction.decision === 'lifecycle_only'
          ? resolveRelationshipOpenLoopFromUserText({
              store,
              text: options.searchableText,
              sourceMessageId: extraction.sourceMessageId,
              occurredAt: extraction.sourceOccurredAt,
              now,
            })
          : contextualUpdate
          ? reconcileRelationshipOpenLoopContextualUpdate({
              store,
              text: options.searchableText,
              sourceMessageId: extraction.sourceMessageId,
              occurredAt: extraction.sourceOccurredAt,
              now,
            })
          : extraction.draft
          ? upsertRelationshipOpenLoopDraft({
              store,
              draft: extraction.draft,
              sourceMessageId: extraction.sourceMessageId,
              sourceOccurredAt: extraction.sourceOccurredAt,
              now,
            })
          : { store, action: 'noop' as const };
      let persistence: RelationshipOpenLoopPersistenceResult | undefined;
      if (mutation.action !== 'noop' || stored.migratedLegacyCount > 0) {
        persistence = await this.persistStoreUnlocked(
          options.message.conversationId,
          mutation.store,
          stored.message
        );
      }
      audit = {
        ...baseAudit,
        mutationAction: mutation.action,
        ...(mutation.task
          ? {
              taskId: mutation.task.id,
              rootId: mutation.task.rootId,
              state: mutation.task.state,
            }
          : {}),
        ...(persistence
          ? {
              persistenceAction: persistence.action,
              readbackVerified: persistence.readbackVerified,
            }
          : {}),
      };
    });
    return audit;
  }

  async prepareTurn(
    options: PrepareRelationshipOpenLoopTurnOptions
  ): Promise<PreparedRelationshipOpenLoopTurn> {
    return this.withStorageQueue(options.conversation.id, async () => {
      const now = options.now ?? new Date();
      const stored = await this.loadUnifiedStore(options.conversation.id, now);
      if (!stored.store.tasks.length) {
        return { status: 'no_store', candidateCount: 0 };
      }
      const expired = expireRelationshipOpenLoops(stored.store, now);
      const recentVisibleMessageIds = await this.findRecentVisibleMessageIds(
        options.conversation.id,
        options.currentTurnMessages
      );
      const selection = selectRelationshipOpenLoop({
        store: expired,
        currentQuery: options.currentQuery,
        currentTurnMessageIds: options.currentTurnMessages.map(message =>
          this.stringifyObjectId(message.id)
        ),
        recentVisibleMessageIds,
        isReturnTurn: await this.isReturnTurn(
          options.conversation.id,
          options.currentTurnMessages
        ),
        now,
      });
      if (!selection) {
        await this.persistStoreUnlocked(
          options.conversation.id,
          expired,
          stored.message
        );
        return { status: 'no_candidate', candidateCount: 0 };
      }
      // Selection is only a non-decision hint for the main model. Do not
      // consume the task until the persisted assistant reply actually uses it.
      const stateMessage = await this.persistStoreUnlocked(
        options.conversation.id,
        expired,
        stored.message
      );
      return {
        status: 'selected',
        candidateCount: selection.candidateCount,
        prompt: buildRelationshipOpenLoopPrompt(
          selection.task,
          selection.reason,
          now
        ),
        taskId: selection.task.id,
        rootId: selection.task.rootId,
        stateMessageId: this.stringifyObjectId(stateMessage.message.id),
        sourceMessageIds: [...selection.task.sourceMessageIds],
        selectionReason: selection.reason,
        selectedAt: now,
      };
    });
  }

  async recordFinalObservation(options: {
    conversationId: MongoObjectId;
    stateMessageId: string;
    taskId: string;
    assistantText: string;
    assistantMessageIds: string[];
    now?: Date;
  }): Promise<RelationshipOpenLoopFinalAudit | undefined> {
    return this.withStorageQueue(options.conversationId, async () => {
      const stored = await this.loadUnifiedStore(
        options.conversationId,
        options.now ?? new Date()
      );
      if (
        !stored.message ||
        this.stringifyObjectId(stored.message.id) !== options.stateMessageId
      ) {
        return undefined;
      }
      const observation = markRelationshipOpenLoopFinalObservation({
        store: stored.store,
        taskId: options.taskId,
        assistantText: options.assistantText,
        now: options.now,
      });
      await this.persistStoreUnlocked(
        options.conversationId,
        observation.store,
        stored.message
      );
      return {
        taskId: options.taskId,
        observed: observation.observed,
        confidence: observation.confidence,
        assistantMessageIds: [...options.assistantMessageIds],
      };
    });
  }

  async runProductionBackfillOnce(
    now = new Date()
  ): Promise<RelationshipOpenLoopBackfillSummary | undefined> {
    if (process.env.NODE_ENV !== 'production' || !this.redisService) {
      return undefined;
    }
    if (!this.isShanghaiMaintenanceWindow(now)) return undefined;
    const completedKey = `chat:${BACKFILL_JOB_ID}:completed`;
    const lockKey = `chat:${BACKFILL_JOB_ID}:lock`;
    const failedKey = `chat:${BACKFILL_JOB_ID}:failed`;
    if (await this.redisService.get(completedKey)) return undefined;
    if (await this.redisService.get(failedKey)) return undefined;
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
      let markerConversation: ConversationEntity | undefined;
      const summary: RelationshipOpenLoopBackfillSummary = {
        jobId: BACKFILL_JOB_ID,
        cutoffAt,
        eligibleUserCount: eligibleUserIds.length,
        conversationCount: 0,
        scannedMessageCount: 0,
        legacyCardCount: 0,
        migratedLegacyCardCount: 0,
        generatedTaskCount: 0,
        activeTaskCount: 0,
        expiredTaskCount: 0,
        updatedConversationCount: 0,
        verifiedConversationCount: 0,
        failedConversationCount: 0,
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
            order: { createdAt: 'DESC' },
            take: 240,
          });
          summary.scannedMessageCount += messages.length;
          if (!messages.length) continue;

          try {
            await this.withStorageQueue(conversation.id, async () => {
              const loaded = await this.loadUnifiedStore(conversation.id, now);
              let store = loaded.store;
              summary.legacyCardCount += loaded.legacyCardCount;
              summary.migratedLegacyCardCount += loaded.migratedLegacyCount;

              const historicalInputs = [...messages].reverse().map(message => ({
                message,
                text: this.buildSearchableText(message),
              }));
              const legacyCards = extractContinuityInformationCards({
                inputs: historicalInputs.filter(item =>
                  shouldInspectHistoricalContinuityMessage(item.text)
                ),
                now,
              });
              const legacyMigration = migrateLegacyContinuityStore({
                store,
                legacyStore: {
                  version: 'continuity_information_card_v1',
                  cards: legacyCards,
                  updatedAt: now,
                },
                now,
              });
              store = legacyMigration.store;
              summary.legacyCardCount += legacyCards.length;
              summary.migratedLegacyCardCount += legacyMigration.migratedCount;

              for (const item of historicalInputs) {
                const sourceMessageId = this.stringifyObjectId(item.message.id);
                if (
                  store.tasks.some(task =>
                    task.sourceMessageIds.includes(sourceMessageId)
                  )
                ) {
                  continue;
                }
                const extraction = extractRelationshipOpenLoop({
                  message: item.message,
                  text: item.text,
                  now,
                });
                const mutation =
                  extraction.decision === 'lifecycle_only'
                    ? resolveRelationshipOpenLoopFromUserText({
                        store,
                        text: item.text,
                        sourceMessageId,
                        occurredAt: extraction.sourceOccurredAt,
                        now,
                      })
                    : extraction.decision === 'not_eligible' &&
                      /(?:挺严重|很严重|比较严重|病危|进了?ICU|要手术|需要手术)/u.test(
                        item.text
                      )
                    ? reconcileRelationshipOpenLoopContextualUpdate({
                        store,
                        text: item.text,
                        sourceMessageId,
                        occurredAt: extraction.sourceOccurredAt,
                        now,
                      })
                    : extraction.draft
                    ? upsertRelationshipOpenLoopDraft({
                        store,
                        draft: extraction.draft,
                        sourceMessageId,
                        sourceOccurredAt: extraction.sourceOccurredAt,
                        now,
                      })
                    : undefined;
                if (mutation && mutation.action !== 'noop') {
                  store = mutation.store;
                  if (
                    mutation.action === 'created_root' ||
                    mutation.action === 'created_child'
                  ) {
                    summary.generatedTaskCount += 1;
                  }
                }
              }

              store = expireRelationshipOpenLoops(store, now);
              if (!store.tasks.length && !loaded.message) return;
              const persistence = await this.persistStoreUnlocked(
                conversation.id,
                store,
                loaded.message
              );
              const verifiedStore = parseRelationshipOpenLoopStore(
                persistence.message.content
              );
              if (!verifiedStore) {
                throw new Error('RELATIONSHIP_OPEN_LOOP_READBACK_PARSE_FAILED');
              }
              summary.verifiedConversationCount += 1;
              if (persistence.action !== 'unchanged') {
                summary.updatedConversationCount += 1;
              }
              summary.activeTaskCount += verifiedStore.tasks.filter(task =>
                [
                  'reported',
                  'decision_pending',
                  'action_committed',
                  'awaiting_result',
                  'scheduled_checkpoint',
                  'dormant',
                ].includes(task.state)
              ).length;
              summary.expiredTaskCount += verifiedStore.tasks.filter(
                task => task.state === 'superseded'
              ).length;
            });
          } catch (error) {
            summary.failedConversationCount += 1;
            this.logger.error(
              '[relationship-open-loop-backfill] conversation failed, conversationId=%s reason=%s',
              this.stringifyObjectId(conversation.id),
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }

      if (summary.failedConversationCount > 0) {
        throw new Error(
          `RELATIONSHIP_OPEN_LOOP_BACKFILL_PARTIAL_FAILED:${summary.failedConversationCount}`
        );
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
        '[relationship-open-loop-backfill] complete, jobId=%s conversations=%s scanned=%s legacy=%s migrated=%s generated=%s active=%s expired=%s',
        summary.jobId,
        summary.conversationCount,
        summary.scannedMessageCount,
        summary.legacyCardCount,
        summary.migratedLegacyCardCount,
        summary.generatedTaskCount,
        summary.activeTaskCount,
        summary.expiredTaskCount
      );
      await this.redisService.del(failedKey);
      return summary;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failedConversationCount = Number(
        /RELATIONSHIP_OPEN_LOOP_BACKFILL_PARTIAL_FAILED:(\d+)/u.exec(
          reason
        )?.[1] || 0
      );
      await this.redisService.set(
        failedKey,
        JSON.stringify({
          jobId: BACKFILL_JOB_ID,
          status: 'partial_failed',
          reason,
          failedConversationCount,
          failedAt: new Date().toISOString(),
        }),
        'EX',
        15 * 60
      );
      throw error;
    } finally {
      backfillRunning = false;
      if ((await this.redisService.get(lockKey)) === lockToken) {
        await this.redisService.del(lockKey);
      }
    }
  }

  async getProductionBackfillStatus(): Promise<RelationshipOpenLoopBackfillStatus> {
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
      const failed = await this.redisService.get(
        `chat:${BACKFILL_JOB_ID}:failed`
      );
      if (failed) {
        const parsed = JSON.parse(failed) as Record<string, unknown>;
        return {
          jobId: BACKFILL_JOB_ID,
          status: 'partial_failed',
          ...this.pickBackfillStatusCounts(parsed),
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

  private async withStorageQueue<T>(
    conversationId: MongoObjectId,
    task: () => Promise<T>
  ): Promise<T> {
    const key = this.stringifyObjectId(conversationId);
    const previous = STORAGE_QUEUES.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.withDistributedLock(conversationId, task));
    STORAGE_QUEUES.set(key, current);
    try {
      return await current;
    } finally {
      if (STORAGE_QUEUES.get(key) === current) STORAGE_QUEUES.delete(key);
    }
  }

  private async withDistributedLock<T>(
    conversationId: MongoObjectId,
    task: () => Promise<T>
  ): Promise<T> {
    if (!this.redisService) return task();
    const key = `conversation:relationship-open-loop:write:${this.stringifyObjectId(
      conversationId
    )}`;
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;
    let acquired = false;
    for (let attempt = 0; attempt < 5 && !acquired; attempt += 1) {
      acquired =
        (await this.redisService.set(
          key,
          token,
          'PX',
          DISTRIBUTED_LOCK_TTL_MS,
          'NX'
        )) === 'OK';
      if (!acquired) {
        await new Promise(resolve => setTimeout(resolve, 60 * (attempt + 1)));
      }
    }
    if (!acquired) {
      throw new Error('RELATIONSHIP_OPEN_LOOP_LOCK_BUSY');
    }
    const renewal = setInterval(() => {
      void (async () => {
        try {
          if ((await this.redisService.get(key)) === token) {
            await (
              this.redisService as RedisService & {
                pexpire(lockKey: string, ttlMs: number): Promise<number>;
              }
            ).pexpire(key, DISTRIBUTED_LOCK_TTL_MS);
          }
        } catch {
          // Durable readback remains authoritative. Failed renewal only
          // shortens exclusivity and must not block the user's reply.
        }
      })();
    }, Math.floor(DISTRIBUTED_LOCK_TTL_MS / 3));
    renewal.unref();
    try {
      return await task();
    } finally {
      clearInterval(renewal);
      if ((await this.redisService.get(key)) === token) {
        await this.redisService.del(key);
      }
    }
  }

  private async loadUnifiedStore(
    conversationId: MongoObjectId,
    now: Date
  ): Promise<{
    message?: MessageEntity;
    store: RelationshipOpenLoopStore;
    legacyCardCount: number;
    migratedLegacyCount: number;
  }> {
    const current = await this.findStateMessage(conversationId);
    if (current?.store.legacyContinuityMigratedAt) {
      return {
        message: current.message,
        store: expireRelationshipOpenLoops(current.store, now),
        legacyCardCount: 0,
        migratedLegacyCount: 0,
      };
    }
    const legacy = await this.findLegacyStateMessage(conversationId);
    const migrated = migrateLegacyContinuityStore({
      store: current?.store ?? buildEmptyRelationshipOpenLoopStore(now),
      legacyStore: legacy?.store,
      now,
    });
    return {
      message: current?.message,
      store: expireRelationshipOpenLoops(
        {
          ...migrated.store,
          legacyContinuityMigratedAt: now,
          updatedAt: now,
        },
        now
      ),
      legacyCardCount: legacy?.store.cards.length ?? 0,
      migratedLegacyCount: migrated.migratedCount,
    };
  }

  private async findLegacyStateMessage(conversationId: MongoObjectId) {
    const messages = await this.messageModel.find({
      where: {
        conversationId,
        role: MessageRole.system,
        isArchived: true,
        content: { $regex: `^${CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX}` },
      } as never,
      order: { updatedAt: 'DESC' },
      take: 1,
    });
    const message = messages[0];
    const store = parseContinuityInformationCardStore(message?.content);
    return message && store ? { message, store } : undefined;
  }

  private async findRecentVisibleMessageIds(
    conversationId: MongoObjectId,
    currentTurnMessages: MessageEntity[]
  ): Promise<string[]> {
    const currentIds = new Set(
      currentTurnMessages.map(message => this.stringifyObjectId(message.id))
    );
    const messages = await this.messageModel.find({
      where: {
        conversationId,
        status: MessageStatus.sent,
        isArchived: { $ne: true },
      } as never,
      order: { createdAt: 'DESC' },
      take: RECENT_VISIBLE_MESSAGE_LIMIT,
    });
    return messages
      .map(message => this.stringifyObjectId(message.id))
      .filter(id => id && !currentIds.has(id));
  }

  private async persistStoreUnlocked(
    conversationId: MongoObjectId,
    store: RelationshipOpenLoopStore,
    existingMessage?: MessageEntity
  ): Promise<RelationshipOpenLoopPersistenceResult> {
    const now = new Date();
    const content = serializeRelationshipOpenLoopStore(store);
    if (existingMessage) {
      const action =
        existingMessage.content === content ? 'unchanged' : 'updated';
      if (action === 'updated') {
        existingMessage.content = content;
        existingMessage.updatedAt = now;
        await this.messageModel.save(existingMessage);
      }
      const verified = await this.readBackStateMessage(
        conversationId,
        content,
        existingMessage.id
      );
      return { action, message: verified, readbackVerified: true };
    }
    const conversation = await this.findConversationById(conversationId);
    if (!conversation) {
      throw new Error('RELATIONSHIP_OPEN_LOOP_CONVERSATION_NOT_FOUND');
    }
    const saved = await this.messageModel.save(
      this.buildArchivedSystemMessage(conversation, content, now)
    );
    const verified = await this.readBackStateMessage(
      conversationId,
      content,
      saved.id
    );
    return { action: 'created', message: verified, readbackVerified: true };
  }

  private async findConversationById(
    conversationId: MongoObjectId
  ): Promise<ConversationEntity | undefined> {
    return (
      (await this.conversationModel.findOne({
        where: { id: conversationId } as never,
      })) ||
      (await this.conversationModel.findOne({
        where: { _id: conversationId } as never,
      })) ||
      undefined
    );
  }

  private async readBackStateMessage(
    conversationId: MongoObjectId,
    expectedContent: string,
    messageId?: MongoObjectId
  ): Promise<MessageEntity> {
    let message: MessageEntity | null = null;
    if (messageId) {
      message =
        (await this.messageModel.findOne({
          where: { id: messageId, conversationId } as never,
        })) ||
        (await this.messageModel.findOne({
          where: { _id: messageId, conversationId } as never,
        }));
    }
    if (!message) {
      message = (await this.findStateMessage(conversationId))?.message || null;
    }
    if (
      !message ||
      message.content !== expectedContent ||
      !parseRelationshipOpenLoopStore(message.content)
    ) {
      throw new Error('RELATIONSHIP_OPEN_LOOP_READBACK_FAILED');
    }
    return message;
  }

  private async findStateMessage(
    conversationId: MongoObjectId
  ): Promise<
    { message: MessageEntity; store: RelationshipOpenLoopStore } | undefined
  > {
    const messages = await this.messageModel.find({
      where: {
        conversationId,
        role: MessageRole.system,
        isArchived: true,
        content: { $regex: `^${RELATIONSHIP_OPEN_LOOP_MESSAGE_PREFIX}` },
      } as never,
      order: { updatedAt: 'DESC' },
      take: 2,
    });
    for (const message of messages) {
      const store = parseRelationshipOpenLoopStore(message.content);
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
    await this.messageModel.save(
      this.buildArchivedSystemMessage(
        conversation,
        `${BACKFILL_MARKER_MESSAGE_PREFIX}${JSON.stringify(summary)}`,
        now
      )
    );
  }

  private pickBackfillStatusCounts(
    value: Record<string, unknown>
  ): Pick<
    RelationshipOpenLoopBackfillStatus,
    | 'generatedTaskCount'
    | 'activeTaskCount'
    | 'expiredTaskCount'
    | 'migratedLegacyCardCount'
    | 'updatedConversationCount'
    | 'verifiedConversationCount'
    | 'failedConversationCount'
  > {
    const result: Pick<
      RelationshipOpenLoopBackfillStatus,
      | 'generatedTaskCount'
      | 'activeTaskCount'
      | 'expiredTaskCount'
      | 'migratedLegacyCardCount'
      | 'updatedConversationCount'
      | 'verifiedConversationCount'
      | 'failedConversationCount'
    > = {};
    for (const key of [
      'generatedTaskCount',
      'activeTaskCount',
      'expiredTaskCount',
      'migratedLegacyCardCount',
      'updatedConversationCount',
      'verifiedConversationCount',
      'failedConversationCount',
    ] as const) {
      if (typeof value[key] === 'number') result[key] = value[key] as number;
    }
    return result;
  }

  private isShanghaiMaintenanceWindow(now: Date): boolean {
    const shanghaiHour = (now.getUTCHours() + 8) % 24;
    return shanghaiHour >= 3 && shanghaiHour < 7;
  }

  private buildSearchableText(message: MessageEntity): string {
    return (message.mediaTranscript?.trim() || message.content?.trim() || '')
      .replace(/\s+/gu, ' ')
      .trim();
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

  private stringifyObjectId(value: MongoObjectId | undefined): string {
    if (!value) return '';
    return typeof (value as { toHexString?: () => string }).toHexString ===
      'function'
      ? (value as { toHexString: () => string }).toHexString()
      : String(value);
  }
}
