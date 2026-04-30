import { Body, Controller, Get, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AdminAuthenticatedPayload } from '@tzl/shared';
import {
  AdminBootstrapRegisterDTO,
  AdminPasswordLoginDTO,
} from '../dto/admin-auth.dto';
import { AdminAuthService } from '../service/admin-auth.service';

@Controller('/auth')
export class AdminAuthController {
  @Inject()
  ctx: Context;

  @Inject()
  adminAuthService: AdminAuthService;

  @Post('/login')
  async login(@Body() body: AdminPasswordLoginDTO) {
    return this.adminAuthService.login(body);
  }

  @Get('/bootstrap-status')
  async bootstrapStatus() {
    return this.adminAuthService.getBootstrapStatus();
  }

  @Post('/bootstrap-register')
  async bootstrapRegister(@Body() body: AdminBootstrapRegisterDTO) {
    return this.adminAuthService.registerSuperAdmin(body);
  }

  @Get('/me')
  async me() {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return {
      id: auth.sub,
      account: auth.account,
      roles: auth.roles,
    };
  }
}
