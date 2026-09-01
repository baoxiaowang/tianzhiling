import {
  AgentEntitlementStatus,
  AgentEntitlementType,
  MongoObjectId,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipStatus,
  VirtualGoodsProvideStatus,
  VipPlanGroup,
  VipPlanStatus,
  VoicePackageStatus,
  VoiceTrainingTaskStatus,
  VoiceTrainingTaskTrainingStrategy,
} from '@tzl/entities';
import { AppError } from '@tzl/shared';
import { AdminOrderService } from './admin-order.service';

const USER_ID = new MongoObjectId('665000000000000000000201');
const ORDER_ID = new MongoObjectId('665000000000000000000301');
const VIP_PLAN_ID = new MongoObjectId('665000000000000000000402');
const BASIC_VIP_PLAN_ID = new MongoObjectId('665000000000000000000408');
const AGENT_ID = new MongoObjectId('665000000000000000000405');
const VOICE_PACKAGE_ID = new MongoObjectId('665000000000000000000406');
const OLD_VOICE_TASK_ORDER_ID = new MongoObjectId('665000000000000000000407');
const ORDER_CREATED_AT = new Date('2026-05-02T08:00:00.000Z');

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function getNestedValue(target: any, path: string): any {
  return path.split('.').reduce((value, key) => value?.[key], target);
}

function setNestedValue(target: any, path: string, value: unknown): void {
  const keys = path.split('.');
  const finalKey = keys.pop() as string;
  const parent = keys.reduce((current, key) => {
    current[key] ??= {};
    return current[key];
  }, target);

  parent[finalKey] = value;
}

function unsetNestedValue(target: any, path: string): void {
  const keys = path.split('.');
  const finalKey = keys.pop() as string;
  const parent = keys.reduce((current, key) => current?.[key], target);

  if (parent) {
    delete parent[finalKey];
  }
}

function cloneMongoValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof MongoObjectId) {
    return new MongoObjectId(value.toHexString()) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => cloneMongoValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      cloned[key] = cloneMongoValue(item);
    }

    return cloned as T;
  }

  return value;
}

function matchesMongoValue(actual: any, expected: any): boolean {
  if (expected && typeof expected === 'object' && !expected.toHexString) {
    if ('$exists' in expected) {
      return expected.$exists ? actual !== undefined : actual === undefined;
    }

    if ('$in' in expected) {
      return expected.$in.some((value: unknown) =>
        matchesMongoValue(actual, value)
      );
    }

    if ('$ne' in expected) {
      return !matchesMongoValue(actual, expected.$ne);
    }

    if ('$lte' in expected) {
      return actual <= expected.$lte;
    }

    if ('$lt' in expected) {
      return actual < expected.$lt;
    }

    if ('$gte' in expected) {
      return actual >= expected.$gte;
    }

    if ('$gt' in expected) {
      return actual > expected.$gt;
    }

    if ('$nin' in expected) {
      return !expected.$nin.some((value: unknown) =>
        matchesMongoValue(actual, value)
      );
    }
  }

  if (actual?.toHexString || expected?.toHexString) {
    return sameObjectId(actual, expected);
  }

  return actual === expected;
}

function matchesMongoFilter(record: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([path, expected]) => {
    if (path === '$or') {
      return expected.some((item: Record<string, any>) =>
        matchesMongoFilter(record, item)
      );
    }

    const actual =
      path === '_id' || path === 'id'
        ? record.id ?? record._id
        : getNestedValue(record, path);

    return matchesMongoValue(actual, expected);
  });
}

function applyMongoUpdate(record: any, update: Record<string, any>): void {
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    setNestedValue(record, path, cloneMongoValue(value));
  }

  for (const path of Object.keys(update.$unset ?? {})) {
    unsetNestedValue(record, path);
  }

  for (const [path, value] of Object.entries(update.$inc ?? {})) {
    setNestedValue(
      record,
      path,
      (getNestedValue(record, path) ?? 0) + Number(value)
    );
  }
}

