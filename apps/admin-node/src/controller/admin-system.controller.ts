import { Controller, Get, Inject } from '@midwayjs/core';
import { AdminDailyStatsService } from '../service/admin-daily-stats.service';

// 健康检查与调试入口

@Controller('/system')
export class AdminSystemController {
  @Inject()
  adminDailyStats: AdminDailyStatsService;

  @Get('/health')
  async health() {
    const debug: Record<string, unknown> = {
      releaseVersion: process.env.RELEASE_VERSION ?? 'unknown',
      adminDailyStatsInjected: typeof this.adminDailyStats?.getMonthDaily === 'function',
    };
    try {
      const today = this.adminDailyStats.getTodayBeijing();
      const map = await this.adminDailyStats.getDays(today, today);
      debug.todayStatsCount = map.size;
      debug.today = today;
    } catch (err) {
      debug.statsQueryError = (err as Error).message;
    }
    return {
      status: 'ok',
      service: 'admin-node',
      timestamp: Date.now(),
      debug,
    };
  }
}
