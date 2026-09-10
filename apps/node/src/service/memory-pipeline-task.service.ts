import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { Framework as BullMQFramework } from '@midwayjs/bullmq';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { RedisService } from '@midwayjs/redis';
import {
  MEMORY_PIPELINE_TASK_VERSION,
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskStatus,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { createHash } from 'crypto';
import { MongoRepository } from 'typeorm';

export const MEMORY_PIPELINE_QUEUE = 'memory-pipeline';
export const MEMORY_PIPELINE_RECONCILE_JOB_ID = 'memory-pipeline-reconcile-v1';
export const MEMORY_PIPELINE_RECONCILE_INTERVAL_MS = 60_000;
export const MEMORY_PIPELINE_VERSION = 'memory_pipeline_20260905_v1';

export interface MemoryPipelineJobData {
  taskId?: string;
  reconcile?: true;
}

@Provide()
export class MemoryPipelineTaskService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MemoryPipelineTaskEntity)
  taskModel: MongoRepository<MemoryPipelineTaskEntity>;

  @Inject()
  bullmqFramework: BullMQFramework;

  @Inject()
  redisService: RedisService;

  async enqueueForMessage(
    message: MessageEntity,
    searchableText: string,
    kinds: MemoryPipelineTaskKind[]
  ): Promise<MemoryPipelineTaskEntity[]> {
    const cleanText = searchableText?.replace(/\s+/g, ' ').trim();
    if (!cleanText || !message?.id) return [];

    const conversationId = message.conversationId?.toString();
    if (!conversationId) return [];

    // 批量合并：每 N 条消息创建一个批量任务，避免丢失消息
    const batchSize = Number(process.env.MEMORY_PIPELINE_BATCH_SIZE || 10);
    const batchKey = `memory-pipeline:batch:${conversationId}`;

    try {
      // 把当前消息 ID 加入批量队列
      await this.redisService?.rpush(batchKey, message.id.toString());
      // 设置过期时间，避免异常情况下队列永久残留
      await this.redisService?.expire(batchKey, 24 * 60 * 60);

      const batchLen = await this.redisService?.llen(batchKey);
      if ((batchLen || 0) < batchSize) {
        this.logger.info(
          '[memory-pipeline] batch accumulate, conversationId=%s, count=%s/%s',
          conversationId,
          batchLen,
          batchSize
        );
        return [];
      }

      // 达到批量大小，取出所有消息 ID
      const messageIds = await this.redisService?.lrange(batchKey, 0, -1);
      await this.redisService?.del(batchKey);

      if (!messageIds || messageIds.length === 0) return [];

      this.logger.info(
        '[memory-pipeline] batch trigger, conversationId=%s, messageCount=%s',
        conversationId,
        messageIds.length
      );

      // 为每种 kind 创建一个批量任务
      const tasks: MemoryPipelineTaskEntity[] = [];
      for (const kind of Array.from(new Set(kinds))) {
        const task = await this.ensureBatchTask(message, cleanText, kind, messageIds);
        tasks.push(task);
        await this.enqueueTaskJob(task);
      }
      return tasks;
    } catch (error) {
      this.logger.warn(
        '[memory-pipeline] batch enqueue failed, fallback to single. error=%s',
        this.describeError(error)
      );
      // Redis 异常时降级为单条任务
      const tasks: MemoryPipelineTaskEntity[] = [];
      for (const kind of Array.from(new Set(kinds))) {
        const task = await this.ensureTask(message, cleanText, kind);
        tasks.push(task);
        await this.enqueueTaskJob(task);
      }
      return tasks;
    }
  }

  async getDueTasks(limit = 25): Promise<MemoryPipelineTaskEntity[]> {
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    return this.taskModel.find({
      where: {
        $or: [
          {
            status: {
              $in: [
                MemoryPipelineTaskStatus.pending,
                MemoryPipelineTaskStatus.failed,
              ],
            },
            nextAttemptAt: { $lte: new Date() },
          },
          {
            status: MemoryPipelineTaskStatus.processing,
            processingStartedAt: { $lte: staleBefore },
          },
        ],
      } as never,
      order: { nextAttemptAt: 'ASC' },
      take: Math.max(1, Math.min(limit, 100)),
    });
  }

  async getHealthSnapshot(): Promise<{
    pending: number;
    processing: number;
    failed: number;
    oldestPendingAgeMs: number;
  }> {
    const [pending, processing, failed, oldest] = await Promise.all([
      this.taskModel.count({ status: MemoryPipelineTaskStatus.pending } as never),
      this.taskModel.count({ status: MemoryPipelineTaskStatus.processing } as never),
      this.taskModel.count({ status: MemoryPipelineTaskStatus.failed } as never),
      this.taskModel.findOne({
        where: {
          status: {
            $in: [
              MemoryPipelineTaskStatus.pending,
              MemoryPipelineTaskStatus.failed,
            ],
          },
        } as never,
        order: { createdAt: 'ASC' },
      }),
    ]);
    return {
      pending,
      processing,
      failed,
      oldestPendingAgeMs: oldest?.createdAt
        ? Math.max(0, Date.now() - oldest.createdAt.getTime())
        : 0,
    };
  }

  async claimTask(taskId: string): Promise<MemoryPipelineTaskEntity | null> {
    if (!MongoObjectId.isValid(taskId)) return null;
    const task = await this.taskModel.findOne({
      where: { _id: new MongoObjectId(taskId) } as never,
    });
    if (!task) return null;

    const now = new Date();
    const stale =
      task.status === MemoryPipelineTaskStatus.processing &&
      Boolean(
        task.processingStartedAt &&
          task.processingStartedAt.getTime() <= now.getTime() - 10 * 60_000
      );
    const due =
      task.status === MemoryPipelineTaskStatus.pending ||
      (task.status === MemoryPipelineTaskStatus.failed &&
        task.nextAttemptAt.getTime() <= now.getTime()) ||
      stale;
    if (!due) return null;

    const result = await this.taskModel.updateOne(
      { _id: task.id, status: task.status, updatedAt: task.updatedAt },
      {
        $set: {
          status: MemoryPipelineTaskStatus.processing,
          processingStartedAt: now,
          updatedAt: now,
        },
        $inc: { attemptCount: 1 },
      } as never
    );
    if (result.modifiedCount !== 1) return null;

    return this.taskModel.findOne({ where: { _id: task.id } as never });
  }

  async markCompleted(
    task: MemoryPipelineTaskEntity,
    status: MemoryPipelineTaskStatus.completed | MemoryPipelineTaskStatus.skipped =
      MemoryPipelineTaskStatus.completed
  ): Promise<void> {
    const now = new Date();
    await this.taskModel.updateOne(
      { _id: task.id, status: MemoryPipelineTaskStatus.processing },
      {
        $set: {
          status,
          completedAt: now,
          updatedAt: now,
        },
        $unset: { lastError: '', processingStartedAt: '' },
      } as never
    );
  }

  async markFailed(
    task: MemoryPipelineTaskEntity,
    error: unknown
  ): Promise<void> {
    const attempt = Math.max(1, Number(task.attemptCount || 1));
    const delayMs = Math.min(30 * 60_000, 5_000 * 2 ** (attempt - 1));
    const now = new Date();
    await this.taskModel.updateOne(
      { _id: task.id, status: MemoryPipelineTaskStatus.processing },
      {
        $set: {
          status: MemoryPipelineTaskStatus.failed,
          lastError: this.describeError(error).slice(0, 1000),
          nextAttemptAt: new Date(now.getTime() + delayMs),
          updatedAt: now,
        },
        $unset: { processingStartedAt: '' },
      } as never
    );
  }

  private async ensureTask(
    message: MessageEntity,
    searchableText: string,
    kind: MemoryPipelineTaskKind
  ): Promise<MemoryPipelineTaskEntity> {
    const where = {
      messageId: message.id,
      kind,
      pipelineVersion: MEMORY_PIPELINE_VERSION,
    };
    const existing = await this.taskModel.findOne({ where });
    if (existing) return existing;

    const now = new Date();
    const task = new MemoryPipelineTaskEntity();
    Object.assign(task, {
      schemaVersion: MEMORY_PIPELINE_TASK_VERSION,
      pipelineVersion: MEMORY_PIPELINE_VERSION,
      kind,
      status: MemoryPipelineTaskStatus.pending,
      messageId: message.id,
      conversationId: message.conversationId,
      userId: message.userId,
      agentId: message.agentId,
      sourceHash: createHash('sha256').update(searchableText).digest('hex'),
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    try {
      return await this.taskModel.save(task);
    } catch (error) {
      const concurrentlyCreated = await this.taskModel.findOne({ where });
      if (concurrentlyCreated) return concurrentlyCreated;
      throw error;
    }
  }

  /**
   * 创建批量任务：合并多条消息为一个任务
   * messageId 设为第一条消息的 ID（用于唯一索引兼容）
   * messageIds 存储所有消息的 ID
   */
  private async ensureBatchTask(
    firstMessage: MessageEntity,
    searchableText: string,
    kind: MemoryPipelineTaskKind,
    messageIds: string[]
  ): Promise<MemoryPipelineTaskEntity> {
    const now = new Date();
    const task = new MemoryPipelineTaskEntity();
    Object.assign(task, {
      schemaVersion: MEMORY_PIPELINE_TASK_VERSION,
      pipelineVersion: MEMORY_PIPELINE_VERSION,
      kind,
      status: MemoryPipelineTaskStatus.pending,
      messageId: firstMessage.id,
      messageIds: messageIds.map(id => new MongoObjectId(id)),
      conversationId: firstMessage.conversationId,
      userId: firstMessage.userId,
      agentId: firstMessage.agentId,
      sourceHash: createHash('sha256')
        .update(searchableText + ':' + messageIds.join(','))
        .digest('hex'),
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return await this.taskModel.save(task);
  }

  private async enqueueTaskJob(task: MemoryPipelineTaskEntity): Promise<void> {
    if (
      task.status === MemoryPipelineTaskStatus.completed ||
      task.status === MemoryPipelineTaskStatus.skipped
    ) {
      return;
    }
    const queue = this.bullmqFramework?.getQueue(MEMORY_PIPELINE_QUEUE);
    if (!queue) {
      this.logger.warn('[memory-pipeline] queue unavailable, task remains pending');
      return;
    }
    try {
      await queue.addJobToQueue(
        { taskId: task.id.toString() } as MemoryPipelineJobData,
        {
          jobId: `memory-${task.id.toString()}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }
      );
    } catch (error) {
      this.logger.warn(
        '[memory-pipeline] enqueue failed, taskId=%s, reason=%s',
        task.id.toString(),
        this.describeError(error)
      );
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error || 'unknown');
  }
}
