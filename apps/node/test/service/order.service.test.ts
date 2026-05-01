import {
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipStatus,
  VipPlanEntity,
  VipPlanStatus,
} from '@tzl/entities';
import {
  ORDER_PAYMENT_EXPIRE_QUEUE,
  OrderService,
} from '../../src/service/order.service';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const USER_ID = '665000000000000000000001';
const ORDER_ID = '665000000000000000000002';
const VIP_PLAN_ID = '665000000000000000000003';
const ORDER_NO = 'VIP202605010001';

function createOrder(overrides: Partial<OrderEntity> = {}) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');
  const order = new OrderEntity();

  Object.assign(order, {
    id: new MongoObjectId(ORDER_ID),
    orderNo: ORDER_NO,
    userId: new MongoObjectId(USER_ID),
    orderType: OrderType.vipPlan,
    targetId: new MongoObjectId(VIP_PLAN_ID),
    targetCode: 'vip_month',
    title: '月度会员',
    amount: 990,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 990,
    currency: 'CNY',
    status: OrderStatus.pending,
    source: OrderSource.weapp,
    paymentProvider: 'wechat_pay',
    paymentExpiredAt: new Date(NOW.getTime() - 1000),
    snapshot: {
      vipPlan: {
        id: VIP_PLAN_ID,
        code: 'vip_month',
        durationDays: 31,
        lifetime: false,
      },
    },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  return order;
}

function createVipPlan(overrides: Partial<VipPlanEntity> = {}) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');
  const plan = new VipPlanEntity();

  Object.assign(plan, {
    id: new MongoObjectId(VIP_PLAN_ID),
    code: 'vip_month',
    name: '月度会员',
    priceAmount: 990,
    originalPriceAmount: 990,
    currency: 'CNY',
    durationDays: 31,
    lifetime: false,
    benefits: [],
    status: VipPlanStatus.active,
    sort: 1,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  return plan;
}

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function snapshotOrder(order: OrderEntity) {
  return {
    status: order.status,
    paidAmount: order.paidAmount,
    paymentTradeNo: order.paymentTradeNo,
    paymentNotifyAt: order.paymentNotifyAt,
    paidAt: order.paidAt,
    closedAt: order.closedAt,
    updatedAt: order.updatedAt,
  };
}

function createOrderModel(order: OrderEntity) {
  const savedSnapshots: ReturnType<typeof snapshotOrder>[] = [];
  const model = {
    savedSnapshots,
    findOne: jest.fn(async ({ where }: any) => {
      if (where?.orderNo) {
        return where.orderNo === order.orderNo ? order : null;
      }

      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, order.id) ? order : null;
    }),
    save: jest.fn(async (entity: OrderEntity) => {
      entity.id = entity.id ?? new MongoObjectId(ORDER_ID);
      savedSnapshots.push(snapshotOrder(entity));
      return entity;
    }),
  };

  return model;
}

function createVipPlanModel(plan: VipPlanEntity) {
  return {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, plan.id) ? plan : null;
    }),
  };
}

function createService(orderOverrides: Partial<OrderEntity> = {}) {
  const service = new OrderService();
  const order = createOrder(orderOverrides);
  const plan = createVipPlan();
  const orderModel = createOrderModel(order);
  const vipPlanModel = createVipPlanModel(plan);
  const userMembershipModel = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async membership => membership),
  };
  const wechatPayService = {
    getOpenidByJsCode: jest.fn().mockResolvedValue('openid-1'),
    createVipPlanPrepay: jest.fn().mockResolvedValue({
      prepayId: 'prepay-id',
      payment: {
        timeStamp: '1777600000',
        nonceStr: 'nonce',
        package: 'prepay_id=prepay-id',
        signType: 'RSA',
        paySign: 'sign',
      },
    }),
    queryTransactionByOrderNo: jest.fn(),
  };
  const queue = {
    addJobToQueue: jest.fn().mockResolvedValue(undefined),
  };

  service.logger = {
    warn: jest.fn(),
  } as any;
  service.orderModel = orderModel as any;
  service.vipPlanModel = vipPlanModel as any;
  service.userMembershipModel = userMembershipModel as any;
  service.wechatPayService = wechatPayService as any;
  service.bullmqFramework = {
    getQueue: jest.fn(name =>
      name === ORDER_PAYMENT_EXPIRE_QUEUE ? queue : undefined
    ),
  } as any;

  return {
    service,
    order,
    orderModel,
    userMembershipModel,
    wechatPayService,
    queue,
    auth: {
      sub: USER_ID,
      accountId: 'account-1',
      account: 'test-user',
      iat: 0,
      exp: 0,
      nonce: 'nonce',
    },
  };
}

