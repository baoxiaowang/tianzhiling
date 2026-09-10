import {
  ConversationMessageFeedbackHandlingStatus,
  MongoObjectId,
} from '@tzl/entities';
import { getDouyinPromotionExpense } from '@tzl/shared';
import { AdminOperationsService } from './admin-operations.service';

const aggregateResult = (rows: unknown[]) => ({
  toArray: jest.fn().mockResolvedValue(rows),
});

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
