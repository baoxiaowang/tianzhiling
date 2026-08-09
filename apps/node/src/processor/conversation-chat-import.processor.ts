import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  CONVERSATION_CHAT_IMPORT_QUEUE,
  ConversationChatImportJobData,
  ConversationChatImportService,
} from '../service/conversation-chat-import.service';

@Processor(CONVERSATION_CHAT_IMPORT_QUEUE)
export class ConversationChatImportProcessor implements IProcessor {
  @Inject()
  conversationChatImportService: ConversationChatImportService;

  async execute(data: ConversationChatImportJobData): Promise<void> {
    await this.conversationChatImportService.processJob(data);
  }
}
