import { UserService } from '../../src/service/user.service';
import { createHash } from 'crypto';

const WEAPP_OPENID = 'o1234567890abcdefghijklmnopqrstuvwxyz';
const CURRENT_USER_ID = '507f1f77bcf86cd799439011';
const CURRENT_ACCOUNT_ID = '507f1f77bcf86cd799439012';

function buildWeappAccount(openid: string) {
  return `weapp:${createHash('sha256')
    .update(openid)
    .digest('hex')
    .slice(0, 12)}`;
}

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

  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as any;
  service.redisService = redisService as any;
  service.userModel = userModel as any;
  service.userAccountModel = userAccountModel as any;
  service.userMembershipModel = userMembershipModel as any;
  service.jwtService = {
    signSync: jest.fn().mockReturnValue('test-token'),
  } as any;
  service.postImageService = {
    resolveForResponse: jest.fn((avatar: string) => avatar),
  } as any;
  service.wechatPayService = {
    getOpenidByJsCode: jest.fn().mockResolvedValue(WEAPP_OPENID),
    getPhoneNumberByCode: jest.fn().mockResolvedValue('13800138000'),
  } as any;

  return {
    service,
    redisService,
    userModel,
    userAccountModel,
    userMembershipModel,
  };
}

describe('UserService phoneLogin', () => {
  it('accepts sms codes copied from messages with separators or full-width digits', async () => {
    const { service, redisService, userModel, userAccountModel } =
      createService();

    redisService.get.mockResolvedValue(
      JSON.stringify({
        phone: '13800138000',
        purpose: 'phone_login',
        code: '123456',
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 60_000,
      })
    );

    const result = await service.phoneLogin({
      phone: '13800138000',
      code: '１２ ３-４５６',
    });

    expect(result.accessToken).toBe('test-token');
    expect(result.user.phone).toBe('13800138000');
    expect(result.isNewUser).toBe(true);
    expect(redisService.del).toHaveBeenCalledWith('sms:login:code:13800138000');
    expect(userModel.save).toHaveBeenCalledTimes(1);
    expect(userAccountModel.save).toHaveBeenCalledTimes(1);
  });

  it('still rejects incorrect sms codes after normalization', async () => {
    const { service, redisService } = createService();

    redisService.get.mockResolvedValue(
      JSON.stringify({
        phone: '13800138000',
        purpose: 'phone_login',
        code: '123456',
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 60_000,
      })
    );

    await expect(
      service.phoneLogin({
        phone: '13800138000',
        code: '123457',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_SMS_CODE',
      status: 400,
    });
  });

  it('allows the fixed 666666 code without requesting sms first', async () => {
    const { service, redisService } = createService();

    const result = await service.phoneLogin({
      phone: '13800138000',
      code: '666666',
    });

    expect(result.accessToken).toBe('test-token');
    expect(result.user.phone).toBe('13800138000');
    expect(redisService.get).not.toHaveBeenCalled();
    expect(redisService.del).not.toHaveBeenCalled();
  });

  it('uses a short hash account when binding a new weapp user', async () => {
    const { service, userAccountModel } = createService();

    const result = await service.weappPhoneLogin({
      jsCode: 'js-code',
      phoneCode: 'phone-code',
    });

    expect(result.accessToken).toBe('test-token');
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        account: buildWeappAccount(WEAPP_OPENID),
      })
    );
  });

  it('creates an unbound weapp user without requiring phone authorization', async () => {
    const { service, userModel, userAccountModel } = createService();

    const result = await service.weappLogin({
      jsCode: 'js-code',
    });

    expect(result.accessToken).toBe('test-token');
    expect(result.isNewUser).toBe(true);
    expect(result.user.phone).toBe('');
    expect(result.user.phoneVerified).toBe(false);
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '',
        phoneVerified: false,
      })
    );
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        account: buildWeappAccount(WEAPP_OPENID),
      })
    );
  });

  it('does not create a weapp user during silent login recovery', async () => {
    const { service, userModel, userAccountModel } = createService();

    await expect(
      service.weappLogin({
        jsCode: 'js-code',
        allowCreate: false,
      })
    ).rejects.toMatchObject({
      code: 'WEAPP_ACCOUNT_NOT_FOUND',
      status: 404,
    });
    expect(userModel.save).not.toHaveBeenCalled();
    expect(userAccountModel.save).not.toHaveBeenCalled();
  });

  it('binds a weapp session phone from the current user profile', async () => {
    const { service, userModel, userAccountModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const accountId = createObjectId(CURRENT_ACCOUNT_ID);
    const user = {
      id: userId,
      name: '天之灵用户',
      avatar: '',
      phone: '',
      phoneVerified: false,
    };
    const weappAccount = {
      id: accountId,
      userId,
      account: buildWeappAccount(WEAPP_OPENID),
      password: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    userModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_USER_ID) ||
        matchesObjectId(where._id, CURRENT_USER_ID)
      ) {
        return user;
      }

      if (where.phone === '13800138000') {
        return null;
      }

      return null;
    });
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_ACCOUNT_ID) ||
        matchesObjectId(where._id, CURRENT_ACCOUNT_ID)
      ) {
        return weappAccount;
      }

      if (where.account === '13800138000') {
        return null;
      }

      return null;
    });

    const result = await service.bindCurrentUserWeappPhone(
      {
        sub: CURRENT_USER_ID,
        accountId: CURRENT_ACCOUNT_ID,
        account: weappAccount.account,
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: 'nonce',
      },
      {
        phoneCode: 'phone-code',
      }
    );

    expect(result.accessToken).toBe('test-token');
    expect(result.user.phone).toBe('13800138000');
    expect(result.user.phoneVerified).toBe(true);
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: userId,
        phone: '13800138000',
        phoneVerified: true,
      })
    );
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        account: '13800138000',
        userId,
      })
    );
  });

  it('keeps legacy weapp accounts loginable and migrates them to short hash', async () => {
    const { service, userModel, userAccountModel } = createService();
    const userId = createObjectId('user-legacy');
    const accountId = createObjectId('account-legacy');
    const user = {
      id: userId,
      name: '天之灵用户8000',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
    };
    const legacyAccount = {
      id: accountId,
      userId,
      account: `weapp:${WEAPP_OPENID}`,
      password: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    userModel.findOne.mockResolvedValue(user);
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (where.account === buildWeappAccount(WEAPP_OPENID)) {
        return null;
      }

      if (where.account === `weapp:${WEAPP_OPENID}`) {
        return legacyAccount;
      }

      return null;
    });

    const result = await service.weappLogin({
      jsCode: 'js-code',
    });

    expect(result.user.account).toBe(buildWeappAccount(WEAPP_OPENID));
    expect(userAccountModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: accountId,
        userId,
        account: buildWeappAccount(WEAPP_OPENID),
      })
    );
  });
});
