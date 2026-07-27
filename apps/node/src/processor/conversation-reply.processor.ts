import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import type { Job } from 'bullmq';
import {
  CONVERSATION_REPLY_QUEUE,
  ConversationReplyJobData,
  ConversationService,
} from '../service/conversation.service';

@Processor(CONVERSATION_REPLY_QUEUE)
export class ConversationReplyProcessor implements IProcessor {
  @Inject()
  conversationService: ConversationService;

  async execute(data: ConversationReplyJobData, job?: Job): Promise<void> {
    await this.conversationService.processConversationReplyJob(data, {
      isFinalAttempt: this.isFinalAttempt(job),
    });
  }

  private isFinalAttempt(job?: Job): boolean {
    const attempts = Number(job?.opts?.attempts ?? 1);
    const attemptsMade = Number(job?.attemptsMade ?? 0);

    return attemptsMade + 1 >= Math.max(1, attempts);
  }
}
