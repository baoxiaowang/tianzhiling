import { Destroy, Init, Inject, Logger, Provide } from '@midwayjs/core';
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
import { migrateLegacyContinuityStore } from './relationship-open-loop-legacy';
import {
  extractRelationshipOpenLoop,
  RelationshipOpenLoopExtraction,
} from './relationship-open-loop-extractor';
import { revalidateRelationshipOpenLoopStore } from './relationship-open-loop-revalidation';

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
  allowFollowUpTask?: boolean;
  now?: Date;
}

export interface PreparedRelationshipOpenLoopTurn {
  status: 'selected' | 'context_evidence' | 'no_store' | 'no_candidate';
  candidateCount: number;
  prompt?: string;
  taskId?: string;
  rootId?: string;
  stateMessageId?: string;
  sourceMessageIds?: string[];
  selectionReason?: RelationshipOpenLoopSelection['reason'];
  selectionKind?: RelationshipOpenLoopSelection['kind'];
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
  revalidatedTaskCount: number;
  removedTaskCount: number;
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
  revalidatedTaskCount?: number;
  removedTaskCount?: number;
  completedAt?: string;
  schedulerActive?: boolean;
  nextEligibleAt?: string;
}

interface RelationshipOpenLoopBackfillProgress {
  version: 'relationship_open_loop_revalidation_progress_v1';
  cutoffAt: string;
  eligibleUserIds: string[];
  userIndex: number;
  conversationIndex: number;
  phase: 'scan' | 'retry';
  retryRound: number;
  retryIndex: number;
  retryConversationIds: string[];
  failedConversationIds: string[];
  markerConversationId?: string;
  summary: Omit<RelationshipOpenLoopBackfillSummary, 'cutoffAt'> & {
    cutoffAt: string;
  };
  startedAt: string;
  updatedAt: string;
}

type RelationshipOpenLoopBackfillDelta = Pick<
  RelationshipOpenLoopBackfillSummary,
  | 'legacyCardCount'
  | 'migratedLegacyCardCount'
  | 'generatedTaskCount'
  | 'activeTaskCount'
  | 'expiredTaskCount'
  | 'updatedConversationCount'
  | 'verifiedConversationCount'
  | 'revalidatedTaskCount'
  | 'removedTaskCount'
>;

const RETURN_GAP_MS = 12 * 60 * 60 * 1000;
const RECENT_VISIBLE_MESSAGE_LIMIT = 16;
const DISTRIBUTED_LOCK_TTL_MS = 15 * 1000;
const BACKFILL_JOB_ID = 'relationship-open-loop-revalidation-20260824-v3';
const BACKFILL_MARKER_MESSAGE_PREFIX =
  '__TZL_RELATIONSHIP_OPEN_LOOP_REVALIDATION_20260824_V3__:';
const BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const BACKFILL_LOCK_MS = 10 * 60 * 1000;
const BACKFILL_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const BACKFILL_RUN_BUDGET_MS = 3 * 60 * 1000;
const BACKFILL_CATCH_UP_AFTER = new Date('2026-08-24T23:00:00.000Z');
const BACKFILL_PROGRESS_VERSION =
  'relationship_open_loop_revalidation_progress_v1' as const;
const STORAGE_QUEUES = new Map<string, Promise<unknown>>();
let backfillRunning = false;

@Provide()
export class RelationshipOpenLoopService {
  private backfillTimer?: ReturnType<typeof setInterval>;

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

