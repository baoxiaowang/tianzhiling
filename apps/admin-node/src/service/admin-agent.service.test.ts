import {
  AgentSex,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AdminAgentService } from './admin-agent.service';

function createService() {
  const service = new AdminAgentService();

  service.agentModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as any;
  service.conversationModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  } as any;
  service.messageModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  } as any;
  service.userModel = {
    find: jest.fn(),
  } as any;
  service.userAccountModel = {
    find: jest.fn(),
  } as any;
  service.avatarUrlService = {
    resolve: jest.fn((avatar?: string) => {
      const value = avatar?.trim() ?? '';

      if (!value || /^https?:\/\//i.test(value)) {
        return value;
      }

      return `https://cdn.example.com/${value}`;
    }),
    normalizeForStorage: jest.fn((avatar?: string) => avatar?.trim() ?? ''),
  } as any;

  return service;
}

describe('AdminAgentService', () => {
  it('lists agents with owner data and keyword search', async () => {
    const service = createService();
    const agentId = new MongoObjectId();
    const userId = new MongoObjectId();
    const agent = {
      id: agentId,
      createdUserId: userId,
      name: '小灵',
      avatar: 'agent/avatar.png',
      sex: AgentSex.woman,
      agentCallMe: '主人',
      iCallAgent: '小灵',
      birthday: new Date('2020-01-01T00:00:00.000Z'),
      deathDate: undefined,
      description: '测试 agent',
      status: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const user = {
      id: userId,
      name: 'Alice',
      avatar: 'https://example.com/user.png',
      phone: '13800000000',
    };
    const account = {
      id: new MongoObjectId(),
      userId,
      account: 'alice-account',
      password: 'hidden',
    };

    jest
      .mocked(service.userModel.find)
      .mockResolvedValueOnce([user] as never)
      .mockResolvedValueOnce([user] as never);
    jest
      .mocked(service.userAccountModel.find)
      .mockResolvedValueOnce([account] as never)
      .mockResolvedValueOnce([account] as never);
    jest.mocked(service.agentModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.agentModel.find).mockResolvedValue([agent] as never);

    const result = await service.listAgents({
      keyword: 'Alice',
      status: '1',
      page: '1',
      pageSize: '10',
    });

    expect(service.agentModel.count).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 1,
        $or: expect.any(Array),
      })
    );
    expect(result).toEqual({
      items: [
        {
          id: agentId.toHexString(),
          createdUserId: userId.toHexString(),
          createdUser: {
            id: userId.toHexString(),
            account: 'alice-account',
            name: 'Alice',
            avatar: 'https://example.com/user.png',
            phone: '13800000000',
          },
          name: '小灵',
          avatar: 'https://cdn.example.com/agent/avatar.png',
          sex: AgentSex.woman,
          agentCallMe: '主人',
          iCallAgent: '小灵',
          birthday: '2020-01-01T00:00:00.000Z',
          deathDate: '',
          description: '测试 agent',
          voiceTimbreId: '',
          status: 1,
          isVip: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('updates allowed profile and status fields', async () => {
    const service = createService();
    const agentId = new MongoObjectId();
    const userId = new MongoObjectId();
    const agent = {
      id: agentId,
      createdUserId: userId,
      name: '旧名称',
      avatar: '',
      sex: AgentSex.woman,
      agentCallMe: '旧称呼',
      iCallAgent: '旧昵称',
      birthday: undefined,
      deathDate: new Date('2021-01-01T00:00:00.000Z'),
      description: '',
      status: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    jest
      .mocked(service.agentModel.findOne)
      .mockResolvedValueOnce(agent as never);
    jest.mocked(service.agentModel.save).mockResolvedValue(agent as never);
    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.updateAgent(agentId.toHexString(), {
      name: ' 新名称 ',
      avatar: ' avatar.png ',
      sex: AgentSex.man,
      agentCallMe: '哥哥',
      iCallAgent: '阿灵',
      birthday: '2020-01-01T00:00:00.000Z',
      deathDate: '',
      description: ' 新描述 ',
      status: 0,
    });

    expect(agent.name).toBe('新名称');
    expect(agent.avatar).toBe('avatar.png');
    expect(agent.sex).toBe(AgentSex.man);
    expect(agent.agentCallMe).toBe('哥哥');
    expect(agent.iCallAgent).toBe('阿灵');
    expect(agent.birthday).toEqual(new Date('2020-01-01T00:00:00.000Z'));
    expect(agent.deathDate).toBeUndefined();
    expect(agent.description).toBe('新描述');
    expect(agent.status).toBe(0);
    expect(agent.updatedAt).toBeInstanceOf(Date);
    expect(service.agentModel.save).toHaveBeenCalledWith(agent);
    expect(result.createdUser).toBeNull();
  });

  it('lists agent conversations with latest message and user summary', async () => {
    const service = createService();
    const agentId = new MongoObjectId();
    const userId = new MongoObjectId();
    const conversationId = new MongoObjectId();
    const messageId = new MongoObjectId();
    const agent = {
      id: agentId,
      createdUserId: userId,
      name: '小灵',
      sex: AgentSex.woman,
      status: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const conversation = {
      id: conversationId,
      agentId,
      userId,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    };
    const latestMessage = {
      id: messageId,
      conversationId,
      role: MessageRole.user,
      type: MessageType.text,
      content: '你好',
      status: MessageStatus.sent,
      createdAt: new Date('2026-02-02T00:00:00.000Z'),
      updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    };
    const user = {
      id: userId,
      name: 'Alice',
      avatar: 'users/alice.png',
      phone: '13800000000',
    };
    const account = {
      id: new MongoObjectId(),
      userId,
      account: 'alice-account',
      password: 'hidden',
    };

    jest
      .mocked(service.agentModel.findOne)
      .mockResolvedValueOnce(agent as never);
    jest.mocked(service.conversationModel.count).mockResolvedValue(1 as never);
    jest
      .mocked(service.conversationModel.find)
      .mockResolvedValue([conversation] as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest
      .mocked(service.userAccountModel.find)
      .mockResolvedValue([account] as never);
    jest
      .mocked(service.messageModel.findOne)
      .mockResolvedValue(latestMessage as never);
    jest.mocked(service.messageModel.count).mockResolvedValue(2 as never);

    const result = await service.listAgentConversations(agentId.toHexString(), {
      page: '2',
      pageSize: '200',
    });

    expect(service.conversationModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: {
          updatedAt: 'DESC',
        },
        skip: 100,
        take: 100,
      })
    );
    expect(result).toEqual({
      items: [
        {
          id: conversationId.toHexString(),
          agentId: agentId.toHexString(),
          userId: userId.toHexString(),
          user: {
            id: userId.toHexString(),
            account: 'ali****unt',
            name: 'Alice',
            avatar: 'https://cdn.example.com/users/alice.png',
            phone: '138****0000',
          },
          latestMessage: {
            id: messageId.toHexString(),
            role: MessageRole.user,
            type: MessageType.text,
            content: '你好',
            status: MessageStatus.sent,
            createdAt: '2026-02-02T00:00:00.000Z',
          },
          messageCount: 2,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-02T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 2,
      pageSize: 100,
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(result)).not.toContain('alice-account');
    expect(JSON.stringify(result)).not.toContain('13800000000');
  });

  it('lists messages for a conversation owned by the agent', async () => {
    const service = createService();
    const agentId = new MongoObjectId();
    const userId = new MongoObjectId();
    const conversationId = new MongoObjectId();
    const userMessageId = new MongoObjectId();
    const assistantMessageId = new MongoObjectId();
    const agent = {
      id: agentId,
      createdUserId: userId,
      name: '小灵',
      sex: AgentSex.woman,
      status: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const conversation = {
      id: conversationId,
      agentId,
      userId,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    };
    const messages = [
      {
        id: userMessageId,
        conversationId,
        role: MessageRole.user,
        type: MessageType.text,
        content: '你好',
        status: MessageStatus.sent,
        createdAt: new Date('2026-02-02T00:00:00.000Z'),
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
      },
      {
        id: assistantMessageId,
        conversationId,
        role: MessageRole.assistant,
        type: MessageType.voice,
        content: '',
        status: MessageStatus.sent,
        mediaTranscript: '我在',
        mediaMimeType: 'audio/mpeg',
        mediaDurationMs: 1200,
        createdAt: new Date('2026-02-02T00:01:00.000Z'),
        updatedAt: new Date('2026-02-02T00:01:00.000Z'),
      },
    ];

    jest
      .mocked(service.agentModel.findOne)
      .mockResolvedValueOnce(agent as never);
    jest
      .mocked(service.conversationModel.findOne)
      .mockResolvedValueOnce(conversation as never);
    jest.mocked(service.messageModel.count).mockResolvedValue(2 as never);
    jest.mocked(service.messageModel.find).mockResolvedValue(messages as never);

    const result = await service.listAgentConversationMessages(
      agentId.toHexString(),
      conversationId.toHexString(),
      {
        page: '1',
        pageSize: '50',
      }
    );

    expect(service.conversationModel.findOne).toHaveBeenCalledWith({
      where: {
        id: conversationId,
        agentId,
      },
    });
    expect(service.messageModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: {
          createdAt: 'ASC',
        },
        skip: 0,
        take: 50,
      })
    );
    expect(result).toEqual({
      items: [
        {
          id: userMessageId.toHexString(),
          conversationId: conversationId.toHexString(),
          role: MessageRole.user,
          type: MessageType.text,
          content: '你好',
          status: MessageStatus.sent,
          mediaUrl: '',
          mediaMimeType: '',
          mediaTranscript: '',
          mediaDurationMs: undefined,
          createdAt: '2026-02-02T00:00:00.000Z',
          updatedAt: '2026-02-02T00:00:00.000Z',
        },
        {
          id: assistantMessageId.toHexString(),
          conversationId: conversationId.toHexString(),
          role: MessageRole.assistant,
          type: MessageType.voice,
          content: '',
          status: MessageStatus.sent,
          mediaUrl: '',
          mediaMimeType: 'audio/mpeg',
          mediaTranscript: '我在',
          mediaDurationMs: 1200,
          createdAt: '2026-02-02T00:01:00.000Z',
          updatedAt: '2026-02-02T00:01:00.000Z',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    });
  });

  it('rejects invalid id, blank name and invalid status', async () => {
    const service = createService();
    const agentId = new MongoObjectId();

    await expect(service.getAgentDetail('invalid')).rejects.toMatchObject({
      code: 'INVALID_AGENT_ID',
    });

    jest.mocked(service.agentModel.findOne).mockResolvedValue({
      id: agentId,
      createdUserId: new MongoObjectId(),
      name: '旧名称',
      sex: AgentSex.woman,
      status: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(
      service.updateAgent(agentId.toHexString(), { name: '   ' })
    ).rejects.toMatchObject({
      code: 'INVALID_AGENT_NAME',
    });

    await expect(
      service.updateAgent(agentId.toHexString(), { status: 2 })
    ).rejects.toMatchObject({
      code: 'INVALID_AGENT_STATUS',
    });
  });
});
