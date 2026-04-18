import { Body, Controller, Get, Inject, Param, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  SendConversationMessageDTO,
  TranscribeConversationVoiceDTO,
} from '../dto/conversation.dto';
import { AuthenticatedUserPayload } from '../interface';
import { ConversationService } from '../service/conversation.service';
import { MessageService } from '../service/message.service';

@Controller('/api/conversation')
export class ConversationController {
  @Inject()
  conversationService: ConversationService;

  @Inject()
  messageService: MessageService;

  @Inject()
  ctx: Context;

  @Get('/')
  async listConversations() {
    return {
      items: await this.conversationService.listConversations(
        this.ctx.state.auth as AuthenticatedUserPayload
      ),
    };
  }

  @Get('/:conversationId/messages')
  async listMessages(@Param('conversationId') conversationId: string) {
    return {
      items: await this.messageService.listMessages(
        this.ctx.state.auth as AuthenticatedUserPayload,
        conversationId
      ),
    };
  }

  @Post('/:conversationId/messages')
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: SendConversationMessageDTO
  ) {
    return this.conversationService.sendMessage(
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
}
