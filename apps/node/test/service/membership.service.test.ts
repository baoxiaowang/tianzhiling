import {
  MongoObjectId,
  UserEntitlementEntity,
  UserEntitlementStatus,
  UserEntitlementType,
  UserMembershipEntity,
  UserMembershipStatus,
  VipPlanEntity,
  VipPlanStatus,
} from '@tzl/entities';
import { MembershipService } from '../../src/service/membership.service';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const USER_ID = '665000000000000000000001';
const VIP_PLAN_ID = '665000000000000000000003';

function createMembership(overrides: Partial<UserMembershipEntity> = {}) {
  const membership = new UserMembershipEntity();

  Object.assign(membership, {
    id: new MongoObjectId('665000000000000000000004'),
    userId: new MongoObjectId(USER_ID),
    vipPlanId: new MongoObjectId(VIP_PLAN_ID),
    vipPlanCode: 'vip_month',
    sourceOrderId: new MongoObjectId('665000000000000000000002'),
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
  overrides: Partial<UserEntitlementEntity> = {}
): UserEntitlementEntity {
  const entitlement = new UserEntitlementEntity();

  Object.assign(entitlement, {
    id: new MongoObjectId(),
    userId: new MongoObjectId(USER_ID),
    type: UserEntitlementType.voiceModel,
    totalQuota: 2,
    usedQuota: 1,
    status: UserEntitlementStatus.available,
    sourceOrderId: new MongoObjectId('665000000000000000000002'),
    sourceVipPlanId: new MongoObjectId(VIP_PLAN_ID),
    activatedAt: NOW,
    expiredAt: new Date('2026-05-08T00:00:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return entitlement;
}

describe('MembershipService membership status', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns active vip status and aggregated available entitlements', async () => {
    const service = new MembershipService();
    const membership = createMembership();
    const plan = createVipPlan();

    service.userMembershipModel = {
      find: jest.fn().mockResolvedValue([membership]),
    } as any;
    service.userEntitlementModel = {
      find: jest.fn().mockResolvedValue([
        createEntitlement(),
        createEntitlement({
          totalQuota: 3,
          usedQuota: 0,
          expiredAt: new Date('2026-05-10T00:00:00.000Z'),
        }),
      ]),
    } as any;
    service.vipPlanModel = {
      findOne: jest.fn(async ({ where }: any) => {
        const id = where?.id ?? where?._id;
        return id?.toHexString?.() === VIP_PLAN_ID ? plan : null;
      }),
    } as any;

    const result = await service.getMembershipStatus({
      sub: USER_ID,
      accountId: 'account-1',
      account: 'test-user',
      iat: 0,
      exp: 0,
      nonce: 'nonce',
    });

    expect(result.isVip).toBe(true);
    expect(result.membership?.plan?.name).toBe('月度会员');
    expect(result.entitlements).toEqual([
      expect.objectContaining({
        type: UserEntitlementType.voiceModel,
        totalQuota: 5,
        usedQuota: 1,
        availableQuota: 4,
        expiredAt: '2026-05-10T00:00:00.000Z',
      }),
    ]);
  });
});
