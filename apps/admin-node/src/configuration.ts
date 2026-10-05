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
import { AgentVtAuthMiddleware } from './middleware/agent-vt-auth.middleware';
import { FormatMiddleware } from './middleware/format.middleware';
import { AdminPerformanceMiddleware } from './middleware/admin-performance.middleware';
import { AdminDailyStatsService } from './service/admin-daily-stats.service';
import { AdminOrderService } from './service/admin-order.service';
import { AdminOperationsService } from './service/admin-operations.service';
import { AdminRelationshipLlmBackfillService } from './service/admin-relationship-llm-backfill.service';

const DAILY_STATS_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟
const RELATIONSHIP_BACKFILL_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 每小时检查一次
/** 会员降级退款自动收敛：每 30 分钟查一次微信退款状态。 */
const DOWNGRADE_RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

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
  private relationshipBackfillTimer?: NodeJS.Timeout;
  private downgradeReconcileTimer?: NodeJS.Timeout;
  private relationshipBackfillLastRunDate = '';

  async onReady() {
    this.app.useMiddleware([AdminPerformanceMiddleware]);
    this.app.useMiddleware([AdminAuthMiddleware]);
    this.app.useMiddleware([AgentVtAuthMiddleware]);
    this.app.useMiddleware([FormatMiddleware]);
    this.app.useFilter([NotFoundFilter, DefaultErrorFilter]);

    this.startDailyStatsPrecompute();
    this.backfillHistoricalDailyStats();
    this.startRelationshipLlmBackfillScheduler();
    this.startVoiceMembershipDowngradeReconcileScheduler();
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
    if (this.relationshipBackfillTimer) {
      clearInterval(this.relationshipBackfillTimer);
    if (this.downgradeReconcileTimer)
      clearInterval(this.downgradeReconcileTimer);
      this.relationshipBackfillTimer = undefined;
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

        // 预热仪表盘 reports 缓存，避免用户打开时冷启动全表聚合（~5s）
        try {
          const adminOperations = await this.app
            .getApplicationContext()
            .getAsync(AdminOperationsService);
          await adminOperations.getReport();
          this.app.getLogger().info('[daily-stats] reports cache warmed');
        } catch (warmErr) {
          this.app
            .getLogger()
            .warn('[daily-stats] reports warm failed: %s', (warmErr as Error).message);
        }
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

  /**
   * 每月最后一天凌晨执行订单关系 LLM 回填。
   * 每小时检查一次：如果今天是当月最后一天且今天还没执行过，则运行。
   */
  private startRelationshipLlmBackfillScheduler() {
    const checkAndRun = async () => {
      try {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // 判断今天是否是当月最后一天（明天是下个月1号）
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        const isLastDayOfMonth = tomorrow.getDate() === 1;

        if (!isLastDayOfMonth) return;
        if (this.relationshipBackfillLastRunDate === todayStr) return;

        // 只在凌晨 1-5 点之间执行，避免影响白天业务
        const hour = now.getHours();
        if (hour < 1 || hour > 5) return;

        this.relationshipBackfillLastRunDate = todayStr;
        this.app.getLogger().info('[relationship-llm] last day of month, start backfill');

        const service = await this.app
          .getApplicationContext()
          .getAsync(AdminRelationshipLlmBackfillService);
        const result = await service.run();

        this.app
          .getLogger()
          .info(
            '[relationship-llm] backfill done: pairs=%d identified=%d ordersUpdated=%d',
            result.pairsTotal,
            result.pairsIdentified,
            result.ordersUpdated
          );
      } catch (err) {
        this.app
          .getLogger()
          .error('[relationship-llm] scheduler failed: %s', (err as Error).message);
      }
    };

    // 启动 5 分钟后检查一次，之后每小时检查
    setTimeout(() => {
      checkAndRun().catch(() => {});
    }, 5 * 60 * 1000);
    this.relationshipBackfillTimer = setInterval(() => {
      checkAndRun().catch(() => {});
    }, RELATIONSHIP_BACKFILL_CHECK_INTERVAL_MS);
  }

  /**
   * 会员降级退款自动收敛：每 30 分钟把仍卡在 processing 的降级退款向微信查询真实状态并回写。
   *
   * 为什么需要：降级退款只有同步成功后才会写入 `order_refund`；长期停在 processing
   * 会让这笔退款在所有收入统计（净收入、净收入下钻、月度报表）里凭空消失。
   * 任务只查询不发起退款，虚拟支付通道与 failed 记录都不在自动范围内。
   */
  private startVoiceMembershipDowngradeReconcileScheduler() {
    const run = async () => {
      try {
        const service = await this.app
          .getApplicationContext()
          .getAsync(AdminOrderService);
        const refundSummary = await service.reconcileVirtualRefunds();
        if (refundSummary.scanned > 0) {
          // eslint-disable-next-line no-console
          console.log(
            '[refund-reconcile] scanned=%d confirmed=%d pending=%d failed=%d%s',
            refundSummary.scanned,
            refundSummary.confirmed,
            refundSummary.pending,
            refundSummary.failed,
            refundSummary.errors.length
              ? ' errors=' + refundSummary.errors.join(' | ')
              : ''
          );
          this.app
            .getLogger()
            .info(
              '[refund-reconcile] scanned=%d confirmed=%d pending=%d failed=%d%s',
              refundSummary.scanned,
              refundSummary.confirmed,
              refundSummary.pending,
              refundSummary.failed,
              refundSummary.errors.length
                ? ' errors=' + refundSummary.errors.join(' | ')
                : ''
            );
        }
        const summary = await service.reconcilePendingVoiceMembershipDowngrades();
        if (summary.scanned > 0) {
          this.app
            .getLogger()
            .info(
              '[downgrade-reconcile] scanned=%d completed=%d pending=%d failed=%d%s',
              summary.scanned,
              summary.completed,
              summary.pending,
              summary.failed,
              summary.errors.length ? ' errors=' + summary.errors.join(' | ') : ''
            );
        }
      } catch (err) {
        this.app
          .getLogger()
          .error(
            '[downgrade-reconcile] scheduler failed: %s',
            (err as Error).message
          );
      }
    };

    // 启动 2 分钟后跑一次，之后每 30 分钟
    setTimeout(() => {
      run().catch(() => {});
    }, 2 * 60 * 1000);
    this.downgradeReconcileTimer = setInterval(() => {
      run().catch(() => {});
    }, DOWNGRADE_RECONCILE_INTERVAL_MS);
  }
}
