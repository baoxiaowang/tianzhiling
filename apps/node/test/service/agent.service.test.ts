import {
  AgentEntity,
  AgentSex,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
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
      agents.filter(agent =>
        sameObjectId(agent.createdUserId, where?.createdUserId)
      )
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
            where?.isDefault === undefined ||
            agent.isDefault === where.isDefault;

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
    save: jest.fn(async entity => {
      if (!entity.id) {
        entity.id = new MongoObjectId();
      }

      return entity;
    }),
  } as any;
  service.messageModel = {
    save: jest.fn(async entity => {
      if (!entity.id) {
        entity.id = new MongoObjectId();
      }

      return entity;
    }),
  } as any;
  service.postImageService = {
    resolveForResponse: jest.fn((value: string) => value),
  } as any;
  service.agentMemoryProfileService = {
    buildInterviewTurn: jest.fn(async ({ draft, input }) => ({
      reply: '谢谢，我记住了。',
      draft: {
        lifeExperience: draft?.lifeExperience || '',
        personalityTraits: input,
        languageHabits: '',
        hobbies: '',
        sharedMemories: '',
      },
      coveredFields: ['personalityTraits'],
      nextFocusField: 'lifeExperience',
      isComplete: false,
    })),
    createMessengerSpeech: jest.fn(async () => ({
      url: 'https://media.example/messenger.wav',
      voice: 'Chinese (Mandarin)_Gentle_Senior',
    })),
    refreshFromMemoryForView: jest.fn(async ({ agent }) => agent),
    alignManualProfileEdits: jest.fn(async ({ agent }) => agent),
  } as any;

  return service;
}

