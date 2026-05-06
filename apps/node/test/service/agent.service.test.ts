import { AgentEntity, AgentSex, MongoObjectId } from '@tzl/entities';
import { AgentService } from '../../src/service/agent.service';

const USER_ID = '665000000000000000000001';
const AGENT_A_ID = '665000000000000000000010';
const AGENT_B_ID = '665000000000000000000011';
const NOW = new Date('2026-05-06T08:00:00.000Z');
const AUTH = {
  sub: USER_ID,
  accountId: 'account-1',
  account: 'user',
  iat: 1778054400,
  exp: 1778083200,
  nonce: 'nonce',
};

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createAgent(
  id: string,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(id),
    createdUserId: new MongoObjectId(USER_ID),
    name: '奶奶',
    avatar: '',
    sex: AgentSex.woman,
    iCallAgent: '奶奶',
    agentCallMe: '小宝',
    description: '',
    lifeExperience: '',
    personalityTraits: '',
    languageHabits: '',
    hobbies: '',
    sharedMemories: '',
    status: 1,
    isDefault: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return agent;
}

function createService(agents: AgentEntity[] = []) {
  const service = new AgentService();

  service.agentModel = {
    find: jest.fn(async ({ where }: any) =>
      agents.filter(agent => sameObjectId(agent.createdUserId, where?.createdUserId))
    ),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return (
        agents.find(agent => {
          const matchesId = id ? sameObjectId(agent.id, id) : true;
          const matchesUser = where?.createdUserId
            ? sameObjectId(agent.createdUserId, where.createdUserId)
            : true;
          const matchesDefault =
            where?.isDefault === undefined || agent.isDefault === where.isDefault;

          return matchesId && matchesUser && matchesDefault;
        }) ?? null
      );
    }),
    save: jest.fn(async (agent: AgentEntity) => {
      if (!agent.id) {
        agent.id = new MongoObjectId();
      }

      const index = agents.findIndex(item => sameObjectId(item.id, agent.id));
      if (index >= 0) {
        agents[index] = agent;
      } else {
        agents.push(agent);
      }

      return agent;
    }),
  } as any;
  service.conversationModel = {
    save: jest.fn(async entity => entity),
  } as any;
  service.messageModel = {} as any;
  service.postImageService = {
    resolveForResponse: jest.fn((value: string) => value),
  } as any;

  return service;
}

describe('AgentService default agent', () => {
  it('sets the first created agent as default', async () => {
    const agents: AgentEntity[] = [];
    const service = createService(agents);

    const result = await service.createAgent(AUTH, {
      name: '奶奶',
      sex: AgentSex.woman,
      iCallAgent: '奶奶',
      agentCallMe: '小宝',
    });

    expect(result.isDefault).toBe(true);
    expect(agents[0].isDefault).toBe(true);
  });

  it('clears the previous default when another agent is set as default', async () => {
    const firstAgent = createAgent(AGENT_A_ID, { isDefault: true });
    const secondAgent = createAgent(AGENT_B_ID, { isDefault: false });
    const service = createService([firstAgent, secondAgent]);

    const result = await service.updateAgentDefault(AUTH, AGENT_B_ID, {
      isDefault: true,
    });

    expect(result.id).toBe(AGENT_B_ID);
    expect(result.isDefault).toBe(true);
    expect(firstAgent.isDefault).toBe(false);
    expect(secondAgent.isDefault).toBe(true);
  });
});