describe('OrderService payment expiration and reconciliation', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues a delayed expiration job after creating a vip payment order', async () => {
    const { service, queue, auth } = createService();

    await service.createVipPlanOrder(auth, {
      vipPlanId: VIP_PLAN_ID,
      jsCode: 'wx-code',
    });

    expect(queue.addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
      }),
      expect.objectContaining({
        jobId: `order-payment-expire:${ORDER_ID}`,
        delay: 30 * 60 * 1000,
        attempts: 3,
      })
    );
  });

  it('closes an expired pending order and writes closedAt when WeChat has no transaction', async () => {
    const { service, order, orderModel, wechatPayService } = createService();

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue(null);

    const result = await service.closeExpiredWechatOrder(ORDER_ID);

    expect(wechatPayService.queryTransactionByOrderNo).toHaveBeenCalledWith(
      ORDER_NO
    );
    expect(orderModel.save).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.closed);
    expect(order.closedAt).toEqual(NOW);
    expect(order.updatedAt).toEqual(NOW);
    expect(orderModel.savedSnapshots).toEqual([
      expect.objectContaining({
        status: OrderStatus.closed,
        closedAt: NOW,
        updatedAt: NOW,
      }),
    ]);
    expect(result?.status).toBe(OrderStatus.closed);
  });

  it('syncs an expired pending order as paid when WeChat returns SUCCESS and grants membership', async () => {
    const {
      service,
      order,
      orderModel,
      userMembershipModel,
      wechatPayService,
    } = createService();
    const paidAt = '2026-05-01T00:10:00+08:00';

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue({
      out_trade_no: ORDER_NO,
      transaction_id: '420000000020260501000001',
      trade_state: 'SUCCESS',
      success_time: paidAt,
      amount: {
        total: 990,
        payer_total: 990,
      },
    });

    const result = await service.closeExpiredWechatOrder(ORDER_ID);

    expect(wechatPayService.queryTransactionByOrderNo).toHaveBeenCalledWith(
      ORDER_NO
    );
    expect(userMembershipModel.save).toHaveBeenCalledTimes(1);
    expect(userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: order.userId,
        vipPlanId: order.targetId,
        vipPlanCode: 'vip_month',
        sourceOrderId: order.id,
        status: UserMembershipStatus.active,
        lifetime: false,
      })
    );
    expect(order.status).toBe(OrderStatus.completed);
    expect(order.paidAmount).toBe(990);
    expect(order.paymentTradeNo).toBe('420000000020260501000001');
    expect(order.closedAt).toBeUndefined();
    expect(orderModel.savedSnapshots.map(item => item.status)).toEqual([
      OrderStatus.granting,
      OrderStatus.completed,
    ]);
    expect(result?.status).toBe(OrderStatus.completed);
  });

  it.each([
    OrderStatus.completed,
    OrderStatus.paid,
    OrderStatus.closed,
    OrderStatus.refunded,
    OrderStatus.granting,
    OrderStatus.grantFailed,
  ])('does not query WeChat for final status %s', async status => {
    const { service, orderModel, auth, wechatPayService } = createService({
      status,
    });

    const result = await service.syncUserOrderPayment(auth, ORDER_ID);

    expect(wechatPayService.queryTransactionByOrderNo).not.toHaveBeenCalled();
    expect(orderModel.save).not.toHaveBeenCalled();
    expect(result.status).toBe(status);
  });

  it('keeps a non-expired pending order open when WeChat trade state is not final', async () => {
    const { service, order, orderModel, wechatPayService } = createService({
      paymentExpiredAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    });

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue({
      out_trade_no: ORDER_NO,
      trade_state: 'USERPAYING',
      amount: {
        total: 990,
      },
    });

    const result = await service.closeExpiredWechatOrder(ORDER_ID);

    expect(wechatPayService.queryTransactionByOrderNo).toHaveBeenCalledWith(
      ORDER_NO
    );
    expect(orderModel.save).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.pending);
    expect(order.closedAt).toBeUndefined();
    expect(result?.status).toBe(OrderStatus.pending);
  });
});
