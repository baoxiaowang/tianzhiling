import { Controller, Get, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthenticatedUserPayload } from '../interface';
import { MembershipService } from '../service/membership.service';

@Controller('/membership')
export class MembershipController {
  @Inject()
  membershipService: MembershipService;

  @Inject()
  ctx: Context;

  @Get('/center')
  async getMembershipCenter() {
    return this.membershipService.getMembershipCenter(
      this.ctx.state.auth as AuthenticatedUserPayload,
      this.getClientUserAgent()
    );
  }

  @Get('/purchase-center')
  async getVipPurchaseCenter() {
    return this.membershipService.getVipPurchaseCenter(
      this.ctx.state.auth as AuthenticatedUserPayload,
      this.getClientUserAgent()
    );
  }

  @Get('/status')
  async getMembershipStatus() {
    return this.membershipService.getMembershipStatus(
      this.ctx.state.auth as AuthenticatedUserPayload,
      this.getClientUserAgent()
    );
  }

  /**
   * 下发套餐/语音包时按平台裁剪虚拟支付道具 ID：
   * iOS 不下发，旧版小程序才会回落到普通微信支付。
   */
  private getClientUserAgent(): string | undefined {
    const header = this.ctx.headers['user-agent'];

    return Array.isArray(header) ? header[0] : header;
  }
}
