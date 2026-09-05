import { Body, Controller, Get, Inject, Post, Query } from '@midwayjs/core';
import { AdminChatStatsService } from '../service/admin-chat-stats.service';
import {
  RelationshipOpenLoopBackfillStatus,
  RelationshipOpenLoopService,
} from '../service/agents/relationship-open-loop.service';
import { Context } from '@midwayjs/koa';
import { AgentMemoryInheritanceService } from '../service/agents/agent-memory-inheritance.service';
import { MessengerService } from '../service/agents/messenger.service';
import { MongoObjectId } from '@tzl/entities';
import { MemoryPipelineTaskService } from '../service/memory-pipeline-task.service';
import { MilvusService } from '../service/rag/milvus.service';

@Controller('/system')
export class SystemController {
  @Inject()
  adminChatStatsService: AdminChatStatsService;

  @Inject()
  ctx: Context;

  @Inject()
  memoryPipelineTaskService: MemoryPipelineTaskService;

  @Inject()
  milvusService: MilvusService;

  @Get('/health')
  async health() {
    let relationshipOpenLoopBackfill: RelationshipOpenLoopBackfillStatus = {
      jobId: 'relationship-open-loop-backfill-20260820-v1',
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
          jobId: 'relationship-open-loop-backfill-20260820-v1',
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
      memoryPipeline: await this.memoryPipelineTaskService
        .getHealthSnapshot()
        .catch(() => ({ status: 'unavailable' })),
      milvus: this.milvusService.getRuntimeStatus(),
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

  /**
   * 内部接口：管理端降级退款等业务事件触发小使者提示。
   * 需携带与 .env INTERNAL_API_SECRET 一致的 x-internal-secret 请求头。
   */
  @Post('/messenger-event')
  async messengerEvent(
    @Body()
    body: {
      eventType?: string;
      userId?: string;
      orderId?: string;
      refundAmount?: number;
    }
  ) {
    const secret = this.ctx.get('x-internal-secret');
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || secret !== expected) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const eventType = body?.eventType;
    if (
      eventType !== 'membership_purchase' &&
      eventType !== 'voice_purchase' &&
      eventType !== 'voice_package_purchase' &&
      eventType !== 'membership_downgrade'
    ) {
      return { ok: false, error: 'INVALID_EVENT_TYPE' };
    }
    if (!body?.userId || !body?.orderId) {
      return { ok: false, error: 'MISSING_PARAMS' };
    }
    let userId: MongoObjectId;
    try {
      userId = new MongoObjectId(body.userId);
    } catch {
      return { ok: false, error: 'INVALID_USER_ID' };
    }
    const service = await this.ctx.requestContext.getAsync(MessengerService);
    const result = await service.sendEventNotice({
      eventType,
      userId,
      orderId: body.orderId,
      refundAmount: body.refundAmount,
    });
    return { ok: true, result };
  }
}
