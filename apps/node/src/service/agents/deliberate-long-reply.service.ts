import { createHash } from 'crypto';
import { Destroy, Init, Inject, Logger, Provide } from '@midwayjs/core';
import * as bullmq from '@midwayjs/bullmq';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { ILogger } from '@midwayjs/logger';
import { MongoRepository } from 'typeorm';
import {
  ConversationDeliberateReplyTaskEntity,
  MongoObjectId,
} from '@tzl/entities';
import {
  DELIBERATE_LONG_REPLY_ENABLED,
  DeliberateLongReplyModelDecision,
  countDeliberateReplyVisibleCharacters,
} from './deliberate-long-reply';

export const CONVERSATION_DELIBERATE_REPLY_QUEUE =
  'conversation-deliberate-reply';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const MORNING_WINDOW_START_MINUTE = 7 * 60 + 30;
const MORNING_WINDOW_DURATION_MINUTES = 90;
const DELIVERY_WINDOW_END_MINUTE = 13 * 60;
const GENERATION_LEASE_MS = 30 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 5 * 60 * 1000;

export interface ConversationDeliberateReplyJobData {
  taskId: string;
}

export interface ScheduleDeliberateReplyOptions {
  conversationId: MongoObjectId;
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sourceMessageIds: string[];
  acknowledgementMessageIds: string[];
  sourceText: string;
  sourceOccurredAt: Date;
  decision: DeliberateLongReplyModelDecision;
  now?: Date;
}

export interface ScheduleDeliberateReplyResult {
  task: ConversationDeliberateReplyTaskEntity;
  action: 'created' | 'merged';
  readbackVerified: true;
  queued: boolean;
}

