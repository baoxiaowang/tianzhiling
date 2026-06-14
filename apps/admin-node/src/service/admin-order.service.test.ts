import {
  AgentEntitlementStatus,
  AgentEntitlementType,
  MongoObjectId,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipStatus,
  VirtualGoodsProvideStatus,
  VipPlanStatus,
  VoicePackageStatus,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { AdminOrderService } from './admin-order.service';

const USER_ID = new MongoObjectId('665000000000000000000201');
const ORDER_ID = new MongoObjectId('665000000000000000000301');
const VIP_PLAN_ID = new MongoObjectId('665000000000000000000402');
const AGENT_ID = new MongoObjectId('665000000000000000000405');
const VOICE_PACKAGE_ID = new MongoObjectId('665000000000000000000406');
const OLD_VOICE_TASK_ORDER_ID = new MongoObjectId('665000000000000000000407');
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
    agentId: AGENT_ID,
    orderId: ORDER_ID,
    voicePackageId: VOICE_PACKAGE_ID,
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

function createAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    createdUserId: USER_ID,
    name: '方方',
    avatar: '',
    status: 1,
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createVipPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: VIP_PLAN_ID,
    code: 'vip_year',
    name: '一年会员',
    description: '',
    priceAmount: 9900,
    originalPriceAmount: 19900,
    currency: 'CNY',
    durationDays: 365,
    lifetime: false,
    benefits: [],
    entitlementGrants: [
      {
        type: AgentEntitlementType.voiceModel,
        totalQuota: 1,
        durationDays: 30,
      },
    ],
    status: VipPlanStatus.active,
    sort: 1,
    createdAt: ORDER_CREATED_AT,
    updatedAt: ORDER_CREATED_AT,
    ...overrides,
  };
}

function createVoicePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: VOICE_PACKAGE_ID,
    code: 'voice_standard',
    name: '标准声音套餐',
    description: '',
    priceAmount: 12900,
    originalPriceAmount: 19900,
    currency: 'CNY',
    deliverables: [],
    materialRequirement: '',
    estimatedServiceDays: 7,
    status: VoicePackageStatus.active,
    sort: 1,
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

  service.logger = {
    warn: jest.fn(),
  } as any;
  service.orderModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;
      const orderNo = where?.orderNo;

      return (
        orders.find(order => id && sameObjectId(order.id, id)) ??
        orders.find(order => orderNo && order.orderNo === orderNo) ??
        null
      );
    }),
    save: jest.fn(async order => {
      if (order?.orderNo && !order.id) {
        order.id = ORDER_ID;
      }

      if (order?.orderNo && !orders.includes(order)) {
        orders.push(order);
      }

      return order;
    }),
  } as any;
  service.userModel = {
    find: jest.fn(),
    findOne: jest.fn(),
  } as any;
  service.userAccountModel = {
    find: jest.fn(),
  } as any;
  service.vipPlanModel = {
    findOne: jest.fn(),
  } as any;
  service.voicePackageModel = {
    findOne: jest.fn(),
  } as any;
  service.agentModel = {
    findOne: jest.fn(),
  } as any;
  service.userMembershipModel = {
    find: jest.fn(async ({ where }: any) => {
      return memberships.filter(
        membership =>
          sameObjectId(membership.userId, where?.userId) &&
          (!where?.status || membership.status === where.status)
      );
    }),
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
    findOne: jest.fn(async ({ where }: any) => {
      return (
        entitlements.find(
          entitlement =>
            sameObjectId(entitlement.sourceOrderId, where?.sourceOrderId) &&
            entitlement.type === where?.type
        ) ?? null
      );
    }),
    save: jest.fn(async entitlement => entitlement),
  } as any;
  service.voiceTrainingTaskModel = {
    find: jest.fn(async ({ where }: any) => {
      return voiceTrainingTasks.filter(
        task =>
          sameObjectId(task.agentId, where?.agentId) &&
          (!where?.status?.$in || where.status.$in.includes(task.status))
      );
    }),
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
    queryTransactionByOrderNo: jest.fn(),
    refundOrder: jest.fn().mockResolvedValue({
      out_refund_no: 'RVIP202605020001',
      status: 'SUCCESS',
    }),
    queryVirtualOrder: jest.fn(),
    notifyVirtualGoodsProvided: jest.fn().mockResolvedValue({}),
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

function mockVoicePackageOrderLookups(service: AdminOrderService) {
  const user = {
    id: USER_ID,
    name: '测试用户',
    avatar: '',
    phone: '13800000000',
  };
  const voicePackage = createVoicePackage();
  const agent = createAgent();

  jest.mocked(service.userModel.findOne).mockImplementation(async ({
    where,
  }: any) => {
    const id = where?.id ?? where?._id;

    return id && sameObjectId(id, USER_ID) ? (user as never) : null;
  });
  jest.mocked(service.voicePackageModel.findOne).mockImplementation(async ({
    where,
  }: any) => {
    const id = where?.id ?? where?._id;

    return id && sameObjectId(id, VOICE_PACKAGE_ID)
      ? (voicePackage as never)
      : null;
  });
  jest.mocked(service.agentModel.findOne).mockImplementation(async ({
    where,
  }: any) => {
    const id = where?.id ?? where?._id;

    return id && sameObjectId(id, AGENT_ID) ? (agent as never) : null;
  });
  jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
  jest.mocked(service.userAccountModel.find).mockResolvedValue([
    {
      userId: USER_ID,
      account: '13800000000',
    },
  ] as never);

  return { user, voicePackage, agent };
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

  it('filters orders by created time range and virtual payment type', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      createdAtStart: '2026-05-01T00:00:00.000Z',
      createdAtEnd: '2026-05-02T23:59:59.999Z',
      paymentType: 'virtual',
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      paymentProvider: 'wechat_virtual_pay',
      createdAt: {
        $gte: new Date('2026-05-01T00:00:00.000Z'),
        $lte: new Date('2026-05-02T23:59:59.999Z'),
      },
    });
  });

  it('filters normal payment orders as non virtual payment orders', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      paymentType: 'normal',
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      paymentProvider: { $ne: 'wechat_virtual_pay' },
    });
  });

  it('creates an admin vip order and grants membership benefits', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders } = createService();
    const user = {
      id: USER_ID,
      name: '测试用户',
      avatar: '',
      phone: '13800000000',
    };
    const plan = createVipPlan();

    jest.mocked(service.userModel.findOne).mockImplementation(async ({
      where,
    }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, USER_ID) ? (user as never) : null;
    });
    jest.mocked(service.vipPlanModel.findOne).mockImplementation(async ({
      where,
    }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, VIP_PLAN_ID) ? (plan as never) : null;
    });
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([
      {
        userId: USER_ID,
        account: '13800000000',
      },
    ] as never);

    const result = await service.createOrder({
      orderType: OrderType.vipPlan,
      userId: USER_ID.toHexString(),
      vipPlanId: VIP_PLAN_ID.toHexString(),
    });

    expect(orders[0]).toEqual(
      expect.objectContaining({
        id: ORDER_ID,
        userId: USER_ID,
        orderType: OrderType.vipPlan,
        targetId: VIP_PLAN_ID,
        targetCode: 'vip_year',
        source: OrderSource.admin,
        paymentProvider: 'admin_manual',
        status: OrderStatus.completed,
        paidAmount: 9900,
      })
    );
    expect(service.userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        vipPlanId: VIP_PLAN_ID,
        vipPlanCode: 'vip_year',
        sourceOrderId: ORDER_ID,
        status: UserMembershipStatus.active,
      })
    );
    expect(service.agentEntitlementModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        sourceOrderId: ORDER_ID,
        type: AgentEntitlementType.voiceModel,
        totalQuota: 1,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: ORDER_ID.toHexString(),
        userId: USER_ID.toHexString(),
        source: OrderSource.admin,
        paymentProvider: 'admin_manual',
        status: OrderStatus.completed,
      })
    );

    jest.useRealTimers();
  });

  it('creates an admin voice package order and a training task', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders } = createService();
    const user = {
      id: USER_ID,
      name: '测试用户',
      avatar: '',
      phone: '13800000000',
    };
    const voicePackage = createVoicePackage();
    const agent = createAgent();

    jest.mocked(service.userModel.findOne).mockImplementation(async ({
      where,
    }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, USER_ID) ? (user as never) : null;
    });
    jest.mocked(service.voicePackageModel.findOne).mockImplementation(async ({
      where,
    }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, VOICE_PACKAGE_ID)
        ? (voicePackage as never)
        : null;
    });
    jest.mocked(service.agentModel.findOne).mockImplementation(async ({
      where,
    }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, AGENT_ID) ? (agent as never) : null;
    });
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([
      {
        userId: USER_ID,
        account: '13800000000',
      },
    ] as never);

    const result = await service.createOrder({
      orderType: OrderType.voicePackage,
      userId: USER_ID.toHexString(),
      voicePackageId: VOICE_PACKAGE_ID.toHexString(),
      agentId: AGENT_ID.toHexString(),
    });

    expect(orders[0]).toEqual(
      expect.objectContaining({
        id: ORDER_ID,
        userId: USER_ID,
        orderType: OrderType.voicePackage,
        targetId: VOICE_PACKAGE_ID,
        targetCode: 'voice_standard',
        agentId: AGENT_ID,
        source: OrderSource.admin,
        paymentProvider: 'admin_manual',
        status: OrderStatus.completed,
        paidAmount: 12900,
      })
    );
    expect(service.voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        agentId: AGENT_ID,
        orderId: ORDER_ID,
        voicePackageId: VOICE_PACKAGE_ID,
        voicePackageCode: 'voice_standard',
        status: VoiceTrainingTaskStatus.paid,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: ORDER_ID.toHexString(),
        userId: USER_ID.toHexString(),
        orderType: OrderType.voicePackage,
        source: OrderSource.admin,
        paymentProvider: 'admin_manual',
        status: OrderStatus.completed,
      })
    );

    jest.useRealTimers();
  });

  it('rejects an admin voice package order when the agent has an active training task by default', async () => {
    const { service, voiceTrainingTasks } = createService();
    mockVoicePackageOrderLookups(service);
    voiceTrainingTasks.push(
      createVoiceTrainingTask({
        orderId: OLD_VOICE_TASK_ORDER_ID,
        status: VoiceTrainingTaskStatus.training,
      })
    );

    await expect(
      service.createOrder({
        orderType: OrderType.voicePackage,
        userId: USER_ID.toHexString(),
        voicePackageId: VOICE_PACKAGE_ID.toHexString(),
        agentId: AGENT_ID.toHexString(),
      })
    ).rejects.toMatchObject({
      code: 'VOICE_TRAINING_TASK_EXISTS',
    });
    expect(service.orderModel.save).not.toHaveBeenCalled();
  });

  it('replaces active voice training tasks when creating an admin voice package order with override enabled', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, voiceTrainingTasks } = createService();
    mockVoicePackageOrderLookups(service);
    const oldTask = createVoiceTrainingTask({
      orderId: OLD_VOICE_TASK_ORDER_ID,
      status: VoiceTrainingTaskStatus.processing,
      remark: '旧任务备注',
    });
    voiceTrainingTasks.push(oldTask);

    const result = await service.createOrder({
      orderType: OrderType.voicePackage,
      userId: USER_ID.toHexString(),
      voicePackageId: VOICE_PACKAGE_ID.toHexString(),
      agentId: AGENT_ID.toHexString(),
      replaceActiveVoiceTrainingTask: true,
    });

    expect(service.voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        status: VoiceTrainingTaskStatus.paid,
      })
    );
    expect(service.voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: oldTask.id,
        status: VoiceTrainingTaskStatus.failed,
        remark: expect.stringContaining('管理端创建新声音套餐订单时覆盖关闭'),
      })
    );
    expect(oldTask.remark).toContain('旧任务备注');
    expect(result.status).toBe(OrderStatus.completed);

    jest.useRealTimers();
  });

  it('syncs a pending vip order from WeChat and grants membership benefits', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders } = createService();
    const order = createCompletedVipOrder({
      status: OrderStatus.pending,
      paidAmount: undefined,
      paymentTradeNo: undefined,
      paidAt: undefined,
      snapshot: {
        vipPlan: {
          id: '665000000000000000000402',
          code: 'vip_year',
          durationDays: 365,
          lifetime: false,
          entitlementGrants: [
            {
              type: AgentEntitlementType.voiceModel,
              totalQuota: 1,
              durationDays: 30,
            },
          ],
        },
      },
    });

    orders.push(order);
    jest
      .mocked(service.adminWechatPayService.queryTransactionByOrderNo)
      .mockResolvedValue({
        out_trade_no: 'VIP202605020001',
        transaction_id: '420000000020260502999999',
        trade_state: 'SUCCESS',
        success_time: '2026-05-02T08:05:00+08:00',
        amount: {
          total: 9900,
          payer_total: 9876,
        },
      } as never);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.syncPaymentStatus(ORDER_ID.toHexString());

    expect(
      service.adminWechatPayService.queryTransactionByOrderNo
    ).toHaveBeenCalledWith('VIP202605020001');
    expect(service.userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        vipPlanCode: 'vip_year',
        sourceOrderId: ORDER_ID,
        status: UserMembershipStatus.active,
        lifetime: false,
      })
    );
    expect(service.agentEntitlementModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        type: AgentEntitlementType.voiceModel,
        totalQuota: 1,
        status: AgentEntitlementStatus.available,
        sourceOrderId: ORDER_ID,
      })
    );
    expect(order.status).toBe(OrderStatus.completed);
    expect(order.paidAmount).toBe(9900);
    expect(order.paymentTradeNo).toBe('420000000020260502999999');
    expect(result.status).toBe(OrderStatus.completed);

    jest.useRealTimers();
  });

  it('returns amount mismatch details when WeChat paid amount differs from local order amount', async () => {
    const { service, orders } = createService();
    const order = createCompletedVipOrder({
      status: OrderStatus.pending,
      paidAmount: undefined,
      payableAmount: 12900,
      paymentTradeNo: undefined,
      paidAt: undefined,
    });

    orders.push(order);
    jest
      .mocked(service.adminWechatPayService.queryTransactionByOrderNo)
      .mockResolvedValue({
        out_trade_no: 'VIP202605020001',
        transaction_id: '420000000020260502999999',
        trade_state: 'SUCCESS',
        success_time: '2026-05-02T08:05:00+08:00',
        amount: {
          total: 9900,
          payer_total: 9876,
        },
      } as never);

    await expect(
      service.syncPaymentStatus(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'WECHAT_AMOUNT_MISMATCH',
      data: expect.objectContaining({
        orderId: ORDER_ID.toHexString(),
        orderNo: 'VIP202605020001',
        expectedAmount: 12900,
        actualAmount: 9900,
        wechatTotal: 9900,
        wechatPayerTotal: 9876,
        transactionId: '420000000020260502999999',
      }),
    });
    expect(service.logger.warn).toHaveBeenCalled();
  });

  it('notifies virtual goods delivery for a completed local order when WeChat is still pending provide', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders } = createService();
    const order = createCompletedVipOrder({
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentEnv: 0,
      virtualGoodsProvidedAt: undefined,
    });

    orders.push(order);
    jest.mocked(service.adminWechatPayService.queryVirtualOrder).mockResolvedValue({
      order_id: 'VIP202605020001',
      status: 2,
      paid_fee: 9900,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-admin-1',
    } as never);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.syncPaymentStatus(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.queryVirtualOrder).toHaveBeenCalledWith({
      openid: 'openid-1',
      orderNo: 'VIP202605020001',
      env: 0,
    });
    expect(
      service.adminWechatPayService.notifyVirtualGoodsProvided
    ).toHaveBeenCalledWith({
      orderNo: 'VIP202605020001',
      wxOrderId: 'wxpay-virtual-admin-1',
      env: 0,
    });
    expect((order as any).virtualGoodsProvidedAt).toEqual(ORDER_CREATED_AT);
    expect((order as any).virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.provided
    );
    expect(result.status).toBe(OrderStatus.completed);
    expect(result.virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.provided
    );
    expect(result.virtualGoodsProvidedAt).toBe('2026-05-02T08:00:00.000Z');

    jest.useRealTimers();
  });

  it('returns virtual goods delivery failure when WeChat provide notify fails', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders } = createService();
    const order = createCompletedVipOrder({
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentEnv: 0,
      virtualGoodsProvidedAt: undefined,
    });

    orders.push(order);
    jest.mocked(service.adminWechatPayService.queryVirtualOrder).mockResolvedValue({
      order_id: 'VIP202605020001',
      status: 2,
      paid_fee: 9900,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-admin-2',
    } as never);
    jest
      .mocked(service.adminWechatPayService.notifyVirtualGoodsProvided)
      .mockRejectedValue(new Error('bad signature') as never);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.syncPaymentStatus(ORDER_ID.toHexString());

    expect(
      service.adminWechatPayService.notifyVirtualGoodsProvided
    ).toHaveBeenCalledWith({
      orderNo: 'VIP202605020001',
      wxOrderId: 'wxpay-virtual-admin-2',
      env: 0,
    });
    expect((order as any).virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.failed
    );
    expect((order as any).virtualGoodsProvidedAt).toBeUndefined();
    expect((order as any).virtualGoodsProvideFailedAt).toEqual(
      ORDER_CREATED_AT
    );
    expect((order as any).virtualGoodsProvideError).toBe('bad signature');
    expect(result.status).toBe(OrderStatus.completed);
    expect(result.virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.failed
    );
    expect(result.virtualGoodsProvidedAt).toBeUndefined();
    expect(result.virtualGoodsProvideFailedAt).toBe(
      '2026-05-02T08:00:00.000Z'
    );
    expect(result.virtualGoodsProvideError).toBe('bad signature');

    jest.useRealTimers();
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

  it('refunds a refund requested vip order and revokes membership benefits', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders, memberships, entitlements } = createService();
    const order = createCompletedVipOrder({
      status: OrderStatus.refundRequested,
    });
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
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(9900);

    jest.useRealTimers();
  });

  it('refunds an admin manual vip order without calling WeChat', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders, memberships, entitlements } = createService();
    const order = createCompletedVipOrder({
      source: OrderSource.admin,
      paymentProvider: 'admin_manual',
    });

    orders.push(order);
    memberships.push(createMembership());
    entitlements.push(createEntitlement());
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).not.toHaveBeenCalled();
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(9900);
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
