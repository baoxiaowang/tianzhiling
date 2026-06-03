import {
  AgentEntitlementStatus,
  AgentEntitlementType,
  MongoObjectId,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipStatus,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { AdminOrderService } from './admin-order.service';

const USER_ID = new MongoObjectId('665000000000000000000201');
const ORDER_ID = new MongoObjectId('665000000000000000000301');
const ORDER_CREATED_AT = new Date('2026-05-02T08:00:00.000Z');

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createCompletedVipOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderNo: 'VIP202605020001',
    userId: USER_ID,
    orderType: OrderType.vipPlan,
    targetCode: 'vip_year',
    title: '一年会员',
    amount: 19900,
    discountAmount: 10000,
    couponAmount: 0,
    payableAmount: 9900,
    paidAmount: 9900,
    currency: 'CNY',
    status: OrderStatus.completed,
    source: OrderSource.weapp,
    paymentProvider: 'wechat_pay',
    paymentTradeNo: '420000000020260502000001',
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    paidAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createCompletedVoiceOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderNo: 'VOICE202605020001',
    userId: USER_ID,
    orderType: OrderType.voicePackage,
    targetCode: 'voice_standard',
    title: '标准声音套餐',
    amount: 12900,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 12900,
    paidAmount: 12900,
    currency: 'CNY',
    status: OrderStatus.completed,
    source: OrderSource.weapp,
    paymentProvider: 'wechat_pay',
    paymentTradeNo: '420000000020260502000002',
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    paidAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: new MongoObjectId('665000000000000000000401'),
    userId: USER_ID,
    vipPlanId: new MongoObjectId('665000000000000000000402'),
    vipPlanCode: 'vip_year',
    sourceOrderId: ORDER_ID,
    status: UserMembershipStatus.active,
    startedAt: ORDER_CREATED_AT,
    expiredAt: new Date('2027-05-02T08:00:00.000Z'),
    lifetime: false,
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createEntitlement(overrides: Record<string, unknown> = {}) {
  return {
    id: new MongoObjectId('665000000000000000000403'),
    userId: USER_ID,
    type: AgentEntitlementType.voiceModel,
    totalQuota: 1,
    usedQuota: 0,
    status: AgentEntitlementStatus.available,
    sourceOrderId: ORDER_ID,
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createVoiceTrainingTask(overrides: Record<string, unknown> = {}) {
  return {
    id: new MongoObjectId('665000000000000000000404'),
    userId: USER_ID,
    agentId: new MongoObjectId('665000000000000000000405'),
    orderId: ORDER_ID,
    voicePackageId: new MongoObjectId('665000000000000000000406'),
    voicePackageCode: 'voice_standard',
    status: VoiceTrainingTaskStatus.paid,
    assigneeName: '',
    materialObjectKeys: [],
    remark: '',
    paidAt: ORDER_CREATED_AT,
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createService() {
  const service = new AdminOrderService();
  const orders: any[] = [];
  const memberships: any[] = [];
  const entitlements: any[] = [];
  const voiceTrainingTasks: any[] = [];

  service.orderModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return orders.find(order => id && sameObjectId(order.id, id)) ?? null;
    }),
    save: jest.fn(async order => order),
  } as any;
  service.userModel = {
    find: jest.fn(),
  } as any;
  service.userAccountModel = {
    find: jest.fn(),
  } as any;
  service.userMembershipModel = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        memberships.find(membership =>
          sameObjectId(membership.sourceOrderId, where?.sourceOrderId)
        ) ?? null
      );
    }),
    save: jest.fn(async membership => membership),
  } as any;
  service.agentEntitlementModel = {
    find: jest.fn(async ({ where }: any) => {
      return entitlements.filter(entitlement =>
        sameObjectId(entitlement.sourceOrderId, where?.sourceOrderId)
      );
    }),
    save: jest.fn(async entitlement => entitlement),
  } as any;
  service.voiceTrainingTaskModel = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        voiceTrainingTasks.find(task =>
          sameObjectId(task.orderId, where?.orderId)
        ) ?? null
      );
    }),
    save: jest.fn(async task => task),
  } as any;
  service.adminWechatPayService = {
    refundOrder: jest.fn().mockResolvedValue({
      out_refund_no: 'RVIP202605020001',
      status: 'SUCCESS',
    }),
    refundVirtualOrder: jest.fn().mockResolvedValue({
      refund_order_id: 'RVIP202605020001',
    }),
    getVirtualPayEnv: jest.fn().mockReturnValue(0),
  } as any;

  return {
    service,
    orders,
    memberships,
    entitlements,
    voiceTrainingTasks,
  };
}

