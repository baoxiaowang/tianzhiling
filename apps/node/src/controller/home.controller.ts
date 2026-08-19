import { Controller, Get } from '@midwayjs/core';
import { Inject } from '@midwayjs/core';
import { Query } from '@midwayjs/core';
import { AdminChatStatsService } from '../service/admin-chat-stats.service';
import {
  ContinuityCardBackfillStatus,
  ContinuityInformationCardService,
} from '../service/agents/continuity-information-card.service';
import { Context } from '@midwayjs/koa';

@Controller('/system')
export class SystemController {
  @Inject()
  adminChatStatsService: AdminChatStatsService;

  @Inject()
  ctx: Context;

  @Get('/health')
  async health() {
    let continuityCardBackfill: ContinuityCardBackfillStatus = {
      jobId: 'continuity-card-backfill-20260819-v1',
      status: 'pending' as const,
    };
    if (process.env.NODE_ENV === 'production') {
      try {
        const service = await this.ctx.requestContext.getAsync(
          ContinuityInformationCardService
        );
        void service.runProductionBackfillOnce().catch(() => undefined);
        continuityCardBackfill = await service.getProductionBackfillStatus();
      } catch {
        continuityCardBackfill = {
          jobId: 'continuity-card-backfill-20260819-v1',
          status: 'unknown',
        };
      }
    }
    return {
      service: 'tianzhiling-node',
      status: 'ok',
      continuityCardBackfill,
    };
  }

  @Get('/chat-stats')
  async chatStats(@Query() query: { since?: string; sampleSize?: string }) {
    return this.adminChatStatsService.getStats({
      since: query.since,
      sampleSize: Number(query.sampleSize) || undefined,
    });
  }

  @Get('/chat-failures')
  async chatFailures(@Query() query: { since?: string }) {
    return this.adminChatStatsService.getFailureStats(query.since);
  }
}
