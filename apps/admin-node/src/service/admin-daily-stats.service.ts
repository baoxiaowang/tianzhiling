import { Provide, Inject } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { MongoRepository } from 'typeorm';
import {
  AdminDailyStatsEntity,
} from '@tzl/entities';
import type { AdminOperationsDailyPointDTO } from '@tzl/shared';
import { AdminOperationsService } from './admin-operations.service';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

@Provide()
export class AdminDailyStatsService {
  @InjectEntityModel(AdminDailyStatsEntity)
  private statsModel!: MongoRepository<AdminDailyStatsEntity>;

  @Inject()
  private adminOperations!: AdminOperationsService;

  /**
   * 计算单日数据并 upsert 到汇总表。幂等，可重复调用。
   */
  async computeDay(date: string): Promise<AdminOperationsDailyPointDTO> {
    const point = await this.adminOperations.computeDailyStats(date);
    await this.statsModel.updateOne(
      { date },
      {
        $set: {
          newUsers: point.newUsers,
          newAgents: point.newAgents,
          newUserChatUsers: point.newUserChatUsers,
          newUserMessages: point.newUserMessages,
          newUserFiveMessageUsers: point.newUserFiveMessageUsers,
          allChatUsers: point.allChatUsers,
          userMessages: point.userMessages,
          paidUsers: point.paidUsers,
          paidOrders: point.paidOrders,
          sameDayPayingUsers: point.sameDayPayingUsers,
          paidRevenue: point.paidRevenue,
          refundedRevenue: point.refundedRevenue,
          netRevenue: point.netRevenue,
          cohortRevenue: point.cohortRevenue,
          computedAt: new Date(),
        },
      },
      { upsert: true }
    );
    return point;
  }

  /**
   * 批量计算日期范围（含首尾）。逐日串行执行，避免 MongoDB 压力过大。
   */
  async computeRange(startDate: string, endDate: string): Promise<void> {
    const dates = this.enumerateDates(startDate, endDate);
    for (const date of dates) {
      await this.computeDay(date);
    }
  }

  /**
   * 从汇总表读取日期范围的数据。缺失的日期不返回（调用方自行补算）。
   */
  async getDays(
    startDate: string,
    endDate: string
  ): Promise<Map<string, AdminOperationsDailyPointDTO>> {
    const rows = await this.statsModel
      .aggregate<AdminDailyStatsEntity>([
        { $match: { date: { $gte: startDate, $lte: endDate } } },
        { $sort: { date: 1 } },
      ])
      .toArray();
    const map = new Map<string, AdminOperationsDailyPointDTO>();
    for (const row of rows) {
      map.set(row.date, {
        date: row.date,
        newUsers: row.newUsers,
        newAgents: row.newAgents,
        newUserChatUsers: row.newUserChatUsers,
        newUserMessages: row.newUserMessages,
        newUserFiveMessageUsers: row.newUserFiveMessageUsers,
        allChatUsers: row.allChatUsers,
        userMessages: row.userMessages,
        paidUsers: row.paidUsers,
        paidOrders: row.paidOrders,
        sameDayPayingUsers: row.sameDayPayingUsers,
        paidRevenue: row.paidRevenue,
        refundedRevenue: row.refundedRevenue,
        netRevenue: row.netRevenue,
        cohortRevenue: row.cohortRevenue,
      });
    }
    return map;
  }

  /**
   * 确保指定日期都有汇总数据。缺失的日期实时补算并写入。
   * 返回完整的 date -> point 映射。
   */
  async ensureDays(
    dates: string[]
  ): Promise<Map<string, AdminOperationsDailyPointDTO>> {
    if (dates.length === 0) return new Map();
    const sorted = [...dates].sort();
    const cached = await this.getDays(sorted[0], sorted[sorted.length - 1]);
    const missing = dates.filter(d => !cached.has(d));
    for (const date of missing) {
      const point = await this.computeDay(date);
      cached.set(date, point);
    }
    return cached;
  }

  /** 获取今天的北京时间日期字符串 */
  getTodayBeijing(): string {
    const now = new Date();
    const beijingNow = new Date(now.getTime() + BEIJING_OFFSET_MS);
    return `${beijingNow.getUTCFullYear()}-${String(
      beijingNow.getUTCMonth() + 1
    ).padStart(2, '0')}-${String(beijingNow.getUTCDate()).padStart(2, '0')}`;
  }

  /** 枚举起止日期之间的所有日期（含首尾） */
  private enumerateDates(startDate: string, endDate: string): string[] {
    const result: string[] = [];
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    let cursor = new Date(Date.UTC(sy, sm - 1, sd));
    const end = new Date(Date.UTC(ey, em - 1, ed));
    while (cursor.getTime() <= end.getTime()) {
      result.push(
        `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(
          2,
          '0'
        )}-${String(cursor.getUTCDate()).padStart(2, '0')}`
      );
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    return result;
  }

  /**
   * 获取整月的每日统计数据。
   * 优先从汇总表读取，缺失日期实时补算并写入。
   * 当前月只返回到今天为止的数据；历史月返回整月。
   */
  async getMonthDaily(month: string): Promise<AdminOperationsDailyPointDTO[]> {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const today = this.getTodayBeijing();
    const isCurrentMonth = today.startsWith(month);
    const lastDay = isCurrentMonth
      ? Math.min(Number(today.split('-')[2]), daysInMonth)
      : daysInMonth;
    const dates = Array.from({ length: lastDay }, (_, i) =>
      `${month}-${String(i + 1).padStart(2, '0')}`
    );
    const map = await this.ensureDays(dates);
    return dates.map(d => map.get(d)!).filter(Boolean);
  }
}
