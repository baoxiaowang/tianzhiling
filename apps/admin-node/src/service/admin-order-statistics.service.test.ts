import { OrderRefundStatus, OrderRefundType, OrderStatus } from '@tzl/entities';
import {
  AdminOrderStatisticsService,
  CALCULATION_VERSION,
} from './admin-order-statistics.service';

const aggregateResult = (rows: unknown[]) => ({
  toArray: jest.fn().mockResolvedValue(rows),
});

describe('AdminOrderStatisticsService', () => {
  it('把购买和各类退款按发生月份拆成独立流水并保存月度快照', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    const service = new AdminOrderStatisticsService();
    service.snapshotModel = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: { toString: () => 'purchase-1' },
            orderNo: 'VIP-PURCHASE-1',
            createdAt: new Date('2026-09-01T02:00:00.000Z'),
            targetCode: 'vip_master',
            payableAmount: 19900,
            status: OrderStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            user: {
              name: '用户甲',
              createdAt: new Date('2026-08-01T02:00:00.000Z'),
            },
            agents: [],
            interactionCount: 36,
          },
        ])
      ),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: { toString: () => 'refund-downgrade' },
            refundNo: 'REFUND-DOWNGRADE',
            originalOrderNo: 'VIP-PURCHASE-OLD',
            requestedAt: new Date('2026-08-31T03:00:00.000Z'),
            completedAt: new Date('2026-09-02T03:00:00.000Z'),
            refundType: OrderRefundType.voiceMembershipDowngrade,
            amount: 7000,
            status: OrderRefundStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_virtual_pay',
            targetCode: 'voice_vip_year',
            user: { name: '用户乙' },
          },
          {
            _id: { toString: () => 'refund-final' },
            refundNo: 'REFUND-FINAL',
            originalOrderNo: 'VIP-PURCHASE-OLD-2',
            requestedAt: new Date('2026-09-03T03:00:00.000Z'),
            completedAt: new Date('2026-09-03T03:05:00.000Z'),
            refundType: OrderRefundType.voiceMembershipFinalRefund,
            amount: 9900,
            status: OrderRefundStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            targetCode: 'voice_vip_year',
            user: { name: '用户丙' },
          },
        ])
      ),
    } as never;

    const result = await service.getMonthlyReport('2026-09');

    expect(result.totals).toEqual({
      allOrders: 1,
      validOrders: 1,
      abnormalOrders: 0,
      validAmount: 199,
      completedRefunds: 2,
      refundedAmount: 169,
      legacyRefundedAmount: 0,
      legacyRefundCount: 0,
      netAmount: 30,
    });
    expect(result.refundOrders).toEqual([
      expect.objectContaining({
        refundTypeLabel: '会员降级退款',
        amount: 70,
        originalOrderNo: 'VIP-PURCHASE-OLD',
      }),
      expect.objectContaining({
        refundTypeLabel: '最终退订退款',
        amount: 99,
        originalOrderNo: 'VIP-PURCHASE-OLD-2',
      }),
    ]);
    expect(result.validOrders[0]).toMatchObject({
      amount: 199,
      interactionCount: 36,
      paymentCycleDays: 31,
      userCreatedAt: '2026-08-01T02:00:00.000Z',
    });
    expect(service.snapshotModel.updateOne).toHaveBeenCalledWith(
      { month: '2026-09' },
      expect.objectContaining({
        $set: expect.objectContaining({ payload: result }),
      }),
      { upsert: true }
    );
    const refundPipeline = jest.mocked(service.orderRefundModel.aggregate).mock
      .calls[0][0];
    expect(JSON.stringify(refundPipeline)).toContain('"completedAt"');
    expect(JSON.stringify(refundPipeline)).not.toContain(
      '"requestedAt":{"$gte"'
    );
    expect(JSON.stringify(refundPipeline)).toContain(
      `"status":"${OrderRefundStatus.completed}"`
    );
    jest.useRealTimers();
  });

  it('月度净额按当月已付款减当月退款（含已退款/退款申请中订单，与仪表盘同口径）', async () => {
    const service = new AdminOrderStatisticsService();
    service.snapshotModel = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({}),
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: { toString: () => 'completed-1' },
            orderNo: 'A',
            createdAt: new Date('2026-09-02T04:00:00.000Z'),
            paidAt: new Date('2026-09-02T04:00:00.000Z'),
            targetCode: 'vip_year',
            paidAmount: 10000,
            status: OrderStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            user: { name: '甲' },
            agents: [],
            interactionCount: 0,
          },
          {
            _id: { toString: () => 'refunded-1' },
            orderNo: 'B',
            createdAt: new Date('2026-09-03T04:00:00.000Z'),
            paidAt: new Date('2026-09-03T04:00:00.000Z'),
            targetCode: 'vip_year',
            paidAmount: 16900,
            refundAmount: 16900,
            status: OrderStatus.refunded,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            user: { name: '乙' },
            agents: [],
            interactionCount: 0,
          },
          {
            _id: { toString: () => 'requested-1' },
            orderNo: 'C',
            createdAt: new Date('2026-09-04T04:00:00.000Z'),
            paidAt: new Date('2026-09-04T04:00:00.000Z'),
            targetCode: 'vip_year',
            paidAmount: 9900,
            status: 'refund_requested',
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            user: { name: '丙' },
            agents: [],
            interactionCount: 0,
          },
          {
            _id: { toString: () => 'admin-1' },
            orderNo: 'D',
            createdAt: new Date('2026-09-05T04:00:00.000Z'),
            paidAt: new Date('2026-09-05T04:00:00.000Z'),
            targetCode: 'vip_year',
            paidAmount: 50000,
            status: OrderStatus.completed,
            source: 'admin',
            paymentProvider: 'admin_manual',
            user: { name: '丁' },
            agents: [],
            interactionCount: 0,
          },
        ])
      ),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: { toString: () => 'refund-1' },
            refundNo: 'R1',
            originalOrderNo: 'B',
            requestedAt: new Date('2026-09-03T04:00:00.000Z'),
            completedAt: new Date('2026-09-03T05:00:00.000Z'),
            refundType: OrderRefundType.voiceMembershipFinalRefund,
            amount: 16900,
            status: OrderRefundStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            targetCode: 'vip_year',
            user: { name: '乙' },
          },
        ])
      ),
    } as never;

    const result = await service.getMonthlyReport('2026-09', true);

    // 有效订单只有 A（100 元）；B/C 因非 completed 被剔除，D 为管理端手动单
    expect(result.totals.validAmount).toBe(100);
    expect(result.totals.refundedAmount).toBe(169);
    // 净额 = (100 + 169 + 99 − 管理端 500) − 169 = 199
    expect(result.totals.netAmount).toBe(199);
  });

  it('历史月份命中已保存快照时不重复扫描订单', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    const service = new AdminOrderStatisticsService();
    service.snapshotModel = {
      findOne: jest.fn().mockResolvedValue({
        month: '2026-08',
        calculationVersion: CALCULATION_VERSION,
        payload: {
          month: '2026-08',
          timezone: 'Asia/Shanghai',
          generatedAt: '2026-09-01T00:00:00.000Z',
          totals: {},
        },
        updatedAt: new Date('2026-09-06T11:50:00.000Z'),
      }),
    } as never;
    service.orderModel = { aggregate: jest.fn() } as never;
    service.orderRefundModel = { aggregate: jest.fn() } as never;

    const result = await service.getMonthlyReport('2026-08');

    expect(result.snapshot.persisted).toBe(true);
    expect(result.snapshot.updatedAt).toBe('2026-09-06T11:50:00.000Z');
    expect(service.orderModel.aggregate).not.toHaveBeenCalled();
    expect(service.orderRefundModel.aggregate).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  // 历史月份也会出现迟到退款/补录，快照不能永久固化：
  // 超过有限 TTL 后必须重算，否则补录永远看不到。
  it('历史月份快照超过有限 TTL 后会重算', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    const service = new AdminOrderStatisticsService();
    const updateOne = jest.fn().mockResolvedValue({});
    service.snapshotModel = {
      findOne: jest.fn().mockResolvedValue({
        month: '2026-08',
        calculationVersion: CALCULATION_VERSION,
        payload: {
          month: '2026-08',
          timezone: 'Asia/Shanghai',
          generatedAt: '2026-09-06T10:00:00.000Z',
          totals: {},
        },
        // 2 小时前，已超过历史月份的有限 TTL
        updatedAt: new Date('2026-09-06T10:00:00.000Z'),
      }),
      updateOne,
    } as never;
    service.orderModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() => aggregateResult([])),
    } as never;

    await service.getMonthlyReport('2026-08');

    expect(service.orderModel.aggregate).toHaveBeenCalled();
    // 重算结果要写回快照
    expect(updateOne).toHaveBeenCalled();
    jest.useRealTimers();
  });

  // 历史遗留退款（订单自带 refundAmount、无独立退款单）金额进净值公式，
  // 但不在 refundOrders 明细里；必须单独列出笔数与金额才能勾稽。
  it('历史遗留退款在总计里单独列出，净额可与明细勾稽', async () => {
    const service = new AdminOrderStatisticsService();
    service.snapshotModel = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({}),
    } as never;
    service.orderModel = {
      aggregate: jest.fn((pipeline: unknown[]) => {
        if (JSON.stringify(pipeline).includes('independentRefundOrders')) {
          // 1 笔历史遗留退款 ¥30
          return aggregateResult([{ amount: 3000, count: 1 }]);
        }

        // 当月 1 笔实付 ¥100
        return aggregateResult([
          {
            _id: { toString: () => 'order-1' },
            orderNo: 'VIP-1',
            createdAt: new Date('2026-09-02T04:00:00.000Z'),
            paidAt: new Date('2026-09-02T04:00:00.000Z'),
            targetCode: 'vip_year',
            paidAmount: 10000,
            status: OrderStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            user: { name: '甲' },
            agents: [],
            interactionCount: 0,
          },
        ]);
      }),
    } as never;
    service.orderRefundModel = {
      aggregate: jest.fn(() =>
        aggregateResult([
          {
            _id: { toString: () => 'refund-1' },
            refundNo: 'R1',
            originalOrderNo: 'VIP-0',
            requestedAt: new Date('2026-09-03T04:00:00.000Z'),
            completedAt: new Date('2026-09-03T05:00:00.000Z'),
            refundType: OrderRefundType.orderRefund,
            amount: 2000,
            status: OrderRefundStatus.completed,
            source: 'wechat',
            paymentProvider: 'wechat_pay',
            targetCode: 'vip_year',
            user: { name: '乙' },
          },
        ])
      ),
    } as never;

    const result = await service.getMonthlyReport('2026-09', true);

    expect(result.totals.completedRefunds).toBe(1);
    expect(result.totals.refundedAmount).toBe(20);
    expect(result.totals.legacyRefundCount).toBe(1);
    expect(result.totals.legacyRefundedAmount).toBe(30);
    // 勾稽：净额 = 实付 100 − 独立退款 20 − 遗留退款 30 = 50
    expect(result.totals.netAmount).toBe(50);
    // 遗留退款不进 refundOrders 明细，因此明细求和只有独立退款
    expect(
      result.refundOrders.reduce((sum, item) => sum + item.amount, 0)
    ).toBe(20);
  });
});
