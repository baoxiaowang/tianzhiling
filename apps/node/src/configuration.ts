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
import { Queue as BullQueue } from 'bullmq';
import { DEPARTURE_DURATION_QUEUE } from './service/agents/departure-duration.service';
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

    // 注意：departure-duration 队列的消费者由独立 worker 脚本承担
    // （scripts/departure-duration-worker.js，memory_worker 容器经 memory-worker-bootstrap.js 启动）。
    // MidwayJS @RuntimeProcessor 在 memory-worker 角色下不会自动创建该队列的 worker；
    // 而 bullmqFramework.createWorker 创建的 worker 处理完 job 后无法正确标记完成（job 长期滞留 active 状态），
    // 因此不再在此处手动创建 worker，统一交由独立 worker 消费。
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
        // 注意：不能使用 bullmqFramework.getQueue().addJobToQueue() 注册 repeat——
        // MidwayJS 封装将队列名作为 jobSchedulerId（忽略 repeat.jobId），
        // daily 与 monthly 会相互覆盖，导致其中一个丢失。
        // 因此这里直接用原生 BullMQ Queue 注册，jobSchedulerId 各不相同可共存。
        try {
          const connection = {
            host:
              process.env.NODE_BULLMQ_HOST ||
              process.env.NODE_REDIS_HOST ||
              '127.0.0.1',
            port: Number(
              process.env.NODE_BULLMQ_PORT ||
                process.env.NODE_REDIS_PORT ||
                17380
            ),
            password:
              process.env.NODE_BULLMQ_PASSWORD ||
              process.env.NODE_REDIS_PASSWORD ||
              '',
            db: Number(
              process.env.NODE_BULLMQ_DB ||
                process.env.NODE_REDIS_DB ||
                0
            ),
          };
          const prefix =
            process.env.NODE_BULLMQ_PREFIX || '{tzl-bullmq}';
          const durationQueue = new BullQueue(DEPARTURE_DURATION_QUEUE, {
            connection,
            prefix,
          });
          // 每天凌晨3点：增量计算活跃用户
          await durationQueue.upsertJobScheduler(
            'departure-duration-daily',
            { pattern: '0 3 * * *' },
            {
              name: DEPARTURE_DURATION_QUEUE,
              data: { type: 'daily' },
              opts: { removeOnComplete: true, removeOnFail: 30 },
            }
          );
          // 每月1号凌晨3点：全量计算所有用户
          await durationQueue.upsertJobScheduler(
            'departure-duration-monthly',
            { pattern: '0 3 1 * *' },
            {
              name: DEPARTURE_DURATION_QUEUE,
              data: { type: 'monthly' },
              opts: { removeOnComplete: true, removeOnFail: 30 },
            }
          );
          // 启动时立即跑一次增量，避免重启后当天不执行
          await durationQueue.add(
            DEPARTURE_DURATION_QUEUE,
            { type: 'daily' },
            {
              jobId: `departure-duration-startup-${Date.now()}`,
              removeOnComplete: true,
              removeOnFail: 30,
            }
          );
          await durationQueue.close();
          this.logger.info(
            '[departure-duration] scheduled daily(03:00) and monthly(1st 03:00) computation'
          );
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
