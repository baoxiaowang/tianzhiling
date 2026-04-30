import { AgentSex, MongoObjectId } from '@tzl/entities';
import { AdminAppUserService } from './admin-app-user.service';

function createService() {
  const service = new AdminAppUserService();

  service.agentModel = {
    count: jest.fn(),
    find: jest.fn(),
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

describe('AdminAppUserService', () => {
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
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    jest.mocked(service.userModel.findOne).mockResolvedValueOnce(user as never);
    jest
      .mocked(service.userAccountModel.findOne)
      .mockResolvedValue(account as never);
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
          },
          name: '小灵',
          avatar: 'https://cdn.example.com/agent/avatar.png',
          sex: AgentSex.woman,
          agentCallMe: '主人',
          iCallAgent: '小灵',
          birthday: '2020-01-01T00:00:00.000Z',
          deathDate: '',
          description: '测试 agent',
          status: 1,
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

  it('updates only allowed profile fields', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const user = {
      id: userId,
      name: 'Old name',
      avatar: '',
      phone: '13900000000',
      phoneVerified: true,
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

    const result = await service.updateUser(userId.toHexString(), {
      name: ' New name ',
      avatar: ' https://example.com/new.png ',
    });

    expect(user.name).toBe('New name');
    expect(user.avatar).toBe('https://example.com/new.png');
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(service.userModel.save).toHaveBeenCalledWith(user);
    expect(result.name).toBe('New name');
    expect(JSON.stringify(result)).not.toContain('hidden');
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
});
