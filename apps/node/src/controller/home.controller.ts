import { Controller, Get } from '@midwayjs/core';
import { Inject } from '@midwayjs/core';
import { Query } from '@midwayjs/core';
import { AdminChatStatsService } from '../service/admin-chat-stats.service';
import {
  ContinuityCardBackfillStatus,
  ContinuityInformationCardService,
} from '../service/agents/continuity-information-card.service';
import { Context } from '@midwayjs/koa';
import { AgentMemoryInheritanceService } from '../service/agents/agent-memory-inheritance.service';

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
    let memoryInheritanceBackfill: {
      jobId: string;
      status: 'pending' | 'running' | 'completed' | 'unknown';
      [key: string]: unknown;
    } = {
      jobId: 'agent-memory-inheritance-backfill-20260820-v1',
      status: 'pending' as 'pending' | 'running' | 'completed' | 'unknown',
    };
    if (process.env.NODE_ENV === 'production') {
      try {
        const service = await this.ctx.requestContext.getAsync(
          AgentMemoryInheritanceService
        );
        void service.runProductionBackfillOnce().catch(() => undefined);
        memoryInheritanceBackfill = { ...(await service.getStatus()) };
      } catch {
        memoryInheritanceBackfill.status = 'unknown';
      }
    }
    return {
      service: 'tianzhiling-node',
      status: 'ok',
      continuityCardBackfill,
      memoryInheritanceBackfill,
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