  @Init()
  async initializeProductionBackfill(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    const attempt = () => {
      void this.runProductionBackfillOnce().catch(error => {
        this.logger?.error?.(
          '[relationship-open-loop-backfill] scheduled run failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
      });
    };
    setImmediate(attempt);
    this.backfillTimer = setInterval(attempt, BACKFILL_RETRY_INTERVAL_MS);
    this.backfillTimer.unref?.();
  }

  @Destroy()
  async stopProductionBackfillScheduler(): Promise<void> {
    if (!this.backfillTimer) return;
    clearInterval(this.backfillTimer);
    this.backfillTimer = undefined;
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
        allowFollowUpTask: options.allowFollowUpTask,
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
        status:
          selection.kind === 'context_evidence'
            ? 'context_evidence'
            : 'selected',
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
        selectionKind: selection.kind,
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
    const completedKey = `chat:${BACKFILL_JOB_ID}:completed`;
    const lockKey = `chat:${BACKFILL_JOB_ID}:lock`;
    const failedKey = `chat:${BACKFILL_JOB_ID}:failed`;
    const progressKey = `chat:${BACKFILL_JOB_ID}:progress`;
    if (await this.redisService.get(completedKey)) return undefined;
    if (await this.redisService.get(failedKey)) return undefined;
    const existingProgress = this.parseBackfillProgress(
      await this.redisService.get(progressKey)
    );
    if (
      !this.isShanghaiMaintenanceWindow(now) &&
      !existingProgress &&
      now < BACKFILL_CATCH_UP_AFTER
    ) {
      return undefined;
    }
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
      const startedAt = Date.now();
      let progress =
        existingProgress ?? (await this.createBackfillProgress(now));
      await this.persistBackfillProgress(progressKey, progress);
      const cutoffAt = new Date(progress.cutoffAt);
      let markerConversation: ConversationEntity | undefined;
      while (progress.phase === 'scan') {
        if (progress.userIndex >= progress.eligibleUserIds.length) {
          if (progress.failedConversationIds.length) {
            progress.phase = 'retry';
            progress.retryRound = 1;
            progress.retryIndex = 0;
            progress.retryConversationIds = [...progress.failedConversationIds];
            progress.failedConversationIds = [];
            progress.summary.failedConversationCount = 0;
            progress.updatedAt = new Date().toISOString();
            await this.persistBackfillProgress(progressKey, progress);
          }
          break;
        }

        const userId = this.parseBackfillObjectId(
          progress.eligibleUserIds[progress.userIndex]
        );
        const conversations = await this.conversationModel.find({
          where: { userId } as never,
          order: { createdAt: 'ASC' },
        });
        while (progress.conversationIndex < conversations.length) {
          const conversation = conversations[progress.conversationIndex];
          markerConversation ??= conversation;
          progress.markerConversationId ??= this.stringifyObjectId(
            conversation.id
          );
          progress.summary.conversationCount += 1;
          try {
            const result = await this.revalidateBackfillConversation(
              conversation,
              cutoffAt,
              now
            );
            progress.summary.scannedMessageCount += result.scannedMessageCount;
            this.mergeBackfillDelta(progress.summary, result.delta);
          } catch (error) {
            progress.summary.failedConversationCount += 1;
            progress.failedConversationIds.push(
              this.stringifyObjectId(conversation.id)
            );
            this.logger.error(
              '[relationship-open-loop-backfill] conversation failed, conversationId=%s reason=%s',
              this.stringifyObjectId(conversation.id),
              error instanceof Error ? error.message : String(error)
            );
          }
          progress.conversationIndex += 1;
          progress.updatedAt = new Date().toISOString();
          await this.persistBackfillProgress(progressKey, progress);
          if (Date.now() - startedAt >= BACKFILL_RUN_BUDGET_MS) {
            return undefined;
          }
        }
        progress.userIndex += 1;
        progress.conversationIndex = 0;
        progress.updatedAt = new Date().toISOString();
        await this.persistBackfillProgress(progressKey, progress);
      }

      while (progress.phase === 'retry') {
        if (progress.retryIndex >= progress.retryConversationIds.length) {
          if (
            progress.failedConversationIds.length &&
            progress.retryRound < 2
          ) {
            progress.retryRound += 1;
            progress.retryIndex = 0;
            progress.retryConversationIds = [...progress.failedConversationIds];
            progress.failedConversationIds = [];
            progress.summary.failedConversationCount = 0;
            progress.updatedAt = new Date().toISOString();
            await this.persistBackfillProgress(progressKey, progress);
            continue;
          }
          break;
        }
        const conversationId = this.parseBackfillObjectId(
          progress.retryConversationIds[progress.retryIndex]
        );
        const conversation = await this.conversationModel.findOne({
          where: { id: conversationId },
        });
        if (conversation) {
          markerConversation ??= conversation;
          progress.markerConversationId ??= this.stringifyObjectId(
            conversation.id
          );
          try {
            const result = await this.revalidateBackfillConversation(
              conversation,
              cutoffAt,
              now
            );
            this.mergeBackfillDelta(progress.summary, result.delta);
          } catch (error) {
            progress.summary.failedConversationCount += 1;
            progress.failedConversationIds.push(
              this.stringifyObjectId(conversation.id)
            );
            this.logger.error(
              '[relationship-open-loop-backfill] retry failed, conversationId=%s reason=%s',
              this.stringifyObjectId(conversation.id),
              error instanceof Error ? error.message : String(error)
            );
          }
        }
        progress.retryIndex += 1;
        progress.updatedAt = new Date().toISOString();
        await this.persistBackfillProgress(progressKey, progress);
        if (Date.now() - startedAt >= BACKFILL_RUN_BUDGET_MS) {
          return undefined;
        }
      }

      const summary = this.deserializeBackfillSummary(progress.summary);
      if (progress.failedConversationIds.length > 0) {
        throw new Error(
          `RELATIONSHIP_OPEN_LOOP_BACKFILL_PARTIAL_FAILED:${progress.failedConversationIds.length}`
        );
      }

      const completedSummary = {
        ...summary,
        completedAt: new Date().toISOString(),
      };
      if (!markerConversation && progress.markerConversationId) {
        markerConversation =
          (await this.conversationModel.findOne({
            where: {
              id: this.parseBackfillObjectId(progress.markerConversationId),
            },
          })) || undefined;
      }
      if (!markerConversation) {
        markerConversation =
          (await this.conversationModel.findOne({
            order: { createdAt: 'ASC' },
          })) || undefined;
      }
      if (!markerConversation) {
        throw new Error(
          'RELATIONSHIP_OPEN_LOOP_BACKFILL_MARKER_CONVERSATION_REQUIRED'
        );
      }
      await this.createBackfillMarker(markerConversation, completedSummary);
      const verifiedMarker = await this.findBackfillMarker();
      if (verifiedMarker?.summary?.jobId !== BACKFILL_JOB_ID) {
        throw new Error(
          'RELATIONSHIP_OPEN_LOOP_BACKFILL_MARKER_READBACK_FAILED'
        );
      }
      await this.redisService.set(
        completedKey,
        JSON.stringify(completedSummary)
      );
      await this.redisService.del(progressKey);
      this.logger.info(
        '[relationship-open-loop-backfill] complete, jobId=%s conversations=%s scanned=%s revalidated=%s removed=%s generated=%s active=%s expired=%s',
        summary.jobId,
        summary.conversationCount,
        summary.scannedMessageCount,
        summary.revalidatedTaskCount,
        summary.removedTaskCount,
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
    const schedule = this.buildBackfillScheduleStatus();
    if (process.env.NODE_ENV !== 'production') {
      return { jobId: BACKFILL_JOB_ID, status: 'pending', ...schedule };
    }
    if (!this.redisService) {
      return { jobId: BACKFILL_JOB_ID, status: 'unknown', ...schedule };
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
          ...schedule,
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
          ...schedule,
        };
      }
      const progress = this.parseBackfillProgress(
        await this.redisService.get(`chat:${BACKFILL_JOB_ID}:progress`)
      );
      const running = await this.redisService.get(
        `chat:${BACKFILL_JOB_ID}:lock`
      );
      return {
        jobId: BACKFILL_JOB_ID,
        status: running || backfillRunning || progress ? 'running' : 'pending',
        ...(progress
          ? this.pickBackfillStatusCounts(
              progress.summary as unknown as Record<string, unknown>
            )
          : {}),
        ...schedule,
        ...(progress ? { nextEligibleAt: new Date().toISOString() } : {}),
      };
    } catch {
      return { jobId: BACKFILL_JOB_ID, status: 'unknown', ...schedule };
    }
  }

