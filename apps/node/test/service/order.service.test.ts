import {
  AgentEntity,
  AgentSex,
  AgentEntitlementStatus,
  AgentEntitlementType,
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipStatus,
  VirtualGoodsProvideStatus,
  VipPlanEntity,
  VipPlanGroup,
  VipPlanStatus,
  VoicePackageEntity,
  VoicePackageStatus,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
  VoiceTrainingTaskTrainingStrategy,
} from '@tzl/entities';
import {
  ORDER_PAYMENT_EXPIRE_QUEUE,
  OrderService,
} from '../../src/service/order.service';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const USER_ID = '665000000000000000000001';
const ORDER_ID = '665000000000000000000002';
const VIP_PLAN_ID = '665000000000000000000003';
const VOICE_PACKAGE_ID = '665000000000000000000004';
const AGENT_ID = '665000000000000000000005';
const VOICE_TASK_ID = '665000000000000000000006';
const ORDER_NO = 'VIP202605010001';
const VOICE_ORDER_NO = 'VOICE202605010001';
// 普通微信支付入口只对可信 iOS 放行；真实小程序请求一定带 UA，
// 所以非平台相关的下单用例也要带一个 iPhone UA 才符合生产形态。
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.74(0x18004a30) NetType/4G Language/zh_CN';

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

function createVoicePackage(overrides: Partial<VoicePackageEntity> = {}) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');
  const voicePackage = new VoicePackageEntity();

  Object.assign(voicePackage, {
    id: new MongoObjectId(VOICE_PACKAGE_ID),
    code: 'voice_standard',
    name: '标准声音套餐',
    description: '标准声音训练服务',
    priceAmount: 12900,
    originalPriceAmount: 19900,
    currency: 'CNY',
    deliverables: [{ title: '声音训练' }],
    materialRequirement: '请提供清晰录音素材',
    estimatedServiceDays: 7,
    status: VoicePackageStatus.active,
    sort: 1,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  return voicePackage;
}

function createAgent(overrides: Partial<AgentEntity> = {}) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: new MongoObjectId(USER_ID),
    name: '奶奶',
    avatar: '',
    sex: AgentSex.woman,
    description: '',
    status: 1,
    isDefault: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  return agent;
}

function createVoiceOrder(overrides: Partial<OrderEntity> = {}) {
  return createOrder({
    orderNo: VOICE_ORDER_NO,
    orderType: OrderType.voicePackage,
    targetId: new MongoObjectId(VOICE_PACKAGE_ID),
    targetCode: 'voice_standard',
    agentId: new MongoObjectId(AGENT_ID),
    title: '标准声音套餐',
    amount: 12900,
    discountAmount: 7000,
    payableAmount: 12900,
    snapshot: {
      voicePackage: {
        id: VOICE_PACKAGE_ID,
        code: 'voice_standard',
        name: '标准声音套餐',
      },
      agent: {
        id: AGENT_ID,
        name: '奶奶',
      },
    },
    ...overrides,
  });
}

