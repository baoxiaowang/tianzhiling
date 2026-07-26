import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntitlementType,
  ConversationEntity,
  MessageRole,
  MessageStatus,
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipEntity,
  UserMembershipStatus,
  VipPlanEntity,
  VipPlanGroup,
  VipPlanStatus,
} from '@tzl/entities';
import { MembershipService } from '../../src/service/membership.service';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const USER_ID = '665000000000000000000001';
const OTHER_USER_ID = '665000000000000000000009';
const VIP_PLAN_ID = '665000000000000000000003';
const ORDER_ID = '665000000000000000000002';

function createMembership(overrides: Partial<UserMembershipEntity> = {}) {
  const membership = new UserMembershipEntity();

  Object.assign(membership, {
    id: new MongoObjectId('665000000000000000000004'),
    userId: new MongoObjectId(USER_ID),
    vipPlanId: new MongoObjectId(VIP_PLAN_ID),
    vipPlanCode: 'vip_month',
    sourceOrderId: new MongoObjectId(ORDER_ID),
    status: UserMembershipStatus.active,
    startedAt: NOW,
    expiredAt: new Date('2026-06-01T00:00:00.000Z'),
    lifetime: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return membership;
}

function createVipPlan(overrides: Partial<VipPlanEntity> = {}) {
  const plan = new VipPlanEntity();

  Object.assign(plan, {
    id: new MongoObjectId(VIP_PLAN_ID),
    code: 'vip_month',
    name: '月度会员',
    description: '会员权益',
    priceAmount: 990,
    currency: 'CNY',
    durationDays: 31,
    lifetime: false,
    benefits: [],
    status: VipPlanStatus.active,
    sort: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return plan;
}

function createEntitlement(
  overrides: Partial<AgentEntitlementEntity> = {}
): AgentEntitlementEntity {
  const entitlement = new AgentEntitlementEntity();

  Object.assign(entitlement, {
    id: new MongoObjectId(),
    userId: new MongoObjectId(USER_ID),
    type: AgentEntitlementType.voiceModel,
    totalQuota: 2,
    usedQuota: 1,
    status: AgentEntitlementStatus.available,
    sourceOrderId: new MongoObjectId(ORDER_ID),
    sourceVipPlanId: new MongoObjectId(VIP_PLAN_ID),
    activatedAt: NOW,
    expiredAt: new Date('2026-05-08T00:00:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return entitlement;
}

function createPaidVipOrder(overrides: Partial<OrderEntity> = {}) {
  const order = new OrderEntity();

  Object.assign(order, {
    id: new MongoObjectId(),
    orderNo: `VIP${new MongoObjectId().toHexString()}`,
    userId: new MongoObjectId(USER_ID),
    orderType: OrderType.vipPlan,
    title: '会员订单',
    amount: 990,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 990,
    paidAmount: 990,
    currency: 'CNY',
    status: OrderStatus.completed,
    source: OrderSource.weapp,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return order;
}

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createService(
  options: {
    memberships?: UserMembershipEntity[];
    entitlements?: AgentEntitlementEntity[];
    conversationCreatedAt?: Date;
    conversationCount?: number;
    plans?: VipPlanEntity[];
    orders?: OrderEntity[];
  } = {}
) {
  const service = new MembershipService();
  const plan = createVipPlan();
  const plans = options.plans ?? [plan];

  service.userMembershipModel = {
    find: jest.fn(async ({ where }: any) =>
      (options.memberships ?? []).filter(
        membership =>
          sameObjectId(membership.userId, where?.userId) &&
          membership.status === where?.status
      )
    ),
  } as any;
  service.orderModel = {
    find: jest.fn().mockResolvedValue(options.orders ?? []),
  } as any;
  service.agentEntitlementModel = {
    find: jest.fn(async ({ where }: any) =>
      (options.entitlements ?? []).filter(
        entitlement =>
          sameObjectId(entitlement.userId, where?.userId) &&
          entitlement.status === where?.status
      )
    ),
  } as any;
  service.vipPlanModel = {
    find: jest.fn().mockResolvedValue(plans),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;
      return plans.find(item => sameObjectId(item.id, id)) ?? null;
    }),
  } as any;
  service.conversationModel = {
    find: jest.fn(async ({ where }: any) => {
      if (
        !options.conversationCreatedAt ||
        !sameObjectId(where?.userId, new MongoObjectId(USER_ID))
      ) {
        return [];
      }

      return [
        Object.assign(new ConversationEntity(), {
          userId: new MongoObjectId(USER_ID),
          createdAt: options.conversationCreatedAt,
        }),
      ];
    }),
  } as any;
  service.messageModel = {
    count: jest.fn().mockResolvedValue(options.conversationCount ?? 0),
  } as any;

  return service;
}

const auth = {
  sub: USER_ID,
  accountId: 'account-1',
  account: 'test-user',
  iat: 0,
  exp: 0,
  nonce: 'nonce',
};

describe('MembershipService user membership status', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns active user vip status and aggregated available entitlements', async () => {
    const service = createService({
      memberships: [createMembership()],
      entitlements: [
        createEntitlement(),
        createEntitlement({
          totalQuota: 3,
          usedQuota: 0,
          expiredAt: new Date('2026-05-10T00:00:00.000Z'),
        }),
      ],
    });

    const result = await service.getMembershipStatus(auth);

    expect(result.isVip).toBe(true);
    expect(result.membership?.plan?.name).toBe('月度会员');
    expect(result.entitlements).toEqual([
      expect.objectContaining({
        type: AgentEntitlementType.voiceModel,
        totalQuota: 5,
        usedQuota: 1,
        availableQuota: 4,
        expiredAt: '2026-05-10T00:00:00.000Z',
      }),
    ]);
  });

  it('does not leak membership or entitlements from another user', async () => {
    const service = createService({
      memberships: [
        createMembership({
          userId: new MongoObjectId(OTHER_USER_ID),
        }),
      ],
      entitlements: [
        createEntitlement({
          userId: new MongoObjectId(OTHER_USER_ID),
        }),
      ],
    });

    const result = await service.getMembershipStatus(auth);

    expect(service.userMembershipModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: new MongoObjectId(USER_ID),
        }),
      })
    );
    expect(result.isVip).toBe(false);
    expect(result.membership).toBeUndefined();
    expect(result.entitlements).toEqual([]);
  });

  it('returns plans and no membership for a normal user', async () => {
    const service = createService();

    const result = await service.getMembershipCenter(auth);

    expect(result.isVip).toBe(false);
    expect(result.membership).toBeUndefined();
    expect(result.plans).toEqual([
      expect.objectContaining({
        id: VIP_PLAN_ID,
        name: '月度会员',
      }),
    ]);
  });

  it('returns Beijing-day activity stats for a vip purchase center', async () => {
    const service = createService({
      memberships: [createMembership()],
      conversationCreatedAt: new Date('2026-04-28T15:30:00.000Z'),
      conversationCount: 3286,
    });

    const result = await service.getVipPurchaseCenter(auth);

    expect(result).toEqual(
      expect.objectContaining({
        isVip: true,
        serverTime: NOW.toISOString(),
        activityStats: {
          companionshipDays: 3,
          conversationCount: 3286,
        },
      })
    );
    expect(service.messageModel.count).toHaveBeenCalledWith({
      userId: new MongoObjectId(USER_ID),
      role: MessageRole.user,
      status: MessageStatus.sent,
      isArchived: { $ne: true },
    });
  });

  it('returns upgrade payable amounts after deducting historical vip payments', async () => {
    const voiceLifetimePlan = createVipPlan({
      id: new MongoObjectId('665000000000000000000010'),
      code: 'vip_voice_lifetime',
      name: '声音永久会员',
      planGroup: VipPlanGroup.voice,
      priceAmount: 29900,
      originalPriceAmount: 39900,
      durationDays: undefined,
      lifetime: true,
    });
    const service = createService({
      memberships: [createMembership()],
      plans: [createVipPlan(), voiceLifetimePlan],
      orders: [
        createPaidVipOrder({ paidAmount: undefined, payableAmount: 990 }),
        createPaidVipOrder({
          paidAmount: 2000,
          refundAmount: 2000,
          status: OrderStatus.refunded,
        }),
      ],
    });

    const result = await service.getVipPurchaseCenter(auth);
    const upgradePlan = result.plans.find(
      plan => plan.id === voiceLifetimePlan.id.toHexString()
    );

    expect(upgradePlan?.upgradePayableAmount).toBe(28910);
  });

  it('returns zero activity stats when a vip user has no conversation', async () => {
    const service = createService({
      memberships: [createMembership()],
    });

    const result = await service.getVipPurchaseCenter(auth);

    expect(result.activityStats).toEqual({
      companionshipDays: 0,
      conversationCount: 0,
    });
  });

  it('does not query activity tables for a normal purchase-center user', async () => {
    const service = createService();

    const result = await service.getVipPurchaseCenter(auth);

    expect(result.isVip).toBe(false);
    expect(result.plans).toHaveLength(1);
    expect(service.conversationModel.find).not.toHaveBeenCalled();
    expect(service.messageModel.count).not.toHaveBeenCalled();
  });

  it('rejects invalid user ids before querying membership tables', async () => {
    const service = createService();
    const invalidAuth = {
      ...auth,
      sub: 'bad-user-id',
    };

    await expect(
      service.getMembershipStatus(invalidAuth)
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(service.userMembershipModel.find).not.toHaveBeenCalled();
  });

  it('rejects invalid purchase-center user ids before querying any tables', async () => {
    const service = createService();

    await expect(
      service.getVipPurchaseCenter({ ...auth, sub: 'bad-user-id' })
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(service.vipPlanModel.find).not.toHaveBeenCalled();
    expect(service.userMembershipModel.find).not.toHaveBeenCalled();
    expect(service.conversationModel.find).not.toHaveBeenCalled();
    expect(service.messageModel.count).not.toHaveBeenCalled();
  });
});