@Provide()
export class DeliberateLongReplyService {
  private recoveryTimer?: ReturnType<typeof setInterval>;

  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationDeliberateReplyTaskEntity)
  taskModel: MongoRepository<ConversationDeliberateReplyTaskEntity>;

  @Inject()
  bullmqFramework: bullmq.Framework;

  @Init()
  async initializeRecoveryScheduler(): Promise<void> {
    if (!DELIBERATE_LONG_REPLY_ENABLED) return;
    if (process.env.NODE_ENV !== 'production') return;
    const attempt = () => {
      void this.recoverPendingTasks().catch(error => {
        this.logger?.error?.(
          '[deliberate-reply] recovery failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
      });
    };
    setImmediate(attempt);
    this.recoveryTimer = setInterval(attempt, RECOVERY_INTERVAL_MS);
    this.recoveryTimer.unref?.();
  }

  @Destroy()
  async stopRecoveryScheduler(): Promise<void> {
    if (!this.recoveryTimer) return;
    clearInterval(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  async schedule(
    options: ScheduleDeliberateReplyOptions
  ): Promise<ScheduleDeliberateReplyResult> {
    if (!DELIBERATE_LONG_REPLY_ENABLED) {
      throw new Error('DELIBERATE_REPLY_FEATURE_DISABLED');
    }
    if (options.decision.action !== 'schedule_next_morning') {
      throw new Error('DELIBERATE_REPLY_NOT_SCHEDULED');
    }
    const now = options.now ?? new Date();
    const normalizedSourceIds = uniqueStrings(options.sourceMessageIds, 32);
    const normalizedAcknowledgementIds = uniqueStrings(
      options.acknowledgementMessageIds,
      16
    );
    const sourceText = options.sourceText.trim().slice(0, 12000);
    if (!normalizedSourceIds.length || !sourceText) {
      throw new Error('DELIBERATE_REPLY_SOURCE_REQUIRED');
    }

    const scheduledAt = resolveNextBeijingMorning({
      now,
      stableKey: `${String(options.conversationId)}:${normalizedSourceIds.join(
        ','
      )}`,
    });
    const desiredTaskKey = buildTaskKey(options.conversationId, scheduledAt);

    const existing = await this.taskModel.findOne({
      where: {
        conversationId: options.conversationId,
        status: 'pending',
        taskKey: desiredTaskKey,
      } as never,
      order: { scheduledAt: 'ASC' },
    });
    let task: ConversationDeliberateReplyTaskEntity;
    let action: ScheduleDeliberateReplyResult['action'];
    if (existing) {
      task = await this.mergePendingTask(existing, {
        sourceMessageIds: normalizedSourceIds,
        acknowledgementMessageIds: normalizedAcknowledgementIds,
        sourceText,
        sourceOccurredAt: options.sourceOccurredAt,
        focus: options.decision.focus,
        now,
      });
      action = 'merged';
    } else {
      task = new ConversationDeliberateReplyTaskEntity();
      task.schemaVersion = 'deliberate_long_reply_task_v2';
      task.taskKey = desiredTaskKey;
      task.conversationId = options.conversationId;
      task.userId = options.userId;
      task.agentId = options.agentId;
      task.status = 'pending';
      task.sourceMessageIds = normalizedSourceIds;
      task.acknowledgementMessageIds = normalizedAcknowledgementIds;
      task.sourceText = sourceText;
      task.sourceVisibleCharacters =
        countDeliberateReplyVisibleCharacters(sourceText);
      task.focus = uniqueStrings(options.decision.focus, 3, 120);
      task.decisionReason = options.decision.reason;
      task.scheduledAt = scheduledAt;
      task.deliveryWindowEndAt = resolveBeijingDeliveryWindowEnd(scheduledAt);
      task.sourceOccurredAt = options.sourceOccurredAt;
      task.attemptCount = 0;
      task.deliveredMessageIds = [];
      task.createdAt = now;
      task.updatedAt = now;
      try {
        task = await this.taskModel.save(task);
        action = 'created';
      } catch (error) {
        const duplicate = await this.taskModel.findOne({
          where: { taskKey: task.taskKey },
        });
        if (!duplicate || duplicate.status !== 'pending') throw error;
        task = await this.mergePendingTask(duplicate, {
          sourceMessageIds: normalizedSourceIds,
          acknowledgementMessageIds: normalizedAcknowledgementIds,
          sourceText,
          sourceOccurredAt: options.sourceOccurredAt,
          focus: options.decision.focus,
          now,
        });
        action = 'merged';
      }
    }

    const verified = await this.verifyPendingTask(task.id);
    const queued = await this.enqueue(verified, now);
    const finalReadback = await this.verifyPendingTask(verified.id, queued);
    return {
      task: finalReadback,
      action,
      readbackVerified: true,
      queued,
    };
  }

  async claim(
    taskId: MongoObjectId,
    now = new Date()
  ): Promise<ConversationDeliberateReplyTaskEntity | undefined> {
    await this.expireTaskIfNeeded(taskId, now);
    const result = await this.taskModel.updateOne(
      {
        _id: taskId,
        status: 'pending',
        scheduledAt: { $lte: now },
        $or: [
          { deliveryWindowEndAt: { $gt: now } },
          { deliveryWindowEndAt: { $exists: false } },
        ],
      } as never,
      {
        $set: {
          status: 'generating',
          generationStartedAt: now,
          updatedAt: now,
        },
        $inc: { attemptCount: 1 },
      } as never
    );
    if (!Number(result?.modifiedCount || 0)) return undefined;
    return (
      (await this.taskModel.findOne({ where: { id: taskId } })) || undefined
    );
  }

  async recordRuntimeContext(options: {
    taskId: MongoObjectId;
    messageIds: string[];
    now?: Date;
  }): Promise<ConversationDeliberateReplyTaskEntity> {
    const now = options.now ?? new Date();
    await this.taskModel.updateOne(
      { _id: options.taskId, status: 'generating' } as never,
      {
        $set: {
          runtimeContextMessageIds: uniqueStrings(options.messageIds, 24),
          runtimeContextReadAt: now,
          updatedAt: now,
        },
      } as never
    );
    const verified = await this.taskModel.findOne({
      where: { id: options.taskId },
    });
    if (!verified || verified.status !== 'generating') {
      throw new Error('DELIBERATE_REPLY_RUNTIME_CONTEXT_READBACK_FAILED');
    }
    return verified;
  }

  async markDelivered(options: {
    taskId: MongoObjectId;
    messageIds: string[];
    now?: Date;
  }): Promise<ConversationDeliberateReplyTaskEntity> {
    const now = options.now ?? new Date();
    await this.taskModel.updateOne(
      {
        _id: options.taskId,
        status: { $in: ['generating', 'delivered'] },
      } as never,
      {
        $set: {
          status: 'delivered',
          deliveredMessageIds: uniqueStrings(options.messageIds, 8),
          deliveredAt: now,
          updatedAt: now,
        },
        $unset: { lastError: '', generationStartedAt: '' },
      } as never
    );
    const verified = await this.taskModel.findOne({
      where: { id: options.taskId },
    });
    if (
      !verified ||
      verified.status !== 'delivered' ||
      !verified.deliveredMessageIds.length
    ) {
      throw new Error('DELIBERATE_REPLY_DELIVERY_READBACK_FAILED');
    }
    return verified;
  }

  async cancel(options: {
    taskId: MongoObjectId;
    reason: string;
    now?: Date;
  }): Promise<ConversationDeliberateReplyTaskEntity | undefined> {
    const now = options.now ?? new Date();
    await this.taskModel.updateOne(
      {
        _id: options.taskId,
        status: { $in: ['pending', 'generating'] },
      } as never,
      {
        $set: {
          status: 'cancelled',
          cancellationReason: options.reason.slice(0, 120),
          cancelledAt: now,
          updatedAt: now,
        },
        $unset: { generationStartedAt: '' },
      } as never
    );
    const verified = await this.taskModel.findOne({
      where: { id: options.taskId },
    });
    if (!verified) return undefined;
    if (
      verified.status !== 'cancelled' &&
      verified.status !== 'delivered' &&
      verified.status !== 'failed'
    ) {
      throw new Error('DELIBERATE_REPLY_CANCELLATION_READBACK_FAILED');
    }
    return verified;
  }

  async releaseAfterFailure(options: {
    taskId: MongoObjectId;
    error: unknown;
    finalAttempt: boolean;
    now?: Date;
  }): Promise<void> {
    const now = options.now ?? new Date();
    const reason = (
      options.error instanceof Error
        ? options.error.message
        : String(options.error)
    ).slice(0, 500);
    await this.taskModel.updateOne(
      { _id: options.taskId, status: 'generating' } as never,
      {
        $set: {
          status: options.finalAttempt ? 'failed' : 'pending',
          lastError: reason,
          ...(options.finalAttempt ? { failedAt: now } : {}),
          updatedAt: now,
        },
        $unset: { generationStartedAt: '' },
      } as never
    );
  }

  isExplicitlyCancelledByUser(text: string): boolean {
    const normalized = text.replace(/\s/gu, '');
    return /(?:不用(?:再)?回(?:复)?了|不要(?:再)?回(?:复)?了|别(?:再)?回(?:复)?了|不需要(?:再)?回(?:复)?|明天不用说了|明早不用说了|这段不用回了|这件事不用再说了|别给我发了)/u.test(
      normalized
    );
  }

  async recoverPendingTasks(now = new Date()): Promise<void> {
    if (!DELIBERATE_LONG_REPLY_ENABLED) return;
    const staleAt = new Date(now.getTime() - GENERATION_LEASE_MS);
    await this.taskModel.updateMany(
      {
        status: 'generating',
        generationStartedAt: { $lte: staleAt },
        $or: [
          { deliveryWindowEndAt: { $gt: now } },
          { deliveryWindowEndAt: { $exists: false } },
        ],
      } as never,
      {
        $set: { status: 'pending', updatedAt: now },
        $unset: { generationStartedAt: '' },
      } as never
    );
    await this.taskModel.updateMany(
      {
        status: { $in: ['pending', 'generating'] },
        deliveryWindowEndAt: { $lte: now },
      } as never,
      {
        $set: {
          status: 'cancelled',
          cancellationReason: 'delivery_window_expired',
          cancelledAt: now,
          updatedAt: now,
        },
        $unset: { generationStartedAt: '' },
      } as never
    );
    const tasks = await this.taskModel.find({
      where: { status: 'pending' } as never,
      order: { scheduledAt: 'ASC' },
      take: 500,
    });
    for (const task of tasks) await this.enqueue(task, now);
  }

  private async mergePendingTask(
    task: ConversationDeliberateReplyTaskEntity,
    options: {
      sourceMessageIds: string[];
      acknowledgementMessageIds: string[];
      sourceText: string;
      sourceOccurredAt: Date;
      focus: string[];
      now: Date;
    }
  ): Promise<ConversationDeliberateReplyTaskEntity> {
    task.schemaVersion = 'deliberate_long_reply_task_v2';
    task.sourceMessageIds = uniqueStrings(
      (task.sourceMessageIds || []).concat(options.sourceMessageIds),
      48
    );
    task.acknowledgementMessageIds = uniqueStrings(
      (task.acknowledgementMessageIds || []).concat(
        options.acknowledgementMessageIds
      ),
      24
    );
    task.sourceText = [task.sourceText, options.sourceText]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);
    task.sourceVisibleCharacters = countDeliberateReplyVisibleCharacters(
      task.sourceText
    );
    task.sourceOccurredAt = new Date(
      Math.max(
        task.sourceOccurredAt?.getTime?.() || 0,
        options.sourceOccurredAt.getTime()
      )
    );
    task.focus = uniqueStrings(
      (task.focus || []).concat(options.focus),
      5,
      120
    );
    task.deliveryWindowEndAt =
      task.deliveryWindowEndAt ||
      resolveBeijingDeliveryWindowEnd(task.scheduledAt);
    task.updatedAt = options.now;
    return this.taskModel.save(task);
  }

  private async verifyPendingTask(
    taskId: MongoObjectId,
    requireQueueMarker = false
  ): Promise<ConversationDeliberateReplyTaskEntity> {
    const verified = await this.taskModel.findOne({ where: { id: taskId } });
    if (
      !verified ||
      verified.status !== 'pending' ||
      !verified.sourceMessageIds.length ||
      !verified.scheduledAt ||
      (requireQueueMarker && !verified.queueJobId)
    ) {
      throw new Error('DELIBERATE_REPLY_READBACK_FAILED');
    }
    return verified;
  }

  private async expireTaskIfNeeded(
    taskId: MongoObjectId,
    now: Date
  ): Promise<void> {
    await this.taskModel.updateOne(
      {
        _id: taskId,
        status: 'pending',
        deliveryWindowEndAt: { $lte: now },
      } as never,
      {
        $set: {
          status: 'cancelled',
          cancellationReason: 'delivery_window_expired',
          cancelledAt: now,
          updatedAt: now,
        },
      } as never
    );
  }

  private async enqueue(
    task: ConversationDeliberateReplyTaskEntity,
    now = new Date()
  ): Promise<boolean> {
    if (
      task.deliveryWindowEndAt &&
      task.deliveryWindowEndAt.getTime() <= now.getTime()
    ) {
      await this.cancel({
        taskId: task.id,
        reason: 'delivery_window_expired',
        now,
      });
      return false;
    }
    const queue = this.bullmqFramework?.getQueue(
      CONVERSATION_DELIBERATE_REPLY_QUEUE
    );
    if (!queue) {
      this.logger?.error?.(
        '[deliberate-reply] queue unavailable, taskId=%s',
        String(task.id)
      );
      return false;
    }
    const jobId = `conversation-deliberate-reply:${String(task.id)}`;
    const queueWithGetJob = queue as unknown as {
      getJob?: (id: string) => Promise<{
        getState?: () => Promise<string>;
        remove?: () => Promise<void>;
      } | null>;
    };
    const existing = await queueWithGetJob.getJob?.(jobId);
    const state = await existing?.getState?.();
    if (['delayed', 'waiting', 'active'].includes(state || '')) {
      await this.taskModel.updateOne(
        { _id: task.id, status: 'pending' } as never,
        {
          $set: {
            queueJobId: jobId,
            queuedAt: task.queuedAt || now,
            updatedAt: now,
          },
        } as never
      );
      return true;
    }
    if (existing?.remove) await existing.remove();
    await queue.addJobToQueue(
      { taskId: String(task.id) } as ConversationDeliberateReplyJobData,
      {
        jobId,
        delay: Math.max(0, task.scheduledAt.getTime() - now.getTime()),
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
        backoff: { type: 'exponential', delay: 30000 },
      }
    );
    await this.taskModel.updateOne(
      { _id: task.id, status: 'pending' } as never,
      {
        $set: { queueJobId: jobId, queuedAt: now, updatedAt: now },
      } as never
    );
    return true;
  }
}

export function resolveNextBeijingMorning(options: {
  now: Date;
  stableKey: string;
}): Date {
  const shifted = new Date(options.now.getTime() + BEIJING_OFFSET_MS);
  const nextLocalMidnightUtc =
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() + 1
    ) - BEIJING_OFFSET_MS;
  const hash = createHash('sha256').update(options.stableKey).digest();
  const windowOffsetMinute =
    hash.readUInt32BE(0) % MORNING_WINDOW_DURATION_MINUTES;
  return new Date(
    nextLocalMidnightUtc +
      (MORNING_WINDOW_START_MINUTE + windowOffsetMinute) * 60 * 1000
  );
}

export function resolveBeijingDeliveryWindowEnd(scheduledAt: Date): Date {
  const shifted = new Date(scheduledAt.getTime() + BEIJING_OFFSET_MS);
  const localMidnightUtc =
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate()
    ) - BEIJING_OFFSET_MS;
  return new Date(localMidnightUtc + DELIVERY_WINDOW_END_MINUTE * 60 * 1000);
}

function buildTaskKey(
  conversationId: MongoObjectId,
  scheduledAt: Date
): string {
  const shifted = new Date(scheduledAt.getTime() + BEIJING_OFFSET_MS);
  const dateKey = [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return createHash('sha256')
    .update(`${String(conversationId)}:${dateKey}`)
    .digest('hex');
}

function uniqueStrings(
  values: string[],
  limit: number,
  maxLength = 96
): string[] {
  return Array.from(
    new Set(
      values
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
        .map(value => value.slice(0, maxLength))
    )
  ).slice(0, limit);
}
