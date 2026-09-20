import {
  ConversationMessageFeedbackHandlingStatus,
  MongoObjectId,
} from '@tzl/entities';
import { getDouyinPromotionExpense } from '@tzl/shared';
import { AdminDailyStatsService } from './admin-daily-stats.service';
import { AdminOperationsService } from './admin-operations.service';

const aggregateResult = (rows: unknown[]) => ({
  toArray: jest.fn().mockResolvedValue(rows),
});

const OVERRIDE_COLLECTION = 'admin_daily_promotion_expense';

/**
 * 内存模拟 admin_daily_stats 汇总表 + admin_daily_promotion_expense 覆盖集合。
 * 覆盖值通过 MongoEntityManager.mongoQueryRunner 的原生命令读写。
 */
const createPromotionExpenseStore = () => {
  const stats = new Map<string, Record<string, unknown>>();
  const overrides = new Map<string, number>();
  const queryRunner = {
    updateOne: jest.fn(
      async (
        collection: string,
        filter: { _id: string },
        update: { $set?: Record<string, unknown> }
      ) => {
        if (
          collection === OVERRIDE_COLLECTION &&
          update?.$set?.promotionExpense !== undefined
        ) {
          overrides.set(
            String(filter._id),
            Number(update.$set.promotionExpense)
          );
        }
        return {};
      }
    ),
    deleteOne: jest.fn(async (collection: string, filter: { _id: string }) => {
      if (collection === OVERRIDE_COLLECTION) {
        overrides.delete(String(filter._id));
      }
      return {};
    }),
    cursor: jest.fn((collection: string, filter: { _id?: unknown }) => ({
      toArray: async () => {
        if (collection !== OVERRIDE_COLLECTION) return [];
        const key = filter?._id;
        if (typeof key === 'string') {
          return overrides.has(key)
            ? [{ _id: key, promotionExpense: overrides.get(key) }]
            : [];
        }
        const range = (key ?? {}) as { $gte?: string; $lte?: string };
        return [...overrides.entries()]
          .filter(
            ([date]) =>
              (!range.$gte || date >= range.$gte) &&
              (!range.$lte || date <= range.$lte)
          )
          .map(([date, promotionExpense]) => ({ _id: date, promotionExpense }));
      },
    })),
  };
  const statsModel = {
    updateOne: jest.fn(
      async (
        filter: { date: string },
        update: { $set?: Record<string, unknown> }
      ) => {
        const current = stats.get(filter.date) ?? { date: filter.date };
        stats.set(filter.date, { ...current, ...(update.$set ?? {}) });
        return {};
      }
    ),
    aggregate: jest.fn(() => aggregateResult([...stats.values()])),
    manager: { mongoQueryRunner: queryRunner },
  };
  return { stats, overrides, statsModel, queryRunner };
};

