import { Controller, Get, Inject, Param } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AppError } from '../common/errors';
import { AuthenticatedUserPayload } from '../interface';
import { VoicePackageService } from '../service/voice-package.service';

@Controller('/voice-packages')
export class VoicePackageController {
  @Inject()
  voicePackageService: VoicePackageService;

  @Inject()
  ctx: Context;

  @Get('/agent/:agentId/center')
  async getAgentVoicePackageCenter(@Param('agentId') agentId: string) {
    return this.voicePackageService.getAgentVoicePackageCenter(
      this.requireAuth(),
      agentId
    );
  }

  private requireAuth(): AuthenticatedUserPayload {
    const auth = this.ctx.state.auth as AuthenticatedUserPayload | undefined;

    if (!auth?.sub) {
      throw new AppError('UNAUTHORIZED', 'authorization is required', 401);
    }

    return auth;
  }
}
