import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntitlementType,
  AgentEntity,
  AgentMembershipEntity,
  AgentMembershipStatus,
  AgentSex,
  MongoObjectId,
  VipPlanEntity,
  VipPlanStatus,
} from '@tzl/entities';
import { MembershipService } from '../../src/service/membership.service';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const USER_ID = '665000000000000000000001';
const OTHER_USER_ID = '665000000000000000000009';
const AGENT_ID = '665000000000000000000010';
const OTHER_AGENT_ID = '665000000000000000000011';
const VIP_PLAN_ID = '665000000000000000000003';
const ORDER_ID = '665000000000000000000002';

function createAgent(overrides: Partial<AgentEntity> = {}) {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: new MongoObjectId(USER_ID),
    name: '奶奶',
    avatar: '',
    sex: AgentSex.woman,
    iCallAgent: '奶奶',
    agentCallMe: '小宝',
    description: '',
    status: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return agent;
}

function createMembership(overrides: Partial<AgentMembershipEntity> = {}) {
  const membership = new AgentMembershipEntity();

  Object.assign(membership, {
    id: new MongoObjectId('665000000000000000000004'),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    vipPlanId: new MongoObjectId(VIP_PLAN_ID),
    vipPlanCode: 'vip_month',
    sourceOrderId: new MongoObjectId(ORDER_ID),
    status: AgentMembershipStatus.active,
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
    agentId: new MongoObjectId(AGENT_ID),
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
  agent?: AgentEntity | null;
  memberships?: AgentMembershipEntity[];
  entitlements?: AgentEntitlementEntity[];
} = {}) {
  const service = new MembershipService();
  const plan = createVipPlan();
  const agent = options.agent === undefined ? createAgent() : options.agent;

  service.agentModel = {
    findOne: jest.fn(async ({ where }: any) => {
      if (!agent) {
        return null;
      }

      return sameObjectId(where?.id, agent.id) &&
        sameObjectId(where?.createdUserId, agent.createdUserId)
        ? agent
        : null;
    }),
  } as any;
  service.agentMembershipModel = {
    find: jest.fn(async ({ where }: any) =>
      (options.memberships ?? []).filter(
        membership =>
          sameObjectId(membership.userId, where?.userId) &&
          sameObjectId(membership.agentId, where?.agentId) &&
          membership.status === where?.status
      )
    ),
  } as any;
  service.agentEntitlementModel = {
    find: jest.fn(async ({ where }: any) =>
      (options.entitlements ?? []).filter(
        entitlement =>
          sameObjectId(entitlement.userId, where?.userId) &&
          sameObjectId(entitlement.agentId, where?.agentId) &&
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

describe('MembershipService agent membership status', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns active vip status and aggregated available entitlements for the selected agent', async () => {
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

    const result = await service.getMembershipStatus(auth, AGENT_ID);

    expect(result.agentId).toBe(AGENT_ID);
    expect(result.isVip).toBe(true);
    expect(result.membership?.agentId).toBe(AGENT_ID);
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

  it('does not leak a vip membership from another agent of the same user', async () => {
    const service = createService({
      memberships: [
        createMembership({
          agentId: new MongoObjectId(OTHER_AGENT_ID),
        }),
      ],
      entitlements: [
        createEntitlement({
          agentId: new MongoObjectId(OTHER_AGENT_ID),
        }),
      ],
    });

    const result = await service.getMembershipStatus(auth, AGENT_ID);

    expect(service.agentMembershipModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: new MongoObjectId(AGENT_ID),
        }),
      })
    );
    expect(result.isVip).toBe(false);
    expect(result.membership).toBeUndefined();
  });

  it('rejects agents that are not owned by the current user', async () => {
    const service = createService({
      agent: createAgent({
        createdUserId: new MongoObjectId(OTHER_USER_ID),
      }),
    });

    await expect(service.getMembershipCenter(auth, AGENT_ID)).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('rejects invalid agent ids before querying membership tables', async () => {
    const service = createService();

    await expect(service.getMembershipStatus(auth, 'bad-agent-id')).rejects.toMatchObject({
      code: 'INVALID_AGENT_ID',
    });
    expect(service.agentMembershipModel.find).not.toHaveBeenCalled();
  });
});
