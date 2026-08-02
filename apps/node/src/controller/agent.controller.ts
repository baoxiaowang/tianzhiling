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
  AcceptAgentShareInviteDTO,
  AgentShareQRCodeDTO,
  AgentCreateGuideDTO,
  AgentProfileMessengerSpeechDTO,
  AgentProfileInterviewDTO,
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentDefaultDTO,
  UpdateAgentProfileDTO,
  UpdateAgentShareContextDTO,
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

  @Get('/accessible')
  async listAccessibleAgents() {
    return {
      items: await this.agentService.listAccessibleAgents(this.requireAuth()),
    };
  }

  @Post('/create-interview')
  async interviewAgentCreation(@Body() body: AgentCreateGuideDTO) {
    return this.agentService.interviewAgentCreation(this.requireAuth(), body);
  }

  @Post('/create-messenger-speech')
  async createAgentCreationMessengerSpeech(
    @Body() body: AgentProfileMessengerSpeechDTO
  ) {
    return this.agentService.createAgentCreationMessengerSpeech(
      this.requireAuth(),
      body
    );
  }

  @Post('/share-invites/accept')
  async acceptAgentShareInvite(@Body() body: AcceptAgentShareInviteDTO) {
    return this.agentService.acceptAgentShareInvite(this.requireAuth(), body);
  }

  @Post('/share-invites/qrcode')
  async createAgentShareQRCode(@Body() body: AgentShareQRCodeDTO) {
    return this.agentService.createAgentShareQRCode(this.requireAuth(), body);
  }

  @Get('/:agentId')
  async getAgentDetail(@Param('agentId') agentId: string) {
    return this.agentService.getAgentDetail(this.requireAuth(), agentId);
  }

  @Post('/:agentId/share-invites')
  async createAgentShareInvite(@Param('agentId') agentId: string) {
    return this.agentService.createAgentShareInvite(
      this.requireAuth(),
      agentId
    );
  }

  @Patch('/:agentId/share-context')
  async updateAgentShareContext(
    @Param('agentId') agentId: string,
    @Body() body: UpdateAgentShareContextDTO
  ) {
    return this.agentService.updateAgentShareContext(
      this.requireAuth(),
      agentId,
      body
    );
  }

  @Post('/:agentId/memory-profile')
  async getAgentMemoryProfile(@Param('agentId') agentId: string) {
    return this.agentService.getAgentMemoryProfile(this.requireAuth(), agentId);
  }

  @Post('/:agentId/profile-interview')
  async interviewAgentProfile(
    @Param('agentId') agentId: string,
    @Body() body: AgentProfileInterviewDTO
  ) {
    return this.agentService.interviewAgentProfile(
      this.requireAuth(),
      agentId,
      body
    );
  }

  @Post('/:agentId/profile-messenger-speech')
  async createAgentProfileMessengerSpeech(
    @Param('agentId') agentId: string,
    @Body() body: AgentProfileMessengerSpeechDTO
  ) {
    return this.agentService.createAgentProfileMessengerSpeech(
      this.requireAuth(),
      agentId,
      body
    );
  }

  @Post('/:agentId/guide-seen/:target')
  async markAgentGuideSeen(
    @Param('agentId') agentId: string,
    @Param('target') target: string
  ) {
    return this.agentService.markAgentGuideSeen(
      this.requireAuth(),
      agentId,
      target
    );
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

  @Patch('/:agentId/default')
  async updateAgentDefault(
    @Param('agentId') agentId: string,
    @Body() body: UpdateAgentDefaultDTO
  ) {
    return this.agentService.updateAgentDefault(
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