describe('AdminOperationsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('按抖评记录返回天之灵每日推广费用', () => {
    expect(getDouyinPromotionExpense('2026-02-28')).toBe(1166);
    expect(getDouyinPromotionExpense('2026-08-31')).toBe(230);
    expect(getDouyinPromotionExpense('2026-09-02')).toBe(440);
    expect(getDouyinPromotionExpense('2026-09-06')).toBe(0);
    expect(getDouyinPromotionExpense('invalid')).toBe(0);
  });

  it('按北京时间生成日报并统计实时用户消息和净收入', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T04:30:00.000Z'));
    const service = new AdminOperationsService();
    // daily 数据优先从预计算汇总表读取；mock 返回整月数据
    const mockDaily = Array.from({ length: 23 }, (_, i) => {
      const date = `2026-08-${String(i + 1).padStart(2, '0')}`;
      const isToday = date === '2026-08-23';
      return {
        date,
        newUsers: isToday ? 3 : 0,
        newAgents: isToday ? 4 : 0,
        newUserChatUsers: isToday ? 2 : 0,
        newUserMessages: isToday ? 5 : 0,
        newUserFiveMessageUsers: isToday ? 1 : 0,
        allChatUsers: isToday ? 6 : 0,
        userMessages: isToday ? 12 : 0,
        paidUsers: isToday ? 2 : 0,
        paidOrders: isToday ? 3 : 0,
        sameDayPayingUsers: isToday ? 1 : 0,
        paidRevenue: isToday ? 99 : 0,
        refundedRevenue: isToday ? 18 : 0,
        netRevenue: isToday ? 81 : 0,
        cohortRevenue: isToday ? 500 : 0,
        promotionExpense: isToday ? 310 : 0,
        profit: isToday ? 190 : 0,
      };
    });
    service.statsModel = {
      aggregate: jest.fn(() => aggregateResult(mockDaily)),
      updateOne: jest.fn().mockResolvedValue({}),
    } as never;
    service.userModel = {
      count: jest.fn().mockResolvedValue(100),
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        return aggregateResult(
          serialized.includes('"format":"%H"')
            ? [{ _id: '12', count: 2 }]
            : [{ _id: '2026-08-23', count: 3 }]
        );
      }),
    } as never;
    service.agentModel = {
      count: jest.fn().mockResolvedValue(10),
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', count: 4 }])
      ),
    } as never;
    service.messageModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        if (serialized.includes('"format":"%H"')) {
          return aggregateResult([{ _id: '12', count: 9 }]);
        }
        if (serialized.includes('"chatUsers"')) {
          return aggregateResult([{ chatUsers: 30, userMessages: 300 }]);
        }
        return aggregateResult([
          {
            _id: '2026-08-23',
            allChatUsers: 6,
            userMessages: 12,
            newUserChatUsers: 2,
            newUserMessages: 5,
            newUserFiveMessageUsers: 1,
          },
        ]);
      }),
    } as never;
    service.orderModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        if (
          serialized.includes('"date":"$user.createdAt"') &&
          serialized.includes('"signedAmount"')
        ) {
          return aggregateResult([{ _id: '2026-08-23', revenue: 50000 }]);
        }
        if (serialized.includes('"independentRefundOrders"')) {
          return aggregateResult([]);
        }
        if (serialized.includes('"_id":"$userId"')) {
          return aggregateResult([{ _id: new MongoObjectId(), amount: 50000 }]);
        }
        if (serialized.includes('"isSameDayUser"')) {
          return aggregateResult([
            {
              _id: '2026-08-23',
              paidUsers: 2,
              paidOrders: 3,
              paidAmount: 9900,
              sameDayPayingUsers: 1,
            },
          ]);
        }
        return aggregateResult([
          { paidUsers: 2, paidOrders: 3, paidAmount: 9900 },
        ]);
      }),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);

        return serialized.includes('"format":"%Y-%m-%d"')
          ? aggregateResult([{ _id: '2026-08-23', amount: 1800 }])
          : aggregateResult([]);
      }),
    } as never;

    const result = await service.getReport('2026-08');
    const today = result.daily.find(item => item.date === '2026-08-23');

    expect(result.timezone).toBe('Asia/Shanghai');
    expect(today).toMatchObject({
      newUsers: 3,
      newAgents: 4,
      newUserChatUsers: 2,
      newUserMessages: 5,
      allChatUsers: 6,
      userMessages: 12,
      paidUsers: 2,
      paidOrders: 3,
      paidRevenue: 99,
      refundedRevenue: 18,
      netRevenue: 81,
      cohortRevenue: 500,
      promotionExpense: 310,
      profit: 190,
    });
    expect(result.hourly[12]).toMatchObject({
      hour: '12:00',
      newUsers: 2,
      userMessages: 9,
    });
    // 今日口径与当日行对齐：新建智能体按当天新建智能体数统计
    expect(result.todayTotals).toMatchObject({
      newUsers: 3,
      newAgents: 4,
    });
    // daily 数据来自预计算汇总表
    expect(service.statsModel.aggregate).toHaveBeenCalled();
  });

  it('refresh=true 绕过缓存并重算今天与昨天的汇总', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T04:00:00.000Z'));
    const service = new AdminOperationsService();
    const { statsModel } = createPromotionExpenseStore();
    service.statsModel = statsModel as never;
    service.userModel = {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.agentModel = {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.messageModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    const recompute = jest
      .spyOn(service, 'computeAndPersistDailyStats')
      .mockResolvedValue({ date: '2026-09-14' } as never);

    await service.getReport('2026-09');
    const countAfterFirst = (service.userModel.count as jest.Mock).mock.calls
      .length;
    recompute.mockClear();

    // 不传 refresh：命中 30 分钟缓存，不再查询
    await service.getReport('2026-09');
    expect(recompute).not.toHaveBeenCalled();
    expect((service.userModel.count as jest.Mock).mock.calls.length).toBe(
      countAfterFirst
    );

    // 传 refresh：绕过缓存并重算今天/昨天
    await service.getReport('2026-09', { refresh: true });
    expect(recompute).toHaveBeenCalledWith('2026-09-14');
    expect(recompute).toHaveBeenCalledWith('2026-09-13');
    expect(
      (service.userModel.count as jest.Mock).mock.calls.length
    ).toBeGreaterThan(countAfterFirst);
  });

  it('月度统计按北京时间月份汇总新增用户、消息与净收入', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00.000Z'));
    const service = new AdminOperationsService();
    service.userModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          { _id: '2026-08', count: 100 },
          { _id: '2026-09', count: 50 },
        ])
      ),
    } as never;
    service.messageModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          { _id: '2026-08', count: 1000 },
          { _id: '2026-09', count: 400 },
        ])
      ),
    } as never;
    service.orderModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) =>
        JSON.stringify(pipeline).includes('independentRefundOrders')
          ? aggregateResult([{ _id: '2026-08', amount: 1000 }])
          : aggregateResult([
              { _id: '2026-08', amount: 200000 },
              { _id: '2026-09', amount: 50000 },
            ])
      ),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08', amount: 20000 }])
      ),
    } as never;

    const result = await service.getMonthlySummary(6);

    expect(result.range).toBe(6);
    expect(result.timezone).toBe('Asia/Shanghai');
    // 2026-09 往前 6 个月：2026-04 ~ 2026-09，无数据的月份补零
    expect(result.items.map(item => item.month)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    expect(result.items[0]).toMatchObject({
      month: '2026-04',
      newUsers: 0,
      userMessages: 0,
      paidRevenue: 0,
      refundedRevenue: 0,
      netRevenue: 0,
      isCurrentMonth: false,
    });
    // 实付 200000 分 = 2000 元；退款 = 独立退款 20000 分 + 遗留退款 1000 分 = 210 元
    expect(result.items[4]).toMatchObject({
      month: '2026-08',
      newUsers: 100,
      userMessages: 1000,
      paidRevenue: 2000,
      refundedRevenue: 210,
      netRevenue: 1790,
      isCurrentMonth: false,
    });
    expect(result.items[5]).toMatchObject({
      month: '2026-09',
      newUsers: 50,
      userMessages: 400,
      paidRevenue: 500,
      refundedRevenue: 0,
      netRevenue: 500,
      isCurrentMonth: true,
    });
    expect(service.orderRefundModel.aggregate).toHaveBeenCalled();
  });

  it('月度统计区间 all 从最早注册用户所在月开始枚举', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00.000Z'));
    const service = new AdminOperationsService();
    service.userModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) =>
        JSON.stringify(pipeline).includes('"$limit"')
          ? aggregateResult([
              { createdAt: new Date('2026-01-05T02:00:00.000Z') },
            ])
          : aggregateResult([{ _id: '2026-01', count: 7 }])
      ),
    } as never;
    service.messageModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;

    const result = await service.getMonthlySummary('all');

    expect(result.range).toBe('all');
    expect(result.items[0].month).toBe('2026-01');
    expect(result.items[result.items.length - 1].month).toBe('2026-09');
    expect(result.items).toHaveLength(9);
    expect(result.items[0]).toMatchObject({ newUsers: 7, isCurrentMonth: false });
  });

  it('月度统计非法区间回落到 12 个月并命中缓存', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00.000Z'));
    const service = new AdminOperationsService();
    const userAggregate = jest.fn(() => aggregateResult([]));
    service.userModel = { aggregate: userAggregate } as never;
    service.messageModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;

    const first = await service.getMonthlySummary('oops');
    const callsAfterFirst = userAggregate.mock.calls.length;
    const second = await service.getMonthlySummary('oops');

    expect(first.range).toBe(12);
    expect(first.items).toHaveLength(12);
    expect(userAggregate.mock.calls.length).toBe(callsAfterFirst);
    expect(second.items).toEqual(first.items);
  });

  it('每日明细只读汇总表，手动刷新只重算今天和昨天', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00.000Z'));
    const service = new AdminOperationsService();
    const { stats, statsModel } = createPromotionExpenseStore();
    const seedMonth = (targetMonth: string, lastDay: number) => {
      for (let day = 1; day <= lastDay; day += 1) {
        const date = `${targetMonth}-${String(day).padStart(2, '0')}`;
        stats.set(date, {
          date,
          newUsers: day,
          newAgents: 0,
          newUserChatUsers: 0,
          newUserMessages: 0,
          newUserFiveMessageUsers: 0,
          allChatUsers: day,
          userMessages: day * 10,
          paidUsers: 0,
          paidOrders: 0,
          sameDayPayingUsers: 0,
          paidRevenue: day,
          refundedRevenue: 0,
          netRevenue: day,
          cohortRevenue: day,
          promotionExpense: 0,
          profit: day,
        });
      }
    };
    seedMonth('2026-09', 19);
    // 历史月整月都有汇总行，避免踩到「缺失日期实时补算」
    seedMonth('2026-05', 31);
    service.statsModel = statsModel as never;
    const recompute = jest
      .spyOn(service, 'computeAndPersistDailyStats')
      .mockResolvedValue({ date: '2026-09-19' } as never);

    const result = await service.getDailyDetail('2026-09');
    expect(result.month).toBe('2026-09');
    expect(result.daily.map(row => row.date)).toHaveLength(19);
    expect(result.daily[0]).toMatchObject({ date: '2026-09-01', newUsers: 1 });
    expect(result.daily[18]).toMatchObject({
      date: '2026-09-19',
      userMessages: 190,
    });
    // 普通读取不该触发任何重算
    expect(recompute).not.toHaveBeenCalled();

    // 手动刷新：只重算今天和昨天
    await service.getDailyDetail('2026-09', { refresh: true });
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(recompute).toHaveBeenCalledWith('2026-09-18');
    expect(recompute).toHaveBeenCalledWith('2026-09-19');

    // 历史月：不重算
    recompute.mockClear();
    await service.getDailyDetail('2026-05', { refresh: true });
    expect(recompute).not.toHaveBeenCalled();

    // 非法月份回落到当前月（2026-09）
    const fallback = await service.getDailyDetail('oops');
    expect(fallback.month).toBe('2026-09');
    expect(fallback.daily[fallback.daily.length - 1].date).toBe('2026-09-19');
  });

  it('每日运营笔记可保存、读取与清空', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T04:00:00.000Z'));
    const service = new AdminOperationsService();
    const { statsModel, queryRunner } = createPromotionExpenseStore();
    service.statsModel = statsModel as never;

    const saved = await service.setDailyNote('2026-09-19', '  投了 3 条视频  ');
    expect(saved).toEqual({ date: '2026-09-19', note: '投了 3 条视频' });
    expect(queryRunner.updateOne).toHaveBeenCalled();

    const longNote = 'x'.repeat(600);
    const truncated = await service.setDailyNote('2026-09-18', longNote);
    expect(truncated.note).toHaveLength(500);

    // 空文本 = 清除
    const cleared = await service.setDailyNote('2026-09-19', '   ');
    expect(cleared.note).toBe('');
    expect(queryRunner.deleteOne).toHaveBeenCalledWith(
      'admin_daily_note',
      expect.objectContaining({ _id: '2026-09-19' })
    );

    await expect(service.setDailyNote('2026-9-1', 'x')).rejects.toThrow(
      'invalid date'
    );
  });

  it('computeDailyStats 排除内部小使者并计算单日统计', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T04:30:00.000Z'));
    const service = new AdminOperationsService();
    service.userModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', count: 3 }])
      ),
    } as never;
    service.agentModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', count: 4 }])
      ),
    } as never;
    service.messageModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: '2026-08-23',
            allChatUsers: 6,
            userMessages: 12,
            newUserChatUsers: 2,
            newUserMessages: 5,
            newUserFiveMessageUsers: 1,
          },
        ])
      ),
    } as never;
    service.orderModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        if (serialized.includes('"independentRefundOrders"')) {
          return aggregateResult([]);
        }
        return aggregateResult([
          {
            _id: '2026-08-23',
            paidUsers: 2,
            paidOrders: 3,
            paidAmount: 9900,
            sameDayPayingUsers: 1,
          },
        ]);
      }),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', amount: 1800 }])
      ),
    } as never;

    const result = await service.computeDailyStats('2026-08-23');

    expect(result).toMatchObject({
      date: '2026-08-23',
      newUsers: 3,
      newAgents: 4,
      allChatUsers: 6,
      userMessages: 12,
      paidUsers: 2,
      paidOrders: 3,
      paidRevenue: 99,
      refundedRevenue: 18,
      netRevenue: 81,
    });
    // 新建智能体口径必须排除内部小使者
    const agentAggregateCalls = jest.mocked(service.agentModel.aggregate).mock
      .calls;
    expect(agentAggregateCalls).toHaveLength(1);
    const agentMatch = agentAggregateCalls[0][0][0] as {
      $match: Record<string, unknown>;
    };
    expect(agentMatch.$match).toMatchObject({
      $or: [
        { messengerOfAgentId: { $exists: false } },
        { messengerOfAgentId: null },
      ],
    });
  });

  it('将后续订单收入归回用户注册月份并计算注册用户产值', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T04:30:00.000Z'));
    const service = new AdminOperationsService();
    service.userModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          { _id: '2026-06', count: 100 },
          { _id: '2026-07', count: 80 },
        ])
      ),
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: '2026-06',
            payingUsers: 10,
            revenue: 50000,
            revenue7Day: 20000,
            revenue30Day: 40000,
          },
          {
            _id: '2026-07',
            payingUsers: 8,
            revenue: 32000,
            revenue7Day: 16000,
            revenue30Day: 28000,
          },
        ])
      ),
    } as never;
    // 预计算汇总表按月返回新增用户数（与仪表盘共用同一份数据）
    service.statsModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          { date: '2026-06-30', newUsers: 100 },
          { date: '2026-07-31', newUsers: 80 },
        ])
      ),
      updateOne: jest.fn().mockResolvedValue({}),
    } as never;

    const result = await service.getUserValueReport('2026-07', 2);

    expect(result.items).toEqual([
      expect.objectContaining({
        month: '2026-06',
        newUsers: 100,
        payingUsers: 10,
        payRate: 10,
        revenue: 500,
        userValue: 5,
        value7Day: 2,
        value30Day: 4,
      }),
      expect.objectContaining({
        month: '2026-07',
        newUsers: 80,
        payingUsers: 8,
        payRate: 10,
        revenue: 320,
        userValue: 4,
        value7Day: 2,
        value30Day: undefined,
      }),
    ]);
    expect(
      JSON.stringify(jest.mocked(service.orderModel.aggregate).mock.calls)
    ).toContain('"date":"$user.createdAt"');
    expect(
      JSON.stringify(jest.mocked(service.orderModel.aggregate).mock.calls)
    ).toContain('"occurredAt":"$completedAt"');
  });

  it('按购买支付日期和退款完成日期分别统计', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T04:30:00.000Z'));
    const service = new AdminOperationsService();
    service.orderModel = {
      count: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(8),
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        if (serialized.includes('"independentRefundOrders"')) {
          return aggregateResult([]);
        }
        if (serialized.includes('"status":"refunded"')) {
          return aggregateResult([{ _id: '2026-08-23', amount: 2000 }]);
        }
        if (serialized.includes('"firstPaidAt"')) {
          return aggregateResult([{ count: 2 }]);
        }
        if (serialized.includes('"isSameDayUser"')) {
          return aggregateResult([
            {
              _id: '2026-08-23',
              paidUsers: 3,
              paidOrders: 4,
              paidAmount: 12000,
              sameDayPayingUsers: 1,
            },
          ]);
        }
        return aggregateResult([
          { paidUsers: 3, paidOrders: 4, paidAmount: 12000 },
        ]);
      }),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-24', amount: 2000 }])
      ),
    } as never;
    // 预计算汇总表返回当月每日行（8-23 有收入、8-24 有退款，其余为 0）
    const mockDailyRows = Array.from({ length: 25 }, (_, i) => {
      const date = `2026-08-${String(i + 1).padStart(2, '0')}`;
      if (date === '2026-08-23') {
        return {
          date,
          paidUsers: 3,
          paidOrders: 4,
          paidRevenue: 120,
          refundedRevenue: 0,
          netRevenue: 120,
        };
      }
      if (date === '2026-08-24') {
        return {
          date,
          paidUsers: 0,
          paidOrders: 0,
          paidRevenue: 0,
          refundedRevenue: 20,
          netRevenue: -20,
        };
      }
      return {
        date,
        paidUsers: 0,
        paidOrders: 0,
        paidRevenue: 0,
        refundedRevenue: 0,
        netRevenue: 0,
      };
    });
    service.statsModel = {
      aggregate: jest.fn(() => aggregateResult(mockDailyRows)),
      updateOne: jest.fn().mockResolvedValue({}),
    } as never;

    const result = await service.getOrderAnalytics('2026-08');

    expect(result.totals).toMatchObject({
      createdOrders: 10,
      paidOrders: 4,
      payingUsers: 3,
      firstTimePayingUsers: 2,
      paidRevenue: 120,
      refundedRevenue: 20,
      netRevenue: 100,
      averageOrderAmount: 30,
      paymentSuccessRate: 80,
    });
    expect(result.daily.find(item => item.date === '2026-08-23')).toMatchObject(
      {
        paidUsers: 3,
        paidOrders: 4,
        paidRevenue: 120,
        refundedRevenue: 0,
        netRevenue: 120,
      }
    );
    expect(result.daily.find(item => item.date === '2026-08-24')).toMatchObject(
      {
        paidRevenue: 0,
        refundedRevenue: 20,
        netRevenue: -20,
      }
    );
    // 退款数据来自预计算汇总表（与仪表盘共用同一份数据）
    expect(service.statsModel.aggregate).toHaveBeenCalled();
  });

  it('重算单日汇总时保留人工推广费覆盖', async () => {
    const service = new AdminOperationsService();
    service.userModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', count: 3 }])
      ),
    } as never;
    service.agentModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', count: 4 }])
      ),
    } as never;
    service.messageModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    // 全量返回 cohort 收入行：cohortRevenue = 500 元
    service.orderModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', revenue: 50000 }])
      ),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    const { overrides, statsModel } = createPromotionExpenseStore();
    overrides.set('2026-08-23', 250);
    service.statsModel = statsModel as never;

    const point = await service.computeAndPersistDailyStats('2026-08-23');

    expect(point).toMatchObject({
      date: '2026-08-23',
      cohortRevenue: 500,
      promotionExpense: 250,
      profit: 250,
      promotionExpenseManual: true,
    });
    expect(statsModel.updateOne).toHaveBeenCalledWith(
      { date: '2026-08-23' },
      expect.objectContaining({
        $set: expect.objectContaining({
          promotionExpense: 250,
          profit: 250,
        }),
      }),
      { upsert: true }
    );
  });

  it('保存每日推广费手动覆盖并支持恢复默认', async () => {
    const service = new AdminOperationsService();
    const { stats, overrides, statsModel, queryRunner } =
      createPromotionExpenseStore();
    stats.set('2026-08-23', {
      date: '2026-08-23',
      newUsers: 3,
      newAgents: 4,
      newUserChatUsers: 2,
      newUserMessages: 5,
      newUserFiveMessageUsers: 1,
      allChatUsers: 6,
      userMessages: 12,
      paidUsers: 2,
      paidOrders: 3,
      sameDayPayingUsers: 1,
      paidRevenue: 99,
      refundedRevenue: 18,
      netRevenue: 81,
      cohortRevenue: 500,
      promotionExpense: 310,
      profit: 190,
    });
    service.statsModel = statsModel as never;

    const saved = await service.updateDailyPromotionExpense('2026-08-23', {
      promotionExpense: 250,
    });

    expect(saved).toMatchObject({
      date: '2026-08-23',
      promotionExpense: 250,
      profit: 250,
      promotionExpenseManual: true,
    });
    expect(overrides.get('2026-08-23')).toBe(250);
    expect(queryRunner.updateOne).toHaveBeenCalledWith(
      OVERRIDE_COLLECTION,
      { _id: '2026-08-23' },
      { $set: expect.objectContaining({ promotionExpense: 250 }) },
      { upsert: true }
    );
    expect(statsModel.updateOne).toHaveBeenCalledWith(
      { date: '2026-08-23' },
      { $set: expect.objectContaining({ promotionExpense: 250, profit: 250 }) },
      { upsert: true }
    );
    const savedUpdate = statsModel.updateOne.mock.calls[0][1];
    expect(savedUpdate.$set).not.toHaveProperty('promotionExpenseOverride');

    statsModel.updateOne.mockClear();
    queryRunner.updateOne.mockClear();
    const reset = await service.updateDailyPromotionExpense('2026-08-23', {
      promotionExpense: null,
    });

    expect(overrides.has('2026-08-23')).toBe(false);
    expect(queryRunner.deleteOne).toHaveBeenCalledWith(OVERRIDE_COLLECTION, {
      _id: '2026-08-23',
    });
    expect(reset).toMatchObject({
      promotionExpense: getDouyinPromotionExpense('2026-08-23'),
      promotionExpenseManual: false,
    });
    expect(statsModel.updateOne).toHaveBeenCalledWith(
      { date: '2026-08-23' },
      {
        $set: expect.objectContaining({
          promotionExpense: getDouyinPromotionExpense('2026-08-23'),
        }),
      },
      { upsert: true }
    );
  });

  it('人工推广费保存后经多次重算仍保留，并能从覆盖集合读回', async () => {
    const service = new AdminOperationsService();
    const date = '2026-08-10';
    const { overrides, statsModel } = createPromotionExpenseStore();
    service.statsModel = statsModel as never;
    service.userModel = {
      aggregate: jest.fn(() => aggregateResult([{ _id: date, count: 3 }])),
    } as never;
    service.agentModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.messageModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    // cohort 收入 500 元
    service.orderModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: date, revenue: 50000 }])
      ),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;

    // 1. 首次重算，无人工值，使用抖评默认值
    const first = await service.computeAndPersistDailyStats(date);
    expect(first).toMatchObject({
      promotionExpense: getDouyinPromotionExpense(date),
      promotionExpenseManual: false,
    });

    // 2. 管理员手动保存 → 写入独立覆盖集合
    const saved = await service.updateDailyPromotionExpense(date, {
      promotionExpense: 123.45,
    });
    expect(saved).toMatchObject({
      promotionExpense: 123.45,
      profit: 376.55,
      promotionExpenseManual: true,
    });
    expect(overrides.get(date)).toBe(123.45);

    // 3. 模拟定时任务/回填再次重算：覆盖值必须保留
    const afterRecompute = await service.computeAndPersistDailyStats(date);
    expect(afterRecompute).toMatchObject({
      promotionExpense: 123.45,
      profit: 376.55,
      promotionExpenseManual: true,
    });
    expect(overrides.get(date)).toBe(123.45);

    // 4. 汇总表读取路径同样返回人工值
    const dailyStats = new AdminDailyStatsService();
    (dailyStats as unknown as { statsModel: unknown }).statsModel =
      statsModel as never;
    (dailyStats as unknown as { adminOperations: unknown }).adminOperations =
      service;
    const map = await dailyStats.getDays(date, date);
    expect(map.get(date)).toMatchObject({
      promotionExpense: 123.45,
      profit: 376.55,
      promotionExpenseManual: true,
    });

    // 5. 恢复默认后覆盖文档删除
    await service.updateDailyPromotionExpense(date, { promotionExpense: null });
    expect(overrides.has(date)).toBe(false);
    const reset = await service.computeAndPersistDailyStats(date);
    expect(reset.promotionExpenseManual).toBe(false);
    expect(reset.promotionExpense).toBe(getDouyinPromotionExpense(date));
  });

  it('拒绝非法的推广费金额和日期', async () => {
    const service = new AdminOperationsService();

    await expect(
      service.updateDailyPromotionExpense('2026-08-23', {
        promotionExpense: -1,
      })
    ).rejects.toThrow();
    await expect(
      service.updateDailyPromotionExpense('2026-13-40', {
        promotionExpense: 100,
      })
    ).rejects.toThrow();
  });

  it('兼容旧反馈并保存处理状态和管理员记录', async () => {
    const service = new AdminOperationsService();
    const feedback = {
      id: new MongoObjectId('64f000000000000000000001'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const save = jest.fn().mockResolvedValue(feedback);
    service.feedbackModel = {
      findOne: jest.fn().mockResolvedValueOnce(feedback),
      save,
    } as never;

    const result = await service.updateFeedback(
      feedback.id.toHexString(),
      {
        status: 'resolved',
        note: ' 已核对并修复 ',
      },
      {
        sub: 'admin-id',
        account: 'operator',
        roles: ['admin'],
        nonce: 'test-nonce',
        exp: 1,
        iat: 1,
      }
    );

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        handlingStatus: ConversationMessageFeedbackHandlingStatus.resolved,
        handlingNote: '已核对并修复',
        handledBy: 'operator',
      })
    );
    expect(result.handlingStatus).toBe('resolved');
  });
});
