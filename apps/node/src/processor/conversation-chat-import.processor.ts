import { Inject } from '@midwayjs/core';
import { IProcessor } from '@midwayjs/bullmq';
import {
  CONVERSATION_CHAT_IMPORT_QUEUE,
  ConversationChatImportJobData,
  ConversationChatImportService,
} from '../service/conversation-chat-import.service';
import { RuntimeProcessor } from './runtime-processor';

@RuntimeProcessor(CONVERSATION_CHAT_IMPORT_QUEUE)
export class ConversationChatImportProcessor implements IProcessor {
  @Inject()
  conversationChatImportService: ConversationChatImportService;

  async execute(data: ConversationChatImportJobData): Promise<void> {
    await this.conversationChatImportService.processJob(data);
  }
}
