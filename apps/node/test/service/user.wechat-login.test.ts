import { createHash } from 'crypto';
import { AppError } from '../../src/common/errors';
import { UserService } from '../../src/service/user.service';

const WECHAT_OPENID = 'oAppOpenid1234567890abcdefghijkl';
const WECHAT_UNIONID = 'uUnionid1234567890abcdefghijkl';
const WEAPP_OPENID = 'oWeappOpenid1234567890abcdefghijkl';

function createObjectId(value: string) {
  return {
    toHexString: () => value,
  };
}

function matchesObjectId(value: unknown, expected: string) {
  const candidate = value as { toHexString?: unknown } | null;

  return (
    Boolean(candidate) &&
    typeof candidate?.toHexString === 'function' &&
    candidate.toHexString() === expected
  );
}

function buildWeappAccount(openid: string) {
  return `weapp:${createHash('sha256')
    .update(openid)
    .digest('hex')
    .slice(0, 12)}`;
}

function buildWechatAppAccount(openid: string) {
  return `wechat:${openid}`;
}

function createService() {
  const service = new UserService();
  const userId = createObjectId('user-1');
  const accountId = createObjectId('account-1');

  const redisService = {
    get: jest.fn(),
    del: jest.fn(),
  };
  const userModel = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (user: any) => ({
      ...user,
      id: user.id ?? userId,
    })),
  };
  const userAccountModel = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (account: any) => ({
      ...account,
      id: account.id ?? accountId,
    })),
  };
  const userMembershipModel = {
    find: jest.fn().mockResolvedValue([]),
  };
  const wechatPayService = {
    exchangeAppLoginCode: jest.fn(),
    getWeappLoginSessionByJsCode: jest
      .fn()
      .mockResolvedValue({ openid: WEAPP_OPENID }),
  };

  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  service.redisService = redisService as any;
  service.userModel = userModel as any;
  service.userAccountModel = userAccountModel as any;
  service.userMembershipModel = userMembershipModel as any;
  service.jwtService = {
    signSync: jest.fn().mockReturnValue('test-token'),
  } as any;
  service.postImageService = {
    resolveForResponse: jest.fn((value: string) => value),
    resolveUserAvatarForResponse: jest.fn((value: string) => value),
  } as any;
  service.wechatPayService = wechatPayService as any;

  return {
    service,
    redisService,
    userModel,
    userAccountModel,
    userMembershipModel,
    wechatPayService,
  };
}

type MockedModel = ReturnType<typeof createService>['userModel'];

/**
 * 模拟 userModel.findOne：按 id / unionid 返回给定用户，其余返回 null。
 * 与旧账号结构保持一致（id 兼容 Mongo 的 id 与 _id 两种 where 写法）。
 */
function mockUserLookup(
  userModel: MockedModel,
  options: {
    byId?: { id: string; user: Record<string, any> };
    byUnionid?: { unionid: string; user: Record<string, any> };
  }
) {
  userModel.findOne.mockImplementation(async ({ where }: any) => {
    if (where.unionid) {
      return options.byUnionid &&
        where.unionid === options.byUnionid.unionid
        ? options.byUnionid.user
        : null;
    }

    if (
      options.byId &&
      (matchesObjectId(where.id, options.byId.id) ||
        matchesObjectId(where._id, options.byId.id))
    ) {
      return options.byId.user;
    }

    return null;
  });
}

function buildAppUser() {
  return {
    id: createObjectId('user-1'),
    name: '天之灵用户8000',
    avatar: '',
    phone: '',
    phoneVerified: false,
    gender: 'unknown',
    region: null,
  };
}

