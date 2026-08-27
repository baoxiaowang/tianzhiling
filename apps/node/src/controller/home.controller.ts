import { Controller, Get } from '@midwayjs/core';
import { Inject } from '@midwayjs/core';
import { Query } from '@midwayjs/core';
import { AdminChatStatsService } from '../service/admin-chat-stats.service';
import {
  RelationshipOpenLoopBackfillStatus,
  RelationshipOpenLoopService,
} from '../service/agents/relationship-open-loop.service';
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
    let relationshipOpenLoopBackfill: RelationshipOpenLoopBackfillStatus = {
      jobId: 'relationship-open-loop-revalidation-20260824-v3',
      status: 'pending' as const,
    };
    if (process.env.NODE_ENV === 'production') {
      try {
        const service = await this.ctx.requestContext.getAsync(
          RelationshipOpenLoopService
        );
        relationshipOpenLoopBackfill =
          await service.getProductionBackfillStatus();
      } catch {
        relationshipOpenLoopBackfill = {
          jobId: 'relationship-open-loop-revalidation-20260824-v3',
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
        memoryInheritanceBackfill = { ...(await service.getStatus()) };
      } catch {
        memoryInheritanceBackfill.status = 'unknown';
      }
    }
    return {
      service: 'tianzhiling-node',
      status: 'ok',
      relationshipOpenLoopBackfill,
      continuityCardBackfill: relationshipOpenLoopBackfill,
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
