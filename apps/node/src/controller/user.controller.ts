import { Body, Controller, Get, Inject, Patch, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthenticatedUserPayload } from '../interface';
import {
  BindWeappPhoneDTO,
  PasswordLoginDTO,
  PhoneLoginDTO,
  SendSmsCodeDTO,
  UpdateUserAvatarDTO,
  UpdateUserNameDTO,
  WeappLoginDTO,
  WeappPhoneLoginDTO,
} from '../dto/user.dto';
import { UserService } from '../service/user.service';

@Controller('/user')
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

  @Post('/weapp-login')
  async weappLogin(@Body() body: WeappLoginDTO) {
    return this.userService.weappLogin(body);
  }

  @Post('/weapp-phone-login')
  async weappPhoneLogin(@Body() body: WeappPhoneLoginDTO) {
    return this.userService.weappPhoneLogin(body);
  }

  @Post('/me/weapp-phone')
  async bindWeappPhone(@Body() body: BindWeappPhoneDTO) {
    return this.userService.bindCurrentUserWeappPhone(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
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
