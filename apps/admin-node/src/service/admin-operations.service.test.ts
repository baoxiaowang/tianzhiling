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
    // 今日口径与当日行对齐：新建智能体按当天新建智能体数统计（而非“当日新注册用户数”）
    expect(result.todayTotals).toMatchObject({
      newUsers: 3,
      newAgents: 4,
    });
    // 新建智能体口径必须排除内部小使者：查询需携带 messengerOfAgentId 过滤
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

  describe('净收入口径（getNetPaidAmountExpression）', () => {
    // 极简 Mongo 聚合表达式求值器（仅覆盖净收入表达式用到的算子，用于断言计算口径）
    const evaluate = (
      expr: unknown,
      doc: Record<string, unknown>
    ): unknown => {
      if (Array.isArray(expr)) {
        return expr.map((item) => evaluate(item, doc));
      }
      if (expr && typeof expr === 'object') {
        const obj = expr as Record<string, unknown>;
        if ('$ifNull' in obj) {
          const [value, fallback] = obj.$ifNull as unknown[];
          return evaluate(value, doc) ?? evaluate(fallback, doc);
        }
        if ('$cond' in obj) {
          const [condition, whenTrue, whenFalse] = obj.$cond as unknown[];
          return evaluate(condition, doc)
            ? evaluate(whenTrue, doc)
            : evaluate(whenFalse, doc);
        }
        if ('$subtract' in obj) {
          const [left, right] = obj.$subtract as unknown[];
          return (evaluate(left, doc) as number) - (evaluate(right, doc) as number);
        }
        if ('$add' in obj) {
          return (obj.$add as unknown[]).reduce<number>(
            (sum, item) => sum + (evaluate(item, doc) as number),
            0
          );
        }
        if ('$eq' in obj) {
          const [left, right] = obj.$eq as unknown[];
          return evaluate(left, doc) === evaluate(right, doc) ? 1 : 0;
        }
        if ('$lte' in obj) {
          const [left, right] = obj.$lte as unknown[];
          return (evaluate(left, doc) as number) <= (evaluate(right, doc) as number)
            ? 1
            : 0;
        }
        if ('$gt' in obj) {
          const [left, right] = obj.$gt as unknown[];
          return (evaluate(left, doc) as number) > (evaluate(right, doc) as number)
            ? 1
            : 0;
        }
        if ('$and' in obj) {
          const conditions = obj.$and as unknown[];
          return conditions.every((item) => evaluate(item, doc)) ? 1 : 0;
        }
      }
      if (typeof expr === 'string' && expr.startsWith('$')) {
        const path = expr.slice(1).split('.');
        let value: unknown = doc;
        for (const key of path) {
          value = (value as Record<string, unknown>)?.[key];
        }
        return value;
      }
      return expr;
    };

    const exprOf = (service: AdminOperationsService) =>
      (
        service as unknown as {
          getNetPaidAmountExpression: () => unknown;
        }
      ).getNetPaidAmountExpression();

    it('普通已完成订单：净收入=实付金额（无退款）', () => {
      const service = new AdminOperationsService();
      expect(
        evaluate(exprOf(service), {
          paidAmount: 9900,
          payableAmount: 9900,
          refundAmount: 0,
          status: 'completed',
        })
      ).toBe(9900);
    });

    it('降级已完成订单：降级差价只扣一次，净收入=实付-差价', () => {
      // 降级差价在降级时已写入 order.refundAmount，不应再从 snapshot 重复扣除
      const service = new AdminOperationsService();
      expect(
        evaluate(exprOf(service), {
          paidAmount: 16900,
          payableAmount: 16900,
          refundAmount: 7000,
          status: 'completed',
          snapshot: { voiceMembershipDowngrade: { refundAmount: 7000 } },
        })
      ).toBe(9900);
    });

    it('已退款订单：净收入=实付-退款（全额退款为0）', () => {
      const service = new AdminOperationsService();
      expect(
        evaluate(exprOf(service), {
          paidAmount: 16900,
          payableAmount: 16900,
          refundAmount: 16900,
          status: 'refunded',
        })
      ).toBe(0);
    });

    it('已退款但退款金额缺失的订单：按全额退款兜底为0', () => {
      const service = new AdminOperationsService();
      expect(
        evaluate(exprOf(service), {
          paidAmount: 9900,
          payableAmount: 9900,
          refundAmount: 0,
          status: 'refunded',
        })
      ).toBe(0);
    });
  });
});
