import { Body, Controller, Get, Inject, Patch, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AuthenticatedUserPayload } from '../interface';
import {
  BindWeappPhoneDTO,
  CancelCurrentUserDTO,
  DevLoginDTO,
  PasswordLoginDTO,
  PhoneLoginDTO,
  SendSmsCodeDTO,
  UpdateUserAvatarDTO,
  UpdateUserGenderDTO,
  UpdateUserNameDTO,
  UpdateUserPreferencesDTO,
  UpdateUserRegionDTO,
  WeappLoginDTO,
  WeappPhoneLoginDTO,
} from '../dto/user.dto';
import { UserService } from '../service/user.service';
import { AccountCancellationService } from '../service/account-cancellation.service';

@Controller('/user')
export class UserController {
  @Inject()
  userService: UserService;

  @Inject()
  accountCancellationService: AccountCancellationService;

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

  @Post('/dev-login')
  async devLogin(@Body() body: DevLoginDTO) {
    return this.userService.devLogin(body);
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

  @Patch('/me/gender')
  async updateCurrentUserGender(@Body() body: UpdateUserGenderDTO) {
    return this.userService.updateCurrentUserGender(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Patch('/me/region')
  async updateCurrentUserRegion(@Body() body: UpdateUserRegionDTO) {
    return this.userService.updateCurrentUserRegion(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Patch('/me/preferences')
  async updateCurrentUserPreferences(@Body() body: UpdateUserPreferencesDTO) {
    return this.userService.updateCurrentUserPreferences(
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

  @Get('/me/cancellation-check')
  async checkAccountCancellation() {
    return this.accountCancellationService.checkCurrentUser(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Post('/me/cancel')
  async cancelCurrentUser(@Body() body: CancelCurrentUserDTO) {
    return this.accountCancellationService.cancelCurrentUser(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }
}
