import { Body, Controller, Get, Inject, Post, Query } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { SiteMessageService } from '../service/site-message.service';

@Controller('/site-messages')
export class SiteMessageController {
  @Inject()
  siteMessageService: SiteMessageService;

  @Inject()
  ctx: Context;

  @Get('/')
  async list(@Query() query: { page?: string; pageSize?: string }) {
    return this.siteMessageService.listPublished(query?.page, query?.pageSize);
  }

  @Post('/')
  async create(
    @Body()
    body: {
      authorName?: string;
      content?: string;
      contact?: string;
      agreementAccepted?: boolean;
      website?: string;
    }
  ) {
    return this.siteMessageService.create(body, {
      ip: this.ctx.ip,
      userAgent: this.ctx.get('user-agent') || '',
    });
  }
}