  private async createBackfillProgress(
    now: Date
  ): Promise<RelationshipOpenLoopBackfillProgress> {
    const cutoffAt = new Date(now.getTime() - BACKFILL_WINDOW_MS);
    const eligibleUserIds = (await this.listRecentlyActiveUserIds(cutoffAt))
      .map(userId => this.stringifyObjectId(userId))
      .filter(Boolean)
      .sort();
    return {
      version: BACKFILL_PROGRESS_VERSION,
      cutoffAt: cutoffAt.toISOString(),
      eligibleUserIds,
      userIndex: 0,
      conversationIndex: 0,
      phase: 'scan',
      retryRound: 0,
      retryIndex: 0,
      retryConversationIds: [],
      failedConversationIds: [],
      summary: {
        jobId: BACKFILL_JOB_ID,
        cutoffAt: cutoffAt.toISOString(),
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
        revalidatedTaskCount: 0,
        removedTaskCount: 0,
      },
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private parseBackfillProgress(
    value?: string | null
  ): RelationshipOpenLoopBackfillProgress | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as RelationshipOpenLoopBackfillProgress;
      if (
        parsed.version !== BACKFILL_PROGRESS_VERSION ||
        !Array.isArray(parsed.eligibleUserIds) ||
        !parsed.summary ||
        !['scan', 'retry'].includes(parsed.phase) ||
        !Number.isInteger(parsed.userIndex) ||
        !Number.isInteger(parsed.conversationIndex)
      ) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async persistBackfillProgress(
    key: string,
    progress: RelationshipOpenLoopBackfillProgress
  ): Promise<void> {
    const content = JSON.stringify(progress);
    await this.redisService.set(key, content);
    const verified = this.parseBackfillProgress(
      await this.redisService.get(key)
    );
    if (
      !verified ||
      verified.phase !== progress.phase ||
      verified.userIndex !== progress.userIndex ||
      verified.conversationIndex !== progress.conversationIndex ||
      verified.retryIndex !== progress.retryIndex
    ) {
      throw new Error(
        'RELATIONSHIP_OPEN_LOOP_BACKFILL_PROGRESS_READBACK_FAILED'
      );
    }
  }

  private parseBackfillObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new Error('RELATIONSHIP_OPEN_LOOP_BACKFILL_OBJECT_ID_INVALID');
    }
    return new MongoObjectId(value);
  }

