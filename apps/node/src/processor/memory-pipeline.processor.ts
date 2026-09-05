import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import { MemoryPipelineTaskStatus } from '@tzl/entities';
import { ConversationService } from '../service/conversation.service';
import {
  MEMORY_PIPELINE_QUEUE,
  MemoryPipelineJobData,
  MemoryPipelineTaskService,
} from '../service/memory-pipeline-task.service';

@Processor(MEMORY_PIPELINE_QUEUE)
export class MemoryPipelineProcessor implements IProcessor {
  @Inject()
  memoryPipelineTaskService: MemoryPipelineTaskService;

  @Inject()
  conversationService: ConversationService;

  async execute(data: MemoryPipelineJobData): Promise<void> {
    if (data?.reconcile) {
      const tasks = await this.memoryPipelineTaskService.getDueTasks();
      for (const task of tasks) {
        try {
          await this.processTask(task.id.toString());
        } catch {
          // A failed task already carries its own retry time. Keep draining the
          // batch so one poison message cannot starve unrelated memories.
        }
      }
      return;
    }
    if (data?.taskId) await this.processTask(data.taskId);
  }

  private async processTask(taskId: string): Promise<void> {
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
