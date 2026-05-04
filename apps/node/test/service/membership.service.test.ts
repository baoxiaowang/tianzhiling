import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntitlementType,
  MongoObjectId,
  UserMembershipEntity,
  UserMembershipStatus,
  VipPlanEntity,
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

function createVipPlan() {
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

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createService(options: {
  memberships?: UserMembershipEntity[];
  entitlements?: AgentEntitlementEntity[];
} = {}) {
  const service = new MembershipService();
  const plan = createVipPlan();

  service.userMembershipModel = {
    find: jest.fn(async ({ where }: any) =>
      (options.memberships ?? []).filter(
        membership =>
          sameObjectId(membership.userId, where?.userId) &&
          membership.status === where?.status
      )
    ),
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
    find: jest.fn().mockResolvedValue([plan]),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;
      return id?.toHexString?.() === VIP_PLAN_ID ? plan : null;
    }),
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

  it('rejects invalid user ids before querying membership tables', async () => {
    const service = createService();
    const invalidAuth = {
      ...auth,
      sub: 'bad-user-id',
    };

    await expect(service.getMembershipStatus(invalidAuth)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(service.userMembershipModel.find).not.toHaveBeenCalled();
  });
});