  private deserializeBackfillSummary(
    summary: RelationshipOpenLoopBackfillProgress['summary']
  ): RelationshipOpenLoopBackfillSummary {
    return {
      ...summary,
      cutoffAt: new Date(summary.cutoffAt),
    };
  }

  private mergeBackfillDelta(
    summary: RelationshipOpenLoopBackfillProgress['summary'],
    delta: RelationshipOpenLoopBackfillDelta
  ): void {
    for (const key of [
      'legacyCardCount',
      'migratedLegacyCardCount',
      'generatedTaskCount',
      'activeTaskCount',
      'expiredTaskCount',
      'updatedConversationCount',
      'verifiedConversationCount',
      'revalidatedTaskCount',
      'removedTaskCount',
    ] as const) {
      summary[key] += delta[key];
    }
  }

  private async revalidateBackfillConversation(
    conversation: ConversationEntity,
    cutoffAt: Date,
    now: Date
  ): Promise<{
    scannedMessageCount: number;
    delta: RelationshipOpenLoopBackfillDelta;
  }> {
    const messages = await this.findHistoricalUserMessages(
      conversation.id,
      cutoffAt
    );
    const delta: RelationshipOpenLoopBackfillDelta = {
      legacyCardCount: 0,
      migratedLegacyCardCount: 0,
      generatedTaskCount: 0,
      activeTaskCount: 0,
      expiredTaskCount: 0,
      updatedConversationCount: 0,
      verifiedConversationCount: 0,
      revalidatedTaskCount: 0,
      removedTaskCount: 0,
    };
    await this.withStorageQueue(conversation.id, async () => {
      const loaded = await this.loadUnifiedStore(conversation.id, now);
      delta.legacyCardCount = loaded.legacyCardCount;
      delta.migratedLegacyCardCount = loaded.migratedLegacyCount;
      const historicalInputs = [...messages].reverse().map(message => ({
        message,
        text: this.buildSearchableText(message),
      }));
      const revalidated = revalidateRelationshipOpenLoopStore({
        previousStore: loaded.store,
        inputs: historicalInputs,
        now,
      });
      const store = revalidated.store;
      delta.generatedTaskCount = revalidated.generatedTaskCount;
      delta.revalidatedTaskCount = revalidated.revalidatedTaskCount;
      delta.removedTaskCount = revalidated.removedTaskCount;
      if (
        !store.tasks.length &&
        !loaded.message &&
        loaded.legacyCardCount === 0
      ) {
        return;
      }
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
      delta.verifiedConversationCount = 1;
      if (persistence.action !== 'unchanged') {
        delta.updatedConversationCount = 1;
      }
      delta.activeTaskCount = verifiedStore.tasks.filter(task =>
        [
          'reported',
          'decision_pending',
          'action_committed',
          'awaiting_result',
          'scheduled_checkpoint',
          'dormant',
        ].includes(task.state)
      ).length;
      delta.expiredTaskCount = verifiedStore.tasks.filter(
        task => task.state === 'superseded'
      ).length;
    });
    return { scannedMessageCount: messages.length, delta };
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

  private async findHistoricalUserMessages(
    conversationId: MongoObjectId,
    cutoffAt: Date
  ): Promise<MessageEntity[]> {
    const messages: MessageEntity[] = [];
    for (let skip = 0; ; skip += 500) {
      const page = await this.messageModel.find({
        where: {
          conversationId,
          role: MessageRole.user,
          status: MessageStatus.sent,
          isArchived: { $ne: true },
          createdAt: { $gte: cutoffAt },
        } as never,
        order: { createdAt: 'DESC' },
        skip,
        take: 500,
      });
      messages.push(...page);
      if (page.length < 500) break;
    }
    return messages;
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
    | 'revalidatedTaskCount'
    | 'removedTaskCount'
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
      | 'revalidatedTaskCount'
      | 'removedTaskCount'
    > = {};
    for (const key of [
      'generatedTaskCount',
      'activeTaskCount',
      'expiredTaskCount',
      'migratedLegacyCardCount',
      'updatedConversationCount',
      'verifiedConversationCount',
      'failedConversationCount',
      'revalidatedTaskCount',
      'removedTaskCount',
    ] as const) {
      if (typeof value[key] === 'number') result[key] = value[key] as number;
    }
    return result;
  }

  private isShanghaiMaintenanceWindow(now: Date): boolean {
    const shanghaiHour = (now.getUTCHours() + 8) % 24;
    return shanghaiHour >= 3 && shanghaiHour < 7;
  }

  private buildBackfillScheduleStatus(
    now = new Date()
  ): Pick<
    RelationshipOpenLoopBackfillStatus,
    'schedulerActive' | 'nextEligibleAt'
  > {
    return {
      schedulerActive: Boolean(this.backfillTimer),
      nextEligibleAt:
        this.resolveNextShanghaiMaintenanceWindow(now).toISOString(),
    };
  }

  private resolveNextShanghaiMaintenanceWindow(now: Date): Date {
    if (this.isShanghaiMaintenanceWindow(now)) return now;
    const shanghaiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const nextDayOffset = shanghaiNow.getUTCHours() >= 7 ? 1 : 0;
    const shanghaiWindowStartAsUtc = Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate() + nextDayOffset,
      3
    );
    return new Date(shanghaiWindowStartAsUtc - 8 * 60 * 60 * 1000);
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
