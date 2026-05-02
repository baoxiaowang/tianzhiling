import { Controller, Get, Inject, Param } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthenticatedUserPayload } from '../interface';
import { MembershipService } from '../service/membership.service';

@Controller('/membership')
export class MembershipController {
  @Inject()
  membershipService: MembershipService;

  @Inject()
  ctx: Context;

  @Get('/center/:agentId')
  async getMembershipCenter(@Param('agentId') agentId: string) {
    return this.membershipService.getMembershipCenter(
      this.ctx.state.auth as AuthenticatedUserPayload,
      agentId
    );
  }

  @Get('/status/:agentId')
  async getMembershipStatus(@Param('agentId') agentId: string) {
    return this.membershipService.getMembershipStatus(
      this.ctx.state.auth as AuthenticatedUserPayload,
      agentId
    );
  }
}