describe('AdminOrderService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists orders with user profile and account fields', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([
      {
        id: ORDER_ID,
        orderNo: 'VIP202605020001',
        userId: USER_ID,
        orderType: OrderType.vipPlan,
        targetCode: 'vip_year',
        title: '一年会员',
        amount: 19900,
        discountAmount: 10000,
        couponAmount: 0,
        payableAmount: 9900,
        currency: 'CNY',
        status: OrderStatus.completed,
        source: OrderSource.weapp,
        paymentProvider: 'wechat_pay',
        paymentTradeNo: '420000000020260502000001',
        createdAt: ORDER_CREATED_AT,
        updatedAt: ORDER_CREATED_AT,
        paidAt: ORDER_CREATED_AT,
      },
    ] as never);
    jest.mocked(service.userModel.find).mockResolvedValue([
      {
        id: USER_ID,
        name: '测试用户',
        avatar: '',
        phone: '13800000000',
      },
    ] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([
      {
        userId: USER_ID,
        account: '13800000000',
      },
    ] as never);

    const result = await service.listOrders({
      keyword: '',
      page: '1',
      pageSize: '20',
    });

    expect(service.orderModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        order: {
          createdAt: 'DESC',
        },
        skip: 0,
        take: 20,
      })
    );
    expect(service.userModel.find).toHaveBeenCalledWith({
      where: {
        $or: [{ id: { $in: [USER_ID] } }, { _id: { $in: [USER_ID] } }],
      },
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: ORDER_ID.toHexString(),
          orderNo: 'VIP202605020001',
          userId: USER_ID.toHexString(),
          user: {
            id: USER_ID.toHexString(),
            account: '13800000000',
            name: '测试用户',
            phone: '13800000000',
          },
          payableAmount: 9900,
          status: OrderStatus.completed,
          source: OrderSource.weapp,
          paymentTradeNo: '420000000020260502000001',
          createdAt: ORDER_CREATED_AT.toISOString(),
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('falls back to _id when joining order users', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([
      {
        id: ORDER_ID,
        orderNo: 'VIP202605020002',
        userId: USER_ID,
        orderType: OrderType.vipPlan,
        title: '一年会员',
        amount: 100,
        discountAmount: 0,
        couponAmount: 0,
        payableAmount: 100,
        currency: 'CNY',
        status: OrderStatus.pending,
        source: OrderSource.weapp,
        createdAt: ORDER_CREATED_AT,
        updatedAt: ORDER_CREATED_AT,
      },
    ] as never);
    jest.mocked(service.userModel.find).mockResolvedValue([
      {
        _id: USER_ID,
        name: 'ID兜底用户',
        avatar: '',
        phone: '13900000000',
      },
    ] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.listOrders({});

    expect(result.items[0].user).toEqual({
      id: USER_ID.toHexString(),
      account: '13900000000',
      name: 'ID兜底用户',
      phone: '13900000000',
    });
  });

  it('combines base filters and keyword filters for order search', async () => {
    const { service } = createService();

    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);
    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      keyword: 'VIP20260502',
      status: OrderStatus.pending,
      source: OrderSource.weapp,
      orderType: OrderType.vipPlan,
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      $and: [
        {
          status: OrderStatus.pending,
          orderType: OrderType.vipPlan,
          source: OrderSource.weapp,
        },
        {
          $or: expect.arrayContaining([
            { orderNo: { $regex: 'VIP20260502', $options: 'i' } },
            { title: { $regex: 'VIP20260502', $options: 'i' } },
            { targetCode: { $regex: 'VIP20260502', $options: 'i' } },
            { paymentTradeNo: { $regex: 'VIP20260502', $options: 'i' } },
          ]),
        },
      ],
    });
  });

  it('filters orders by user id', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      userId: USER_ID.toHexString(),
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      userId: USER_ID,
    });
  });

  it('refunds a completed vip order and revokes membership benefits', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders, memberships, entitlements } = createService();
    const order = createCompletedVipOrder();
    const membership = createMembership();
    const entitlement = createEntitlement();

    orders.push(order);
    memberships.push(membership);
    entitlements.push(entitlement);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledWith({
      orderNo: 'VIP202605020001',
      refundNo: 'RVIP202605020001',
      reason: '管理端退订退款',
      amount: 9900,
      totalAmount: 9900,
    });
    expect(service.userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: UserMembershipStatus.refunded,
        updatedAt: ORDER_CREATED_AT,
      })
    );
    expect(service.agentEntitlementModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentEntitlementStatus.refunded,
        updatedAt: ORDER_CREATED_AT,
      })
    );
    expect(service.orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OrderStatus.refunded,
        refundAmount: 9900,
        refundedAt: ORDER_CREATED_AT,
      })
    );
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(9900);

    jest.useRealTimers();
  });

  it('refunds a virtual payment vip order through xpay', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders, memberships, entitlements } = createService();
    const order = createCompletedVipOrder({
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentEnv: 0,
    });

    orders.push(order);
    memberships.push(createMembership());
    entitlements.push(createEntitlement());
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(service.adminWechatPayService.refundVirtualOrder).toHaveBeenCalledWith({
      openid: 'openid-1',
      orderNo: 'VIP202605020001',
      refundNo: 'RVIP202605020001',
      leftFee: 9900,
      refundFee: 9900,
      reason: '管理端退订退款',
      env: 0,
    });
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(9900);
  });

  it('refunds a voice package order and marks the training task refunded', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders, voiceTrainingTasks } = createService();
    const order = createCompletedVoiceOrder();
    const task = createVoiceTrainingTask();

    orders.push(order);
    voiceTrainingTasks.push(task);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledWith({
      orderNo: 'VOICE202605020001',
      refundNo: 'RVOICE202605020001',
      reason: '管理端退订退款',
      amount: 12900,
      totalAmount: 12900,
    });
    expect(service.voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VoiceTrainingTaskStatus.refunded,
        updatedAt: ORDER_CREATED_AT,
      })
    );
    expect(service.userMembershipModel.save).not.toHaveBeenCalled();
    expect(service.orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OrderStatus.refunded,
        refundAmount: 12900,
        refundedAt: ORDER_CREATED_AT,
      })
    );
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(12900);
  });

  it('rejects voice package refund after the training task is completed', async () => {
    const { service, orders, voiceTrainingTasks } = createService();

    orders.push(createCompletedVoiceOrder());
    voiceTrainingTasks.push(
      createVoiceTrainingTask({
        status: VoiceTrainingTaskStatus.completed,
      })
    );

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'VOICE_PACKAGE_ALREADY_COMPLETED',
    });
    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
  });

  it('rejects refund for pending orders before calling WeChat', async () => {
    const { service, orders } = createService();

    orders.push(
      createCompletedVipOrder({
        status: OrderStatus.pending,
        paidAmount: undefined,
      })
    );

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_NOT_REFUNDABLE',
    });
    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
  });
});
