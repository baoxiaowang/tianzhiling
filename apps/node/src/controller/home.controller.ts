import { Controller, Get } from '@midwayjs/core';
import { Inject } from '@midwayjs/core';
import { Query } from '@midwayjs/core';
import { AdminChatStatsService } from '../service/admin-chat-stats.service';

@Controller('/system')
export class SystemController {
  @Inject()
  adminChatStatsService: AdminChatStatsService;

  @Get('/health')
  async health() {
    return {
      service: 'tianzhiling-node',
      status: 'ok',
    };
  }

  @Get('/chat-stats')
  async chatStats(@Query() query: { since?: string; sampleSize?: string }) {
    return this.adminChatStatsService.getStats({
      since: query.since,
      sampleSize: Number(query.sampleSize) || undefined,
    });
  }
}
