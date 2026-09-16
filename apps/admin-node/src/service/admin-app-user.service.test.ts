import {
  AgentSex,
  MessageRole,
  MongoObjectId,
  OrderStatus,
} from '@tzl/entities';
import { AdminAppUserService } from './admin-app-user.service';

function createService() {
  const service = new AdminAppUserService();

  service.agentModel = {
    count: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.conversationModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.messageModel = {
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.userModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as any;
  service.userAccountModel = {
    find: jest.fn(),
    findOne: jest.fn(),
  } as any;
  service.userMembershipModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.userIdentityProfileModel = {
    findOne: jest.fn().mockResolvedValue(null),
  } as any;
  service.userKnownPersonModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.userRelativeProfileModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.userRelativeFactModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.userSelfFactModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.orderModel = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
  } as any;
  service.agentProfileFactModel = {
    count: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockResolvedValue([]),
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
  service.adminMilvusService = {
    listConversationMessageMemories: jest.fn().mockResolvedValue({
      available: true,
      unavailableReason: '',
      total: 0,
      pageIndexRows: 0,
      items: [],
    }),
  } as any;

  return service;
}

describe('AdminAppUserService', () => {
  it('classifies and filters current members by membership duration', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const user = {
      id: userId,
      name: '三年会员用户',
      avatar: '',
      phone: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const membership = {
      userId,
      status: 'active',
      lifetime: false,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiredAt: new Date('2029-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    jest
      .mocked(service.userMembershipModel.find)
      .mockResolvedValueOnce([membership] as never)
      .mockResolvedValueOnce([membership] as never);
    jest.mocked(service.userModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.listMembers({
      membershipType: 'three_year',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: userId.toHexString(),
      membershipType: 'three_year',
      membershipExpiredAt: '2029-01-01T00:00:00.000Z',
    });
  });

  it('marks a manually started specified-price buyer as servicing', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const order = {
      userId,
      status: OrderStatus.completed,
      paidAmount: 16900,
      payableAmount: 16900,
      amount: 16900,
      paidAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      voiceServiceStartedAt: new Date('2026-02-02T00:00:00.000Z'),
    };
    const user = {
      id: userId,
      name: '声音服务用户',
      avatar: '',
      phone: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    jest.mocked(service.orderModel.find).mockResolvedValue([order] as never);
    jest.mocked(service.userModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.listVoiceServiceUsers({
      serviceStatus: 'servicing',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: userId.toHexString(),
      serviceStatus: 'servicing',
      purchasedAmounts: [169],
    });
  });

  it('keeps a specified-price buyer pending until an admin confirms service', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const order = {
      userId,
      status: OrderStatus.completed,
      paidAmount: 12000,
      payableAmount: 12000,
      amount: 12000,
      paidAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const user = {
      id: userId,
      name: '待服务用户',
      avatar: '',
      phone: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    jest.mocked(service.orderModel.find).mockResolvedValue([order] as never);
    jest.mocked(service.userModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.listVoiceServiceUsers({
      serviceStatus: 'pending',
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: userId.toHexString(),
      serviceStatus: 'pending',
      purchasedAmounts: [120],
    });
  });

  it('automatically classifies a previously bound voice service as servicing', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const order = {
      userId,
      status: OrderStatus.completed,
      paidAmount: 12000,
      payableAmount: 12000,
      amount: 12000,
      paidAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    const user = {
      id: userId,
      name: '旧声音服务用户',
      avatar: '',
      phone: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    jest.mocked(service.orderModel.find).mockResolvedValue([order] as never);
    jest.mocked(service.agentModel.find).mockResolvedValue([
      {
        createdUserId: userId,
        voiceTimbreId: new MongoObjectId(),
      },
    ] as never);
    jest.mocked(service.userModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.listVoiceServiceUsers({
      serviceStatus: 'servicing',
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0]).toMatchObject({
      id: userId.toHexString(),
      serviceStatus: 'servicing',
    });
  });

  it('hides refunded buyers from all and returns them for the refunded filter', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const order = {
      userId,
      status: OrderStatus.refunded,
      paidAmount: 16900,
      payableAmount: 16900,
      amount: 16900,
      paidAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-03T00:00:00.000Z'),
    };
    const user = {
      id: userId,
      name: '已退款用户',
      avatar: '',
      phone: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    jest.mocked(service.orderModel.find).mockResolvedValue([order] as never);

    const allResult = await service.listVoiceServiceUsers({
      page: 1,
      pageSize: 20,
    });
    expect(allResult.items).toEqual([]);

    jest.mocked(service.userModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);
    const refundedResult = await service.listVoiceServiceUsers({
      serviceStatus: 'refunded',
      page: 1,
      pageSize: 20,
    });

    expect(refundedResult.items[0]).toMatchObject({
      id: userId.toHexString(),
      serviceStatus: 'refunded',
    });
  });

  it('persists manual confirmation before returning servicing status', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const user = { id: userId };
    const order = {
      userId,
      status: OrderStatus.completed,
      paidAmount: 18000,
      payableAmount: 18000,
      amount: 18000,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      voiceServiceStartedAt: undefined as Date | undefined,
    };
    jest.mocked(service.userModel.findOne).mockResolvedValue(user as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([order] as never);
    jest.mocked(service.orderModel.save).mockResolvedValue(order as never);

    const result = await service.startVoiceService(userId.toHexString());

    expect(order.voiceServiceStartedAt).toBeInstanceOf(Date);
    expect(service.orderModel.save).toHaveBeenCalledWith(order);
    expect(result).toMatchObject({
      userId: userId.toHexString(),
      serviceStatus: 'servicing',
    });
  });

  it('lists app users with account data and keyword search', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Alice',
      avatar: 'users/alice.png',
      phone: '13800000000',
      phoneVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const account = {
      id: new MongoObjectId(),
      userId,
      account: '13800000000',
      password: 'hidden',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    jest
      .mocked(service.userAccountModel.find)
      .mockResolvedValueOnce([account] as never)
      .mockResolvedValueOnce([account] as never);
    jest.mocked(service.userMembershipModel.find).mockResolvedValue([
      {
        userId,
        status: 'active',
        lifetime: true,
      },
    ] as never);
    jest.mocked(service.userModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.userModel.find).mockResolvedValue([user] as never);

    const result = await service.listUsers({
      keyword: '138',
      page: '1',
      pageSize: '10',
    });

    expect(service.userModel.count).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: expect.any(Array),
      })
    );
    expect(result).toEqual({
      items: [
        {
          id: userId.toHexString(),
          account: '13800000000',
          name: 'Alice',
          avatar: 'https://cdn.example.com/users/alice.png',
          phone: '13800000000',
          phoneVerified: true,
          isVip: true,
          isRiskControlled: false,
          riskControlUntilAt: '',
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

  it('lists agents for a specific app user', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const agentId = new MongoObjectId();
    const voiceTimbreId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Alice',
      avatar: 'https://example.com/avatar.png',
      phone: '13800000000',
      phoneVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const account = {
      id: new MongoObjectId(),
      userId,
      account: 'alice-account',
      password: 'hidden',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
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
      isDefault: true,
      voiceTimbreId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    jest.mocked(service.userModel.findOne).mockResolvedValueOnce(user as never);
    jest
      .mocked(service.userAccountModel.findOne)
      .mockResolvedValue(account as never);
    jest.mocked(service.userMembershipModel.find).mockResolvedValue([]);
    jest.mocked(service.agentModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.agentModel.find).mockResolvedValue([agent] as never);

    const result = await service.listUserAgents(userId.toHexString(), {
      page: '1',
      pageSize: '10',
    });

    expect(service.agentModel.count).toHaveBeenCalledWith({
      createdUserId: userId,
    });
    expect(service.agentModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdUserId: userId,
        },
        // 音色绑定依赖列表返回 voiceTimbreId，缺失会导致绑定头像不显示
        select: expect.arrayContaining(['voiceTimbreId']),
        skip: 0,
        take: 10,
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
            avatar: 'https://example.com/avatar.png',
            phone: '13800000000',
            isVip: false,
          },
          name: '小灵',
          avatar: 'https://cdn.example.com/agent/avatar.png',
          sex: AgentSex.woman,
          agentCallMe: '主人',
          iCallAgent: '小灵',
          birthday: '2020-01-01T00:00:00.000Z',
          deathDate: '',
          description: '测试 agent',
          lifeExperience: '',
          personalityTraits: '',
          languageHabits: '',
          hobbies: '',
          sharedMemories: '',
          hasUnreadAgentHomeGuide: false,
          hasUnreadAgentProfileGuide: false,
          customContext: '',
          conversationCount: 0,
          messengerConversationCount: 0,
          status: 1,
          isDefault: true,
          voiceTimbreId: voiceTimbreId.toHexString(),
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

  it('counts user messages for every relationship agent', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const agentId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Alice',
      avatar: '',
      phone: '',
    };
    const agent: any = {
      id: agentId,
      createdUserId: userId,
      name: '小灵',
      sex: AgentSex.woman,
      status: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    jest.mocked(service.userModel.findOne).mockResolvedValue(user as never);
    jest.mocked(service.userAccountModel.findOne).mockResolvedValue(null);
    jest.mocked(service.agentModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.agentModel.find).mockResolvedValue([agent] as never);
    jest.mocked(service.messageModel.aggregate).mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ _id: agentId, count: 3 }]),
    } as never);

    const result = await service.listUserAgents(userId.toHexString(), {
      page: 1,
      pageSize: 10,
    });

    expect(result.items[0].conversationCount).toBe(3);
    expect(service.messageModel.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          agentId: { $in: [agentId] },
          role: MessageRole.user,
        },
      },
      { $group: { _id: '$agentId', count: { $sum: 1 } } },
    ]);
  });

  it('returns account-level identity, people and relative facts', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const personId = new MongoObjectId();
    const agentId = new MongoObjectId();
    const factId = new MongoObjectId();
    jest.mocked(service.userModel.findOne).mockResolvedValue({
      id: userId,
      name: 'Alice',
    } as never);
    jest.mocked(service.userIdentityProfileModel.findOne).mockResolvedValue({
      userId,
      realName: '张文祥',
      formerNames: [{ value: '张小祥' }],
      aliases: ['文祥'],
      source: 'explicit_chat_statement',
      sourceText: '我叫张文祥',
      updatedAt: new Date('2026-09-06T12:00:00.000Z'),
    } as never);
    jest.mocked(service.userKnownPersonModel.find).mockResolvedValue([
      {
        id: personId,
        userId,
        realName: '周叔叔',
        preferredName: '叔叔',
        aliases: ['老周'],
        relationToUser: '叔叔',
        sourceText: '我叔叔叫周叔叔',
        updatedAt: new Date('2026-09-06T12:01:00.000Z'),
      },
    ] as never);
    jest.mocked(service.userRelativeProfileModel.find).mockResolvedValue([
      {
        personId,
        lifeStage: 'adult',
        sex: 'male',
        relationshipsToAgents: [
          { agentId, relationToAgent: '弟弟', personCallsAgent: '哥哥' },
        ],
      },
    ] as never);
    jest.mocked(service.userRelativeFactModel.find).mockResolvedValue([
      {
        id: factId,
        personId,
        domain: 'health',
        key: 'health.recovery',
        value: '正在康复',
        status: 'current',
        confidence: 'confirmed',
        supportCount: 2,
        sourceText: '叔叔恢复得不错',
        updatedAt: new Date('2026-09-06T12:02:00.000Z'),
      },
    ] as never);

    const result = await service.getAccountMemory(userId.toHexString());

    expect(result.identity).toMatchObject({
      realName: '张文祥',
      formerNames: ['张小祥'],
      aliases: ['文祥'],
    });
    expect(result.people[0]).toMatchObject({
      id: personId.toHexString(),
      preferredName: '叔叔',
      profile: {
        lifeStage: 'adult',
        sex: 'male',
        relationshipsToAgents: [
          {
            agentId: agentId.toHexString(),
            relationToAgent: '弟弟',
            personCallsAgent: '哥哥',
          },
        ],
      },
      facts: [
        {
          id: factId.toHexString(),
          domain: 'health',
          value: '正在康复',
        },
      ],
    });
  });

  it('filters user agents by name', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const agentId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Alice',
      avatar: '',
      phone: '13800000000',
      phoneVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const account = {
      id: new MongoObjectId(),
      userId,
      account: 'alice-account',
      password: 'hidden',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const agent = {
      id: agentId,
      createdUserId: userId,
      name: '小灵 VIP',
      avatar: '',
      sex: AgentSex.woman,
      agentCallMe: '主人',
      iCallAgent: '小灵',
      birthday: undefined,
      deathDate: undefined,
      description: '',
      status: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    jest.mocked(service.userModel.findOne).mockResolvedValueOnce(user as never);
    jest
      .mocked(service.userAccountModel.findOne)
      .mockResolvedValue(account as never);
    jest.mocked(service.userMembershipModel.find).mockResolvedValue([]);
    jest.mocked(service.agentModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.agentModel.find).mockResolvedValue([agent] as never);

    const result = await service.listUserAgents(userId.toHexString(), {
      keyword: '小灵',
      page: '1',
      pageSize: '10',
    });

    expect(service.agentModel.count).toHaveBeenCalledWith({
      createdUserId: userId,
      name: { $regex: '小灵', $options: 'i' },
    });
    expect(result.items[0].id).toBe(agentId.toHexString());
  });

  it('updates allowed profile and risk control fields', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Old name',
      avatar: '',
      phone: '13900000000',
      phoneVerified: true,
      riskControlUntilAt: undefined,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const account = {
      id: new MongoObjectId(),
      userId,
      account: '13900000000',
      password: 'hidden',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    jest.mocked(service.userModel.findOne).mockResolvedValueOnce(user as never);
    jest.mocked(service.userModel.save).mockResolvedValue(user as never);
    jest
      .mocked(service.userAccountModel.findOne)
      .mockResolvedValue(account as never);
    jest.mocked(service.userMembershipModel.find).mockResolvedValue([]);

    const result = await service.updateUser(userId.toHexString(), {
      name: ' New name ',
      avatar: ' https://example.com/new.png ',
      riskControlUntilAt: '2026-02-01T00:00:00.000Z',
    });

    expect(user.name).toBe('New name');
    expect(user.avatar).toBe('https://example.com/new.png');
    expect(user.riskControlUntilAt).toEqual(
      new Date('2026-02-01T00:00:00.000Z')
    );
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(service.userModel.save).toHaveBeenCalledWith(user);
    expect(result.name).toBe('New name');
    expect(result.riskControlUntilAt).toBe('2026-02-01T00:00:00.000Z');
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('clears user risk control and rejects invalid risk control time', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Alice',
      avatar: '',
      riskControlUntilAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    jest.mocked(service.userModel.findOne).mockResolvedValue(user as never);
    jest.mocked(service.userModel.save).mockResolvedValue(user as never);
    jest.mocked(service.userAccountModel.findOne).mockResolvedValue(null);
    jest.mocked(service.userMembershipModel.find).mockResolvedValue([]);

    await service.updateUser(userId.toHexString(), {
      riskControlUntilAt: '',
    });

    expect(user.riskControlUntilAt).toBeUndefined();

    await expect(
      service.updateUser(userId.toHexString(), {
        riskControlUntilAt: 'not-a-date',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_RISK_CONTROL_UNTIL_AT',
    });
  });

  it('rejects invalid user id and blank name', async () => {
    const service = createService();

    await expect(service.getUserDetail('invalid')).rejects.toMatchObject({
      code: 'INVALID_APP_USER_ID',
    });

    const userId = new MongoObjectId();
    jest.mocked(service.userModel.findOne).mockResolvedValueOnce({
      id: userId,
      name: 'Old name',
      avatar: '',
    } as never);

    await expect(
      service.updateUser(userId.toHexString(), { name: '   ' })
    ).rejects.toMatchObject({
      code: 'INVALID_APP_USER_NAME',
    });
  });

  describe('messenger message channel', () => {
    afterEach(() => {
      delete process.env.INTERNAL_API_SECRET;
      delete (global as { fetch?: unknown }).fetch;
    });

    it('returns empty list when the messenger conversation does not exist', async () => {
      const service = createService();
      const userId = new MongoObjectId().toHexString();
      const agentId = new MongoObjectId().toHexString();
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: new MongoObjectId(agentId),
        createdUserId: new MongoObjectId(userId),
        messengerOfAgentId: new MongoObjectId(),
      });
      (service.conversationModel as any).findOne = jest
        .fn()
        .mockResolvedValue(null);

      const result = await service.listMessengerMessages(userId, agentId);

      expect(result).toEqual({ conversationId: '', hasMore: false, items: [] });
    });

    it('sends a text message through the node internal endpoint', async () => {
      const service = createService();
      const userId = new MongoObjectId().toHexString();
      const agentId = new MongoObjectId().toHexString();
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: new MongoObjectId(agentId),
        createdUserId: new MongoObjectId(userId),
        messengerOfAgentId: new MongoObjectId(),
      });
      process.env.INTERNAL_API_SECRET = 'test-secret';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          code: 'OK',
          message: 'OK',
          data: {
            ok: true,
            result: {
              conversationId: 'conv-1',
              messageId: 'msg-1',
              type: 'text',
              content: '你好',
              createdAt: '2026-09-14T00:00:00.000Z',
            },
          },
        }),
      });
      (global as { fetch?: unknown }).fetch = fetchMock;

      const result = await service.sendMessengerMessage(userId, agentId, {
        type: 'text',
        content: '你好',
      });

      expect(result).toMatchObject({
        id: 'msg-1',
        type: 'text',
        content: '你好',
        role: MessageRole.assistant,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/system/messenger-message'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('rejects text without content', async () => {
      const service = createService();

      await expect(
        service.sendMessengerMessage(
          new MongoObjectId().toHexString(),
          new MongoObjectId().toHexString(),
          { type: 'text' }
        )
      ).rejects.toThrow('content is required');
    });

    it('propagates the node error from the response envelope', async () => {
      const service = createService();
      const userId = new MongoObjectId().toHexString();
      const agentId = new MongoObjectId().toHexString();
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: new MongoObjectId(agentId),
        createdUserId: new MongoObjectId(userId),
        messengerOfAgentId: new MongoObjectId(),
      });
      process.env.INTERNAL_API_SECRET = 'test-secret';
      (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          code: 'OK',
          message: 'OK',
          data: { ok: false, error: 'messenger agent not found' },
        }),
      });

      await expect(
        service.sendMessengerMessage(userId, agentId, {
          type: 'text',
          content: '你好',
        })
      ).rejects.toThrow('messenger agent not found');
    });
  });

  describe('agent memory and chat read', () => {
    it('returns stored agent memories with source conversation and account shared memories', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();
      const sourceMessageId = new MongoObjectId();
      const conversationId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
        name: '测试用户',
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: userId,
      });
      (service.agentProfileFactModel as any).count = jest
        .fn()
        .mockResolvedValue(1);
      (service.agentProfileFactModel as any).find = jest
        .fn()
        .mockResolvedValue([
          {
            id: new MongoObjectId(),
            userId,
            agentId,
            type: 'preference',
            key: 'user.preference.spicy',
            value: '用户不爱吃辣',
            polarity: 'negative',
            status: 'active',
            confidence: 'confirmed',
            assertionPolicy: 'can_assert',
            priority: 3,
            sourceMessageId,
            sourceMessageIds: [sourceMessageId],
            sourceText: '我不吃辣',
            governance: {
              retention: 'durable',
              certainty: 'explicit',
              timeKind: 'stable',
              sourceOccurredAt: '2026-07-28T06:49:31.905Z',
            },
            createdAt: new Date('2026-07-28T06:49:33.718Z'),
            updatedAt: new Date('2026-07-28T06:49:33.718Z'),
          },
        ]);
      (service.messageModel as any).find = jest
        .fn()
        .mockResolvedValue([{ id: sourceMessageId, conversationId }]);
      (service.userIdentityProfileModel as any).findOne = jest
        .fn()
        .mockResolvedValue({
          userId,
          realName: '张三',
          aliases: ['小张'],
          sourceText: '我叫张三',
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        });
      (service.userKnownPersonModel as any).find = jest.fn().mockResolvedValue([
        {
          id: new MongoObjectId(),
          userId,
          realName: '李四',
          preferredName: '',
          aliases: [],
          relationToUser: '母亲',
          sourceText: '我妈叫李四',
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      ]);

      const result = await service.listAgentMemories(
        userId.toHexString(),
        agentId.toHexString(),
        { page: '1', pageSize: '20' }
      );

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        scope: 'agent',
        type: 'preference',
        value: '用户不爱吃辣',
        status: 'active',
        sourceMessageId: sourceMessageId.toHexString(),
        sourceConversationId: conversationId.toHexString(),
        retention: 'durable',
        sourceOccurredAt: '2026-07-28T06:49:31.905Z',
      });
      expect(result.accountSharedItems).toHaveLength(2);
      expect(result.accountSharedTotal).toBe(2);
      expect(result.accountSharedItems[0]).toMatchObject({
        scope: 'account',
        type: 'identity',
      });
      expect(result.accountSharedItems[1]).toMatchObject({
        scope: 'account',
        type: 'relationship',
      });
    });

    it('rejects reading memories for an agent outside the user scope', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: new MongoObjectId(),
      });

      await expect(
        service.listAgentMemories(userId.toHexString(), agentId.toHexString(), {
          pageSize: '999',
        })
      ).rejects.toThrow('app user agent not found');
    });

    it('reads chat messages of a non-messenger agent for the same user', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();
      const conversationId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: userId,
      });
      (service.messageModel as any).find = jest.fn().mockResolvedValue([
        {
          id: new MongoObjectId(),
          conversationId,
          userId,
          agentId,
          role: 'assistant',
          type: 'text',
          content: '闺女，好想你啊',
          createdAt: new Date('2026-08-01T06:51:49.626Z'),
        },
      ]);

      const result = await service.listAgentMessages(
        userId.toHexString(),
        agentId.toHexString()
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        content: '闺女，好想你啊',
        conversationId: conversationId.toHexString(),
      });
      expect(result.hasMore).toBe(false);
    });

    it('caps agent memory page size at 50', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: userId,
      });

      const result = await service.listAgentMemories(
        userId.toHexString(),
        agentId.toHexString(),
        { pageSize: '999' }
      );

      expect(result.pageSize).toBe(50);
      expect((service.agentProfileFactModel as any).find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });

    it('returns only indexed evidence whose source message is still valid', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();
      const conversationId = new MongoObjectId();
      const validId = new MongoObjectId();
      const archivedId = new MongoObjectId();
      const missingId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: userId,
      });
      (service.adminMilvusService as any).listConversationMessageMemories = jest
        .fn()
        .mockResolvedValue({
          available: true,
          unavailableReason: '',
          total: 3,
          pageIndexRows: 3,
          items: [
            {
              id: String(validId),
              sourceMessageId: validId.toHexString(),
              conversationId: conversationId.toHexString(),
              agentId: agentId.toHexString(),
              role: 'user',
              memoryKind: 'raw_episode',
              text: '我明天监考美术',
              createdAt: '2026-09-15T01:00:00.000Z',
            },
            {
              id: String(archivedId),
              sourceMessageId: archivedId.toHexString(),
              conversationId: conversationId.toHexString(),
              agentId: agentId.toHexString(),
              role: 'user',
              memoryKind: 'raw_episode',
              text: '已归档原话',
              createdAt: '2026-09-15T01:01:00.000Z',
            },
            {
              id: 'missing',
              sourceMessageId: missingId.toHexString(),
              conversationId: conversationId.toHexString(),
              agentId: agentId.toHexString(),
              role: 'user',
              memoryKind: 'raw_episode',
              text: '来源已删除',
              createdAt: '2026-09-15T01:02:00.000Z',
            },
          ],
        });
      (service.messageModel as any).find = jest.fn().mockResolvedValue([
        {
          id: validId,
          userId,
          agentId,
          conversationId,
          role: MessageRole.user,
          content: '我明天监考美术',
          isArchived: false,
          createdAt: new Date('2026-09-15T01:00:00.000Z'),
        },
        {
          id: archivedId,
          userId,
          agentId,
          conversationId,
          role: MessageRole.user,
          content: '已归档原话',
          isArchived: true,
          createdAt: new Date('2026-09-15T01:01:00.000Z'),
        },
      ]);

      const result = await service.listIndexedEvidence(
        userId.toHexString(),
        agentId.toHexString()
      );

      expect(result.available).toBe(true);
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.pageValidCount).toBe(1);
      expect(result.pageInvalidCount).toBe(2);
      expect(result.pageIndexRows).toBe(3);
      expect(result.items[0]).toMatchObject({
        sourceMessageId: validId.toHexString(),
        text: '我明天监考美术',
        sourceValid: true,
      });
      expect(
        (service.adminMilvusService as any).listConversationMessageMemories
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: userId.toHexString(),
          agentId: agentId.toHexString(),
        })
      );
    });

    it('rejects indexed evidence for an agent outside the user scope', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: new MongoObjectId(),
      });

      await expect(
        service.listIndexedEvidence(userId.toHexString(), agentId.toHexString())
      ).rejects.toThrow('app user agent not found');
    });

    it('reports indexed evidence as disabled when milvus is unavailable', async () => {
      const service = createService();
      const userId = new MongoObjectId();
      const agentId = new MongoObjectId();

      (service.userModel as any).findOne = jest.fn().mockResolvedValue({
        id: userId,
      });
      (service.agentModel as any).findOne = jest.fn().mockResolvedValue({
        id: agentId,
        createdUserId: userId,
      });
      (service.adminMilvusService as any).listConversationMessageMemories = jest
        .fn()
        .mockResolvedValue({
          available: false,
          unavailableReason: 'disabled',
          total: 0,
          pageIndexRows: 0,
          items: [],
        });

      const result = await service.listIndexedEvidence(
        userId.toHexString(),
        agentId.toHexString()
      );

      expect(result.available).toBe(false);
      expect(result.unavailableReason).toBe('disabled');
      expect(result.items).toEqual([]);
    });
  });
});
