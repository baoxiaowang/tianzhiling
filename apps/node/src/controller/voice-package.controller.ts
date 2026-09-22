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
      agentId,
      this.getClientUserAgent()
    );
  }

  /** 下发套餐时按平台裁剪虚拟支付道具 ID（iOS 不下发）。 */
  private getClientUserAgent(): string | undefined {
    const header = this.ctx.headers['user-agent'];

    return Array.isArray(header) ? header[0] : header;
  }

  private requireAuth(): AuthenticatedUserPayload {
    const auth = this.ctx.state.auth as AuthenticatedUserPayload | undefined;

    if (!auth?.sub) {
      throw new AppError('UNAUTHORIZED', 'authorization is required', 401);
    }

    return auth;
  }
}
