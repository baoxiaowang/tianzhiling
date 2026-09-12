import { Inject } from '@midwayjs/core';
import { memoryBudgetSnapshot } from '../service/memory-resource-budget';
import { IProcessor } from '@midwayjs/bullmq';
import { MemoryPipelineTaskStatus } from '@tzl/entities';
import { ConversationService } from '../service/conversation.service';
import {
  MEMORY_PIPELINE_QUEUE,
  MemoryPipelineJobData,
  MemoryPipelineTaskService,
} from '../service/memory-pipeline-task.service';
import {
  resolveMemoryWorkerConcurrency,
  RuntimeProcessor,
} from './runtime-processor';

/**
 * 一次协调最多重排多少条。只做入队，成本与条数几乎无关，
 * 因此可以比"逐个执行"的时代放得更大，同时给足并发上限。
 */
const RECONCILE_REQUEUE_LIMIT = 200;

@RuntimeProcessor(MEMORY_PIPELINE_QUEUE, undefined, {
  concurrency: resolveMemoryWorkerConcurrency(),
})
export class MemoryPipelineProcessor implements IProcessor {
  @Inject()
  memoryPipelineTaskService: MemoryPipelineTaskService;

  @Inject()
  conversationService: ConversationService;

  async execute(data: MemoryPipelineJobData): Promise<void> {
    if (data?.reconcile) {
      // 协调任务只负责"把到期的活重新丢回队列"，绝不在这里顺序执行。
      // 历史缺陷：这里对最多 25 个任务逐个 await 处理，而一个 semantic_index
      // 就要 3–5 秒，于是一次协调要跑 1–2 分钟——超过它自己 60 秒的周期，
      // 协调任务互相堆叠、worker 长期满负荷，CPU 居高不下。
      const tasks = await this.memoryPipelineTaskService.getDueTasks(
        RECONCILE_REQUEUE_LIMIT
      );
      for (const task of tasks) {
        try {
          await this.memoryPipelineTaskService.requeueDueTask(task);
        } catch {
          // 单条重排失败不影响其余任务；它下次仍会被协调任务扫到。
        }
      }
      return;
    }
    // 攒批超时兜底：把不足一批的消息也提交处理。
    if (data?.flushBatch && data.flushKind && data.flushConversationId) {
      await this.memoryPipelineTaskService.flushBatch(
        data.flushKind,
        data.flushConversationId
      );
      return;
    }
    if (data?.taskId) await this.processTask(data.taskId);
  }

  private async processTask(taskId: string): Promise<void> {
    // Leave unclaimed work durable; the existing reconciler retries it later.
    if (!memoryBudgetSnapshot().allowed) return;
    const task = await this.memoryPipelineTaskService.claimTask(taskId);
    if (!task) return;
    try {
      const outcome = await this.conversationService.processMemoryPipelineTask(
        task
      );
      await this.memoryPipelineTaskService.markCompleted(
        task,
        outcome === 'skipped'
          ? MemoryPipelineTaskStatus.skipped
          : MemoryPipelineTaskStatus.completed
      );
    } catch (error) {
      await this.memoryPipelineTaskService.markFailed(task, error);
      throw error;
    }
  }
}
