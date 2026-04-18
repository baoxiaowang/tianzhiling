import { Body, Controller, Get, Inject, Patch, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthenticatedUserPayload } from '../interface';
import {
  PasswordLoginDTO,
  PhoneLoginDTO,
  SendSmsCodeDTO,
  UpdateUserAvatarDTO,
  UpdateUserNameDTO,
} from '../dto/user.dto';
import { UserService } from '../service/user.service';

@Controller('/api/user')
export class UserController {
  @Inject()
  userService: UserService;

  @Inject()
  ctx: Context;

  @Post('/sms-code')
  async sendSmsCode(@Body() body: SendSmsCodeDTO) {
    return this.userService.sendPhoneLoginCode(body);
  }

  @Post('/phone-login')
  async phoneLogin(@Body() body: PhoneLoginDTO) {
    return this.userService.phoneLogin(body);
  }

  @Post('/password-login')
  async passwordLogin(@Body() body: PasswordLoginDTO) {
    return this.userService.passwordLogin(body);
  }

  @Get('/me')
  async getCurrentUser() {
    return this.userService.getCurrentUser(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Patch('/me/name')
  async updateCurrentUserName(@Body() body: UpdateUserNameDTO) {
    return this.userService.updateCurrentUserName(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Patch('/me/avatar')
  async updateCurrentUserAvatar(@Body() body: UpdateUserAvatarDTO) {
    return this.userService.updateCurrentUserAvatar(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Post('/logout')
  async logout() {
    return this.userService.logoutCurrentUser(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }
}
