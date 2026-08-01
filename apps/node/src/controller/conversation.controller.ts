import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  GenerateMemorialPhotoDTO,
  SendConversationMessageDTO,
  SubmitConversationMessageFeedbackDTO,
  TranscribeConversationVoiceDTO,
} from '../dto/conversation.dto';
import { AuthenticatedUserPayload } from '../interface';
import { ConversationService } from '../service/conversation.service';
import { MessageService } from '../service/message.service';
import type { ListConversationMessagesOptions } from '../service/message.service';

@Controller('/conversation')
export class ConversationController {
  @Inject()
  conversationService: ConversationService;

  @Inject()
  messageService: MessageService;

  @Inject()
  ctx: Context;

  @Get('/')
  async listConversations(
    @Query() query: { page?: string; pageSize?: string }
  ) {
    const auth = this.ctx.state.auth as AuthenticatedUserPayload;
    const shouldIncludeEntry =
      Boolean(query.pageSize) && (!query.page || Number(query.page) === 1);
    const [result, entryItem] = await Promise.all([
      this.conversationService.listConversations(auth, query),
      shouldIncludeEntry
        ? this.conversationService.getEntryConversation(auth)
        : Promise.resolve(null),
    ]);

    return {
      ...result,
      ...(shouldIncludeEntry ? { entryItem } : {}),
    };
  }

  @Get('/entry')
  async getEntryConversation() {
    return {
      item: await this.conversationService.getEntryConversation(
        this.ctx.state.auth as AuthenticatedUserPayload
      ),
    };
  }

  @Get('/:conversationId/messages')
  async listMessages(
    @Param('conversationId') conversationId: string,
    @Query() query: ListConversationMessagesOptions
  ) {
    return this.messageService.listMessages(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      query
    );
  }

  @Get('/:conversationId/bootstrap')
  async getChatBootstrap(
    @Param('conversationId') conversationId: string,
    @Query() query: ListConversationMessagesOptions
  ) {
    const auth = this.ctx.state.auth as AuthenticatedUserPayload;
    const [messages, metadata] = await Promise.all([
      this.messageService.listMessages(auth, conversationId, query),
      this.conversationService.getChatBootstrapMetadata(auth, conversationId),
    ]);

    return {
      ...messages,
      ...metadata,
    };
  }

  @Del('/:conversationId/messages/:messageId')
  async deleteMessage(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string
  ) {
    await this.messageService.deleteMessage(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      messageId
    );

    return { deleted: true };
  }

  @Get('/:conversationId/chat-quota')
  async getChatQuota(@Param('conversationId') conversationId: string) {
    return this.conversationService.getChatQuota(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId
    );
  }

  @Post('/:conversationId/messages')
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: SendConversationMessageDTO
  ) {
    return this.conversationService.sendMessage(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      this.withClientRequestId(body)
    );
  }

  @Post('/:conversationId/messages/async')
  async sendMessageAsync(
    @Param('conversationId') conversationId: string,
    @Body() body: SendConversationMessageDTO
  ) {
    return this.conversationService.sendMessageAsync(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      this.withClientRequestId(body)
    );
  }

  @Post('/:conversationId/messages/:messageId/voice')
  async generateMessageVoice(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string
  ) {
    return this.conversationService.generateMessageVoice(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      messageId
    );
  }

  @Post('/:conversationId/messages/:messageId/feedback')
  async submitMessageFeedback(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() body: SubmitConversationMessageFeedbackDTO
  ) {
    return this.conversationService.submitMessageFeedback(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      messageId,
      body
    );
  }

  @Post('/:conversationId/messages/:messageId/memory')
  async markMessageMemory(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string
  ) {
    return this.conversationService.markMessageMemory(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      messageId
    );
  }

  @Post('/:conversationId/memorial-photo')
  async generateMemorialPhoto(
    @Param('conversationId') conversationId: string,
    @Body() body: GenerateMemorialPhotoDTO
  ) {
    return this.conversationService.generateMemorialPhoto(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      body
    );
  }

  @Post('/:conversationId/voice-transcription')
  async transcribeVoice(
    @Param('conversationId') conversationId: string,
    @Body() body: TranscribeConversationVoiceDTO
  ) {
    return this.conversationService.transcribeVoice(
      this.ctx.state.auth as AuthenticatedUserPayload,
      conversationId,
      body
    );
  }

  private withClientRequestId(
    body: SendConversationMessageDTO
  ): SendConversationMessageDTO {
    if (body.clientRequestId?.trim()) {
      return body;
    }

    const clientRequestId = this.ctx
      .get('x-client-request-id')
      .trim()
      .slice(0, 64);

    return clientRequestId
      ? {
          ...body,
          clientRequestId,
        }
      : body;
  }
}
