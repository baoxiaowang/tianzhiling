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
  VipPlanStatus,
  VoicePackageEntity,
  VoicePackageStatus,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
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
  } = {}
) {
  const service = new OrderService();
  const order = createOrder(orderOverrides);
  const plan = createVipPlan(planOverrides);
  const voicePackage = createVoicePackage(options.voicePackageOverrides);
  const agent = createAgent(options.agentOverrides);
  const orderModel = createOrderModel(order);
  const vipPlanModel = createVipPlanModel(plan);
  const voicePackageModel = createVoicePackageModel(voicePackage);
  const agentModel = createAgentModel(agent);
  const voiceTrainingTaskModel = createVoiceTrainingTaskModel(
    options.voiceTrainingTasks
  );
  const memberships = options.memberships ?? [];
  const entitlements = options.entitlements ?? [];
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

  service.logger = {
    warn: jest.fn(),
  } as any;
  service.orderModel = orderModel as any;
  service.vipPlanModel = vipPlanModel as any;
  service.voicePackageModel = voicePackageModel as any;
  service.agentModel = agentModel as any;
  service.userMembershipModel = userMembershipModel as any;
  service.agentEntitlementModel = agentEntitlementModel as any;
  service.voiceTrainingTaskModel = voiceTrainingTaskModel as any;
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
    voicePackage,
    voicePackageModel,
    agent,
    agentModel,
    voiceTrainingTaskModel,
    userMembershipModel,
    agentEntitlementModel,
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

    const result = await service.createVoicePackageOrder(auth, {
      voicePackageId: VOICE_PACKAGE_ID,
      agentId: AGENT_ID,
      jsCode: 'wx-code',
    });

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

    expect(wechatPayService.getSessionByJsCode).toHaveBeenCalledWith(
      'wx-code'
    );
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
        paidAt: new Date('2026-05-01T00:10:00+08:00'),
      })
    );
    expect(orderModel.savedSnapshots.map(item => item.status)).toEqual([
      OrderStatus.granting,
      OrderStatus.completed,
    ]);
    expect(result?.status).toBe(OrderStatus.completed);
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
    const { service, order, orderModel, userMembershipModel, wechatPayService } =
      createService(
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
    const { service, order, orderModel, userMembershipModel, wechatPayService } =
      createService(
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

  it('refunds a completed vip order and revokes membership benefits', async () => {
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

    expect(wechatPayService.refundOrder).toHaveBeenCalledWith({
      orderNo: ORDER_NO,
      refundNo: `R${ORDER_NO}`,
      reason: '用户申请退款',
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

  it('refunds a voice package order and marks the training task refunded', async () => {
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

    expect(wechatPayService.refundOrder).toHaveBeenCalledWith({
      orderNo: VOICE_ORDER_NO,
      refundNo: `R${VOICE_ORDER_NO}`,
      reason: '用户申请退款',
      amount: 12900,
      totalAmount: 12900,
    });
    expect(userMembershipModel.save).not.toHaveBeenCalled();
    expect(voiceTrainingTaskModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VoiceTrainingTaskStatus.refunded,
        updatedAt: NOW,
      })
    );
    expect(order.status).toBe(OrderStatus.refunded);
    expect(order.refundAmount).toBe(12900);
    expect(order.refundedAt).toEqual(NOW);
    expect(
      orderModel.savedSnapshots[orderModel.savedSnapshots.length - 1]
    ).toEqual(
      expect.objectContaining({
        status: OrderStatus.refunded,
        refundAmount: 12900,
        refundedAt: NOW,
      })
    );
    expect(result.status).toBe(OrderStatus.refunded);
  });

  it('rejects voice package refund after the training task is completed', async () => {
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

    await expect(service.refundUserOrder(auth, ORDER_ID)).rejects.toMatchObject(
      {
        code: 'VOICE_PACKAGE_ALREADY_COMPLETED',
      }
    );
    expect(wechatPayService.refundOrder).not.toHaveBeenCalled();
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