function createCompletedVipOrder(overrides: Record<string, unknown> = {}): any {
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

function createAgent(overrides: Record<string, unknown> = {}): any {
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

function createVipPlan(overrides: Record<string, unknown> = {}): any {
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

function createVoiceVipPlan(overrides: Record<string, unknown> = {}) {
  return createVipPlan({
    code: 'vip_year_voice',
    name: '声音版年会员',
    planGroup: VipPlanGroup.voice,
    priceAmount: 19900,
    originalPriceAmount: 19900,
    ...overrides,
  });
}

function createBasicVipPlan(overrides: Record<string, unknown> = {}) {
  return createVipPlan({
    id: BASIC_VIP_PLAN_ID,
    code: 'vip_year_basic',
    name: '基础版年会员',
    planGroup: VipPlanGroup.basic,
    priceAmount: 12900,
    originalPriceAmount: 12900,
    entitlementGrants: [],
    ...overrides,
  });
}

function createService() {
  const service = new AdminOrderService();
  const orders: any[] = [];
  const users: any[] = [{ id: USER_ID }];
  const memberships: any[] = [];
  const entitlements: any[] = [];
  const voiceTrainingTasks: any[] = [];
  const voiceServiceSessions: any[] = [];

  service.logger = {
    warn: jest.fn(),
  } as any;
  service.orderModel = {
    count: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;
      const orderNo = where?.orderNo;

      const order =
        orders.find(order => id && sameObjectId(order.id, id)) ??
        orders.find(order => orderNo && order.orderNo === orderNo) ??
        null;

      return order ? cloneMongoValue(order) : null;
    }),
    save: jest.fn(async order => {
      if (order?.orderNo && !order.id) {
        order.id = ORDER_ID;
      }

      if (order?.orderNo) {
        const stored = orders.find(
          item =>
            (order.id && sameObjectId(item.id, order.id)) ||
            item.orderNo === order.orderNo
        );

        if (stored) {
          Object.assign(stored, cloneMongoValue(order));
        } else {
          orders.push(cloneMongoValue(order));
        }
      }

      return order;
    }),
    updateOne: jest.fn(async (filter: any, update: any) => {
      const order = orders.find(item => matchesMongoFilter(item, filter));

      if (!order) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      applyMongoUpdate(order, update);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  } as any;
  service.userModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(async (filter: any, update: any) => {
      const user = users.find(item => matchesMongoFilter(item, filter));

      if (!user) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      applyMongoUpdate(user, update);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  } as any;
  service.userAccountModel = {
    find: jest.fn(),
  } as any;
  service.vipPlanModel = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
  } as any;
  service.voicePackageModel = {
    findOne: jest.fn(),
  } as any;
  service.agentModel = {
    findOne: jest.fn(),
    save: jest.fn(async agent => agent),
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
          where?.sourceOrderId
            ? sameObjectId(membership.sourceOrderId, where.sourceOrderId)
            : where?._id || where?.id
            ? sameObjectId(membership.id, where._id ?? where.id)
            : false
        ) ?? null
      );
    }),
    updateOne: jest.fn(async (filter: any, update: any) => {
      const membership = memberships.find(item =>
        matchesMongoFilter(item, filter)
      );

      if (!membership) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      applyMongoUpdate(membership, update);
      return { matchedCount: 1, modifiedCount: 1 };
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
    updateOne: jest.fn(async (filter: any, update: any) => {
      const entitlement = entitlements.find(item =>
        matchesMongoFilter(item, filter)
      );

      if (!entitlement) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      applyMongoUpdate(entitlement, update);
      return { matchedCount: 1, modifiedCount: 1 };
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
  service.voiceServiceSessionModel = {
    find: jest.fn(async ({ where }: any) => {
      return voiceServiceSessions.filter(
        session =>
          sameObjectId(session.userId, where?.userId) &&
          (!where?.voiceAccessReferenceId ||
            session.voiceAccessReferenceId === where.voiceAccessReferenceId)
      );
    }),
    save: jest.fn(async session => session),
  } as any;
  service.adminWechatPayService = {
    queryTransactionByOrderNo: jest.fn(),
    refundOrder: jest.fn().mockResolvedValue({
      out_refund_no: 'RVIP202605020001',
      status: 'SUCCESS',
    }),
    queryRefundByRefundNo: jest.fn(),
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
    users,
    memberships,
    entitlements,
    voiceTrainingTasks,
    voiceServiceSessions,
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

  jest
    .mocked(service.userModel.findOne)
    .mockImplementation(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, USER_ID) ? (user as never) : null;
    });
  jest
    .mocked(service.voicePackageModel.findOne)
    .mockImplementation(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, VOICE_PACKAGE_ID)
        ? (voicePackage as never)
        : null;
    });
  jest
    .mocked(service.agentModel.findOne)
    .mockImplementation(async ({ where }: any) => {
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

function mockVoiceMembershipDowngradeLookups(
  service: AdminOrderService,
  orders: any[],
  memberships: any[]
) {
  const voicePlan = createVoiceVipPlan();
  const basicPlan = createBasicVipPlan();
  const order = createCompletedVipOrder({
    targetId: VIP_PLAN_ID,
    targetCode: voicePlan.code,
    title: voicePlan.name,
    amount: 19900,
    payableAmount: 19900,
    paidAmount: 19900,
    snapshot: {
      vipPlan: {
        id: String(voicePlan.id),
        code: voicePlan.code,
        name: voicePlan.name,
        planGroup: voicePlan.planGroup,
        priceAmount: voicePlan.priceAmount,
        currency: voicePlan.currency,
        durationDays: voicePlan.durationDays,
        lifetime: voicePlan.lifetime,
        entitlementGrants: voicePlan.entitlementGrants,
      },
      vipUpgrade: {
        historicalPaidAmount: 0,
        deductedAmount: 0,
        payableAmount: 19900,
      },
    },
  });
  const membership = createMembership({
    vipPlanId: VIP_PLAN_ID,
    vipPlanCode: voicePlan.code,
  });

  orders.push(order);
  memberships.push(membership);
  jest
    .mocked(service.vipPlanModel.find)
    .mockResolvedValue([voicePlan, basicPlan] as never);
  jest
    .mocked(service.vipPlanModel.findOne)
    .mockImplementation(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      if (id && sameObjectId(id, VIP_PLAN_ID)) {
        return voicePlan as never;
      }

      if (id && sameObjectId(id, BASIC_VIP_PLAN_ID)) {
        return basicPlan as never;
      }

      return null;
    });
  jest.mocked(service.userModel.find).mockResolvedValue([] as never);
  jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

  return { order, membership, voicePlan, basicPlan };
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

  it('filters orders by the user registration month in Beijing time', async () => {
    const { service } = createService();

    jest
      .mocked(service.userModel.find)
      .mockResolvedValueOnce([{ id: USER_ID }] as never);
    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({ registeredMonth: '2026-06' });

    expect(service.userModel.find).toHaveBeenCalledWith({
      where: {
        createdAt: {
          $gte: new Date('2026-05-31T16:00:00.000Z'),
          $lt: new Date('2026-06-30T16:00:00.000Z'),
        },
      },
    });
    expect(service.orderModel.count).toHaveBeenCalledWith({
      userId: { $in: [USER_ID] },
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

  it('excludes admin manual orders when requested', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      status: OrderStatus.refundRequested,
      excludeAdminManual: true,
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      status: OrderStatus.refundRequested,
      paymentProvider: { $ne: 'admin_manual' },
    });
  });

  it('excludes admin manual orders from normal payment filters when requested', async () => {
    const { service } = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      paymentType: 'normal',
      excludeAdminManual: 'true',
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      paymentProvider: { $nin: ['wechat_virtual_pay', 'admin_manual'] },
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

    jest
      .mocked(service.userModel.findOne)
      .mockImplementation(async ({ where }: any) => {
        const id = where?.id ?? where?._id;

        return id && sameObjectId(id, USER_ID) ? (user as never) : null;
      });
    jest
      .mocked(service.vipPlanModel.findOne)
      .mockImplementation(async ({ where }: any) => {
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

    jest
      .mocked(service.userModel.findOne)
      .mockImplementation(async ({ where }: any) => {
        const id = where?.id ?? where?._id;

        return id && sameObjectId(id, USER_ID) ? (user as never) : null;
      });
    jest
      .mocked(service.voicePackageModel.findOne)
      .mockImplementation(async ({ where }: any) => {
        const id = where?.id ?? where?._id;

        return id && sameObjectId(id, VOICE_PACKAGE_ID)
          ? (voicePackage as never)
          : null;
      });
    jest
      .mocked(service.agentModel.findOne)
      .mockImplementation(async ({ where }: any) => {
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
        trainingStrategy: VoiceTrainingTaskTrainingStrategy.shortSample,
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

  it('does not replay payment grants while a refund is requested', async () => {
    const { service, orders } = createService();
    const order = createCompletedVipOrder({
      status: OrderStatus.refundRequested,
    });

    orders.push(order);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.syncPaymentStatus(ORDER_ID.toHexString());

    expect(
      service.adminWechatPayService.queryTransactionByOrderNo
    ).not.toHaveBeenCalled();
    expect(service.userMembershipModel.save).not.toHaveBeenCalled();
    expect(service.orderModel.save).not.toHaveBeenCalled();
    expect(result.status).toBe(OrderStatus.refundRequested);
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
    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValue({
        order_id: 'VIP202605020001',
        status: 2,
        paid_fee: 9900,
        paid_time: 1777600000,
        wxpay_order_id: 'wxpay-virtual-admin-1',
      } as never);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.syncPaymentStatus(ORDER_ID.toHexString());

    expect(
      service.adminWechatPayService.queryVirtualOrder
    ).toHaveBeenCalledWith({
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
    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValue({
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
    expect(result.virtualGoodsProvideFailedAt).toBe('2026-05-02T08:00:00.000Z');
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
    expect(service.userMembershipModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrderId: ORDER_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: UserMembershipStatus.refunded,
          updatedAt: ORDER_CREATED_AT,
        }),
      })
    );
    expect(service.agentEntitlementModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrderId: ORDER_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: AgentEntitlementStatus.refunded,
          updatedAt: ORDER_CREATED_AT,
        }),
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
    expect(service.userMembershipModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrderId: ORDER_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: UserMembershipStatus.refunded,
          updatedAt: ORDER_CREATED_AT,
        }),
      })
    );
    expect(service.agentEntitlementModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrderId: ORDER_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: AgentEntitlementStatus.refunded,
          updatedAt: ORDER_CREATED_AT,
        }),
      })
    );
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(9900);

    jest.useRealTimers();
  });

  it('rejects refund for admin manual vip orders', async () => {
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

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_REFUND_PROVIDER_UNSUPPORTED',
      status: 400,
    });

    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).not.toHaveBeenCalled();
    expect(service.userMembershipModel.save).not.toHaveBeenCalled();
    expect(service.agentEntitlementModel.save).not.toHaveBeenCalled();
    expect(service.orderModel.save).not.toHaveBeenCalled();
  });

  it('revokes an admin manual vip order without calling payment refund', async () => {
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

    const result = await service.revokeAdminManualOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).not.toHaveBeenCalled();
    expect(service.userMembershipModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrderId: ORDER_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: UserMembershipStatus.refunded,
          updatedAt: ORDER_CREATED_AT,
        }),
      })
    );
    expect(service.agentEntitlementModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrderId: ORDER_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: AgentEntitlementStatus.refunded,
          updatedAt: ORDER_CREATED_AT,
        }),
      })
    );
    expect(service.orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OrderStatus.closed,
        closedAt: ORDER_CREATED_AT,
      })
    );
    expect(result.status).toBe(OrderStatus.closed);
    expect(result.refundAmount).toBeUndefined();
    expect(result.closedAt).toBe(ORDER_CREATED_AT.toISOString());
  });

  it('rejects revoke for payment orders', async () => {
    const { service, orders } = createService();

    orders.push(createCompletedVipOrder());

    await expect(
      service.revokeAdminManualOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_REVOKE_PROVIDER_UNSUPPORTED',
      status: 400,
    });
    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(service.orderModel.save).not.toHaveBeenCalled();
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
    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).toHaveBeenCalledWith({
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

  it('previews the exact price difference for a same-period basic plan', async () => {
    const { service, orders, memberships } = createService();

    mockVoiceMembershipDowngradeLookups(service, orders, memberships);

    const result = await service.getVoiceMembershipDowngradePreview(
      ORDER_ID.toHexString()
    );

    expect(result).toMatchObject({
      eligible: true,
      paidAmount: 19900,
      sourcePlan: {
        planGroup: VipPlanGroup.voice,
      },
      targetPlans: [
        {
          id: BASIC_VIP_PLAN_ID.toHexString(),
          planGroup: VipPlanGroup.basic,
          refundAmount: 7000,
        },
      ],
    });
  });

  it('treats legacy voice bundle titles like 三年会员+声音模型 as voice plans', async () => {
    const { service, orders, memberships } = createService();
    const { order, basicPlan } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.targetId = BASIC_VIP_PLAN_ID;
    order.targetCode = 'vip_master';
    order.title = '三年会员+声音模型';
    order.snapshot.vipPlan = {
      id: String(basicPlan.id),
      code: 'vip_master',
      name: '三年会员+声音模型',
      priceAmount: 29900,
      currency: 'CNY',
      durationDays: order.snapshot.vipPlan.durationDays,
      lifetime: false,
      voicePackageId: null,
      voicePackageCode: null,
      entitlementGrants: [],
    };

    const result = await service.getVoiceMembershipDowngradePreview(
      ORDER_ID.toHexString()
    );

    expect(result.eligible).toBe(true);
    expect(result.sourcePlan?.planGroup).toBe(VipPlanGroup.voice);
  });

  it('refunds the paid difference when the voice plan was an upgrade', async () => {
    const { service, orders, memberships } = createService();
    const { order } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.payableAmount = 7000;
    order.paidAmount = 7000;
    order.snapshot.vipUpgrade = {
      historicalPaidAmount: 12900,
      deductedAmount: 12900,
      payableAmount: 7000,
    };

    const result = await service.getVoiceMembershipDowngradePreview(
      ORDER_ID.toHexString()
    );

    expect(result.eligible).toBe(true);
    expect(result.targetPlans).toEqual([
      expect.objectContaining({
        id: BASIC_VIP_PLAN_ID.toHexString(),
        refundAmount: 7000,
      }),
    ]);
  });

  it('blocks starting a downgrade when a pending upgrade already uses historical payment', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );
    const pendingUpgrade = createCompletedVipOrder({
      id: new MongoObjectId('665000000000000000000499'),
      orderNo: 'VIP202605020002',
      status: OrderStatus.pending,
      createdAt: new Date(ORDER_CREATED_AT.getTime() + 1000),
      snapshot: {
        vipPlan: order.snapshot.vipPlan,
        vipUpgrade: {
          historicalPaidAmount: 19900,
          deductedAmount: 19900,
          payableAmount: 10000,
        },
      },
    });
    jest
      .mocked(service.orderModel.find)
      .mockResolvedValue([pendingUpgrade] as never);

    await expect(
      service.downgradeVoiceMembership(
        ORDER_ID.toHexString(),
        { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
        {
          sub: 'admin-1',
          account: 'operator',
          roles: ['admin'],
          iat: 0,
          exp: 1,
          nonce: 'nonce',
        }
      )
    ).rejects.toMatchObject({
      code: 'ORDER_REFUND_USED_BY_NEWER_UPGRADE',
      status: 409,
    });
    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(order.snapshot.voiceMembershipDowngrade).toBeUndefined();
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('does not start a downgrade while another membership financial operation holds the user lock', async () => {
    const { service, orders, users, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );
    users[0].membershipFinancialOperationLock = {
      token: 'upgrade-create-token',
      operation: 'vip_upgrade_order_create',
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(
      service.downgradeVoiceMembership(
        ORDER_ID.toHexString(),
        { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
        {
          sub: 'admin-1',
          account: 'operator',
          roles: ['admin'],
          iat: 0,
          exp: 1,
          nonce: 'nonce',
        }
      )
    ).rejects.toMatchObject({
      code: 'MEMBERSHIP_FINANCIAL_OPERATION_BUSY',
      status: 409,
    });
    expect(service.adminWechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(order.snapshot.voiceMembershipDowngrade).toBeUndefined();
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('partially refunds, keeps the membership period, and revokes linked voice access', async () => {
    const { service, orders, memberships, entitlements, voiceServiceSessions } =
      createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );
    const originalStartedAt = membership.startedAt;
    const originalExpiredAt = membership.expiredAt;
    const entitlement = createEntitlement();
    const timbreId = new MongoObjectId('665000000000000000000409');
    const agent = createAgent({ voiceTimbreId: timbreId });
    const session = {
      id: new MongoObjectId('665000000000000000000410'),
      userId: USER_ID,
      voiceTimbreId: timbreId,
      selectedAgentId: AGENT_ID,
      voiceBoundAgentIds: [AGENT_ID],
      voiceAccessSource: 'voice_membership_order',
      voiceAccessReferenceId: ORDER_ID.toHexString(),
      voiceBindingStatus: 'bound',
      events: [],
      createdAt: ORDER_CREATED_AT,
      updatedAt: ORDER_CREATED_AT,
    };

    entitlements.push(entitlement);
    voiceServiceSessions.push(session);
    jest.mocked(service.agentModel.findOne).mockResolvedValue(agent as never);

    const result = await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledWith({
      orderNo: order.orderNo,
      refundNo: `VD${order.orderNo}`,
      reason: '声音版会员降级为基础版',
      amount: 7000,
      totalAmount: 19900,
    });
    expect(result.status).toBe(OrderStatus.completed);
    expect(result.refundAmount).toBe(7000);
    expect(result.voiceMembershipDowngrade).toMatchObject({
      status: 'completed',
      refundAmount: 7000,
      operatorAccount: 'operator',
    });
    expect(membership).toMatchObject({
      vipPlanId: BASIC_VIP_PLAN_ID,
      vipPlanCode: 'vip_year_basic',
      startedAt: originalStartedAt,
      expiredAt: originalExpiredAt,
      status: UserMembershipStatus.active,
    });
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
    expect(agent.voiceTimbreId).toBeNull();
    expect(session).toMatchObject({
      voiceBindingStatus: 'purchase_required',
      voiceAccessRevokedReferenceId: ORDER_ID.toHexString(),
    });
  });

  it('downgrades and then fully refunds a WeChat virtual payment membership', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.paymentProvider = 'wechat_virtual_pay';
    order.payerOpenid = 'virtual-openid-1';
    order.virtualPaymentEnv = 0;
    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 19900,
      } as never)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 12900,
      } as never);

    const downgraded = await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).toHaveBeenNthCalledWith(1, {
      openid: 'virtual-openid-1',
      orderNo: order.orderNo,
      refundNo: `VD${order.orderNo}`,
      leftFee: 19900,
      refundFee: 7000,
      reason: '声音版会员降级为基础版',
      env: 0,
    });
    expect(downgraded.voiceMembershipDowngrade?.status).toBe('completed');
    expect(downgraded.refundAmount).toBe(7000);
    expect(membership.vipPlanId).toEqual(BASIC_VIP_PLAN_ID);

    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 12900,
      } as never)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 5,
        paid_fee: 19900,
        left_fee: 0,
      } as never);

    const refunded = await service.refundOrder(ORDER_ID.toHexString());

    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).toHaveBeenNthCalledWith(2, {
      openid: 'virtual-openid-1',
      orderNo: order.orderNo,
      refundNo: `R${order.orderNo}`,
      leftFee: 12900,
      refundFee: 12900,
      reason: '管理端退订退款',
      env: 0,
    });
    expect(refunded.status).toBe(OrderStatus.refunded);
    expect(refunded.refundAmount).toBe(19900);
    expect(refunded.voiceMembershipFinalRefund?.status).toBe('completed');
    expect(membership.status).toBe(UserMembershipStatus.refunded);
  });

  it('reconciles an in-progress WeChat virtual downgrade before changing benefits', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.paymentProvider = 'wechat_virtual_pay';
    order.payerOpenid = 'virtual-openid-2';
    order.virtualPaymentEnv = 0;
    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 19900,
      } as never)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 19900,
      } as never);
    jest
      .mocked(service.adminWechatPayService.refundVirtualOrder)
      .mockRejectedValueOnce(
        new AppError('WECHAT_VIRTUAL_PAY_API_FAILED', '退款操作进行中', 502, {
          errcode: 268490014,
        }) as never
      );

    const processing = await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(processing.voiceMembershipDowngrade?.status).toBe('processing');
    expect(processing.refundAmount).toBeUndefined();
    expect(membership.vipPlanId).toEqual(VIP_PLAN_ID);

    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 12900,
      } as never);

    const completed = await service.syncVoiceMembershipDowngrade(
      ORDER_ID.toHexString(),
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(completed.voiceMembershipDowngrade?.status).toBe('completed');
    expect(completed.refundAmount).toBe(7000);
    expect(membership.vipPlanId).toEqual(BASIC_VIP_PLAN_ID);
    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).toHaveBeenCalledTimes(1);
  });

  it('keeps a downgraded virtual membership active until the final refund is confirmed', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.paymentProvider = 'wechat_virtual_pay';
    order.payerOpenid = 'virtual-openid-3';
    order.virtualPaymentEnv = 0;
    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 19900,
      } as never)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 12900,
      } as never);
    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 12900,
      } as never)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 4,
        paid_fee: 19900,
        left_fee: 12900,
      } as never);

    const processing = await service.refundOrder(ORDER_ID.toHexString());

    expect(processing.status).toBe(OrderStatus.refundRequested);
    expect(processing.voiceMembershipFinalRefund?.status).toBe('processing');
    expect(membership.status).toBe(UserMembershipStatus.active);

    jest
      .mocked(service.adminWechatPayService.queryVirtualOrder)
      .mockResolvedValueOnce({
        order_id: order.orderNo,
        status: 5,
        paid_fee: 19900,
        left_fee: 0,
      } as never);

    const completed = await service.refundOrder(ORDER_ID.toHexString());

    expect(completed.status).toBe(OrderStatus.refunded);
    expect(completed.refundAmount).toBe(19900);
    expect(completed.voiceMembershipFinalRefund?.status).toBe('completed');
    expect(membership.status).toBe(UserMembershipStatus.refunded);
    expect(
      service.adminWechatPayService.refundVirtualOrder
    ).toHaveBeenCalledTimes(2);
  });

  it('releases the exact downgrade benefits token when post-claim bookkeeping fails', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );
    const updateOne = jest.mocked(service.orderModel.updateOne);
    const applyUpdate = updateOne.getMockImplementation() as (
      filter: unknown,
      update: unknown
    ) => Promise<unknown>;
    let updateCall = 0;

    updateOne.mockImplementation(async (filter: any, update: any) => {
      updateCall += 1;

      if (updateCall === 3) {
        throw new Error('refund bookkeeping unavailable');
      }

      return applyUpdate(filter, update) as never;
    });

    const failed = await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(failed.voiceMembershipDowngrade).toMatchObject({
      status: 'benefits_failed',
      wechatRefundStatus: 'SUCCESS',
      failureReason: 'refund bookkeeping unavailable',
    });
    expect(
      order.snapshot.voiceMembershipDowngrade.benefitsApplyToken
    ).toBeUndefined();
    expect(order.refundAmount).toBeUndefined();
    expect(membership.vipPlanId).toEqual(VIP_PLAN_ID);

    updateOne.mockImplementation(applyUpdate as never);
    jest
      .mocked(service.adminWechatPayService.queryRefundByRefundNo)
      .mockResolvedValueOnce({
        refund_id: '500000000000000007',
        out_refund_no: `VD${order.orderNo}`,
        status: 'SUCCESS',
      });

    const recovered = await service.syncVoiceMembershipDowngrade(
      ORDER_ID.toHexString(),
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(recovered.voiceMembershipDowngrade?.status).toBe('completed');
    expect(recovered.refundAmount).toBe(7000);
    expect(membership.vipPlanId).toEqual(BASIC_VIP_PLAN_ID);
  });

  it('refunds the remaining amount after a completed downgrade and revokes membership', async () => {
    jest.useFakeTimers().setSystemTime(ORDER_CREATED_AT);
    const { service, orders, memberships, entitlements } = createService();
    const { order, membership, basicPlan } =
      mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(order.refundAmount).toBe(7000);
    expect(membership.status).toBe(UserMembershipStatus.active);
    expect(entitlement.status).toBe(AgentEntitlementStatus.available);

    order.status = OrderStatus.refundRequested;
    const result = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).toHaveBeenNthCalledWith(
      2,
      {
        orderNo: order.orderNo,
        refundNo: `R${order.orderNo}`,
        reason: '管理端退订退款',
        amount: 12900,
        totalAmount: 19900,
      }
    );
    expect(membership.status).toBe(UserMembershipStatus.refunded);
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
    expect(result.status).toBe(OrderStatus.refunded);
    expect(result.refundAmount).toBe(19900);
    expect(result.voiceMembershipFinalRefund?.status).toBe('completed');

    membership.status = UserMembershipStatus.active;
    entitlement.status = AgentEntitlementStatus.available;
    await service.refundOrder(ORDER_ID.toHexString());
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(2);
    expect(membership.status).toBe(UserMembershipStatus.refunded);
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
    expect(order.snapshot.voiceMembershipFinalRefund.status).toBe('completed');
  });

  it('keeps membership active while the remaining refund is processing and revokes it after sync', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { order, membership, basicPlan } =
      mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: `R${order.orderNo}`,
        status: 'PROCESSING',
      });

    const processing = await service.refundOrder(ORDER_ID.toHexString());

    expect(processing.status).toBe(OrderStatus.refundRequested);
    expect(processing.refundAmount).toBe(7000);
    expect(processing.voiceMembershipFinalRefund?.status).toBe('processing');
    expect(membership.status).toBe(UserMembershipStatus.active);
    expect(entitlement.status).toBe(AgentEntitlementStatus.available);

    jest
      .mocked(service.adminWechatPayService.queryRefundByRefundNo)
      .mockResolvedValueOnce({
        refund_id: '500000000000000002',
        out_refund_no: `R${order.orderNo}`,
        status: 'SUCCESS',
      });

    const completed = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(2);
    expect(completed.status).toBe(OrderStatus.refunded);
    expect(completed.refundAmount).toBe(19900);
    expect(completed.voiceMembershipFinalRefund?.status).toBe('completed');
    expect(membership.status).toBe(UserMembershipStatus.refunded);
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
  });

  it('reconciles a processing refund to financial success but does not revoke a newer membership', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { order, membership, basicPlan } =
      mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: `R${order.orderNo}`,
        status: 'PROCESSING',
      });
    await service.refundOrder(ORDER_ID.toHexString());

    membership.sourceOrderId = new MongoObjectId('665000000000000000000498');
    jest
      .mocked(service.adminWechatPayService.queryRefundByRefundNo)
      .mockResolvedValueOnce({
        refund_id: '500000000000000008',
        out_refund_no: `R${order.orderNo}`,
        status: 'SUCCESS',
      });

    const completed = await service.refundOrder(ORDER_ID.toHexString());

    expect(order.status).toBe(OrderStatus.refunded);
    expect(order.refundAmount).toBe(19900);
    expect(order.snapshot.voiceMembershipFinalRefund).toMatchObject({
      status: 'completed',
      wechatRefundStatus: 'SUCCESS',
    });
    expect(completed.status).toBe(OrderStatus.refunded);
    expect(membership.status).toBe(UserMembershipStatus.active);
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
  });

  it.each(['CLOSED', 'ABNORMAL'])(
    'keeps membership active when the remaining refund reaches %s',
    async refundStatus => {
      const { service, orders, memberships, entitlements } = createService();
      const { order, membership, basicPlan } =
        mockVoiceMembershipDowngradeLookups(service, orders, memberships);
      const entitlement = createEntitlement({
        type: AgentEntitlementType.interview,
      });

      basicPlan.entitlementGrants = [
        {
          type: AgentEntitlementType.interview,
          totalQuota: 1,
          durationDays: 365,
        },
      ];
      entitlements.push(entitlement);

      await service.downgradeVoiceMembership(
        ORDER_ID.toHexString(),
        { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
        {
          sub: 'admin-1',
          account: 'operator',
          roles: ['admin'],
          iat: 0,
          exp: 1,
          nonce: 'nonce',
        }
      );
      jest
        .mocked(service.adminWechatPayService.refundOrder)
        .mockResolvedValueOnce({
          out_refund_no: `R${order.orderNo}`,
          status: refundStatus,
        });

      await expect(
        service.refundOrder(ORDER_ID.toHexString())
      ).rejects.toMatchObject({
        code: 'ORDER_REFUND_NOT_SUCCESSFUL',
        status: 409,
      });
      expect(order.status).toBe(OrderStatus.refundRequested);
      expect(order.refundAmount).toBe(7000);
      expect(membership.status).toBe(UserMembershipStatus.active);
      expect(entitlement.status).toBe(AgentEntitlementStatus.available);
    }
  );

  it('uses a new deterministic refund attempt after WeChat closes the previous refund', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { order, membership, basicPlan } =
      mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: `R${order.orderNo}`,
        status: 'CLOSED',
      });

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({ code: 'ORDER_REFUND_NOT_SUCCESSFUL' });
    expect(order.snapshot.voiceMembershipFinalRefund).toMatchObject({
      status: 'failed',
      wechatRefundStatus: 'CLOSED',
      refundNo: `R${order.orderNo}`,
      attempt: 1,
    });

    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        refund_id: '500000000000000006',
        out_refund_no: `RF${ORDER_ID.toHexString()}-2`,
        status: 'SUCCESS',
      });

    const completed = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).toHaveBeenNthCalledWith(
      3,
      {
        orderNo: order.orderNo,
        refundNo: `RF${ORDER_ID.toHexString()}-2`,
        reason: '管理端退订退款',
        amount: 12900,
        totalAmount: 19900,
      }
    );
    expect(completed).toMatchObject({
      status: OrderStatus.refunded,
      refundAmount: 19900,
      voiceMembershipFinalRefund: {
        status: 'completed',
        refundNo: `RF${ORDER_ID.toHexString()}-2`,
        attempt: 2,
        wechatRefundStatus: 'SUCCESS',
      },
    });
    expect(membership.status).toBe(UserMembershipStatus.refunded);
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
  });

  it('allows only one concurrent caller to advance a closed refund attempt', async () => {
    const { service, orders, memberships } = createService();
    const { order } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: `R${order.orderNo}`,
        status: 'CLOSED',
      });
    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({ code: 'ORDER_REFUND_NOT_SUCCESSFUL' });

    const staleSnapshot = JSON.parse(JSON.stringify(order.snapshot));
    const staleOrders = [
      { ...order, snapshot: JSON.parse(JSON.stringify(staleSnapshot)) },
      { ...order, snapshot: JSON.parse(JSON.stringify(staleSnapshot)) },
    ];

    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: `RF${ORDER_ID.toHexString()}-2`,
        status: 'PROCESSING',
      });

    const attempts = await Promise.all(
      staleOrders.map(staleOrder =>
        (service as any)
          .syncDowngradedMembershipFinalRefund(
            staleOrder,
            12900,
            19900,
            '管理端退订退款'
          )
          .then(
            () => 'fulfilled',
            () => 'rejected'
          )
      )
    );

    expect(attempts.filter(status => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(status => status === 'rejected')).toHaveLength(1);
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(3);
    expect(order.snapshot.voiceMembershipFinalRefund).toMatchObject({
      status: 'processing',
      refundNo: `RF${ORDER_ID.toHexString()}-2`,
      attempt: 2,
    });
  });

  it('keeps the same refund number while an abnormal WeChat refund is being handled', async () => {
    const { service, orders, memberships } = createService();
    const { order } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: `R${order.orderNo}`,
        status: 'ABNORMAL',
      });

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({ code: 'ORDER_REFUND_NOT_SUCCESSFUL' });
    jest
      .mocked(service.adminWechatPayService.queryRefundByRefundNo)
      .mockResolvedValueOnce({
        out_refund_no: `R${order.orderNo}`,
        status: 'ABNORMAL',
      });

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({ code: 'ORDER_REFUND_NOT_SUCCESSFUL' });

    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(2);
    expect(
      service.adminWechatPayService.queryRefundByRefundNo
    ).toHaveBeenLastCalledWith(`R${order.orderNo}`);
    expect(order.snapshot.voiceMembershipFinalRefund).toMatchObject({
      status: 'failed',
      refundNo: `R${order.orderNo}`,
      attempt: 1,
      wechatRefundStatus: 'ABNORMAL',
    });
  });

  it('retries benefit revocation without submitting the remaining refund twice', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { order, membership, basicPlan } =
      mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    jest
      .spyOn(service as any, 'revokeOrderBenefits')
      .mockRejectedValueOnce(new Error('benefit revocation failed'));

    await expect(service.refundOrder(ORDER_ID.toHexString())).rejects.toThrow(
      'benefit revocation failed'
    );
    expect(order.status).toBe(OrderStatus.refunded);
    expect(order.refundAmount).toBe(19900);
    expect(order.snapshot.voiceMembershipFinalRefund.status).toBe(
      'benefits_failed'
    );
    expect(membership.status).toBe(UserMembershipStatus.active);
    expect(entitlement.status).toBe(AgentEntitlementStatus.available);

    const completed = await service.refundOrder(ORDER_ID.toHexString());

    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(2);
    expect(
      service.adminWechatPayService.queryRefundByRefundNo
    ).toHaveBeenCalledTimes(1);
    expect(completed.status).toBe(OrderStatus.refunded);
    expect(completed.voiceMembershipFinalRefund?.status).toBe('completed');
    expect(membership.status).toBe(UserMembershipStatus.refunded);
    expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
  });

  it('does not report completion when another worker changes the final benefit claim before the completion CAS', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { order, basicPlan } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);
    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    const originalOrderUpdate = jest
      .mocked(service.orderModel.updateOne)
      .getMockImplementation()!;
    jest
      .mocked(service.orderModel.updateOne)
      .mockImplementation(async (filter: any, update: any) => {
        const finalRefund =
          update?.$set?.['snapshot.voiceMembershipFinalRefund'];

        if (finalRefund?.status === 'completed') {
          order.snapshot.voiceMembershipFinalRefund.updatedAt =
            '2026-05-02T08:00:01.000Z';
          return { matchedCount: 0, modifiedCount: 0 } as never;
        }

        return originalOrderUpdate(filter, update);
      });

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_REFUND_STATE_CONFLICT',
      status: 409,
    });
    expect(order.status).toBe(OrderStatus.refunded);
    expect(order.refundAmount).toBe(19900);
    expect(order.snapshot.voiceMembershipFinalRefund.status).toBe(
      'benefits_processing'
    );
  });

  it('keeps the downgraded membership active when the remaining refund fails', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { order, membership, basicPlan } =
      mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    const entitlement = createEntitlement({
      type: AgentEntitlementType.interview,
    });

    basicPlan.entitlementGrants = [
      {
        type: AgentEntitlementType.interview,
        totalQuota: 1,
        durationDays: 365,
      },
    ];
    entitlements.push(entitlement);

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockRejectedValueOnce(new Error('wechat refund failed'));

    await expect(service.refundOrder(ORDER_ID.toHexString())).rejects.toThrow(
      'wechat refund failed'
    );
    expect(order.status).toBe(OrderStatus.refundRequested);
    expect(order.refundAmount).toBe(7000);
    expect(membership.status).toBe(UserMembershipStatus.active);
    expect(entitlement.status).toBe(AgentEntitlementStatus.available);
  });

  it('blocks a full refund while the downgrade refund is still processing', async () => {
    const { service, orders, memberships } = createService();

    mockVoiceMembershipDowngradeLookups(service, orders, memberships);
    jest.mocked(service.adminWechatPayService.refundOrder).mockResolvedValue({
      out_refund_no: 'VDVIP202605020001',
      status: 'PROCESSING',
    });

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_VOICE_MEMBERSHIP_DOWNGRADE_INCOMPLETE',
      status: 400,
    });
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
  });

  it('does not revoke membership when a downgraded upgrade order has no remaining refund', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.payableAmount = 7000;
    order.paidAmount = 7000;
    order.snapshot.vipUpgrade = {
      historicalPaidAmount: 12900,
      deductedAmount: 12900,
      payableAmount: 7000,
    };

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_UPGRADE_REFUND_REQUIRES_HISTORY',
      message:
        '升级会员的费用来自多笔历史订单，请核对原基础会员订单后处理，系统不会自动少退或错退',
    });
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('blocks automatic final refund for upgrade orders with historical funding', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    order.payableAmount = 14900;
    order.paidAmount = 14900;
    order.snapshot.vipUpgrade = {
      historicalPaidAmount: 5000,
      deductedAmount: 5000,
      payableAmount: 14900,
    };

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_UPGRADE_REFUND_REQUIRES_HISTORY',
      status: 409,
    });
    expect(order.refundAmount).toBe(7000);
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('blocks refunding a downgraded order after a newer order replaces its active membership', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    membership.sourceOrderId = new MongoObjectId('665000000000000000000499');

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_MEMBERSHIP_REPLACED_BY_NEWER_ORDER',
      status: 409,
    });
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.completed);
    expect(order.refundAmount).toBe(7000);
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('blocks refunding a downgraded order already used by a pending upgrade order', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    const pendingUpgrade = createCompletedVipOrder({
      id: new MongoObjectId('665000000000000000000499'),
      orderNo: 'VIP202605020002',
      status: OrderStatus.pending,
      createdAt: new Date(ORDER_CREATED_AT.getTime() + 1000),
      snapshot: {
        vipPlan: order.snapshot.vipPlan,
        vipUpgrade: {
          historicalPaidAmount: 12900,
          deductedAmount: 12900,
          payableAmount: 7000,
        },
      },
    });
    jest
      .mocked(service.orderModel.find)
      .mockResolvedValue([pendingUpgrade] as never);

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_REFUND_USED_BY_NEWER_UPGRADE',
      status: 409,
    });
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.completed);
    expect(order.refundAmount).toBe(7000);
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('does not start a final refund while another membership financial operation holds the user lock', async () => {
    const { service, orders, users, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    users[0].membershipFinancialOperationLock = {
      token: 'upgrade-create-token',
      operation: 'vip_upgrade_order_create',
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'MEMBERSHIP_FINANCIAL_OPERATION_BUSY',
      status: 409,
    });
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.completed);
    expect(order.refundAmount).toBe(7000);
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it('blocks the final refund while downgrade benefits are atomically claimed', async () => {
    const { service, orders, memberships } = createService();
    const { order, membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );
    order.snapshot.voiceMembershipDowngrade.benefitsApplyToken = 'busy-token';
    order.snapshot.voiceMembershipDowngrade.benefitsApplyStartedAt =
      new Date().toISOString();

    await expect(
      service.refundOrder(ORDER_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'ORDER_REFUND_STATE_CONFLICT',
      status: 409,
    });
    expect(
      service.adminWechatPayService.queryRefundByRefundNo
    ).not.toHaveBeenCalled();
    expect(service.adminWechatPayService.refundOrder).toHaveBeenCalledTimes(1);
    expect(order.status).toBe(OrderStatus.completed);
    expect(membership.status).toBe(UserMembershipStatus.active);
  });

  it.each(['PROCESSING', 'SUCCESS'])(
    'does not let a stale %s downgrade sync overwrite a completed final refund',
    async staleRefundStatus => {
      const { service, orders, memberships, entitlements } = createService();
      const { order, membership } = mockVoiceMembershipDowngradeLookups(
        service,
        orders,
        memberships
      );
      const entitlement = createEntitlement();

      entitlements.push(entitlement);
      jest
        .mocked(service.adminWechatPayService.refundOrder)
        .mockResolvedValueOnce({
          out_refund_no: `VD${order.orderNo}`,
          status: 'PROCESSING',
        });
      await service.downgradeVoiceMembership(
        ORDER_ID.toHexString(),
        { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
        {
          sub: 'admin-1',
          account: 'operator',
          roles: ['admin'],
          iat: 0,
          exp: 1,
          nonce: 'nonce',
        }
      );
      jest.mocked(service.orderModel.save).mockClear();

      const staleOrder = {
        ...order,
        snapshot: JSON.parse(JSON.stringify(order.snapshot)),
      };
      let resolveStaleRefund!: (value: any) => void;
      const staleRefund = new Promise<any>(resolve => {
        resolveStaleRefund = resolve;
      });

      jest
        .mocked(service.orderModel.findOne)
        .mockResolvedValueOnce(staleOrder as never);
      jest
        .mocked(service.adminWechatPayService.queryRefundByRefundNo)
        .mockImplementationOnce(() => staleRefund)
        .mockResolvedValueOnce({
          refund_id: '500000000000000004',
          out_refund_no: `VD${order.orderNo}`,
          status: 'SUCCESS',
        });

      const staleSync = service.syncVoiceMembershipDowngrade(
        ORDER_ID.toHexString(),
        {
          sub: 'admin-stale',
          account: 'stale-operator',
          roles: ['admin'],
          iat: 0,
          exp: 1,
          nonce: 'stale-nonce',
        }
      );
      await Promise.resolve();
      await Promise.resolve();

      await service.syncVoiceMembershipDowngrade(ORDER_ID.toHexString(), {
        sub: 'admin-current',
        account: 'current-operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'current-nonce',
      });
      const finalRefund = await service.refundOrder(ORDER_ID.toHexString());
      const applyBenefitsSpy = jest.spyOn(
        service as any,
        'applyVoiceMembershipDowngradeBenefits'
      );

      applyBenefitsSpy.mockClear();
      resolveStaleRefund({
        refund_id: '500000000000000005',
        out_refund_no: `VD${order.orderNo}`,
        status: staleRefundStatus,
      });
      await staleSync;

      expect(applyBenefitsSpy).not.toHaveBeenCalled();
      expect(service.orderModel.save).not.toHaveBeenCalled();
      expect(finalRefund.status).toBe(OrderStatus.refunded);
      expect(order.status).toBe(OrderStatus.refunded);
      expect(order.refundAmount).toBe(19900);
      expect(order.snapshot.voiceMembershipDowngrade.status).toBe('completed');
      expect(membership.status).toBe(UserMembershipStatus.refunded);
      expect(entitlement.status).toBe(AgentEntitlementStatus.refunded);
    }
  );

  it('waits for a processing refund and applies the downgrade after sync', async () => {
    const { service, orders, memberships } = createService();
    const { membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );

    jest.mocked(service.adminWechatPayService.refundOrder).mockResolvedValue({
      out_refund_no: 'VDVIP202605020001',
      status: 'PROCESSING',
    });

    const submitted = await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(submitted.refundAmount).toBeUndefined();
    expect(submitted.voiceMembershipDowngrade?.status).toBe('processing');
    expect(membership.vipPlanId).toEqual(VIP_PLAN_ID);

    jest
      .mocked(service.adminWechatPayService.queryRefundByRefundNo)
      .mockResolvedValue({
        refund_id: '500000000000000001',
        out_refund_no: 'VDVIP202605020001',
        status: 'SUCCESS',
      });

    const synced = await service.syncVoiceMembershipDowngrade(
      ORDER_ID.toHexString(),
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(synced.refundAmount).toBe(7000);
    expect(synced.voiceMembershipDowngrade?.status).toBe('completed');
    expect(membership.vipPlanId).toEqual(BASIC_VIP_PLAN_ID);
  });

  it('does not overwrite a newer paid membership when a processing downgrade later succeeds', async () => {
    const { service, orders, memberships, entitlements } = createService();
    const { membership } = mockVoiceMembershipDowngradeLookups(
      service,
      orders,
      memberships
    );
    const oldVoiceEntitlement = createEntitlement();
    const newerOrderId = new MongoObjectId('665000000000000000000497');
    const newerPlanId = new MongoObjectId('665000000000000000000496');

    entitlements.push(oldVoiceEntitlement);
    jest
      .mocked(service.adminWechatPayService.refundOrder)
      .mockResolvedValueOnce({
        out_refund_no: 'VDVIP202605020001',
        status: 'PROCESSING',
      });
    await service.downgradeVoiceMembership(
      ORDER_ID.toHexString(),
      { targetVipPlanId: BASIC_VIP_PLAN_ID.toHexString() },
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    const originalMembershipUpdate = jest
      .mocked(service.userMembershipModel.updateOne)
      .getMockImplementation()!;
    jest
      .mocked(service.userMembershipModel.updateOne)
      .mockImplementationOnce(async (filter: any, update: any) => {
        membership.sourceOrderId = newerOrderId;
        membership.vipPlanId = newerPlanId;
        membership.vipPlanCode = 'vip_lifetime_voice_new';
        membership.status = UserMembershipStatus.active;

        return originalMembershipUpdate(filter, update);
      });
    jest
      .mocked(service.adminWechatPayService.queryRefundByRefundNo)
      .mockResolvedValueOnce({
        refund_id: '500000000000000009',
        out_refund_no: 'VDVIP202605020001',
        status: 'SUCCESS',
      });

    const synced = await service.syncVoiceMembershipDowngrade(
      ORDER_ID.toHexString(),
      {
        sub: 'admin-1',
        account: 'operator',
        roles: ['admin'],
        iat: 0,
        exp: 1,
        nonce: 'nonce',
      }
    );

    expect(synced.voiceMembershipDowngrade?.status).toBe('completed');
    expect(membership).toMatchObject({
      sourceOrderId: newerOrderId,
      vipPlanId: newerPlanId,
      vipPlanCode: 'vip_lifetime_voice_new',
      status: UserMembershipStatus.active,
    });
    expect(oldVoiceEntitlement.status).toBe(AgentEntitlementStatus.refunded);
  });
});
