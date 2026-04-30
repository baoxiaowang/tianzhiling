import { Controller, Get, Inject } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthenticatedUserPayload } from '../interface';
import { MembershipService } from '../service/membership.service';

@Controller('/api/membership')
export class MembershipController {
  @Inject()
  membershipService: MembershipService;

  @Inject()
  ctx: Context;

  @Get('/center')
  async getMembershipCenter() {
    return this.membershipService.getMembershipCenter(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }
}
