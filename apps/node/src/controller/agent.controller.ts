import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AppError } from '../common/errors';
import {
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentProfileDTO,
} from '../dto/agent.dto';
import { AuthenticatedUserPayload } from '../interface';
import { AgentService } from '../service/agent.service';

@Controller('/agent')
export class AgentController {
  @Inject()
  agentService: AgentService;

  @Inject()
  ctx: Context;

  @Get('/')
  async listAgents() {
    return {
      items: await this.agentService.listAgents(this.requireAuth()),
    };
  }

  @Get('/:agentId')
  async getAgentDetail(@Param('agentId') agentId: string) {
    return this.agentService.getAgentDetail(this.requireAuth(), agentId);
  }

  @Patch('/:agentId')
  async updateAgentProfile(
    @Param('agentId') agentId: string,
    @Body() body: UpdateAgentProfileDTO
  ) {
    return this.agentService.updateAgentProfile(
      this.requireAuth(),
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
      this.requireAuth(),
      agentId,
      body
    );
  }

  @Del('/:agentId')
  async deleteAgent(@Param('agentId') agentId: string) {
    await this.agentService.deleteAgent(this.requireAuth(), agentId);

    return { deleted: true };
  }

  @Post('/')
  async createAgent(@Body() body: CreateAgentDTO) {
    return this.agentService.createAgent(this.requireAuth(), body);
  }

  private requireAuth(): AuthenticatedUserPayload {
    const auth = this.ctx.state.auth as AuthenticatedUserPayload | undefined;

    if (!auth?.sub) {
      throw new AppError('UNAUTHORIZED', 'authorization is required', 401);
    }

    return auth;
  }
}
