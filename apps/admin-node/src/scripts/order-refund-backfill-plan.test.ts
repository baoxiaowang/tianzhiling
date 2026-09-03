import {
  MongoObjectId,
  OrderEntity,
  OrderRefundType,
  OrderSource,
  OrderStatus,
  OrderType,
} from '@tzl/entities';
import {
  buildHistoricalRefundPlan,
  buildRefundRecordId,
} from './order-refund-backfill-plan';

function order(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return {
    id: new MongoObjectId('64f000000000000000000001'),
    orderNo: 'O100',
    userId: new MongoObjectId('64f000000000000000000002'),
    orderType: OrderType.vipPlan,
    title: '会员',
    amount: 10000,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 10000,
    paidAmount: 10000,
    currency: 'CNY',
    status: OrderStatus.completed,
    source: OrderSource.weapp,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('historical order refund backfill plan', () => {
  it('uses the original refundedAt for a generic full refund', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        status: OrderStatus.refunded,
        refundAmount: 10000,
        refundedAt: new Date('2026-02-01T03:00:00.000Z'),
      })
    );

    expect(plan.eligible).toBe(true);
    expect(plan.candidates).toEqual([
      expect.objectContaining({
        refundNo: 'RO100',
        refundType: OrderRefundType.orderRefund,
        amount: 10000,
        completedAt: new Date('2026-02-01T03:00:00.000Z'),
      }),
    ]);
  });

  it('splits downgrade and final refund by their own completion dates', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        status: OrderStatus.refunded,
        refundAmount: 10000,
        snapshot: {
          voiceMembershipDowngrade: {
            status: 'completed',
            refundNo: 'RD100',
            refundAmount: 3000,
            requestedAt: '2026-02-01T01:00:00.000Z',
            completedAt: '2026-02-01T02:00:00.000Z',
          },
          voiceMembershipFinalRefund: {
            status: 'completed',
            refundNo: 'RF100',
            refundAmount: 7000,
            requestedAt: '2026-03-01T01:00:00.000Z',
            completedAt: '2026-03-01T02:00:00.000Z',
          },
        },
      })
    );

    expect(plan.eligible).toBe(true);
    expect(plan.candidateAmount).toBe(10000);
    expect(
      plan.candidates.map(item => [
        item.refundType,
        item.amount,
        item.completedAt.toISOString(),
      ])
    ).toEqual([
      [
        OrderRefundType.voiceMembershipDowngrade,
        3000,
        '2026-02-01T02:00:00.000Z',
      ],
      [
        OrderRefundType.voiceMembershipFinalRefund,
        7000,
        '2026-03-01T02:00:00.000Z',
      ],
    ]);
  });

  it('accepts virtual-payment SUCCESS snapshots even before benefit recovery', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        paymentProvider: 'wechat_virtual_pay',
        refundAmount: 2500,
        snapshot: {
          voiceMembershipDowngrade: {
            status: 'benefits_failed',
            wechatRefundStatus: 'SUCCESS',
            refundNo: 'VR100',
            refundAmount: 2500,
            requestedAt: '2026-02-01T01:00:00.000Z',
            refundRecordedAt: '2026-02-01T02:00:00.000Z',
          },
        },
      })
    );

    expect(plan.eligible).toBe(true);
    expect(plan.candidates[0].refundType).toBe(
      OrderRefundType.voiceMembershipDowngrade
    );
  });

  it('infers the total only from strongly completed snapshots', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        snapshot: {
          voiceMembershipDowngrade: {
            status: 'completed',
            refundNo: 'RD100',
            refundAmount: 3000,
            requestedAt: '2026-02-01T01:00:00.000Z',
            completedAt: '2026-02-01T02:00:00.000Z',
          },
        },
      })
    );

    expect(plan.eligible).toBe(true);
    expect(plan.effectiveRefundAmount).toBe(3000);
    expect(plan.warnings).toContain(
      '原订单缺少累计退款额，按已成功的分段退款金额合计核对'
    );
  });

  it('blocks an amount mismatch and incomplete snapshot evidence', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        refundAmount: 2000,
        snapshot: {
          voiceMembershipDowngrade: {
            status: 'completed',
            refundNo: 'RD100',
            refundAmount: 3000,
            requestedAt: 'not-a-date',
          },
        },
      })
    );

    expect(plan.eligible).toBe(false);
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        '会员降级退款缺少有效申请时间',
        '分段退款合计 3000 大于原订单累计退款额 2000',
      ])
    );
  });

  it('classifies a historical full membership cancellation as a normal refund', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        status: OrderStatus.completed,
        refundAmount: 10000,
        refundedAt: new Date('2026-02-01T03:00:00.000Z'),
      })
    );

    expect(plan.eligible).toBe(true);
    expect(plan.candidates).toEqual([
      expect.objectContaining({
        refundNo: 'RO100',
        refundType: OrderRefundType.orderRefund,
        amount: 10000,
        completedAt: new Date('2026-02-01T03:00:00.000Z'),
      }),
    ]);
    expect(plan.warnings).toContain(
      '无分段快照的历史全额会员退订，按普通退款订单回填'
    );
  });

  it('still blocks an ambiguous partial membership refund without a snapshot', () => {
    const plan = buildHistoricalRefundPlan(
      order({
        status: OrderStatus.completed,
        refundAmount: 3000,
        refundedAt: new Date('2026-02-01T03:00:00.000Z'),
      })
    );

    expect(plan.eligible).toBe(false);
    expect(plan.errors).toContain(
      '会员订单存在退款金额，但缺少可判定退款性质的成功快照'
    );
  });

  it('derives stable ids from refund numbers', () => {
    expect(String(buildRefundRecordId('RD100'))).toBe(
      String(buildRefundRecordId('RD100'))
    );
    expect(String(buildRefundRecordId('RD100'))).not.toBe(
      String(buildRefundRecordId('RF100'))
    );
  });
});
