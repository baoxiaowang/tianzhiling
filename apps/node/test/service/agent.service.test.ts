import {
  AgentEntity,
  AgentShareInviteEntity,
  AgentShareInviteStatus,
  AgentShareMemberEntity,
  AgentShareMemberStatus,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  UserEntity,
} from '@tzl/entities';
import { AgentService } from '../../src/service/agent.service';

const USER_ID = '665000000000000000000001';
const SHARED_USER_ID = '665000000000000000000002';
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
const SHARED_AUTH = {
  sub: SHARED_USER_ID,
  accountId: 'account-2',
  account: 'shared-user',
  iat: 1778054400,
  exp: 1778083200,
  nonce: 'nonce-shared',
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

function createService(
  agents: AgentEntity[] = [],
  options: {
    shareInvites?: AgentShareInviteEntity[];
    shareMembers?: AgentShareMemberEntity[];
    conversations?: ConversationEntity[];
    messages?: MessageEntity[];
  } = {}
) {
  const shareInvites = options.shareInvites ?? [];
  const shareMembers = options.shareMembers ?? [];
  const conversations = options.conversations ?? [];
  const messages = options.messages ?? [];
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
    find: jest.fn(async ({ where }: any) =>
      conversations.filter(conversation => {
        const matchesAgent = where?.agentId
          ? sameObjectId(conversation.agentId, where.agentId)
          : true;
        const matchesUser = where?.userId
          ? sameObjectId(conversation.userId, where.userId)
          : true;

        return matchesAgent && matchesUser;
      })
    ),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        conversations.find(conversation => {
          const matchesAgent = where?.agentId
            ? sameObjectId(conversation.agentId, where.agentId)
            : true;
          const matchesUser = where?.userId
            ? sameObjectId(conversation.userId, where.userId)
            : true;

          return matchesAgent && matchesUser;
        }) ?? null
      );
    }),
    save: jest.fn(async entity => {
      if (!entity.id) {
        entity.id = new MongoObjectId();
      }

      const index = conversations.findIndex(item =>
        sameObjectId(item.id, entity.id)
      );
      if (index >= 0) {
        conversations[index] = entity;
      } else {
        conversations.push(entity);
      }

      return entity;
    }),
    remove: jest.fn(async entity => {
      const index = conversations.findIndex(item =>
        sameObjectId(item.id, entity.id)
      );
      if (index >= 0) {
        conversations.splice(index, 1);
      }

      return entity;
    }),
  } as any;
  service.messageModel = {
    find: jest.fn(async ({ where }: any) =>
      messages.filter(message => {
        const matchesConversation = where?.conversationId
          ? sameObjectId(message.conversationId, where.conversationId)
          : true;

        return matchesConversation;
      })
    ),
    save: jest.fn(async entity => {
      if (!entity.id) {
        entity.id = new MongoObjectId();
      }

      const index = messages.findIndex(item => sameObjectId(item.id, entity.id));
      if (index >= 0) {
        messages[index] = entity;
      } else {
        messages.push(entity);
      }

      return entity;
    }),
    remove: jest.fn(async entity => {
      const index = messages.findIndex(item => sameObjectId(item.id, entity.id));
      if (index >= 0) {
        messages.splice(index, 1);
      }

      return entity;
    }),
  } as any;
  service.agentShareInviteModel = {
    find: jest.fn(async ({ where }: any) =>
      shareInvites.filter(invite => {
        const matchesAgent = where?.agentId
          ? sameObjectId(invite.agentId, where.agentId)
          : true;
        const matchesTokenHash =
          where?.tokenHash === undefined || invite.tokenHash === where.tokenHash;
        const matchesStatus =
          where?.status === undefined || invite.status === where.status;

        return matchesAgent && matchesTokenHash && matchesStatus;
      })
    ),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        shareInvites.find(invite => {
          const matchesAgent = where?.agentId
            ? sameObjectId(invite.agentId, where.agentId)
            : true;
          const matchesTokenHash =
            where?.tokenHash === undefined ||
            invite.tokenHash === where.tokenHash;
          const matchesStatus =
            where?.status === undefined || invite.status === where.status;

          return matchesAgent && matchesTokenHash && matchesStatus;
        }) ?? null
      );
    }),
    save: jest.fn(async entity => {
      if (!entity.id) {
        entity.id = new MongoObjectId();
      }

      const index = shareInvites.findIndex(item =>
        sameObjectId(item.id, entity.id)
      );
      if (index >= 0) {
        shareInvites[index] = entity;
      } else {
        shareInvites.push(entity);
      }

      return entity;
    }),
    remove: jest.fn(async entity => {
      const index = shareInvites.findIndex(item =>
        sameObjectId(item.id, entity.id)
      );
      if (index >= 0) {
        shareInvites.splice(index, 1);
      }

      return entity;
    }),
  } as any;
  service.agentShareMemberModel = {
    find: jest.fn(async ({ where }: any) =>
      shareMembers.filter(member => {
        const matchesAgent = where?.agentId
          ? sameObjectId(member.agentId, where.agentId)
          : true;
        const matchesUser = where?.userId
          ? sameObjectId(member.userId, where.userId)
          : true;
        const matchesStatus =
          where?.status === undefined || member.status === where.status;

        return matchesAgent && matchesUser && matchesStatus;
      })
    ),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        shareMembers.find(member => {
          const matchesAgent = where?.agentId
            ? sameObjectId(member.agentId, where.agentId)
            : true;
          const matchesUser = where?.userId
            ? sameObjectId(member.userId, where.userId)
            : true;
          const matchesStatus =
            where?.status === undefined || member.status === where.status;

          return matchesAgent && matchesUser && matchesStatus;
        }) ?? null
      );
    }),
    save: jest.fn(async entity => {
      if (!entity.id) {
        entity.id = new MongoObjectId();
      }

      const index = shareMembers.findIndex(item =>
        sameObjectId(item.id, entity.id)
      );
      if (index >= 0) {
        shareMembers[index] = entity;
      } else {
        shareMembers.push(entity);
      }

      return entity;
    }),
    remove: jest.fn(async entity => {
      const index = shareMembers.findIndex(item =>
        sameObjectId(item.id, entity.id)
      );
      if (index >= 0) {
        shareMembers.splice(index, 1);
      }

      return entity;
    }),
  } as any;
  service.userModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const user = new UserEntity();
      user.id = where.id;
      user.name = sameObjectId(where.id, new MongoObjectId(USER_ID))
        ? '邀请人'
        : '亲友';
      user.avatar = '';
      return user;
    }),
  } as any;
  service.messengerService = {
    ensureMessengerForAgent: jest.fn(async (agent: AgentEntity) =>
      createAgent(AGENT_B_ID, {
        createdUserId: agent.createdUserId,
        name: `${agent.name}的小使者`,
        messengerOfAgentId: agent.id,
      })
    ),
    ensureMessengerConversation: jest.fn(async () => new ConversationEntity()),
  } as any;
  service.logger = {
    warn: jest.fn(),
  } as any;
  service.wechatPayService = {
    createUnlimitedMiniProgramCode: jest.fn(async () => ({
      buffer: Buffer.from('png'),
      mimeType: 'image/png',
    })),
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

  it('silently creates a messenger agent for every new relative', async () => {
    const agents: AgentEntity[] = [];
    const service = createService(agents);

    await service.createAgent(AUTH, {
      name: '奶奶',
      sex: AgentSex.woman,
      iCallAgent: '奶奶',
      agentCallMe: '小宝',
    });

    expect(
      service.messengerService.ensureMessengerForAgent
    ).toHaveBeenCalledWith(agents[0]);
    expect(
      service.messengerService.ensureMessengerConversation
    ).not.toHaveBeenCalled();
  });

  it('silently creates a messenger agent for a non-member', async () => {
    const agents: AgentEntity[] = [];
    const service = createService(agents);

    await service.createAgent(AUTH, {
      name: '奶奶',
      sex: AgentSex.woman,
      iCallAgent: '奶奶',
      agentCallMe: '小宝',
    });

    expect(
      service.messengerService.ensureMessengerForAgent
    ).toHaveBeenCalledWith(agents[0]);
    expect(
      service.messengerService.ensureMessengerConversation
    ).not.toHaveBeenCalled();
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

  it('keeps the legacy list owner-only and exposes shared agents separately', async () => {
    const sharedAgent = createAgent(AGENT_A_ID);
    const member = new AgentShareMemberEntity();
    member.agentId = sharedAgent.id;
    member.ownerUserId = sharedAgent.createdUserId;
    member.userId = new MongoObjectId(SHARED_USER_ID);
    member.status = AgentShareMemberStatus.active;
    member.acceptedAt = NOW;
    member.createdAt = NOW;
    member.updatedAt = NOW;
    const service = createService([sharedAgent], {
      shareMembers: [member],
    });

    await expect(service.listAgents(SHARED_AUTH)).resolves.toEqual([]);

    const accessibleAgents = await service.listAccessibleAgents(SHARED_AUTH);
    expect(accessibleAgents).toHaveLength(1);
    expect(accessibleAgents[0]).toMatchObject({
      id: AGENT_A_ID,
      accessRole: 'shared',
      isDefault: false,
    });
  });

  it('creates a share invite without storing the raw token', async () => {
    const agent = createAgent(AGENT_A_ID);
    const shareInvites: AgentShareInviteEntity[] = [];
    const service = createService([agent], { shareInvites });

    const result = await service.createAgentShareInvite(AUTH, AGENT_A_ID);

    expect(result.agentId).toBe(AGENT_A_ID);
    expect(result.ownerUserId).toBe(USER_ID);
    expect(result.createdByUserId).toBe(USER_ID);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(result.token).toHaveLength(32);
    expect(result.expiresAt).toBeTruthy();
    expect(shareInvites).toHaveLength(1);
    expect(shareInvites[0].tokenHash).toBeTruthy();
    expect(shareInvites[0].tokenHash).not.toBe(result.token);
    expect(shareInvites[0].status).toBe(AgentShareInviteStatus.active);
  });

  it('accepts a share invite with an independent conversation for the invited user', async () => {
    const agent = createAgent(AGENT_A_ID, {
      isDefault: true,
      profileCompletionGuideCreatedAt: NOW,
    });
    const shareInvites: AgentShareInviteEntity[] = [];
    const shareMembers: AgentShareMemberEntity[] = [];
    const conversations: ConversationEntity[] = [];
    const messages: MessageEntity[] = [];
    const service = createService([agent], {
      shareInvites,
      shareMembers,
      conversations,
      messages,
    });
    const invite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);

    const accepted = await service.acceptAgentShareInvite(SHARED_AUTH, {
      token: invite.token,
    });

    expect(accepted.agent.id).toBe(AGENT_A_ID);
    expect(accepted.agent.isDefault).toBe(false);
    expect(accepted.agent.hasUnreadAgentHomeGuide).toBe(false);
    expect(accepted.agent.accessRole).toBe('shared');
    expect(accepted.agent.agentCallMe).toBe('');
    expect(accepted.agent.iCallAgent).toBe('奶奶');
    expect(accepted.share).toMatchObject({
      agentId: AGENT_A_ID,
      ownerUserId: USER_ID,
      userId: SHARED_USER_ID,
      status: 'active',
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0].accessRole).toBe('shared');
    expect(accepted.conversationId).toBe(
      conversations[0].id.toHexString()
    );
    expect(
      sameObjectId(
        conversations[0].userId,
        new MongoObjectId(SHARED_USER_ID)
      )
    ).toBe(true);
    expect(sameObjectId(conversations[0].agentId, agent.id)).toBe(true);
    expect(shareMembers).toHaveLength(1);
    expect(shareMembers[0].status).toBe(AgentShareMemberStatus.active);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('好想你啊，过得好吗？');

    const sharedDetail = await service.getAgentDetail(
      SHARED_AUTH,
      AGENT_A_ID
    );
    expect(sharedDetail.id).toBe(AGENT_A_ID);
    expect(sharedDetail.isDefault).toBe(false);
    expect(sharedDetail.accessRole).toBe('shared');
  });

  it('keeps accepting the same share invite idempotent for conversation and membership', async () => {
    const agent = createAgent(AGENT_A_ID);
    const shareInvites: AgentShareInviteEntity[] = [];
    const shareMembers: AgentShareMemberEntity[] = [];
    const conversations: ConversationEntity[] = [];
    const messages: MessageEntity[] = [];
    const service = createService([agent], {
      shareInvites,
      shareMembers,
      conversations,
      messages,
    });
    const invite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);

    const first = await service.acceptAgentShareInvite(SHARED_AUTH, {
      token: invite.token,
    });
    const second = await service.acceptAgentShareInvite(SHARED_AUTH, {
      token: invite.token,
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(conversations).toHaveLength(1);
    expect(shareMembers).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(shareInvites[0].acceptedCount).toBe(1);
  });

  it('previews an invitation without exposing private relationship copy', async () => {
    const agent = createAgent(AGENT_A_ID, {
      realName: '王秀兰',
      description: '你称呼她为奶奶，她会叫你小宝。',
    });
    const shareInvites: AgentShareInviteEntity[] = [];
    const service = createService([agent], { shareInvites });
    const invite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);

    const preview = await service.getAgentShareInvitePreview(invite.token);

    expect(preview.inviter.name).toBe('邀请人');
    expect(preview.agent).toMatchObject({
      name: '奶奶',
      realName: '王秀兰',
      description: '',
    });
    expect(JSON.stringify(preview)).not.toContain('小宝');
  });

  it('generates a mini program code with the invitation token as scene', async () => {
    const agent = createAgent(AGENT_A_ID);
    const shareInvites: AgentShareInviteEntity[] = [];
    const service = createService([agent], { shareInvites });
    const invite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);

    const result = await service.createAgentShareQRCode(AUTH, {
      token: invite.token,
    });

    expect(
      service.wechatPayService.createUnlimitedMiniProgramCode
    ).toHaveBeenCalledWith({
      scene: invite.token,
      page: 'pages/agent-share/index',
    });
    expect(result.imageBase64).toBe(Buffer.from('png').toString('base64'));
  });

  it('stores the invited users call name without changing the owner profile', async () => {
    const agent = createAgent(AGENT_A_ID);
    const shareInvites: AgentShareInviteEntity[] = [];
    const shareMembers: AgentShareMemberEntity[] = [];
    const conversations: ConversationEntity[] = [];
    const service = createService([agent], {
      shareInvites,
      shareMembers,
      conversations,
    });
    const invite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);
    await service.acceptAgentShareInvite(SHARED_AUTH, { token: invite.token });

    const sharedProfile = await service.updateAgentShareContext(
      SHARED_AUTH,
      AGENT_A_ID,
      { agentCallsUser: '闺女' }
    );

    expect(sharedProfile.agentCallMe).toBe('闺女');
    expect(sharedProfile.iCallAgent).toBe('奶奶');
    expect(shareMembers[0].agentCallsUser).toBe('闺女');
    expect(conversations[0].agentCallsUser).toBe('闺女');
    expect(agent.agentCallMe).toBe('小宝');
  });

  it('keeps creating share invites limited to the agent owner', async () => {
    const agent = createAgent(AGENT_A_ID);
    const shareInvites: AgentShareInviteEntity[] = [];
    const shareMembers: AgentShareMemberEntity[] = [];
    const conversations: ConversationEntity[] = [];
    const messages: MessageEntity[] = [];
    const service = createService([agent], {
      shareInvites,
      shareMembers,
      conversations,
      messages,
    });
    const ownerInvite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);
    await service.acceptAgentShareInvite(SHARED_AUTH, {
      token: ownerInvite.token,
    });

    await expect(
      service.createAgentShareInvite(SHARED_AUTH, AGENT_A_ID)
    ).rejects.toMatchObject({
      code: 'AGENT_SHARE_OWNER_REQUIRED',
      status: 403,
    });
    expect(shareInvites).toHaveLength(1);
  });

  it('rejects expired share invites', async () => {
    const agent = createAgent(AGENT_A_ID);
    const shareInvites: AgentShareInviteEntity[] = [];
    const service = createService([agent], { shareInvites });
    const invite = await service.createAgentShareInvite(AUTH, AGENT_A_ID);
    shareInvites[0].expiresAt = new Date(Date.now() - 1000);

    await expect(
      service.acceptAgentShareInvite(SHARED_AUTH, { token: invite.token })
    ).rejects.toMatchObject({
      code: 'AGENT_SHARE_INVITE_EXPIRED',
      status: 410,
    });
  });
});