function createVoiceTrainingTask(
  overrides: Partial<VoiceTrainingTaskEntity> = {}
) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');
  const task = new VoiceTrainingTaskEntity();

  Object.assign(task, {
    id: new MongoObjectId(VOICE_TASK_ID),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    orderId: new MongoObjectId(ORDER_ID),
    voicePackageId: new MongoObjectId(VOICE_PACKAGE_ID),
    voicePackageCode: 'voice_standard',
    status: VoiceTrainingTaskStatus.paid,
    assigneeName: '',
    materialObjectKeys: [],
    remark: '',
    paidAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  return task;
}

function createMembership(overrides: Partial<any> = {}) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');

  return {
    id: new MongoObjectId('665000000000000000000007'),
    userId: new MongoObjectId(USER_ID),
    vipPlanId: new MongoObjectId(VIP_PLAN_ID),
    vipPlanCode: 'vip_month',
    sourceOrderId: new MongoObjectId(ORDER_ID),
    status: UserMembershipStatus.active,
    startedAt: createdAt,
    expiredAt: new Date('2026-06-01T00:00:00.000Z'),
    lifetime: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createEntitlement(overrides: Partial<any> = {}) {
  const createdAt = new Date('2026-05-01T00:00:00.000Z');

  return {
    id: new MongoObjectId('665000000000000000000008'),
    userId: new MongoObjectId(USER_ID),
    type: AgentEntitlementType.voiceModel,
    totalQuota: 2,
    usedQuota: 0,
    status: AgentEntitlementStatus.available,
    sourceOrderId: new MongoObjectId(ORDER_ID),
    sourceVipPlanId: new MongoObjectId(VIP_PLAN_ID),
    activatedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function snapshotOrder(order: OrderEntity) {
  return {
    status: order.status,
    paidAmount: order.paidAmount,
    refundAmount: order.refundAmount,
    paymentTradeNo: order.paymentTradeNo,
    paymentNotifyAt: order.paymentNotifyAt,
    paidAt: order.paidAt,
    closedAt: order.closedAt,
    refundedAt: order.refundedAt,
    virtualGoodsProvideStatus: order.virtualGoodsProvideStatus,
    virtualGoodsProvidedAt: order.virtualGoodsProvidedAt,
    virtualGoodsProvideFailedAt: order.virtualGoodsProvideFailedAt,
    virtualGoodsProvideError: order.virtualGoodsProvideError,
    updatedAt: order.updatedAt,
  };
}

function createOrderModel(
  order: OrderEntity,
  historicalVipOrders: OrderEntity[] = []
) {
  const savedSnapshots: ReturnType<typeof snapshotOrder>[] = [];
  const model = {
    savedSnapshots,
    find: jest.fn().mockResolvedValue(historicalVipOrders),
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
    // CAS：只有 _id 与当前 status 都对得上才占用成功，用于验证重复回调不会重复发权益。
    updateOne: jest.fn(async (filter: any, update: any) => {
      const id = filter?._id;
      const matchesId = id && sameObjectId(id, order.id);
      const expectedStatus = filter?.status;
      const matchesStatus =
        expectedStatus === undefined || expectedStatus === order.status;

      if (!matchesId || !matchesStatus) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      Object.assign(order, update?.$set ?? {});
      savedSnapshots.push(snapshotOrder(order));
      return { matchedCount: 1, modifiedCount: 1 };
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

function createVoicePackageModel(voicePackage: VoicePackageEntity) {
  return {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, voicePackage.id) ? voicePackage : null;
    }),
  };
}

function createAgentModel(agent: AgentEntity) {
  return {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return id && sameObjectId(id, agent.id) ? agent : null;
    }),
  };
}

function createVoiceTrainingTaskModel(tasks: VoiceTrainingTaskEntity[] = []) {
  return {
    find: jest.fn(async ({ where }: any) => {
      let result = tasks;

      if (where?.agentId) {
        result = result.filter(task =>
          sameObjectId(task.agentId, where.agentId)
        );
      }

      const statuses = where?.status?.$in;
      if (Array.isArray(statuses)) {
        result = result.filter(task => statuses.includes(task.status));
      }

      return result;
    }),
    findOne: jest.fn(async ({ where }: any) => {
      if (where?.orderId) {
        return (
          tasks.find(task => sameObjectId(task.orderId, where.orderId)) ?? null
        );
      }

      const id = where?.id ?? where?._id;

      return id ? tasks.find(task => sameObjectId(task.id, id)) ?? null : null;
    }),
    save: jest.fn(async (task: VoiceTrainingTaskEntity) => {
      task.id = task.id ?? new MongoObjectId(VOICE_TASK_ID);

      const index = tasks.findIndex(item => sameObjectId(item.id, task.id));
      if (index >= 0) {
        tasks[index] = task;
      } else {
        tasks.push(task);
      }

      return task;
    }),
  };
}

function createService(
  orderOverrides: Partial<OrderEntity> = {},
  planOverrides: Partial<VipPlanEntity> = {},
  options: {
    voicePackageOverrides?: Partial<VoicePackageEntity>;
    agentOverrides?: Partial<AgentEntity>;
    voiceTrainingTasks?: VoiceTrainingTaskEntity[];
    memberships?: any[];
    entitlements?: any[];
    historicalVipOrders?: OrderEntity[];
  } = {}
) {
  const service = new OrderService();
  const order = createOrder(orderOverrides);
  const plan = createVipPlan(planOverrides);
  const voicePackage = createVoicePackage(options.voicePackageOverrides);
  const agent = createAgent(options.agentOverrides);
  const orderModel = createOrderModel(order, options.historicalVipOrders);
  const vipPlanModel = createVipPlanModel(plan);
  const voicePackageModel = createVoicePackageModel(voicePackage);
  const agentModel = createAgentModel(agent);
  const voiceTrainingTaskModel = createVoiceTrainingTaskModel(
    options.voiceTrainingTasks
  );
  const memberships = options.memberships ?? [];
  const entitlements = options.entitlements ?? [];
  let membershipFinancialOperationLock:
    | {
        token: string;
        operation: string;
        acquiredAt: Date;
        expiresAt: Date;
      }
    | undefined;
  const userModel = {
    updateOne: jest.fn(async (filter: any, update: any) => {
      if (!sameObjectId(filter?._id, new MongoObjectId(USER_ID))) {
        return { matchedCount: 0, modifiedCount: 0 };
      }

      const requestedLock = update?.$set?.membershipFinancialOperationLock;

      if (requestedLock) {
        const expiryFilter = filter?.$or?.find(
          (candidate: any) =>
            candidate?.['membershipFinancialOperationLock.expiresAt']?.$lte
        )?.['membershipFinancialOperationLock.expiresAt']?.$lte;
        const missingFilter = filter?.$or?.some(
          (candidate: any) =>
            candidate?.membershipFinancialOperationLock?.$exists === false
        );
        const canAcquire = membershipFinancialOperationLock
          ? expiryFilter instanceof Date &&
            membershipFinancialOperationLock.expiresAt <= expiryFilter
          : missingFilter;

        if (!canAcquire) {
          return { matchedCount: 0, modifiedCount: 0 };
        }

        membershipFinancialOperationLock = { ...requestedLock };
        return { matchedCount: 1, modifiedCount: 1 };
      }

      if (update?.$unset?.membershipFinancialOperationLock !== undefined) {
        if (
          !membershipFinancialOperationLock ||
          filter?.['membershipFinancialOperationLock.token'] !==
            membershipFinancialOperationLock.token
        ) {
          return { matchedCount: 0, modifiedCount: 0 };
        }

        membershipFinancialOperationLock = undefined;
        return { matchedCount: 1, modifiedCount: 1 };
      }

      return { matchedCount: 0, modifiedCount: 0 };
    }),
    getMembershipFinancialOperationLock: () => membershipFinancialOperationLock,
  };
  const userMembershipModel = {
    find: jest.fn(async () => memberships),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        memberships.find(membership =>
          sameObjectId(membership.sourceOrderId, where?.sourceOrderId)
        ) ?? null
      );
    }),
    save: jest.fn(async membership => membership),
  };
  const agentEntitlementModel = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn(async ({ where }: any) => {
      return entitlements.filter(entitlement =>
        sameObjectId(entitlement.sourceOrderId, where?.sourceOrderId)
      );
    }),
    save: jest.fn(async entitlement => entitlement),
  };
  const wechatPayService = {
    getOpenidByJsCode: jest.fn().mockResolvedValue('openid-1'),
    getSessionByJsCode: jest.fn().mockResolvedValue({
      openid: 'openid-1',
      sessionKey: 'session-key-1',
    }),
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
    buildVirtualPaymentParams: jest.fn().mockReturnValue({
      mode: 'short_series_goods',
      signData: '{"mock":true}',
      paySig: 'pay-sig',
      signature: 'signature',
    }),
    getVirtualPayEnv: jest.fn().mockReturnValue(1),
    queryVirtualOrder: jest.fn(),
    notifyVirtualGoodsProvided: jest.fn().mockResolvedValue({}),
    queryTransactionByOrderNo: jest.fn(),
    refundOrder: jest.fn().mockResolvedValue({
      out_refund_no: `R${ORDER_NO}`,
      status: 'SUCCESS',
    }),
    refundVirtualOrder: jest.fn().mockResolvedValue({
      refund_order_id: `R${ORDER_NO}`,
    }),
  };
  const queue = {
    addJobToQueue: jest.fn().mockResolvedValue(undefined),
  };
  const messengerService = {
    ensureMessengersForUser: jest.fn().mockResolvedValue({
      processed: 1,
      messengersCreated: 1,
      conversationsCreated: 1,
    }),
  };
  const orderRefundModel = {
    updateOne: jest.fn().mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 1,
    }),
  };

  service.logger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  service.orderModel = orderModel as any;
  service.orderRefundModel = orderRefundModel as any;
  service.vipPlanModel = vipPlanModel as any;
  service.voicePackageModel = voicePackageModel as any;
  service.agentModel = agentModel as any;
  service.userModel = userModel as any;
  service.userMembershipModel = userMembershipModel as any;
  service.agentEntitlementModel = agentEntitlementModel as any;
  service.voiceTrainingTaskModel = voiceTrainingTaskModel as any;
  service.wechatPayService = wechatPayService as any;
  service.bullmqFramework = {
    getQueue: jest.fn(name =>
      name === ORDER_PAYMENT_EXPIRE_QUEUE ? queue : undefined
    ),
  } as any;
  service.messengerService = messengerService as any;
  // 下单/发放链路会推断用户与智能体的关系标签；此前漏了这个 mock，
  // 导致 9 个用例在 inferRelationship 上失败。返回空串表示未识别，符合默认语义。
  const orderRelationshipService = {
    inferRelationship: jest.fn().mockResolvedValue(''),
  };
  service.orderRelationshipService = orderRelationshipService as any;

  return {
    service,
    order,
    orderModel,
    orderRefundModel,
    orderRelationshipService,
    voicePackage,
    voicePackageModel,
    agent,
    agentModel,
    voiceTrainingTaskModel,
    userModel,
    userMembershipModel,
    agentEntitlementModel,
    wechatPayService,
    queue,
    messengerService,
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

    await service.createVipPlanOrder(
      auth,
      {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      },
      { userAgent: IOS_UA }
    );

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

  it('拒绝为已配置虚拟支付商品的会员套餐创建普通微信支付订单', async () => {
    const { service, auth, orderModel, wechatPayService } = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );

    await expect(
      service.createVipPlanOrder(auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });

    expect(orderModel.save).not.toHaveBeenCalled();
    expect(wechatPayService.createVipPlanPrepay).not.toHaveBeenCalled();
  });

  it('拒绝为已配置虚拟支付商品的语音套餐创建普通微信支付订单', async () => {
    const { service, auth, orderModel } = createService(
      {},
      {},
      {
        voicePackageOverrides: {
          virtualPaymentProductId: 'voice_standard_goods',
        },
      }
    );

    await expect(
      service.createVoicePackageOrder(auth, {
        voicePackageId: VOICE_PACKAGE_ID,
        agentId: AGENT_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });

    expect(orderModel.save).not.toHaveBeenCalled();
  });

  // 微信只关闭了非 iOS 的普通微信支付；iOS 的 wx.requestVirtualPayment 基本走不通，
  // 普通支付是它唯一的成功路径，必须放行，否则 iOS 用户会被堵死。
  // 到达普通支付入口且商品配了虚拟支付商品 = 客户端虚拟支付失败后回退。
  // 这个入口本身就是「虚拟支付失败」的信号，埋点用于按平台统计，无需客户端上报。
  it('普通支付入口按 route/outcome 埋点，且不把原始 userId 写进日志', async () => {
    const IPHONE_UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.74 NetType/4G';
    const ANDROID_UA =
      'Mozilla/5.0 (Linux; Android 12; BLK-AL80 Build/HUAWEIBLK-AL80; wv) AppleWebKit/537.36 Mobile Safari/537.36 MiniProgramEnv/android';

    // iOS：正常直付，route=ios_ordinary_direct，不是"回退"
    const ios = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await ios.service.createVipPlanOrder(
      ios.auth,
      { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
      { userAgent: IPHONE_UA }
    );
    const iosLog = (ios.service.logger.warn as jest.Mock).mock.calls.find(
      call => String(call[0]).startsWith('ORDER_PAY_ROUTE')
    );
    expect(iosLog).toBeDefined();
    expect(iosLog[0]).toBe(
      'ORDER_PAY_ROUTE route=%s outcome=%s platform=%s platformSource=%s virtualProduct=%s mpEnv=%s userHash=%s targetCode=%s productId=%s'
    );
    expect(iosLog.slice(1)).toEqual([
      'ios_ordinary_direct',
      'allowed',
      'ios',
      'ua',
      'configured',
      '-',
      expect.any(String),
      'vip_month',
      'vip_month_goods',
    ]);
    // 用户标识必须哈希，原始 userId 不能出现
    expect(iosLog[7]).not.toBe(USER_ID);
    expect(iosLog).toHaveLength(10);
    expect(JSON.stringify(iosLog)).not.toContain(USER_ID);

    // 安卓：只允许虚拟支付，命中普通支付入口必须拒绝
    const android = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await expect(
      android.service.createVipPlanOrder(
        android.auth,
        { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
        { userAgent: ANDROID_UA }
      )
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });
    const androidLog = (
      android.service.logger.warn as jest.Mock
    ).mock.calls.find(call => String(call[0]).startsWith('ORDER_PAY_ROUTE'));
    expect(androidLog.slice(1)).toEqual([
      'non_ios_ordinary_blocked',
      'rejected',
      'android',
      'ua',
      'configured',
      'android',
      expect.any(String),
      'vip_month',
      'vip_month_goods',
    ]);
  });

  it('iOS 客户端可为虚拟支付商品创建普通微信支付订单（UA 判定）', async () => {
    const IPHONE_UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.74(0x18004a30) NetType/4G Language/zh_CN';
    const { service, auth, orderModel } = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );

    await service.createVipPlanOrder(
      auth,
      { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
      { userAgent: IPHONE_UA }
    );

    expect(orderModel.save).toHaveBeenCalled();
  });

  it('iOS 语音套餐同样放行，非 iOS 客户端仍被拒绝', async () => {
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
    const ANDROID_UA =
      'Mozilla/5.0 (Linux; Android 12; BLK-AL80 Build/HUAWEIBLK-AL80; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0 Mobile Safari/537.36 MiniProgramEnv/android';

    const ios = createService(
      {},
      {},
      {
        voicePackageOverrides: {
          virtualPaymentProductId: 'voice_standard_goods',
        },
      }
    );
    await ios.service.createVoicePackageOrder(
      ios.auth,
      {
        voicePackageId: VOICE_PACKAGE_ID,
        agentId: AGENT_ID,
        jsCode: 'wx-code',
      },
      { userAgent: IPHONE_UA }
    );
    expect(ios.orderModel.save).toHaveBeenCalled();

    const android = createService(
      {},
      {},
      {
        voicePackageOverrides: {
          virtualPaymentProductId: 'voice_standard_goods',
        },
      }
    );
    await expect(
      android.service.createVoicePackageOrder(
        android.auth,
        {
          voicePackageId: VOICE_PACKAGE_ID,
          agentId: AGENT_ID,
          jsCode: 'wx-code',
        },
        { userAgent: ANDROID_UA }
      )
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });
  });

  it('自报平台与 UA 一致才放行；缺 UA 时自报 ios 不采信', async () => {
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';

    const both = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await both.service.createVipPlanOrder(
      both.auth,
      { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code', platform: 'ios' },
      { userAgent: IPHONE_UA }
    );
    const bothLog = (both.service.logger.warn as jest.Mock).mock.calls.find(
      call => String(call[0]).startsWith('ORDER_PAY_ROUTE')
    );
    expect(bothLog.slice(1)).toEqual([
      'ios_ordinary_direct',
      'allowed',
      'ios',
      'ua+declared',
      'configured',
      '-',
      expect.any(String),
      'vip_month',
      'vip_month_goods',
    ]);

    // 没有 UA：不可信来源。自报 ios 不足以拿到普通微信支付，
    // 否则非 iOS 客户端只要省掉 UA 再自报 ios 就能绕过平台路由规则。
    const declaredOnly = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await expect(
      declaredOnly.service.createVipPlanOrder(declaredOnly.auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
        platform: 'ios',
      })
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });
    expect(declaredOnly.orderModel.save).not.toHaveBeenCalled();

    const declaredOnlyLog = (
      declaredOnly.service.logger.warn as jest.Mock
    ).mock.calls.find(call => String(call[0]).startsWith('ORDER_PAY_ROUTE'));
    expect(declaredOnlyLog.slice(1)).toEqual([
      'non_ios_ordinary_blocked',
      'rejected',
      'ios',
      'declared',
      'configured',
      '-',
      expect.any(String),
      'vip_month',
      'vip_month_goods',
    ]);
  });

  it('自报平台与 UA 冲突时拒绝并告警，不猜通道', async () => {
    const ANDROID_UA =
      'Mozilla/5.0 (Linux; Android 12; BLK-AL80 Build/HUAWEIBLK-AL80; wv) AppleWebKit/537.36 MiniProgramEnv/android';
    const { service, auth, orderModel } = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );

    // UA 说安卓、自报说 iOS：伪造嫌疑，按 fail-closed 拒绝
    await expect(
      service.createVipPlanOrder(
        auth,
        { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code', platform: 'ios' },
        { userAgent: ANDROID_UA }
      )
    ).rejects.toMatchObject({
      code: 'WECHAT_ORDINARY_PAY_PLATFORM_CONFLICT',
    });
    expect(orderModel.save).not.toHaveBeenCalled();

    const conflictLog = (service.logger.warn as jest.Mock).mock.calls.find(
      call => String(call[0]).startsWith('ORDER_PAY_ROUTE')
    );
    expect(conflictLog.slice(1)).toEqual([
      'platform_conflict',
      'rejected',
      'android',
      'ua+declared',
      'configured',
      'android',
      expect.any(String),
      'vip_month',
      'vip_month_goods',
    ]);
  });

  it('平台完全判不出来时按非 iOS 拒绝', async () => {
    const { service, auth } = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );

    await expect(
      service.createVipPlanOrder(auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });

    const log = (service.logger.warn as jest.Mock).mock.calls.find(call =>
      String(call[0]).startsWith('ORDER_PAY_ROUTE')
    );
    expect(log.slice(1)).toEqual([
      'platform_unknown',
      'rejected',
      'other',
      'none',
      'configured',
      '-',
      expect.any(String),
      'vip_month',
      'vip_month_goods',
    ]);
  });

  it('商品漏配 virtualPaymentProductId 时非 iOS 也不能拿普通微信支付订单', async () => {
    const ANDROID_UA =
      'Mozilla/5.0 (Linux; Android 12; BLK-AL80 Build/HUAWEIBLK-AL80; wv) AppleWebKit/537.36 MiniProgramEnv/android';
    // 默认套餐 fixture 没有 virtualPaymentProductId，模拟"在售付费商品漏配道具 ID"
    const { service, auth, orderModel, wechatPayService } = createService();

    await expect(
      service.createVipPlanOrder(
        auth,
        { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
        { userAgent: ANDROID_UA }
      )
    ).rejects.toMatchObject({ code: 'WECHAT_ORDINARY_PAY_DISABLED' });
    expect(orderModel.save).not.toHaveBeenCalled();
    expect(wechatPayService.createVipPlanPrepay).not.toHaveBeenCalled();

    // 漏配要留错误日志，便于运营发现；路由日志标记 missing
    const errorLog = (service.logger.error as jest.Mock).mock.calls.find(call =>
      String(call[0]).includes('缺少 virtualPaymentProductId')
    );
    expect(errorLog).toBeDefined();
    const routeLog = (service.logger.warn as jest.Mock).mock.calls.find(call =>
      String(call[0]).startsWith('ORDER_PAY_ROUTE')
    );
    expect(routeLog).toContain('missing');
  });

  it('商品漏配虚拟道具 ID 时 iOS 仍可正常普通支付，不能连累 iOS 成单', async () => {
    const { service, auth, orderModel } = createService();

    await service.createVipPlanOrder(
      auth,
      { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
      { userAgent: IOS_UA }
    );

    expect(orderModel.save).toHaveBeenCalled();
  });

  it('虚拟支付入口拒绝显式自报 iOS，仅 UA 命中的旧客户端放行但告警', async () => {
    const ANDROID_UA =
      'Mozilla/5.0 (Linux; Android 12; BLK-AL80 Build/HUAWEIBLK-AL80; wv) AppleWebKit/537.36 MiniProgramEnv/android';
    // 显式自报 ios：新客户端才会带，说明前端路由错了 → 拒绝，绝不落到 Apple 通道
    const declaredIos = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await expect(
      declaredIos.service.createVipPlanVirtualPaymentOrder(declaredIos.auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
        platform: 'ios',
      })
    ).rejects.toMatchObject({
      code: 'WECHAT_VIRTUAL_PAY_IOS_NOT_ALLOWED',
    });
    expect(declaredIos.orderModel.save).not.toHaveBeenCalled();

    // 仅 UA 命中 iPhone：可能是已发布旧客户端，放行但留告警
    const legacy = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await legacy.service.createVipPlanVirtualPaymentOrder(
      legacy.auth,
      { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
      { userAgent: IOS_UA }
    );
    const legacyLog = (legacy.service.logger.warn as jest.Mock).mock.calls.find(
      call => String(call[0]).includes('route=ios_virtual_legacy_client')
    );
    expect(legacyLog).toBeDefined();

    // 安卓走虚拟支付是正常路径，不该出现 iOS 告警
    const android = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );
    await android.service.createVipPlanVirtualPaymentOrder(
      android.auth,
      { vipPlanId: VIP_PLAN_ID, jsCode: 'wx-code' },
      { userAgent: ANDROID_UA }
    );
    const androidIosWarn = (
      android.service.logger.warn as jest.Mock
    ).mock.calls.find(call => String(call[0]).includes('ios_virtual'));
    expect(androidIosWarn).toBeUndefined();
  });

  it('订单发放权已被并发回调占用时，重复回调不再发放权益', async () => {
    const { service, order, orderModel, userMembershipModel } = createService();

    // 模拟并发：另一个回调/轮询已经用 CAS 把订单抢占成 granting
    orderModel.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    await service.handleWechatPaymentSuccess({
      out_trade_no: ORDER_NO,
      transaction_id: '420000000020260501000123',
      trade_state: 'SUCCESS',
      success_time: '2026-05-01T00:10:00+08:00',
      amount: { total: 990, payer_total: 990 },
    });

    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.pending);
    expect(orderModel.save).not.toHaveBeenCalled();
    const skipLog = (service.logger.warn as jest.Mock).mock.calls.find(call =>
      String(call[0]).includes('重复/并发回调已跳过发放')
    );
    expect(skipLog).toBeDefined();
  });

  it('deducts historical vip payments from a member upgrade order', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000011'),
      status: OrderStatus.completed,
      paidAmount: 990,
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000012'),
      vipPlanCode: 'vip_month',
    });
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      {
        code: 'vip_voice_lifetime',
        name: '声音永久会员',
        planGroup: VipPlanGroup.voice,
        priceAmount: 5000,
        originalPriceAmount: 6000,
        durationDays: undefined,
        lifetime: true,
      },
      {
        memberships: [membership],
        historicalVipOrders: [historicalOrder],
      }
    );

    const result = await service.createVipPlanOrder(
      auth,
      {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      },
      { userAgent: IOS_UA }
    );

    expect(wechatPayService.createVipPlanPrepay).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4010,
      })
    );
    expect(orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        payableAmount: 4010,
        snapshot: expect.objectContaining({
          vipUpgrade: {
            historicalPaidAmount: 990,
            deductedAmount: 990,
            payableAmount: 4010,
          },
        }),
      })
    );
    expect(result.order.payableAmount).toBe(4010);
  });

  it('rechecks vip upgrade credit under the user financial lock before saving', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000021'),
      status: OrderStatus.completed,
      paidAmount: 990,
    });
    const refundClaimedOrder = createOrder({
      id: historicalOrder.id,
      status: OrderStatus.refundRequested,
      paidAmount: 990,
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000022'),
      vipPlanCode: 'vip_month',
    });
    const { service, orderModel, userModel, wechatPayService, auth } =
      createService(
        {},
        {
          code: 'vip_voice_lifetime',
          name: '声音永久会员',
          planGroup: VipPlanGroup.voice,
          priceAmount: 5000,
          durationDays: undefined,
          lifetime: true,
        },
        {
          memberships: [membership],
          historicalVipOrders: [historicalOrder],
        }
      );
    orderModel.find
      .mockResolvedValueOnce([historicalOrder])
      .mockResolvedValueOnce([refundClaimedOrder]);

    const result = await service.createVipPlanOrder(
      auth,
      {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      },
      { userAgent: IOS_UA }
    );

    expect(result.order.payableAmount).toBe(5000);
    expect(wechatPayService.createVipPlanPrepay).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000 })
    );
    expect(orderModel.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payableAmount: 5000,
        snapshot: expect.objectContaining({
          vipUpgrade: {
            historicalPaidAmount: 0,
            deductedAmount: 0,
            payableAmount: 5000,
          },
        }),
      })
    );

    const [preliminaryRead, lockedRead] =
      orderModel.find.mock.invocationCallOrder;
    const [acquireLock, releaseLock] =
      userModel.updateOne.mock.invocationCallOrder;
    const firstSave = orderModel.save.mock.invocationCallOrder[0];
    expect(preliminaryRead).toBeLessThan(acquireLock);
    expect(acquireLock).toBeLessThan(lockedRead);
    expect(lockedRead).toBeLessThan(firstSave);
    expect(firstSave).toBeLessThan(releaseLock);
    expect(userModel.updateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: new MongoObjectId(USER_ID),
        $or: expect.arrayContaining([
          {
            membershipFinancialOperationLock: { $exists: false },
          },
        ]),
      }),
      expect.objectContaining({
        $set: {
          membershipFinancialOperationLock: expect.objectContaining({
            operation: 'vip_upgrade_order_create',
            acquiredAt: expect.any(Date),
            expiresAt: expect.any(Date),
            token: expect.any(String),
          }),
        },
      })
    );
    expect(userModel.getMembershipFinancialOperationLock()).toBeUndefined();
  });

  it('does not save a vip order when another membership financial operation holds the lock', async () => {
    const { service, orderModel, userModel, wechatPayService, auth } =
      createService();
    userModel.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    await expect(
      service.createVipPlanOrder(
        auth,
        {
          vipPlanId: VIP_PLAN_ID,
          jsCode: 'wx-code',
        },
        { userAgent: IOS_UA }
      )
    ).rejects.toMatchObject({
      code: 'MEMBERSHIP_FINANCIAL_OPERATION_BUSY',
      status: 409,
    });

    expect(orderModel.save).not.toHaveBeenCalled();
    expect(wechatPayService.createVipPlanPrepay).not.toHaveBeenCalled();
  });

  it('allows an expired user financial lease to be replaced without letting its stale token release the new lease', async () => {
    const { service, userModel } = createService();
    const firstLease = await (
      service as any
    ).acquireMembershipFinancialOperationLock(new MongoObjectId(USER_ID));

    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000 + 1));
    const secondLease = await (
      service as any
    ).acquireMembershipFinancialOperationLock(new MongoObjectId(USER_ID));

    expect(secondLease.token).not.toBe(firstLease.token);
    expect(userModel.getMembershipFinancialOperationLock()?.token).toBe(
      secondLease.token
    );

    await (service as any).releaseMembershipFinancialOperationLock(firstLease);
    expect(userModel.getMembershipFinancialOperationLock()?.token).toBe(
      secondLease.token
    );

    await (service as any).releaseMembershipFinancialOperationLock(secondLease);
    expect(userModel.getMembershipFinancialOperationLock()).toBeUndefined();
  });

  it('deducts a legacy 99 yuan payment from a 1314 yuan lifetime upgrade', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000015'),
      status: OrderStatus.completed,
      amount: 99,
      payableAmount: 99,
      paidAmount: 99,
      paymentProvider: 'legacy_wechat',
      snapshot: {
        legacy: {
          namespace: 'legacy_mysql',
          orderId: 'legacy-vip-99',
        },
      },
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000016'),
      vipPlanCode: 'legacy_year_member',
    });
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      {
        code: 'vip_lifetime_1314',
        name: '无限期会员',
        planGroup: VipPlanGroup.basic,
        priceAmount: 131400,
        originalPriceAmount: 131400,
        durationDays: undefined,
        lifetime: true,
      },
      {
        memberships: [membership],
        historicalVipOrders: [historicalOrder],
      }
    );

    const result = await service.createVipPlanOrder(
      auth,
      {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      },
      { userAgent: IOS_UA }
    );

    expect(wechatPayService.createVipPlanPrepay).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 121500,
      })
    );
    expect(orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        payableAmount: 121500,
        snapshot: expect.objectContaining({
          vipUpgrade: {
            historicalPaidAmount: 9900,
            deductedAmount: 9900,
            payableAmount: 121500,
          },
        }),
      })
    );
    expect(result.order.payableAmount).toBe(121500);
  });

  it('completes a zero-amount member upgrade without calling WeChat Pay', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000013'),
      status: OrderStatus.completed,
      paidAmount: 7000,
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000014'),
      vipPlanCode: 'vip_month',
    });
    const { service, userMembershipModel, wechatPayService, auth } =
      createService(
        {},
        {
          code: 'vip_voice_lifetime',
          name: '声音永久会员',
          planGroup: VipPlanGroup.voice,
          priceAmount: 5000,
          durationDays: undefined,
          lifetime: true,
        },
        {
          memberships: [membership],
          historicalVipOrders: [historicalOrder],
        }
      );

    const result = await service.createVipPlanOrder(
      auth,
      {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
        supportsZeroAmountOrder: true,
      },
      { userAgent: IOS_UA }
    );

    expect(result.order.payableAmount).toBe(0);
    expect(result.order.status).toBe(OrderStatus.completed);
    expect(result.payment).toBeUndefined();
    expect(wechatPayService.getOpenidByJsCode).not.toHaveBeenCalled();
    expect(wechatPayService.createVipPlanPrepay).not.toHaveBeenCalled();
    expect(userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        vipPlanCode: 'vip_voice_lifetime',
        lifetime: true,
      })
    );
  });

  it('rejects zero-amount upgrades from clients without zero-order support', async () => {
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000015'),
      vipPlanCode: 'vip_month',
    });
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      {
        code: 'vip_voice_lifetime',
        planGroup: VipPlanGroup.voice,
        priceAmount: 5000,
        durationDays: undefined,
        lifetime: true,
      },
      {
        memberships: [membership],
        historicalVipOrders: [
          createOrder({
            status: OrderStatus.completed,
            paidAmount: 5000,
          }),
        ],
      }
    );

    await expect(
      service.createVipPlanOrder(auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({
      code: 'VIP_UPGRADE_ZERO_AMOUNT_UNSUPPORTED',
    });
    expect(orderModel.save).not.toHaveBeenCalled();
    expect(wechatPayService.getOpenidByJsCode).not.toHaveBeenCalled();
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
      messengerService,
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
        payer_total: 976,
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
    expect(messengerService.ensureMessengersForUser).toHaveBeenCalledWith(
      order.userId
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

  it('returns minimal amount mismatch details when WeChat paid amount differs from local order amount', async () => {
    const { service, order, wechatPayService } = createService({
      payableAmount: 12900,
    });

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue({
      out_trade_no: ORDER_NO,
      transaction_id: '420000000020260501000001',
      trade_state: 'SUCCESS',
      success_time: '2026-05-01T00:10:00+08:00',
      amount: {
        total: 990,
        payer_total: 976,
      },
    });

    let error: unknown;

    try {
      await service.closeExpiredWechatOrder(ORDER_ID);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'WECHAT_AMOUNT_MISMATCH',
      data: expect.objectContaining({
        orderId: ORDER_ID,
        orderNo: ORDER_NO,
        expectedAmount: 12900,
        actualAmount: 990,
      }),
    });
    expect(service.logger.warn).toHaveBeenCalled();
    expect(
      (error as { data?: Record<string, unknown> }).data
    ).not.toHaveProperty('wechatTotal');
    expect(
      (error as { data?: Record<string, unknown> }).data
    ).not.toHaveProperty('wechatPayerTotal');
    expect(
      (error as { data?: Record<string, unknown> }).data
    ).not.toHaveProperty('transactionId');
    expect(order.status).toBe(OrderStatus.pending);
  });

  it('grants vip plan entitlements after payment succeeds', async () => {
    const { service, order, agentEntitlementModel, wechatPayService } =
      createService(
        {},
        {
          entitlementGrants: [
            {
              type: AgentEntitlementType.voiceModel,
              totalQuota: 2,
              durationDays: 7,
            },
          ],
        }
      );

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue({
      out_trade_no: ORDER_NO,
      transaction_id: '420000000020260501000002',
      trade_state: 'SUCCESS',
      success_time: '2026-05-01T00:10:00+08:00',
      amount: {
        total: 990,
        payer_total: 990,
      },
    });

    await service.closeExpiredWechatOrder(ORDER_ID);

    expect(agentEntitlementModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: order.userId,
        type: AgentEntitlementType.voiceModel,
        totalQuota: 2,
        usedQuota: 0,
        status: AgentEntitlementStatus.available,
        sourceOrderId: order.id,
        sourceVipPlanId: order.targetId,
      })
    );
  });

  it('creates a voice package order for the selected user agent', async () => {
    const {
      service,
      orderModel,
      voiceTrainingTaskModel,
      wechatPayService,
      queue,
      auth,
    } = createService();

    const result = await service.createVoicePackageOrder(
      auth,
      {
        voicePackageId: VOICE_PACKAGE_ID,
        agentId: AGENT_ID,
        jsCode: 'wx-code',
        materialObjectKeys: ['voice-training-materials/audio-1.m4a'],
        materialDurationSeconds: 72,
      },
      { userAgent: IOS_UA }
    );

    expect(voiceTrainingTaskModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: new MongoObjectId(AGENT_ID),
        }),
        take: 1,
      })
    );
    expect(wechatPayService.createVipPlanPrepay).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '标准声音套餐',
        amount: 12900,
        openid: 'openid-1',
      })
    );
    expect(orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: OrderType.voicePackage,
        targetId: new MongoObjectId(VOICE_PACKAGE_ID),
        targetCode: 'voice_standard',
        agentId: new MongoObjectId(AGENT_ID),
        payableAmount: 12900,
        snapshot: expect.objectContaining({
          voicePackage: expect.objectContaining({
            id: VOICE_PACKAGE_ID,
            code: 'voice_standard',
          }),
          agent: expect.objectContaining({
            id: AGENT_ID,
            name: '奶奶',
          }),
          voiceTrainingMaterialObjectKeys: [
            'voice-training-materials/audio-1.m4a',
          ],
          voiceTrainingMaterialDurationSeconds: 72,
        }),
      })
    );
    expect(queue.addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
      }),
      expect.objectContaining({
        jobId: `order-payment-expire:${ORDER_ID}`,
      })
    );
    expect(result.order).toEqual(
      expect.objectContaining({
        id: ORDER_ID,
        orderType: OrderType.voicePackage,
        targetId: VOICE_PACKAGE_ID,
        agentId: AGENT_ID,
        title: '标准声音套餐',
        payableAmount: 12900,
      })
    );
  });

  // 微信虚拟支付道具是固定价格，goodsPrice 必须与道具价格一致。
  // 升级抵扣会算出动态应付金额，当前模型没有"差价道具"映射，必须 fail-closed，
  // 否则发出去必然被微信拒成 GOODS_PRICE_INVALID。
  it('升级抵扣后的动态应付金额不能用固定价格的虚拟道具下单', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000021'),
      status: OrderStatus.completed,
      paidAmount: 990,
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000022'),
      vipPlanCode: 'vip_month',
    });
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      {
        code: 'vip_voice_lifetime',
        name: '声音永久会员',
        planGroup: VipPlanGroup.voice,
        priceAmount: 5000,
        durationDays: undefined,
        lifetime: true,
        virtualPaymentProductId: 'vip_voice_lifetime_goods',
      },
      { memberships: [membership], historicalVipOrders: [historicalOrder] }
    );

    await expect(
      service.createVipPlanVirtualPaymentOrder(auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_PRICE_MISMATCH',
      message: expect.stringContaining('配置价格匹配的虚拟支付道具'),
    });

    // 不能先建出一笔注定失败的订单，也不能发参数给微信
    expect(orderModel.save).not.toHaveBeenCalled();
    expect(wechatPayService.buildVirtualPaymentParams).not.toHaveBeenCalled();
  });

  it('应付金额与套餐原价一致时虚拟支付照常下单', async () => {
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      { virtualPaymentProductId: 'vip_month_goods' }
    );

    const result = await service.createVipPlanVirtualPaymentOrder(auth, {
      vipPlanId: VIP_PLAN_ID,
      jsCode: 'wx-code',
    });

    expect(wechatPayService.buildVirtualPaymentParams).toHaveBeenCalled();
    // 应付金额与套餐原价一致，才允许用固定价格的虚拟道具下单
    expect(orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 990, payableAmount: 990 })
    );
    expect(result.order.payableAmount).toBe(990);
  });

  it('零元升级仍然直接发放，不触发价格校验', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000031'),
      status: OrderStatus.completed,
      paidAmount: 5000,
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000032'),
      vipPlanCode: 'vip_month',
    });
    const { service, wechatPayService, auth } = createService(
      {},
      {
        code: 'vip_voice_lifetime',
        name: '声音永久会员',
        planGroup: VipPlanGroup.voice,
        priceAmount: 5000,
        durationDays: undefined,
        lifetime: true,
        virtualPaymentProductId: 'vip_voice_lifetime_goods',
      },
      { memberships: [membership], historicalVipOrders: [historicalOrder] }
    );

    const result = await service.createVipPlanVirtualPaymentOrder(auth, {
      vipPlanId: VIP_PLAN_ID,
      jsCode: 'wx-code',
      supportsZeroAmountOrder: true,
    });

    expect(result.order.payableAmount).toBe(0);
    expect(wechatPayService.buildVirtualPaymentParams).not.toHaveBeenCalled();
  });

  it('creates a vip virtual payment order with product id and virtual params', async () => {
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      {
        virtualPaymentProductId: 'vip_month_goods',
      }
    );

    const result = await service.createVipPlanVirtualPaymentOrder(auth, {
      vipPlanId: VIP_PLAN_ID,
      jsCode: 'wx-code',
    });

    expect(wechatPayService.getSessionByJsCode).toHaveBeenCalledWith('wx-code');
    expect(wechatPayService.buildVirtualPaymentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'session-key-1',
        productId: 'vip_month_goods',
        amount: 990,
      })
    );
    expect(orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentProvider: 'wechat_virtual_pay',
        virtualPaymentProductId: 'vip_month_goods',
        virtualPaymentEnv: 1,
        payerOpenid: 'openid-1',
      })
    );
    expect(result.virtualPayment).toEqual({
      mode: 'short_series_goods',
      signData: '{"mock":true}',
      paySig: 'pay-sig',
      signature: 'signature',
    });
  });

  it('releases the user lock before fetching a newly required virtual payment session and then rechecks pricing again', async () => {
    const historicalOrder = createOrder({
      id: new MongoObjectId('665000000000000000000023'),
      status: OrderStatus.completed,
      paidAmount: 5000,
    });
    const refundClaimedOrder = createOrder({
      id: historicalOrder.id,
      status: OrderStatus.refundRequested,
      paidAmount: 5000,
    });
    const membership = createMembership({
      vipPlanId: new MongoObjectId('665000000000000000000024'),
      vipPlanCode: 'vip_month',
    });
    const { service, orderModel, userModel, wechatPayService, auth } =
      createService(
        {},
        {
          code: 'vip_voice_lifetime',
          name: '声音永久会员',
          planGroup: VipPlanGroup.voice,
          lifetime: true,
          durationDays: undefined,
          priceAmount: 5000,
          virtualPaymentProductId: 'vip_voice_lifetime_goods',
        },
        {
          memberships: [membership],
          historicalVipOrders: [historicalOrder],
        }
      );
    orderModel.find
      .mockResolvedValueOnce([historicalOrder])
      .mockResolvedValueOnce([refundClaimedOrder])
      .mockResolvedValueOnce([refundClaimedOrder]);

    const result = await service.createVipPlanVirtualPaymentOrder(auth, {
      vipPlanId: VIP_PLAN_ID,
      jsCode: 'wx-code',
      supportsZeroAmountOrder: true,
    });

    expect(result.order.payableAmount).toBe(5000);
    expect(wechatPayService.getSessionByJsCode).toHaveBeenCalledTimes(1);
    expect(wechatPayService.buildVirtualPaymentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'vip_voice_lifetime_goods',
        amount: 5000,
      })
    );

    const [, firstRelease, secondAcquire, secondRelease] =
      userModel.updateOne.mock.invocationCallOrder;
    const sessionFetch =
      wechatPayService.getSessionByJsCode.mock.invocationCallOrder[0];
    const lockedSave = orderModel.save.mock.invocationCallOrder[0];
    expect(firstRelease).toBeLessThan(sessionFetch);
    expect(sessionFetch).toBeLessThan(secondAcquire);
    expect(secondAcquire).toBeLessThan(lockedSave);
    expect(lockedSave).toBeLessThan(secondRelease);
    expect(orderModel.find).toHaveBeenCalledTimes(3);
    expect(userModel.getMembershipFinancialOperationLock()).toBeUndefined();
  });

  it('creates a voice package virtual payment order with product id', async () => {
    const { service, orderModel, wechatPayService, auth } = createService(
      {},
      {},
      {
        voicePackageOverrides: {
          virtualPaymentProductId: 'voice_standard_goods',
        },
      }
    );

    await service.createVoicePackageVirtualPaymentOrder(auth, {
      voicePackageId: VOICE_PACKAGE_ID,
      agentId: AGENT_ID,
      jsCode: 'wx-code',
    });

    expect(wechatPayService.buildVirtualPaymentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'voice_standard_goods',
        orderNo: expect.stringMatching(/^VOICE/),
        amount: 12900,
      })
    );
    expect(orderModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: OrderType.voicePackage,
        paymentProvider: 'wechat_virtual_pay',
        virtualPaymentProductId: 'voice_standard_goods',
        virtualPaymentEnv: 1,
      })
    );
  });

  it('rejects virtual payment order when product id is missing', async () => {
    const { service, auth, wechatPayService } = createService();

    await expect(
      service.createVipPlanVirtualPaymentOrder(auth, {
        vipPlanId: VIP_PLAN_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({
      code: 'VIP_PLAN_VIRTUAL_PAYMENT_PRODUCT_ID_MISSING',
    });
    expect(wechatPayService.getSessionByJsCode).not.toHaveBeenCalled();
  });

  it('rejects voice package purchase when the agent already has an active training task', async () => {
    const { service, auth, wechatPayService } = createService(
      {},
      {},
      {
        voiceTrainingTasks: [
          createVoiceTrainingTask({
            status: VoiceTrainingTaskStatus.training,
          }),
        ],
      }
    );

    await expect(
      service.createVoicePackageOrder(auth, {
        voicePackageId: VOICE_PACKAGE_ID,
        agentId: AGENT_ID,
        jsCode: 'wx-code',
      })
    ).rejects.toMatchObject({
      code: 'VOICE_TRAINING_TASK_EXISTS',
    });
    expect(wechatPayService.getOpenidByJsCode).not.toHaveBeenCalled();
  });

  it('虚拟支付未支付且已过期时按本地超时关单', async () => {
    const { service, order, wechatPayService } = createService({
      status: OrderStatus.pending,
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
      paymentExpiredAt: new Date(Date.now() - 60 * 1000),
    });

    // 微信侧仍是「已创建未支付」(status=1)，不会自动关闭
    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 1,
    });

    const result = await service.closeExpiredWechatOrder(ORDER_ID);

    expect(order.status).toBe(OrderStatus.closed);
    expect(result?.status).toBe(OrderStatus.closed);
  });

  it('虚拟支付未支付但未过期时保持待支付', async () => {
    const { service, order, wechatPayService } = createService({
      status: OrderStatus.pending,
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
      paymentExpiredAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 1,
    });

    const result = await service.closeExpiredWechatOrder(ORDER_ID);

    expect(order.status).toBe(OrderStatus.pending);
    expect(result?.status).toBe(OrderStatus.pending);
  });

  it('creates a voice training task after voice package payment succeeds', async () => {
    const {
      service,
      order,
      orderModel,
      userMembershipModel,
      voiceTrainingTaskModel,
      wechatPayService,
    } = createService(createVoiceOrder());

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue({
      out_trade_no: VOICE_ORDER_NO,
      transaction_id: '420000000020260501000003',
      trade_state: 'SUCCESS',
      success_time: '2026-05-01T00:10:00+08:00',
      amount: {
        total: 12900,
        payer_total: 12900,
      },
    });

    const result = await service.closeExpiredWechatOrder(ORDER_ID);

    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(voiceTrainingTaskModel.save).toHaveBeenCalledTimes(1);
    expect(voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: order.userId,
        agentId: new MongoObjectId(AGENT_ID),
        orderId: order.id,
        voicePackageId: new MongoObjectId(VOICE_PACKAGE_ID),
        voicePackageCode: 'voice_standard',
        status: VoiceTrainingTaskStatus.paid,
        assigneeName: '',
        materialObjectKeys: [],
        trainingStrategy: VoiceTrainingTaskTrainingStrategy.shortSample,
        paidAt: new Date('2026-05-01T00:10:00+08:00'),
      })
    );
    expect(orderModel.savedSnapshots.map(item => item.status)).toEqual([
      OrderStatus.granting,
      OrderStatus.completed,
    ]);
    expect(result?.status).toBe(OrderStatus.completed);
  });

  it('creates a processing voice training task with uploaded materials', async () => {
    const { service, order, voiceTrainingTaskModel, wechatPayService } =
      createService(
        createVoiceOrder({
          snapshot: {
            voicePackage: {
              id: VOICE_PACKAGE_ID,
              code: 'voice_standard',
              name: '标准声音套餐',
            },
            agent: {
              id: AGENT_ID,
              name: '奶奶',
            },
            voiceTrainingMaterialObjectKeys: [
              ' voice-training-materials/audio-1.m4a ',
              'voice-training-materials/audio-1.m4a',
              '',
              'voice-training-materials/wechat-screenshot-1.jpg',
            ],
            voiceTrainingMaterialDurationSeconds: 75,
          },
        })
      );

    wechatPayService.queryTransactionByOrderNo.mockResolvedValue({
      out_trade_no: VOICE_ORDER_NO,
      transaction_id: '420000000020260501000004',
      trade_state: 'SUCCESS',
      success_time: '2026-05-01T00:10:00+08:00',
      amount: {
        total: 12900,
        payer_total: 12900,
      },
    });

    await service.closeExpiredWechatOrder(ORDER_ID);

    expect(voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: order.userId,
        agentId: new MongoObjectId(AGENT_ID),
        orderId: order.id,
        status: VoiceTrainingTaskStatus.processing,
        materialObjectKeys: [
          'voice-training-materials/audio-1.m4a',
          'voice-training-materials/wechat-screenshot-1.jpg',
        ],
        materialDurationSeconds: 75,
        trainingStrategy: VoiceTrainingTaskTrainingStrategy.longSample,
      })
    );
  });

  it('grants membership after virtual payment goods delivery notify succeeds', async () => {
    const { service, order, userMembershipModel, wechatPayService } =
      createService({
        paymentProvider: 'wechat_virtual_pay',
        payerOpenid: 'openid-1',
        virtualPaymentProductId: 'vip_month_goods',
        virtualPaymentEnv: 1,
      });

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 2,
      paid_fee: 990,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-1',
    });

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-1',
      OutTradeNo: ORDER_NO,
      Env: 1,
      GoodsInfo: {
        ProductId: 'vip_month_goods',
        ActualPrice: 990,
      },
    });

    expect(wechatPayService.queryVirtualOrder).toHaveBeenCalledWith({
      openid: 'openid-1',
      orderNo: ORDER_NO,
      env: 1,
    });
    expect(userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: order.userId,
        sourceOrderId: order.id,
        status: UserMembershipStatus.active,
      })
    );
    expect(order.status).toBe(OrderStatus.completed);
    expect(order.paymentTradeNo).toBe('wxpay-virtual-1');
  });

  it('creates a voice training task after virtual payment notify succeeds', async () => {
    const { service, order, voiceTrainingTaskModel, wechatPayService } =
      createService(
        createVoiceOrder({
          paymentProvider: 'wechat_virtual_pay',
          payerOpenid: 'openid-1',
          virtualPaymentProductId: 'voice_standard_goods',
          virtualPaymentEnv: 1,
        })
      );

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: VOICE_ORDER_NO,
      status: 2,
      paid_fee: 12900,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-2',
    });

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-1',
      OutTradeNo: VOICE_ORDER_NO,
      Env: 1,
      GoodsInfo: {
        ProductId: 'voice_standard_goods',
        ActualPrice: 12900,
      },
    });

    expect(voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: order.userId,
        agentId: new MongoObjectId(AGENT_ID),
        orderId: order.id,
        voicePackageId: new MongoObjectId(VOICE_PACKAGE_ID),
        status: VoiceTrainingTaskStatus.paid,
      })
    );
    expect(order.status).toBe(OrderStatus.completed);
  });

  it('does not duplicate benefits for repeated virtual payment notify', async () => {
    const { service, userMembershipModel, wechatPayService } = createService({
      status: OrderStatus.completed,
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
    });

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 4,
      paid_fee: 990,
    });

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_goods_deliver_notify',
      OpenId: 'openid-1',
      OutTradeNo: ORDER_NO,
      Env: 1,
      GoodsInfo: {
        ProductId: 'vip_month_goods',
        ActualPrice: 990,
      },
    });

    expect(userMembershipModel.save).not.toHaveBeenCalled();
  });

  it('rejects virtual payment notify when amount does not match', async () => {
    const { service, wechatPayService } = createService({
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
    });

    await expect(
      service.handleWechatVirtualPaymentNotify({
        Event: 'xpay_goods_deliver_notify',
        OpenId: 'openid-1',
        OutTradeNo: ORDER_NO,
        Env: 1,
        GoodsInfo: {
          ProductId: 'vip_month_goods',
          ActualPrice: 980,
        },
      })
    ).rejects.toMatchObject({
      code: 'WECHAT_VIRTUAL_PAY_AMOUNT_MISMATCH',
    });
    expect(wechatPayService.queryVirtualOrder).not.toHaveBeenCalled();
  });

  it('marks a virtual payment order refunded after refund notify succeeds', async () => {
    const membership = createMembership();
    const entitlement = createEntitlement();
    const {
      service,
      order,
      orderModel,
      orderRefundModel,
      userMembershipModel,
      agentEntitlementModel,
      wechatPayService,
    } = createService(
      {
        status: OrderStatus.completed,
        paymentProvider: 'wechat_virtual_pay',
        payerOpenid: 'openid-1',
        paidAmount: 990,
        virtualPaymentEnv: 1,
      },
      {},
      {
        memberships: [membership],
        entitlements: [entitlement],
      }
    );

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 5,
      refund_fee: 990,
      left_fee: 0,
    });

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_refund_notify',
      OpenId: 'openid-1',
      MchOrderId: ORDER_NO,
      RefundFee: 990,
      RetCode: 0,
      RefundSuccTimestamp: 1777601000,
    });

    expect(wechatPayService.queryVirtualOrder).toHaveBeenCalledWith({
      openid: 'openid-1',
      orderNo: ORDER_NO,
      env: 1,
    });
    expect(userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: UserMembershipStatus.refunded,
      })
    );
    expect(agentEntitlementModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentEntitlementStatus.refunded,
      })
    );
    expect(order.status).toBe(OrderStatus.refunded);
    expect(order.refundAmount).toBe(990);
    expect(order.refundedAt).toEqual(new Date(1777601000 * 1000));
    expect(orderRefundModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ refundNo: `R${ORDER_NO}` }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          originalOrderNo: ORDER_NO,
          refundType: 'order_refund',
          amount: 990,
        }),
        $set: expect.objectContaining({
          status: 'completed',
          completedAt: new Date(1777601000 * 1000),
        }),
      }),
      { upsert: true }
    );
    expect(
      orderModel.savedSnapshots[orderModel.savedSnapshots.length - 1]
    ).toEqual(
      expect.objectContaining({
        status: OrderStatus.refunded,
        refundAmount: 990,
      })
    );
  });

  it('ignores repeated virtual payment refund notify for refunded orders', async () => {
    const { service, orderModel, userMembershipModel, agentEntitlementModel } =
      createService(
        {
          status: OrderStatus.refunded,
          paymentProvider: 'wechat_virtual_pay',
          payerOpenid: 'openid-1',
          paidAmount: 990,
          refundAmount: 990,
          refundedAt: new Date('2026-05-01T00:20:00.000Z'),
        },
        {},
        {
          memberships: [
            createMembership({ status: UserMembershipStatus.refunded }),
          ],
          entitlements: [
            createEntitlement({ status: AgentEntitlementStatus.refunded }),
          ],
        }
      );

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_refund_notify',
      OpenId: 'openid-1',
      MchOrderId: ORDER_NO,
      RefundFee: 990,
      RetCode: 0,
    });

    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(agentEntitlementModel.save).not.toHaveBeenCalled();
    expect(orderModel.save).not.toHaveBeenCalled();
  });

  it('does not mark a virtual payment order refunded before xpay query_order confirms refund', async () => {
    const {
      service,
      order,
      orderModel,
      userMembershipModel,
      wechatPayService,
    } = createService(
      {
        status: OrderStatus.completed,
        paymentProvider: 'wechat_virtual_pay',
        payerOpenid: 'openid-1',
        paidAmount: 990,
        virtualPaymentEnv: 1,
      },
      {},
      {
        memberships: [createMembership()],
      }
    );

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 4,
      refund_fee: 0,
      left_fee: 990,
    });

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_refund_notify',
      OpenId: 'openid-1',
      MchOrderId: ORDER_NO,
      RefundFee: 990,
      RetCode: 0,
    });

    expect(order.status).toBe(OrderStatus.completed);
    expect(order.refundAmount).toBeUndefined();
    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(orderModel.save).not.toHaveBeenCalled();
  });

  it('does not mark a virtual payment order refunded for partial refunds', async () => {
    const {
      service,
      order,
      orderModel,
      userMembershipModel,
      wechatPayService,
    } = createService(
      {
        status: OrderStatus.completed,
        paymentProvider: 'wechat_virtual_pay',
        payerOpenid: 'openid-1',
        paidAmount: 990,
        virtualPaymentEnv: 1,
      },
      {},
      {
        memberships: [createMembership()],
      }
    );

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 5,
      refund_fee: 500,
      left_fee: 490,
    });

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_refund_notify',
      OpenId: 'openid-1',
      MchOrderId: ORDER_NO,
      RefundFee: 500,
      RetCode: 0,
    });

    expect(order.status).toBe(OrderStatus.completed);
    expect(order.refundAmount).toBeUndefined();
    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(orderModel.save).not.toHaveBeenCalled();
  });

  it('does not mark a virtual payment order refunded when refund notify failed', async () => {
    const { service, order, orderModel, userMembershipModel } = createService(
      {
        status: OrderStatus.completed,
        paymentProvider: 'wechat_virtual_pay',
        payerOpenid: 'openid-1',
        paidAmount: 990,
      },
      {},
      {
        memberships: [createMembership()],
      }
    );

    await service.handleWechatVirtualPaymentNotify({
      Event: 'xpay_refund_notify',
      OpenId: 'openid-1',
      MchOrderId: ORDER_NO,
      RefundFee: 990,
      RetCode: 1,
      RetMsg: 'refund failed',
    });

    expect(order.status).toBe(OrderStatus.completed);
    expect(order.refundAmount).toBeUndefined();
    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(orderModel.save).not.toHaveBeenCalled();
  });

  it('does not create duplicate voice training tasks for repeated payment notifications', async () => {
    const existingTask = createVoiceTrainingTask();
    const { service, voiceTrainingTaskModel } = createService(
      createVoiceOrder(),
      {},
      {
        voiceTrainingTasks: [existingTask],
      }
    );

    await service.handleWechatPaymentSuccess({
      out_trade_no: VOICE_ORDER_NO,
      transaction_id: '420000000020260501000004',
      trade_state: 'SUCCESS',
      success_time: '2026-05-01T00:10:00+08:00',
      amount: {
        total: 12900,
        payer_total: 12900,
      },
    });

    expect(voiceTrainingTaskModel.save).not.toHaveBeenCalled();
  });

  it.each([OrderStatus.refundRequested, OrderStatus.refunded])(
    'does not replay membership grants for a %s order payment notification',
    async status => {
      const membership = createMembership();
      const { service, order, orderModel, userMembershipModel } = createService(
        { status },
        {},
        { memberships: [membership] }
      );

      await service.handleWechatPaymentSuccess({
        out_trade_no: ORDER_NO,
        transaction_id: '420000000020260501000099',
        trade_state: 'SUCCESS',
        success_time: '2026-05-01T00:10:00+08:00',
        amount: {
          total: 990,
          payer_total: 990,
        },
      });

      expect(order.status).toBe(status);
      expect(userMembershipModel.save).not.toHaveBeenCalled();
      expect(orderModel.save).not.toHaveBeenCalled();
    }
  );

  it.each([
    OrderStatus.completed,
    OrderStatus.paid,
    OrderStatus.closed,
    OrderStatus.refundRequested,
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

  it('syncs virtual payment order through xpay query_order', async () => {
    const { service, order, auth, wechatPayService } = createService({
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
      paymentExpiredAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    });

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 2,
      paid_fee: 990,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-3',
    });

    const result = await service.syncUserOrderPayment(auth, ORDER_ID);

    expect(wechatPayService.queryTransactionByOrderNo).not.toHaveBeenCalled();
    expect(wechatPayService.queryVirtualOrder).toHaveBeenCalledWith({
      openid: 'openid-1',
      orderNo: ORDER_NO,
      env: 1,
    });
    expect(wechatPayService.notifyVirtualGoodsProvided).toHaveBeenCalledWith({
      orderNo: ORDER_NO,
      wxOrderId: 'wxpay-virtual-3',
      env: 1,
    });
    expect(order.status).toBe(OrderStatus.completed);
    expect((order as any).virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.provided
    );
    expect((order as any).virtualGoodsProvidedAt).toBeInstanceOf(Date);
    expect(result.status).toBe(OrderStatus.completed);
  });

  it('notifies virtual goods delivery for a completed local order when WeChat is still pending provide', async () => {
    const { service, order, auth, wechatPayService } = createService({
      status: OrderStatus.completed,
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
      paidAmount: 990,
      paidAt: NOW,
    });

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 2,
      paid_fee: 990,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-4',
    });

    const result = await service.syncUserOrderPayment(auth, ORDER_ID);

    expect(wechatPayService.queryVirtualOrder).toHaveBeenCalledWith({
      openid: 'openid-1',
      orderNo: ORDER_NO,
      env: 1,
    });
    expect(wechatPayService.notifyVirtualGoodsProvided).toHaveBeenCalledWith({
      orderNo: ORDER_NO,
      wxOrderId: 'wxpay-virtual-4',
      env: 1,
    });
    expect((order as any).virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.provided
    );
    expect((order as any).virtualGoodsProvidedAt).toBeInstanceOf(Date);
    expect(result.status).toBe(OrderStatus.completed);
  });

  it('records virtual goods delivery failure without breaking user sync', async () => {
    const { service, order, auth, wechatPayService } = createService({
      status: OrderStatus.completed,
      paymentProvider: 'wechat_virtual_pay',
      payerOpenid: 'openid-1',
      virtualPaymentProductId: 'vip_month_goods',
      virtualPaymentEnv: 1,
      paidAmount: 990,
      paidAt: NOW,
    });

    wechatPayService.queryVirtualOrder.mockResolvedValue({
      order_id: ORDER_NO,
      status: 2,
      paid_fee: 990,
      paid_time: 1777600000,
      wxpay_order_id: 'wxpay-virtual-5',
    });
    wechatPayService.notifyVirtualGoodsProvided.mockRejectedValue(
      new Error('bad signature')
    );

    const result = await service.syncUserOrderPayment(auth, ORDER_ID);

    expect(wechatPayService.notifyVirtualGoodsProvided).toHaveBeenCalledWith({
      orderNo: ORDER_NO,
      wxOrderId: 'wxpay-virtual-5',
      env: 1,
    });
    expect((order as any).virtualGoodsProvideStatus).toBe(
      VirtualGoodsProvideStatus.failed
    );
    expect((order as any).virtualGoodsProvidedAt).toBeUndefined();
    expect((order as any).virtualGoodsProvideFailedAt).toEqual(NOW);
    expect((order as any).virtualGoodsProvideError).toBe('bad signature');
    expect(result.status).toBe(OrderStatus.completed);
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

  it('marks a completed vip order refund requested without revoking benefits', async () => {
    const membership = createMembership();
    const entitlement = createEntitlement();
    const {
      service,
      order,
      orderModel,
      userMembershipModel,
      agentEntitlementModel,
      wechatPayService,
      auth,
    } = createService(
      {
        status: OrderStatus.completed,
        paidAmount: 990,
        paidAt: NOW,
      },
      {},
      {
        memberships: [membership],
        entitlements: [entitlement],
      }
    );

    const result = await service.refundUserOrder(auth, ORDER_ID);

    expect(wechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(agentEntitlementModel.save).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.refundRequested);
    expect(order.refundAmount).toBeUndefined();
    expect(order.refundedAt).toBeUndefined();
    expect(
      orderModel.savedSnapshots[orderModel.savedSnapshots.length - 1]
    ).toEqual(
      expect.objectContaining({
        status: OrderStatus.refundRequested,
      })
    );
    expect(result.status).toBe(OrderStatus.refundRequested);
  });

  it('executes an admin refund for a refund requested vip order', async () => {
    const membership = createMembership();
    const entitlement = createEntitlement();
    const {
      service,
      order,
      orderModel,
      orderRefundModel,
      userMembershipModel,
      agentEntitlementModel,
      wechatPayService,
    } = createService(
      {
        status: OrderStatus.refundRequested,
        paidAmount: 990,
        paidAt: NOW,
      },
      {},
      {
        memberships: [membership],
        entitlements: [entitlement],
      }
    );

    const result = await service.refundAdminOrder(ORDER_ID);

    expect(wechatPayService.refundOrder).toHaveBeenCalledWith({
      orderNo: ORDER_NO,
      refundNo: `R${ORDER_NO}`,
      reason: '管理端执行退款',
      amount: 990,
      totalAmount: 990,
    });
    expect(userMembershipModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: UserMembershipStatus.refunded,
        updatedAt: NOW,
      })
    );
    expect(agentEntitlementModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentEntitlementStatus.refunded,
        updatedAt: NOW,
      })
    );
    expect(order.status).toBe(OrderStatus.refunded);
    expect(order.refundAmount).toBe(990);
    expect(order.refundedAt).toEqual(NOW);
    expect(orderRefundModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ refundNo: `R${ORDER_NO}` }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          originalOrderNo: ORDER_NO,
          amount: 990,
        }),
        $set: expect.objectContaining({
          status: 'completed',
          completedAt: NOW,
        }),
      }),
      { upsert: true }
    );
    expect(
      orderModel.savedSnapshots[orderModel.savedSnapshots.length - 1]
    ).toEqual(
      expect.objectContaining({
        status: OrderStatus.refunded,
        refundAmount: 990,
        refundedAt: NOW,
      })
    );
    expect(result.status).toBe(OrderStatus.refunded);
  });

  it('marks a voice package order refund requested without revoking the training task', async () => {
    const task = createVoiceTrainingTask({
      status: VoiceTrainingTaskStatus.paid,
    });
    const {
      service,
      order,
      orderModel,
      userMembershipModel,
      voiceTrainingTaskModel,
      wechatPayService,
      auth,
    } = createService(
      createVoiceOrder({
        status: OrderStatus.completed,
        paidAmount: 12900,
        paidAt: NOW,
      }),
      {},
      {
        voiceTrainingTasks: [task],
      }
    );

    const result = await service.refundUserOrder(auth, ORDER_ID);

    expect(wechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(voiceTrainingTaskModel.save).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.refundRequested);
    expect(order.refundAmount).toBeUndefined();
    expect(order.refundedAt).toBeUndefined();
    expect(
      orderModel.savedSnapshots[orderModel.savedSnapshots.length - 1]
    ).toEqual(
      expect.objectContaining({
        status: OrderStatus.refundRequested,
      })
    );
    expect(result.status).toBe(OrderStatus.refundRequested);
  });

  it('allows requesting a voice package refund after the training task is completed', async () => {
    const { service, auth, wechatPayService } = createService(
      createVoiceOrder({
        status: OrderStatus.completed,
        paidAmount: 12900,
        paidAt: NOW,
      }),
      {},
      {
        voiceTrainingTasks: [
          createVoiceTrainingTask({
            status: VoiceTrainingTaskStatus.completed,
          }),
        ],
      }
    );

    const result = await service.refundUserOrder(auth, ORDER_ID);

    expect(wechatPayService.refundOrder).not.toHaveBeenCalled();
    expect(result.status).toBe(OrderStatus.refundRequested);
  });

  it('rejects user refund for pending orders', async () => {
    const { service, auth, wechatPayService } = createService({
      status: OrderStatus.pending,
    });

    await expect(service.refundUserOrder(auth, ORDER_ID)).rejects.toMatchObject(
      {
        code: 'ORDER_NOT_REFUNDABLE',
      }
    );
    expect(wechatPayService.refundOrder).not.toHaveBeenCalled();
  });
});