describe('AgentService default agent', () => {
  it('sets the first created agent as default', async () => {
    const agents: AgentEntity[] = [];
    const service = createService(agents);

    const result = await service.createAgent(AUTH, {
      name: '奶奶',
      realName: '王秀兰',
      sex: AgentSex.woman,
      iCallAgent: '奶奶',
      agentCallMe: '小宝',
    });

    expect(result.isDefault).toBe(true);
    expect(result.realName).toBe('王秀兰');
    expect(result.hasUnreadAgentHomeGuide).toBe(true);
    expect(result.hasUnreadAgentProfileGuide).toBe(true);
    expect(agents[0].isDefault).toBe(true);
    expect(agents[0].realName).toBe('王秀兰');
    expect(agents[0].profileCompletionGuideCreatedAt).toBe(agents[0].createdAt);
    expect(service.conversationModel.save).toHaveBeenCalledTimes(1);
    expect(service.messageModel.save).toHaveBeenCalledTimes(1);

    const savedMessage = (service.messageModel.save as jest.Mock).mock
      .calls[0][0];
    expect(savedMessage.conversationId).toBeInstanceOf(MongoObjectId);
    expect(sameObjectId(savedMessage.userId, new MongoObjectId(USER_ID))).toBe(
      true
    );
    expect(sameObjectId(savedMessage.agentId, agents[0].id)).toBe(true);
    expect(savedMessage.role).toBe(MessageRole.assistant);
    expect(savedMessage.type).toBe(MessageType.text);
    expect(savedMessage.content).toBe('小宝，好想你啊，过得好吗？');
    expect(savedMessage.status).toBe(MessageStatus.sent);
    expect(savedMessage.createdAt).toBeInstanceOf(Date);
    expect(savedMessage.updatedAt).toBeInstanceOf(Date);
  });

  it('allows creation when sex cannot be inferred', async () => {
    const agents: AgentEntity[] = [];
    const service = createService(agents);

    const result = await service.createAgent(AUTH, {
      name: '老周',
      sex: AgentSex.unknown,
      iCallAgent: '朋友',
      agentCallMe: '小林',
    });

    expect(result.sex).toBe(AgentSex.unknown);
    expect(agents[0].description).toContain('性别未确定');
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

  it('does not show creation guides for an existing legacy agent', async () => {
    const agent = createAgent(AGENT_A_ID);
    const service = createService([agent]);

    const result = await service.getAgentDetail(AUTH, AGENT_A_ID);

    expect(result.hasUnreadAgentHomeGuide).toBe(false);
    expect(result.hasUnreadAgentProfileGuide).toBe(false);
  });

  it('clears the home and profile creation guides independently', async () => {
    const agent = createAgent(AGENT_A_ID, {
      profileCompletionGuideCreatedAt: NOW,
    });
    const service = createService([agent]);

    const afterHome = await service.markAgentGuideSeen(
      AUTH,
      AGENT_A_ID,
      'agent-home'
    );
    expect(afterHome.hasUnreadAgentHomeGuide).toBe(false);
    expect(afterHome.hasUnreadAgentProfileGuide).toBe(true);

    const afterProfile = await service.markAgentGuideSeen(
      AUTH,
      AGENT_A_ID,
      'agent-profile'
    );
    expect(afterProfile.hasUnreadAgentHomeGuide).toBe(false);
    expect(afterProfile.hasUnreadAgentProfileGuide).toBe(false);
  });

  it('aligns edited profile paragraphs with long-term memory', async () => {
    const agent = createAgent(AGENT_A_ID);
    const service = createService([agent]);

    const result = await service.updateAgentProfile(AUTH, AGENT_A_ID, {
      lifeExperience: '年轻时做木匠，后来在学校负责维修。',
      personalityTraits: '嘴硬心软，遇到大事很直接。',
      languageHabits: '常说“慢慢来”。',
      hobbies: '下象棋、听戏。',
      sharedMemories: '每年夏天一起去河边散步。',
    });

    expect(result.lifeExperience).toBe('年轻时做木匠，后来在学校负责维修。');
    expect(
      service.agentMemoryProfileService.alignManualProfileEdits
    ).toHaveBeenCalledWith({
      userId: new MongoObjectId(USER_ID),
      agent,
      sources: {
        lifeExperience: '年轻时做木匠，后来在学校负责维修。',
        personalityTraits: '嘴硬心软，遇到大事很直接。',
        languageHabits: '常说“慢慢来”。',
        hobbies: '下象棋、听戏。',
        sharedMemories: '每年夏天一起去河边散步。',
      },
    });
  });

  it('runs the independent memory-profile workflow only on its dedicated read', async () => {
    const agent = createAgent(AGENT_A_ID);
    const service = createService([agent]);

    await service.getAgentDetail(AUTH, AGENT_A_ID);
    expect(
      service.agentMemoryProfileService.refreshFromMemoryForView
    ).not.toHaveBeenCalled();

    await service.getAgentMemoryProfile(AUTH, AGENT_A_ID);
    expect(
      service.agentMemoryProfileService.refreshFromMemoryForView
    ).toHaveBeenCalledWith({
      agent,
      userId: new MongoObjectId(USER_ID),
    });
  });

  it('runs a profile interview without saving the agent', async () => {
    const agent = createAgent(AGENT_A_ID);
    const service = createService([agent]);

    const result = await service.interviewAgentProfile(AUTH, AGENT_A_ID, {
      input: '她很温柔，也特别有耐心。',
      draft: {},
      focusField: 'personalityTraits',
      turnCount: 0,
    });

    expect(result.draft.personalityTraits).toContain('很温柔');
    expect(
      service.agentMemoryProfileService.buildInterviewTurn
    ).toHaveBeenCalledWith({
      agent,
      input: '她很温柔，也特别有耐心。',
      draft: {},
      focusField: 'personalityTraits',
      turnCount: 0,
    });
    expect(service.agentModel.save).not.toHaveBeenCalled();
  });

  it('creates profile messenger speech only for the agent owner', async () => {
    const agent = createAgent(AGENT_A_ID);
    const service = createService([agent]);

    const result = await service.createAgentProfileMessengerSpeech(
      AUTH,
      AGENT_A_ID,
      { text: '你好，终于找到你了。' }
    );

    expect(result).toEqual({
      url: 'https://media.example/messenger.wav',
      voice: 'Chinese (Mandarin)_Gentle_Senior',
    });
    expect(
      service.agentMemoryProfileService.createMessengerSpeech
    ).toHaveBeenCalledWith('你好，终于找到你了。');
  });
});
