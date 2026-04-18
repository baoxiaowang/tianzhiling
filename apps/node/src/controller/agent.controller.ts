import { Body, Controller, Get, Inject, Param, Patch, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentProfileDTO,
} from '../dto/agent.dto';
import { AuthenticatedUserPayload } from '../interface';
import { AgentService } from '../service/agent.service';

@Controller('/api/agent')
export class AgentController {
  @Inject()
  agentService: AgentService;

  @Inject()
  ctx: Context;

  @Get('/')
  async listAgents() {
    return {
      items: await this.agentService.listAgents(
        this.ctx.state.auth as AuthenticatedUserPayload
      ),
    };
  }

  @Get('/:agentId')
  async getAgentDetail(@Param('agentId') agentId: string) {
    return this.agentService.getAgentDetail(
      this.ctx.state.auth as AuthenticatedUserPayload,
      agentId
    );
  }

  @Patch('/:agentId')
  async updateAgentProfile(
    @Param('agentId') agentId: string,
    @Body() body: UpdateAgentProfileDTO
  ) {
    return this.agentService.updateAgentProfile(
      this.ctx.state.auth as AuthenticatedUserPayload,
      agentId,
      body
    );
  }

  @Patch('/:agentId/avatar')
  async updateAgentAvatar(
    @Param('agentId') agentId: string,
    @Body() body: UpdateAgentAvatarDTO
  ) {
    return this.agentService.updateAgentAvatar(
      this.ctx.state.auth as AuthenticatedUserPayload,
      agentId,
      body
    );
  }

  @Post('/')
  async createAgent(@Body() body: CreateAgentDTO) {
    return this.agentService.createAgent(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }
}
