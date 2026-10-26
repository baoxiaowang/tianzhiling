import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { SiteMessageService } from '../service/site-message.service';

@Controller('/site-moderation')
export class SiteModerationController {
  @Inject()
  siteMessageService: SiteMessageService;

  @Inject()
  ctx: Context;

  private getClientIp(): string {
    const realIp = (this.ctx.get('x-real-ip') || '').trim();
    const forwarded = (this.ctx.get('x-forwarded-for') || '')
      .split(',')[0]
      .trim();
    return realIp || forwarded || this.ctx.ip;
  }

  @Post('/login')
  async login(@Body() body: { password?: string }) {
    return this.siteMessageService.loginModerator(
      String(body?.password || ''),
      this.getClientIp()
    );
  }

  @Post('/logout')
  async logout() {
    return this.siteMessageService.logoutModerator(
      this.ctx.get('x-moderation-token') || ''
    );
  }

  @Get('/messages')
  async list(
    @Query() query?: { status?: string; page?: string; pageSize?: string }
  ) {
    await this.siteMessageService.assertModerator(
      this.ctx.get('x-moderation-token')
    );
    return this.siteMessageService.listForModeration(
      query?.status,
      query?.page,
      query?.pageSize
    );
  }

  @Post('/messages/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body?: { reason?: string }
  ) {
    await this.siteMessageService.assertModerator(
      this.ctx.get('x-moderation-token')
    );
    return this.siteMessageService.approve(id, body?.reason);
  }

  @Post('/messages/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body?: { reason?: string }
  ) {
    await this.siteMessageService.assertModerator(
      this.ctx.get('x-moderation-token')
    );
    return this.siteMessageService.reject(id, body?.reason);
  }

  @Post('/messages/:id/delete')
  async remove(@Param('id') id: string) {
    await this.siteMessageService.assertModerator(
      this.ctx.get('x-moderation-token')
    );
    return this.siteMessageService.remove(id);
  }

  @Post('/messages/:id/reply')
  async reply(
    @Param('id') id: string,
    @Body() body: { reply?: string }
  ) {
    await this.siteMessageService.assertModerator(
      this.ctx.get('x-moderation-token')
    );
    return this.siteMessageService.reply(id, String(body?.reply || ''));
  }
}
