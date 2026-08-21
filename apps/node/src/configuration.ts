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
import { AgentMemoryInheritanceService } from './service/agents/agent-memory-inheritance.service';

const MEMORY_INHERITANCE_RETRY_INTERVAL_MS = 5 * 60 * 1000;

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

  private memoryInheritanceTimer?: ReturnType<typeof setInterval>;

  async onReady() {
    this.app.use(servePublicAsset);
    this.app.useMiddleware([ReportMiddleware]);
    this.app.useMiddleware([AuthMiddleware]);
    this.app.useMiddleware([FormatMiddleware]);
    this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);
  }

  async onServerReady() {
    this.scheduleMemoryInheritanceBackfill();

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

  private scheduleMemoryInheritanceBackfill(): void {
    const trigger = async () => {
      try {
        const service = await this.app
          .getApplicationContext()
          .getAsync(AgentMemoryInheritanceService);
        await service.runProductionBackfillOnce();
        const status = await service.getStatus();
        if (status.status === 'completed' && this.memoryInheritanceTimer) {
          clearInterval(this.memoryInheritanceTimer);
          this.memoryInheritanceTimer = undefined;
        }
      } catch (error) {
        this.logger.warn(
          '[memory-inheritance] scheduled attempt failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
      }
    };
    // Resolve the database-backed service only after the application has fully
    // started. It cannot be injected while Configuration itself is bootstrapping.
    this.memoryInheritanceTimer = setInterval(
      () => void trigger(),
      MEMORY_INHERITANCE_RETRY_INTERVAL_MS
    );
    this.memoryInheritanceTimer.unref();
  }
}
