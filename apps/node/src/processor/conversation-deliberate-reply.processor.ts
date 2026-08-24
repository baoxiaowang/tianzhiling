import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import type { Job } from 'bullmq';
import {
  CONVERSATION_DELIBERATE_REPLY_QUEUE,
  ConversationDeliberateReplyJobData,
} from '../service/agents/deliberate-long-reply.service';
import { ConversationService } from '../service/conversation.service';

@Processor(CONVERSATION_DELIBERATE_REPLY_QUEUE)
export class ConversationDeliberateReplyProcessor implements IProcessor {
  @Inject()
  conversationService: ConversationService;

  async execute(
    data: ConversationDeliberateReplyJobData,
    job?: Job
  ): Promise<void> {
    const attempts = Number(job?.opts?.attempts ?? 1);
    const attemptsMade = Number(job?.attemptsMade ?? 0);
    await this.conversationService.processDeliberateLongReplyJob(data, {
      isFinalAttempt: attemptsMade + 1 >= Math.max(1, attempts),
      attempt: attemptsMade + 1,
      queueJobId: job?.id != null ? String(job.id) : undefined,
    });
  }
}
