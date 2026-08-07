import {
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
} from '@tzl/entities';
import {
  calculateVipUpgradePricing,
  getHistoricalVipPaidAmount,
} from '../../src/service/vip-upgrade-pricing';

const USER_ID = new MongoObjectId('665000000000000000000001');

function createOrder(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return Object.assign(new OrderEntity(), {
    id: new MongoObjectId(),
    orderNo: `VIP${new MongoObjectId().toHexString()}`,
    userId: USER_ID,
    orderType: OrderType.vipPlan,
    title: '会员订单',
    amount: 9900,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 9900,
    paidAmount: 9900,
    currency: 'CNY',
    status: OrderStatus.completed,
    source: OrderSource.weapp,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides,
  });
}

function createOrderModel(orders: OrderEntity[]) {
  return {
    find: jest.fn().mockResolvedValue(orders),
  } as any;
}

describe('vip upgrade historical pricing compatibility', () => {
  it('keeps current order amounts in fen', async () => {
    const amount = await getHistoricalVipPaidAmount(
      createOrderModel([createOrder()]),
      USER_ID
    );

    expect(amount).toBe(9900);
  });

  it('converts previously migrated legacy WeChat order amounts from yuan to fen', async () => {
    const legacyOrder = createOrder({
      amount: 99,
      payableAmount: 99,
      paidAmount: 99,
      paymentProvider: 'legacy_wechat',
      snapshot: {
        legacy: {
          namespace: 'legacy_mysql',
          orderId: 'old-order-1',
        },
      },
    });

    const amount = await getHistoricalVipPaidAmount(
      createOrderModel([legacyOrder]),
      USER_ID
    );

    expect(amount).toBe(9900);
    expect(calculateVipUpgradePricing(131400, amount)).toEqual({
      historicalPaidAmount: 9900,
      deductedAmount: 9900,
      payableAmount: 121500,
    });
  });

  it('does not convert corrected legacy records that declare fen storage', async () => {
    const correctedLegacyOrder = createOrder({
      paymentProvider: 'legacy_wechat',
      snapshot: {
        legacy: {
          namespace: 'legacy_mysql',
          sourceMoneyUnit: 'yuan',
          moneyUnit: 'fen',
          moneyMigrationVersion: 2,
        },
      },
    });

    const amount = await getHistoricalVipPaidAmount(
      createOrderModel([correctedLegacyOrder]),
      USER_ID
    );

    expect(amount).toBe(9900);
  });

  it('supports raw old-server total_money records when new amount fields are absent', async () => {
    const rawLegacyOrder = createOrder({
      amount: undefined as unknown as number,
      payableAmount: undefined as unknown as number,
      paidAmount: undefined,
    }) as OrderEntity & { total_money: string };
    rawLegacyOrder.total_money = '99.00';

    const amount = await getHistoricalVipPaidAmount(
      createOrderModel([rawLegacyOrder]),
      USER_ID
    );

    expect(amount).toBe(9900);
  });

  it('preserves legacy yuan decimals when converting to fen', async () => {
    const rawLegacyOrder = createOrder({
      amount: undefined as unknown as number,
      payableAmount: undefined as unknown as number,
      paidAmount: undefined,
    }) as OrderEntity & { total_money: string };
    rawLegacyOrder.total_money = '99.50';

    const amount = await getHistoricalVipPaidAmount(
      createOrderModel([rawLegacyOrder]),
      USER_ID
    );

    expect(amount).toBe(9950);
  });

  it('converts legacy refunds with the same unit before deducting them', async () => {
    const partiallyRefundedLegacyOrder = createOrder({
      amount: 99,
      payableAmount: 99,
      paidAmount: 99,
      refundAmount: 20,
      status: OrderStatus.refundRequested,
      paymentProvider: 'legacy_wechat',
      snapshot: {
        legacy: {
          namespace: 'legacy_mysql',
        },
      },
    });

    const amount = await getHistoricalVipPaidAmount(
      createOrderModel([partiallyRefundedLegacyOrder]),
      USER_ID
    );

    expect(amount).toBe(7900);
  });
});