describe('UserService wechatLogin', () => {
  it('reuses the openid account and backfills unionid for existing app users', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();
    const user = buildAppUser();
    const userAccount = {
      id: createObjectId('account-1'),
      userId: user.id,
      account: buildWechatAppAccount(WECHAT_OPENID),
      password: '',
    };

    wechatPayService.exchangeAppLoginCode.mockResolvedValue({
      openid: WECHAT_OPENID,
      unionid: WECHAT_UNIONID,
    });
    mockUserLookup(userModel, { byId: { id: 'user-1', user } });
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (where.account === buildWechatAppAccount(WECHAT_OPENID)) {
        return userAccount;
      }

      return null;
    });

    const result = await service.wechatLogin({ code: 'app-auth-code' });

    expect(result.accessToken).toBe('test-token');
    expect(result.isNewUser).toBe(false);
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({ unionid: WECHAT_UNIONID })
    );
    expect(userAccountModel.save).not.toHaveBeenCalled();
  });

  it('reuses a unionid user from weapp and creates the app login account', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();
    const weappUserId = createObjectId('user-weapp');
    const weappUser = {
      id: weappUserId,
      name: '天之灵用户1234',
      avatar: '',
      phone: '',
      phoneVerified: false,
      gender: 'unknown',
      region: null,
      unionid: WECHAT_UNIONID,
    };

    wechatPayService.exchangeAppLoginCode.mockResolvedValue({
      openid: WECHAT_OPENID,
      unionid: WECHAT_UNIONID,
    });
    mockUserLookup(userModel, {
      byUnionid: { unionid: WECHAT_UNIONID, user: weappUser },
    });
    userAccountModel.findOne.mockResolvedValue(null);

    const result = await service.wechatLogin({ code: 'app-auth-code' });

    expect(result.accessToken).toBe('test-token');
    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe('user-weapp');
    expect(userModel.save).not.toHaveBeenCalled();
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: weappUserId,
        account: buildWechatAppAccount(WECHAT_OPENID),
        status: 'active',
      })
    );
  });

  it('creates a new app user with the wechat openid account and unionid', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();

    wechatPayService.exchangeAppLoginCode.mockResolvedValue({
      openid: WECHAT_OPENID,
      unionid: WECHAT_UNIONID,
    });

    const result = await service.wechatLogin({ code: 'app-auth-code' });

    expect(result.accessToken).toBe('test-token');
    expect(result.isNewUser).toBe(true);
    expect(result.user.account).toBe(buildWechatAppAccount(WECHAT_OPENID));
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '',
        phoneVerified: false,
        unionid: WECHAT_UNIONID,
        accountStatus: 'active',
      })
    );
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        account: buildWechatAppAccount(WECHAT_OPENID),
        status: 'active',
      })
    );
  });

  it('keeps repeat logins on the same account without unionid (open platform not bound)', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();
    const user = buildAppUser();
    const userAccount = {
      id: createObjectId('account-1'),
      userId: user.id,
      account: buildWechatAppAccount(WECHAT_OPENID),
      password: '',
    };

    wechatPayService.exchangeAppLoginCode.mockResolvedValue({
      openid: WECHAT_OPENID,
    });
    mockUserLookup(userModel, { byId: { id: 'user-1', user } });
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (where.account === buildWechatAppAccount(WECHAT_OPENID)) {
        return userAccount;
      }

      return null;
    });

    const result = await service.wechatLogin({ code: 'app-auth-code' });

    expect(result.isNewUser).toBe(false);
    expect(result.user.account).toBe(buildWechatAppAccount(WECHAT_OPENID));
    expect(userModel.save).not.toHaveBeenCalled();
    expect(userAccountModel.save).not.toHaveBeenCalled();
  });

  it('rejects an empty wechat login code without calling wechat', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();

    await expect(service.wechatLogin({ code: '   ' })).rejects.toMatchObject({
      code: 'INVALID_WECHAT_CODE',
      status: 400,
    });
    expect(wechatPayService.exchangeAppLoginCode).not.toHaveBeenCalled();
    expect(userModel.save).not.toHaveBeenCalled();
    expect(userAccountModel.save).not.toHaveBeenCalled();
  });

  it('propagates the wechat api error for an invalid code', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();

    wechatPayService.exchangeAppLoginCode.mockRejectedValue(
      new AppError('WECHAT_APP_LOGIN_FAILED', 'invalid code')
    );

    await expect(
      service.wechatLogin({ code: 'invalid-code' })
    ).rejects.toMatchObject({
      code: 'WECHAT_APP_LOGIN_FAILED',
      status: 400,
    });
    expect(userModel.save).not.toHaveBeenCalled();
    expect(userAccountModel.save).not.toHaveBeenCalled();
  });
});

describe('UserService weappLogin unionid backfill', () => {
  function buildWeappUserAccount() {
    const userId = createObjectId('user-weapp');
    const user = {
      id: userId,
      name: '天之灵用户1234',
      avatar: '',
      phone: '',
      phoneVerified: false,
      gender: 'unknown',
      region: null,
    };
    const userAccount = {
      id: createObjectId('account-weapp'),
      userId,
      account: buildWeappAccount(WEAPP_OPENID),
      password: '',
      openId: WEAPP_OPENID,
    };

    return { userId, user, userAccount };
  }

  it('writes unionid returned by code2session into the existing user', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();
    const { user, userAccount } = buildWeappUserAccount();

    wechatPayService.getWeappLoginSessionByJsCode.mockResolvedValue({
      openid: WEAPP_OPENID,
      unionid: WECHAT_UNIONID,
    });
    mockUserLookup(userModel, { byId: { id: 'user-weapp', user } });
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (where.account === buildWeappAccount(WEAPP_OPENID)) {
        return userAccount;
      }

      return null;
    });

    const result = await service.weappLogin({ jsCode: 'js-code' });

    expect(result.accessToken).toBe('test-token');
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({ unionid: WECHAT_UNIONID })
    );
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: userAccount.id,
        account: buildWeappAccount(WEAPP_OPENID),
      })
    );
  });

  it('does not rewrite the user when code2session has no unionid', async () => {
    const { service, userModel, userAccountModel, wechatPayService } =
      createService();
    const { user, userAccount } = buildWeappUserAccount();

    wechatPayService.getWeappLoginSessionByJsCode.mockResolvedValue({
      openid: WEAPP_OPENID,
    });
    mockUserLookup(userModel, { byId: { id: 'user-weapp', user } });
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (where.account === buildWeappAccount(WEAPP_OPENID)) {
        return userAccount;
      }

      return null;
    });

    const result = await service.weappLogin({ jsCode: 'js-code' });

    expect(result.isNewUser).toBe(false);
    expect(userModel.save).not.toHaveBeenCalled();
  });

  it('stores unionid when creating a weapp user after open platform binding', async () => {
    const { service, userModel, wechatPayService } = createService();

    wechatPayService.getWeappLoginSessionByJsCode.mockResolvedValue({
      openid: WEAPP_OPENID,
      unionid: WECHAT_UNIONID,
    });

    const result = await service.weappLogin({ jsCode: 'js-code' });

    expect(result.isNewUser).toBe(true);
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '',
        phoneVerified: false,
        unionid: WECHAT_UNIONID,
      })
    );
  });
});
