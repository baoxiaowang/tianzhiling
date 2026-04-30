import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
} from '@midwayjs/core';
import {
  ListAdminAgentConversationMessagesQueryDTO,
  ListAdminAgentConversationsQueryDTO,
  ListAdminAgentsQueryDTO,
  UpdateAdminAgentDTO,
} from '../dto/admin-agent.dto';
import { AdminAgentService } from '../service/admin-agent.service';

@Controller('/agents')
export class AdminAgentController {
  @Inject()
  adminAgentService: AdminAgentService;

  @Get('/')
  async list(@Query() query: ListAdminAgentsQueryDTO) {
    return this.adminAgentService.listAgents(query);
  }

  @Get('/:id/conversations')
  async conversations(
    @Param('id') id: string,
    @Query() query: ListAdminAgentConversationsQueryDTO
  ) {
    return this.adminAgentService.listAgentConversations(id, query);
  }

  @Get('/:id/conversations/:conversationId/messages')
  async conversationMessages(
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Query() query: ListAdminAgentConversationMessagesQueryDTO
  ) {
    return this.adminAgentService.listAgentConversationMessages(
      id,
      conversationId,
      query
    );
  }

  @Get('/:id')
  async detail(@Param('id') id: string) {
    return this.adminAgentService.getAgentDetail(id);
  }

  @Put('/:id')
  async update(@Param('id') id: string, @Body() body: UpdateAdminAgentDTO) {
    return this.adminAgentService.updateAgent(id, body);
  }
}
