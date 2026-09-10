import { Configuration, App } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import * as jwt from '@midwayjs/jwt';
import * as orm from '@midwayjs/typeorm';
import * as busboy from '@midwayjs/busboy';
import * as bullmq from '@midwayjs/bullmq';
import { join } from 'path';
import { DefaultErrorFilter } from './filter/default.filter';
import { NotFoundFilter } from './filter/notfound.filter';
import { AdminAuthMiddleware } from './middleware/admin-auth.middleware';
import { AgentVoiceAuthMiddleware } from './middleware/agent-voice-auth.middleware';
import { FormatMiddleware } from './middleware/format.middleware';
import { AdminPerformanceMiddleware } from './middleware/admin-performance.middleware';
import { AdminDailyStatsService } from './service/admin-daily-stats.service';

const DAILY_STATS_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟

@Configuration({
  imports: [
    koa,
    validate,
    jwt,
    orm,
    busboy,
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

  private dailyStatsTimer?: NodeJS.Timeout;

  async onReady() {
    this.app.useMiddleware([AdminPerformanceMiddleware]);
    this.app.useMiddleware([AdminAuthMiddleware]);
    this.app.useMiddleware([AgentVoiceAuthMiddleware]);
    this.app.useMiddleware([FormatMiddleware]);
    this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);

    this.startDailyStatsPrecompute();
    this.backfillHistoricalDailyStats();
  }

  /**
   * 启动时异步回填历史每日统计数据。
   * 回填过去 180 天的数据到汇总表，幂等 upsert。
   * 延迟 30 秒执行，避免与启动流程竞争资源。
   */
  private backfillHistoricalDailyStats() {
    const BACKFILL_DAYS = 180;
    setTimeout(() => {
      (async () => {
        try {
          const adminDailyStats = await this.app
            .getApplicationContext()
            .getAsync(AdminDailyStatsService);
          const today = adminDailyStats.getTodayBeijing();
          const startDate = this.subtractDays(today, BACKFILL_DAYS);
          this.app.getLogger().info('[daily-stats] backfill start: %s ~ %s', startDate, today);
          await adminDailyStats.computeRange(startDate, today);
          this.app.getLogger().info('[daily-stats] backfill done: %s ~ %s', startDate, today);
        } catch (err) {
          this.app
            .getLogger()
            .error('[daily-stats] backfill failed: %s', (err as Error).message);
        }
      })().catch(() => {});
    }, 30_000);
  }

  async onStop() {
    if (this.dailyStatsTimer) {
      clearInterval(this.dailyStatsTimer);
      this.dailyStatsTimer = undefined;
    }
  }

  /**
   * 启动每日统计预计算定时任务。
   * 每 30 分钟计算今天（及昨天）的数据并写入汇总表，
   * 使仪表盘查询优先读汇总表，避免每次请求扫大表聚合。
   */
  private startDailyStatsPrecompute() {
    const run = async () => {
      try {
        const adminDailyStats = await this.app
          .getApplicationContext()
          .getAsync(AdminDailyStatsService);
        const today = adminDailyStats.getTodayBeijing();
        const yesterday = this.subtractOneDay(today);
        await adminDailyStats.computeDay(yesterday);
        await adminDailyStats.computeDay(today);
        this.app.getLogger().info('[daily-stats] precompute done: %s, %s', yesterday, today);
      } catch (err) {
        this.app
          .getLogger()
          .error('[daily-stats] precompute failed: %s', (err as Error).message);
      }
    };

    // 启动 10 秒后跑一次，之后每 30 分钟
    setTimeout(() => {
      run().catch(() => {});
    }, 10_000);
    this.dailyStatsTimer = setInterval(() => {
      run().catch(() => {});
    }, DAILY_STATS_INTERVAL_MS);
  }

  private subtractOneDay(dateStr: string): string {
    return this.subtractDays(dateStr, 1);
  }

  private subtractDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d) - days * 24 * 60 * 60 * 1000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
      2,
      '0'
    )}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }
}
