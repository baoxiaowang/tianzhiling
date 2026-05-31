import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  CONVERSATION_REPLY_QUEUE,
  ConversationReplyJobData,
  ConversationService,
} from '../service/conversation.service';

@Processor(CONVERSATION_REPLY_QUEUE)
export class ConversationReplyProcessor implements IProcessor {
  @Inject()
  conversationService: ConversationService;

  async execute(data: ConversationReplyJobData): Promise<void> {
    await this.conversationService.processConversationReplyJob(data);
  }
}
