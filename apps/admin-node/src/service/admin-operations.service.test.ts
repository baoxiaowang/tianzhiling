import {
  ConversationMessageFeedbackHandlingStatus,
  MongoObjectId,
} from '@tzl/entities';
import { AdminOperationsService } from './admin-operations.service';

const aggregateResult = (rows: unknown[]) => ({
  toArray: jest.fn().mockResolvedValue(rows),
});

describe('AdminOperationsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('按北京时间生成日报并统计实时用户消息和净收入', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T04:30:00.000Z'));
    const service = new AdminOperationsService();
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
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        return aggregateResult(
          serialized.includes('"$count":"count"')
            ? [{ count: 1 }]
            : [{ _id: '2026-08-23', count: 4 }]
        );
      }),
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
        if (serialized.includes('"status":"refunded"')) {
          return aggregateResult([{ _id: '2026-08-23', amount: 1800 }]);
        }
        if (serialized.includes('"netAmount"')) {
          return aggregateResult([{ payingUsers: 20, netAmount: 50000 }]);
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
    });
    expect(result.hourly[12]).toMatchObject({
      hour: '12:00',
      newUsers: 2,
      userMessages: 9,
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
  });

  it('按当月创建订单计算支付成功率并展示支付日净收入', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T04:30:00.000Z'));
    const service = new AdminOperationsService();
    service.orderModel = {
      count: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(8),
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
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
        refundedRevenue: 20,
        netRevenue: 100,
      }
    );
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
