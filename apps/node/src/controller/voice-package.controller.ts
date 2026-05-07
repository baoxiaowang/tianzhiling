import { Controller, Get, Inject, Param } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
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
      this.ctx.state.auth as AuthenticatedUserPayload,
      agentId
    );
  }
}
