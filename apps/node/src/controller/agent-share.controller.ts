import { Controller, Get, Inject, Param } from '@midwayjs/core';
import { AgentService } from '../service/agent.service';

@Controller('/agent-share')
export class AgentShareController {
  @Inject()
  agentService: AgentService;

  @Get('/:token/preview')
  async getAgentShareInvitePreview(@Param('token') token: string) {
    return this.agentService.getAgentShareInvitePreview(token);
  }
}
