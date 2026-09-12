import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { Framework as BullMQFramework, BullMQQueue } from '@midwayjs/bullmq';
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
export const MEMORY_PIPELINE_BATCH_FLUSH_JOB_PREFIX = 'memory-flush';

export interface MemoryPipelineJobData {
  taskId?: string;
  reconcile?: true;
  /** 攒批超时兜底：把不足一批的消息也处理掉，避免短会话永不入库。 */
  flushBatch?: true;
  flushKind?: MemoryPipelineTaskKind;
  flushConversationId?: string;
}

/** 只有真正会调用大模型的抽取任务才攒批；索引类任务必须逐条即时处理。 */
const MEMORY_PIPELINE_BATCHED_KINDS = new Set<MemoryPipelineTaskKind>([
  MemoryPipelineTaskKind.structuredMemory,
]);

/** 队列解析失败后的冷却时间：避免每条消息都尝试新建队列。 */
const QUEUE_RESOLVE_COOLDOWN_MS = 30_000;

function readPositiveInt(
  value: string | undefined,
  fallback: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function resolveBatchSize(): number {
  // 固定用 5 条一批（评测与线上一致）。批量越大越快，但模型一次给出的稳定
  // 事实越少；5 条是当前采用的平衡点，代价已记录在案：
  //   冻结用户 batch=1 → 38 条；batch=5 → 28 条；batch=10 → 24 条
  //   真实用户A batch=1 召回 0.846；batch=5 召回 0.538
  // 改善批量下的抽取完整度是后续优化项；在此之前不再改动批量大小，
  // 以保持各轮评测可比。
  return readPositiveInt(process.env.MEMORY_PIPELINE_BATCH_SIZE, 5, 100);
}

function resolveFlushDelayMs(): number {
  return readPositiveInt(
    process.env.MEMORY_PIPELINE_FLUSH_DELAY_MS,
    120_000,
    3_600_000
  );
}

function resolveBatchMax(): number {
  return readPositiveInt(process.env.MEMORY_PIPELINE_BATCH_MAX, 50, 200);
}

@Provide()
export class MemoryPipelineTaskService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MemoryPipelineTaskEntity)
  taskModel: MongoRepository<MemoryPipelineTaskEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  bullmqFramework: BullMQFramework;

  /** 队列句柄缓存（见 resolveMemoryPipelineQueue）。 */
  private memoryPipelineQueue?: BullMQQueue;
  private memoryPipelineQueueMissAt = 0;

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

    // 索引类任务逐条即时处理；只有需要调用大模型的抽取任务才攒批。
    // 历史缺陷：所有 kind 共用一个攒批 key，导致互相计数、索引类任务永不触发、
    // 不足一批的消息在 24 小时过期后被静默丢弃。现在按 kind 隔离并加超时兜底。
    const tasks: MemoryPipelineTaskEntity[] = [];
    for (const kind of Array.from(new Set(kinds))) {
      if (MEMORY_PIPELINE_BATCHED_KINDS.has(kind)) {
        tasks.push(
          ...(await this.enqueueBatched(
            message,
            cleanText,
            kind,
            conversationId
          ))
        );
      } else {
        tasks.push(await this.enqueueSingle(message, cleanText, kind));
      }
    }
    return tasks;
  }

  private async enqueueSingle(
    message: MessageEntity,
    cleanText: string,
    kind: MemoryPipelineTaskKind
  ): Promise<MemoryPipelineTaskEntity> {
    const task = await this.ensureTask(message, cleanText, kind);
    await this.enqueueTaskJob(task);
    return task;
  }

  private batchKey(
    kind: MemoryPipelineTaskKind,
    conversationId: string
  ): string {
    return `memory-pipeline:batch:${kind}:${conversationId}`;
  }

  private async enqueueBatched(
    message: MessageEntity,
    cleanText: string,
    kind: MemoryPipelineTaskKind,
    conversationId: string
  ): Promise<MemoryPipelineTaskEntity[]> {
    if (!this.redisService) {
      // 无 Redis 时无法攒批，降级为逐条任务，保证不丢。
      return [await this.enqueueSingle(message, cleanText, kind)];
    }

    const batchSize = resolveBatchSize();
    const batchKey = this.batchKey(kind, conversationId);

    try {
      await this.redisService.rpush(batchKey, message.id.toString());
      // 过期时间只作为异常兜底；正常清理由触发或超时兜底完成。
      await this.redisService.expire(batchKey, 24 * 60 * 60);

      const batchLen = Number(await this.redisService.llen(batchKey)) || 0;
      if (batchLen < batchSize) {
        // 不足一批：登记一次超时兜底，避免短会话永不入库。
        await this.scheduleBatchFlush(kind, conversationId);
        this.logger.info(
          '[memory-pipeline] batch accumulate, kind=%s, conversationId=%s, count=%s/%s',
          kind,
          conversationId,
          batchLen,
          batchSize
        );
        return [];
      }

      const messageIds =
        (await this.redisService.lrange(batchKey, 0, -1)) || [];
      await this.redisService.del(batchKey);

      this.logger.info(
        '[memory-pipeline] batch trigger, kind=%s, conversationId=%s, messageCount=%s',
        kind,
        conversationId,
        messageIds.length
      );

      return await this.createBatchTasks(
        kind,
        conversationId,
        messageIds,
        message,
        cleanText
      );
    } catch (error) {
      this.logger.warn(
        '[memory-pipeline] batch enqueue failed, fallback to single. kind=%s error=%s',
        kind,
        this.describeError(error)
      );
      return [await this.enqueueSingle(message, cleanText, kind)];
    }
  }

  /** 超时兜底：把不足一批的消息也做成批量任务。 */
  async flushBatch(
    kind: MemoryPipelineTaskKind,
    conversationId: string
  ): Promise<MemoryPipelineTaskEntity | null> {
    if (!this.redisService) return null;
    const batchKey = this.batchKey(kind, conversationId);
    let messageIds: string[] = [];
    try {
      messageIds = (await this.redisService.lrange(batchKey, 0, -1)) || [];
      if (!messageIds.length) return null;
      await this.redisService.del(batchKey);
    } catch (error) {
      this.logger.warn(
        '[memory-pipeline] batch flush failed, kind=%s, conversationId=%s, error=%s',
        kind,
        conversationId,
        this.describeError(error)
      );
      return null;
    }

    this.logger.info(
      '[memory-pipeline] batch flush, kind=%s, conversationId=%s, messageCount=%s',
      kind,
      conversationId,
      messageIds.length
    );
    const tasks = await this.createBatchTasks(kind, conversationId, messageIds);
    return tasks[0] || null;
  }

  private async createBatchTasks(
    kind: MemoryPipelineTaskKind,
    conversationId: string,
    messageIds: string[],
    anchorMessage?: MessageEntity,
    cleanText = ''
  ): Promise<MemoryPipelineTaskEntity[]> {
    const uniqueIds = Array.from(
      new Set(
        messageIds
          .map(id => id?.trim())
          .filter(
            (id): id is string =>
              Boolean(id) && MongoObjectId.isValid(id as string)
          )
      )
    );
    if (!uniqueIds.length) return [];

    const max = resolveBatchMax();
    const tasks: MemoryPipelineTaskEntity[] = [];
    for (let offset = 0; offset < uniqueIds.length; offset += max) {
      const chunk = uniqueIds.slice(offset, offset + max);
      const anchor =
        offset === 0 && anchorMessage
          ? anchorMessage
          : await this.findExistingMessage(chunk);
      if (!anchor) continue;
      const task = await this.ensureBatchTask(anchor, cleanText, kind, chunk);
      await this.enqueueTaskJob(task);
      tasks.push(task);
    }
    return tasks;
  }

  private async findExistingMessage(
    ids: string[]
  ): Promise<MessageEntity | undefined> {
    if (!this.messageModel) return undefined;
    for (const id of ids) {
      const found = await this.messageModel.findOne({
        where: { _id: new MongoObjectId(id) } as never,
      });
      if (found) return found;
    }
    return undefined;
  }

  /**
   * 队列句柄只解析一次并缓存。
   *
   * 为什么必须缓存：Midway 的 createQueue 每次都会 new 一个 BullMQQueue 并覆盖
   * queueMap——旧的队列实例（连同它的 Redis 连接、事件监听与内部定时器）不会被
   * 关闭。这个函数处在上报每条消息的路径上，一旦走到 createQueue 分支，就会随着
   * 消息量不断新建连接和定时器，表现为"服务跑得越久 CPU 越高、重启就恢复"。
   * 解析不到时留一个冷却窗口，避免在队列确实不可用时每条消息都重试创建。
   */
  private resolveMemoryPipelineQueue(): BullMQQueue | undefined {
    if (this.memoryPipelineQueue) return this.memoryPipelineQueue;
    const now = Date.now();
    if (now - this.memoryPipelineQueueMissAt < QUEUE_RESOLVE_COOLDOWN_MS) {
      return undefined;
    }
    const queue =
      this.bullmqFramework?.getQueue(MEMORY_PIPELINE_QUEUE) ||
      this.bullmqFramework?.createQueue(MEMORY_PIPELINE_QUEUE);
    if (!queue) {
      this.memoryPipelineQueueMissAt = now;
      return undefined;
    }
    this.memoryPipelineQueue = queue;
    return queue;
  }

  /** 把到期的任务重新入队（协调任务只入队、不自己执行）。 */
  async requeueDueTask(task: MemoryPipelineTaskEntity): Promise<void> {
    await this.enqueueTaskJob(task);
  }

  private async scheduleBatchFlush(
    kind: MemoryPipelineTaskKind,
    conversationId: string
  ): Promise<void> {
    const queue = this.resolveMemoryPipelineQueue();
    if (!queue) return;
    try {
      await queue.addJobToQueue(
        {
          flushBatch: true,
          flushKind: kind,
          flushConversationId: conversationId,
        } as MemoryPipelineJobData,
        {
          jobId: `${MEMORY_PIPELINE_BATCH_FLUSH_JOB_PREFIX}-${kind}-${conversationId}`,
          delay: resolveFlushDelayMs(),
          removeOnComplete: true,
          removeOnFail: 10,
        }
      );
    } catch (error) {
      this.logger.warn(
        '[memory-pipeline] schedule flush failed, kind=%s, conversationId=%s, error=%s',
        kind,
        conversationId,
        this.describeError(error)
      );
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
            attemptCount: { $lt: 6 },
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
      this.taskModel.count({
        status: MemoryPipelineTaskStatus.pending,
      } as never),
      this.taskModel.count({
        status: MemoryPipelineTaskStatus.processing,
      } as never),
      this.taskModel.count({
        status: MemoryPipelineTaskStatus.failed,
      } as never),
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
    status:
      | MemoryPipelineTaskStatus.completed
      | MemoryPipelineTaskStatus.skipped = MemoryPipelineTaskStatus.completed
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
    const where = {
      messageId: firstMessage.id,
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
    try {
      return await this.taskModel.save(task);
    } catch (error) {
      // 并发触发时唯一索引兜底：复用已经落库的那条任务。
      const concurrentlyCreated = await this.taskModel.findOne({ where });
      if (concurrentlyCreated) return concurrentlyCreated;
      throw error;
    }
  }

  private async enqueueTaskJob(task: MemoryPipelineTaskEntity): Promise<void> {
    if (
      task.status === MemoryPipelineTaskStatus.completed ||
      task.status === MemoryPipelineTaskStatus.skipped
    ) {
      return;
    }
    const queue = this.resolveMemoryPipelineQueue();
    if (!queue) {
      this.logger.warn(
        '[memory-pipeline] queue unavailable, task remains pending'
      );
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
