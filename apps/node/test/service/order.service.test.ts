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
        result = result.filter(task => sameObjectId(task.agentId, where.agentId));
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
  const userMembershipModel = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async membership => membership),
  };
  const agentEntitlementModel = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async entitlement => entitlement),
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
