import { Configuration, App, Inject, Logger } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import * as jwt from '@midwayjs/jwt';
import * as busboy from '@midwayjs/busboy';
import { join } from 'path';
import * as orm from '@midwayjs/typeorm';
import * as redis from '@midwayjs/redis';
import * as bullmq from '@midwayjs/bullmq';
import { DefaultErrorFilter } from './filter/default.filter';
import { NotFoundFilter } from './filter/notfound.filter';
import { AuthMiddleware } from './middleware/auth.middleware';
import { ReportMiddleware } from './middleware/report.middleware';
import { FormatMiddleware } from './middleware/format.middleware';
import { servePublicAsset } from './middleware/public-asset.middleware';
import {
  VOICE_TIMBRE_RETENTION_INTERVAL_MS,
  VOICE_TIMBRE_RETENTION_JOB_ID,
  VOICE_TIMBRE_RETENTION_QUEUE,
  VOICE_TIMBRE_CLEANUP_QUEUE,
  VOICE_TIMBRE_CLEANUP_JOB_ID,
} from './service/voice-timbre-library.service';
import {
  MEMORY_PIPELINE_QUEUE,
  MEMORY_PIPELINE_RECONCILE_INTERVAL_MS,
  MEMORY_PIPELINE_RECONCILE_JOB_ID,
} from './service/memory-pipeline-task.service';
import { DEPARTURE_DURATION_QUEUE } from './service/agents/departure-duration.service';
import { DepartureDurationProcessor } from './processor/departure-duration.processor';
import { resolveNodeRuntimeRole } from './processor/runtime-processor';

@Configuration({
  imports: [
    koa,
    validate,
    jwt,
    busboy,
    orm,
    redis,
    bullmq,
    {
      component: info,
      enabledEnvironment: ['local'],
    },
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App('koa')
  app: koa.Application;

  @Logger()
  logger: ILogger;

  @Inject()
  bullmqFramework: bullmq.Framework;

  async onReady() {
    this.app.use(servePublicAsset);
    this.app.useMiddleware([ReportMiddleware]);
    this.app.useMiddleware([AuthMiddleware]);
    this.app.useMiddleware([FormatMiddleware]);
    this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);
  }

  async onServerReady() {
    const runtimeRole = resolveNodeRuntimeRole();
    try {
      const instanceId = process.env.NODE_APP_INSTANCE?.trim();
      const ownsMemorySchedule =
        runtimeRole !== 'web' && (!instanceId || instanceId === '0');
      if (ownsMemorySchedule) {
        const memoryQueue = this.bullmqFramework?.getQueue(
          MEMORY_PIPELINE_QUEUE
        );
        if (!memoryQueue) {
          this.logger.warn(
            '[memory-pipeline] reconciliation queue is unavailable'
          );
        } else {
          const schedulerId = memoryQueue.name;
          const scheduler = await memoryQueue.getJobScheduler(schedulerId);
          if (
            scheduler?.next &&
            scheduler.next < Date.now() - MEMORY_PIPELINE_RECONCILE_INTERVAL_MS
          ) {
            await memoryQueue.removeJobScheduler(schedulerId);
            this.logger.warn(
              '[memory-pipeline] stale reconciliation scheduler recreated, previousNext=%s',
              new Date(scheduler.next).toISOString()
            );
          }
          await memoryQueue.addJobToQueue(
            { reconcile: true },
            {
              jobId: MEMORY_PIPELINE_RECONCILE_JOB_ID,
              repeat: { every: MEMORY_PIPELINE_RECONCILE_INTERVAL_MS },
              removeOnComplete: true,
              removeOnFail: 30,
            }
          );
          await memoryQueue.addJobToQueue(
            { reconcile: true },
            {
              jobId: `${MEMORY_PIPELINE_RECONCILE_JOB_ID}-startup-${Math.floor(
                Date.now() / MEMORY_PIPELINE_RECONCILE_INTERVAL_MS
              )}`,
              removeOnComplete: true,
              removeOnFail: 30,
            }
          );
        }

        // 离世时长预计算：每天凌晨3点增量（活跃用户），每月1号全量
        try {
          const durationQueue = this.bullmqFramework?.getQueue(
            DEPARTURE_DURATION_QUEUE
          );
          if (durationQueue) {
            // 每天凌晨3点：增量计算活跃用户
            await durationQueue.addJobToQueue(
              { type: 'daily' },
              {
                jobId: 'departure-duration-daily',
                repeat: { pattern: '0 3 * * *' },
                removeOnComplete: true,
                removeOnFail: 30,
              }
            );
            // 每月1号凌晨3点：全量计算所有用户
            await durationQueue.addJobToQueue(
              { type: 'monthly' },
              {
                jobId: 'departure-duration-monthly',
                repeat: { pattern: '0 3 1 * *' },
                removeOnComplete: true,
                removeOnFail: 30,
              }
            );
            // 启动时立即跑一次增量，避免重启后当天不执行
            await durationQueue.addJobToQueue(
              { type: 'daily' },
              {
                jobId: `departure-duration-startup-${Date.now()}`,
                removeOnComplete: true,
                removeOnFail: 30,
              }
            );
            this.logger.info(
              '[departure-duration] scheduled daily(03:00) and monthly(1st 03:00) computation'
            );
          }
        } catch (error) {
          this.logger.warn(
            '[departure-duration] scheduling failed, reason=%s',
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        '[memory-pipeline] reconciliation scheduling failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
    }

    // 手动为 departure-duration 队列创建 worker
    // 解决 MidwayJS @RuntimeProcessor 在 memory-worker 角色下未自动创建 worker 的问题
    if (runtimeRole === 'memory-worker') {
      try {
        const durationQueue = this.bullmqFramework?.getQueue(
          DEPARTURE_DURATION_QUEUE
        );
        if (durationQueue) {
          this.bullmqFramework?.createWorker(
            DEPARTURE_DURATION_QUEUE,
            async (job: any) => {
              const ctx = this.app.createAnonymousContext({
                jobId: job.id,
                job,
                from: DepartureDurationProcessor,
              });
              try {
                const processor = await ctx.requestContext.getAsync(
                  DepartureDurationProcessor
                );
                await processor.execute(job.data);
              } catch (err) {
                ctx.logger.error(
                  '[departure-duration] manual worker job failed, jobId=%s, reason=%s',
                  job.id,
                  err instanceof Error ? err.message : String(err)
                );
                throw err;
              }
            },
            { concurrency: 1 }
          );
          this.logger.info(
            '[departure-duration] manual worker created for queue %s',
            DEPARTURE_DURATION_QUEUE
          );
        }
      } catch (error) {
        this.logger.warn(
          '[departure-duration] manual worker creation failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    if (runtimeRole === 'memory-worker') return;

    try {
      const cleanupQueue = this.bullmqFramework?.getQueue(
        VOICE_TIMBRE_CLEANUP_QUEUE
      );
      if (!cleanupQueue) {
        this.logger.warn('[voice-timbre-cleanup] queue is unavailable');
      } else {
        await cleanupQueue.addJobToQueue(
          {},
          {
            jobId: VOICE_TIMBRE_CLEANUP_JOB_ID,
            repeat: { every: VOICE_TIMBRE_RETENTION_INTERVAL_MS },
            removeOnComplete: true,
            removeOnFail: 30,
          }
        );
      }
    } catch (error) {
      this.logger.warn(
        '[voice-timbre-cleanup] scheduling failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
    }

    try {
      const queue = this.bullmqFramework?.getQueue(
        VOICE_TIMBRE_RETENTION_QUEUE
      );
      if (!queue) {
        this.logger.warn('[voice-timbre-retention] queue is unavailable');
        return;
      }
      await queue.addJobToQueue(
        {},
        {
          jobId: VOICE_TIMBRE_RETENTION_JOB_ID,
          repeat: { every: VOICE_TIMBRE_RETENTION_INTERVAL_MS },
          removeOnComplete: true,
          removeOnFail: 30,
        }
      );
    } catch (error) {
      this.logger.warn(
        '[voice-timbre-retention] scheduling failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
