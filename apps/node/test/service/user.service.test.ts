import { UserService } from '../../src/service/user.service';
import { createHash } from 'crypto';

const WEAPP_OPENID = 'o1234567890abcdefghijklmnopqrstuvwxyz';
const CURRENT_USER_ID = '507f1f77bcf86cd799439011';
const CURRENT_ACCOUNT_ID = '507f1f77bcf86cd799439012';
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_LOGIN_ENABLED = process.env.NODE_DEV_LOGIN_ENABLED;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;

  if (ORIGINAL_DEV_LOGIN_ENABLED == null) {
    delete process.env.NODE_DEV_LOGIN_ENABLED;
  } else {
    process.env.NODE_DEV_LOGIN_ENABLED = ORIGINAL_DEV_LOGIN_ENABLED;
  }
});

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
  const wechatPayService = {
    getOpenidByJsCode: jest.fn().mockResolvedValue(WEAPP_OPENID),
    getPhoneNumberByCode: jest.fn().mockResolvedValue('13800138000'),
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
        openId: WEAPP_OPENID,
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
        openId: WEAPP_OPENID,
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

  it('keeps dev login disabled unless explicitly enabled', async () => {
    const { service, userModel } = createService();

    process.env.NODE_ENV = 'development';
    delete process.env.NODE_DEV_LOGIN_ENABLED;

    await expect(
      service.devLogin({
        account: buildWeappAccount(WEAPP_OPENID),
        openid: WEAPP_OPENID,
      })
    ).rejects.toMatchObject({
      code: 'DEV_LOGIN_DISABLED',
      status: 404,
    });
    expect(userModel.findOne).not.toHaveBeenCalled();
  });

  it('rejects dev login when account and openid do not match', async () => {
    const { service, userAccountModel } = createService();

    process.env.NODE_ENV = 'development';
    process.env.NODE_DEV_LOGIN_ENABLED = 'true';
    userAccountModel.findOne.mockResolvedValue(null);

    await expect(
      service.devLogin({
        account: buildWeappAccount(WEAPP_OPENID),
        openid: WEAPP_OPENID,
      })
    ).rejects.toMatchObject({
      code: 'DEV_LOGIN_ACCOUNT_OPENID_MISMATCH',
      status: 404,
    });
  });

  it('returns a normal session for dev login when account and openid match', async () => {
    const { service, userModel, userAccountModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const accountId = createObjectId(CURRENT_ACCOUNT_ID);
    const user = {
      id: userId,
      name: '未了言用户',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
      gender: 'unknown',
      region: null,
    };
    const userAccount = {
      id: accountId,
      userId,
      account: buildWeappAccount(WEAPP_OPENID),
      password: '',
      openId: WEAPP_OPENID,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    process.env.NODE_ENV = 'development';
    process.env.NODE_DEV_LOGIN_ENABLED = 'true';
    userModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_USER_ID) ||
        matchesObjectId(where._id, CURRENT_USER_ID)
      ) {
        return user;
      }

      return null;
    });
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        where.account === buildWeappAccount(WEAPP_OPENID) &&
        where.openId === WEAPP_OPENID
      ) {
        return userAccount;
      }

      return null;
    });

    const result = await service.devLogin({
      account: buildWeappAccount(WEAPP_OPENID),
      openid: WEAPP_OPENID,
    });

    expect(result.accessToken).toBe('test-token');
    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe(CURRENT_USER_ID);
    expect(result.user.account).toBe(buildWeappAccount(WEAPP_OPENID));
  });

  it('binds a weapp session phone from the current user profile', async () => {
    const { service, userModel, userAccountModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const accountId = createObjectId(CURRENT_ACCOUNT_ID);
    const user = {
      id: userId,
      name: '未了言用户',
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
      name: '未了言用户8000',
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
        openId: WEAPP_OPENID,
      })
    );
  });

  it('prefers existing short hash weapp account over legacy openId duplicates', async () => {
    const { service, userModel, userAccountModel } = createService();
    const shortUserId = createObjectId('user-short');
    const legacyUserId = createObjectId('user-legacy');
    const shortAccountId = createObjectId('account-short');
    const shortAccount = {
      id: shortAccountId,
      userId: shortUserId,
      account: buildWeappAccount(WEAPP_OPENID),
      password: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const legacyAccount = {
      id: createObjectId('account-legacy'),
      userId: legacyUserId,
      account: `weapp:${WEAPP_OPENID}`,
      password: '',
      openId: WEAPP_OPENID,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const shortUser = {
      id: shortUserId,
      name: '未了言用户8000',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
    };

    userModel.findOne.mockResolvedValue(shortUser);
    userAccountModel.findOne.mockImplementation(async ({ where }: any) => {
      if (where.account === buildWeappAccount(WEAPP_OPENID)) {
        return shortAccount;
      }

      if (
        where.openId === WEAPP_OPENID ||
        where.account === `weapp:${WEAPP_OPENID}`
      ) {
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
        id: shortAccountId,
        userId: shortUserId,
        account: buildWeappAccount(WEAPP_OPENID),
        openId: WEAPP_OPENID,
      })
    );
    expect(userAccountModel.save).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: legacyAccount.id,
        account: buildWeappAccount(WEAPP_OPENID),
      })
    );
  });

  it('returns unknown gender for legacy user profiles without gender', async () => {
    const { service, userModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const user = {
      id: userId,
      name: '未了言用户',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
    };

    userModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_USER_ID) ||
        matchesObjectId(where._id, CURRENT_USER_ID)
      ) {
        return user;
      }

      return null;
    });

    const result = await service.getCurrentUser({
      sub: CURRENT_USER_ID,
      accountId: CURRENT_ACCOUNT_ID,
      account: '13800138000',
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'nonce',
    });

    expect(result.gender).toBe('unknown');
  });

  it('updates current user gender', async () => {
    const { service, userModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const user = {
      id: userId,
      name: '未了言用户',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
      gender: 'unknown',
    };

    userModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_USER_ID) ||
        matchesObjectId(where._id, CURRENT_USER_ID)
      ) {
        return user;
      }

      return null;
    });

    const result = await service.updateCurrentUserGender(
      {
        sub: CURRENT_USER_ID,
        accountId: CURRENT_ACCOUNT_ID,
        account: '13800138000',
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: 'nonce',
      },
      {
        gender: 'female',
      }
    );

    expect(result.gender).toBe('female');
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: userId,
        gender: 'female',
        updatedAt: expect.any(Date),
      })
    );
  });

  it('rejects invalid current user gender', async () => {
    const { service, userModel } = createService();

    await expect(
      service.updateCurrentUserGender(
        {
          sub: CURRENT_USER_ID,
          accountId: CURRENT_ACCOUNT_ID,
          account: '13800138000',
          iat: 0,
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce: 'nonce',
        },
        {
          gender: 'other',
        } as any
      )
    ).rejects.toMatchObject({
      code: 'INVALID_USER_GENDER',
      status: 400,
    });
    expect(userModel.save).not.toHaveBeenCalled();
  });

  it('returns null region for legacy user profiles without region', async () => {
    const { service, userModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const user = {
      id: userId,
      name: '未了言用户',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
      gender: 'unknown',
    };

    userModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_USER_ID) ||
        matchesObjectId(where._id, CURRENT_USER_ID)
      ) {
        return user;
      }

      return null;
    });

    const result = await service.getCurrentUser({
      sub: CURRENT_USER_ID,
      accountId: CURRENT_ACCOUNT_ID,
      account: '13800138000',
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'nonce',
    });

    expect(result.region).toBeNull();
  });

  it('updates current user region from province and city codes', async () => {
    const { service, userModel } = createService();
    const userId = createObjectId(CURRENT_USER_ID);
    const user = {
      id: userId,
      name: '未了言用户',
      avatar: '',
      phone: '13800138000',
      phoneVerified: true,
      gender: 'unknown',
      region: null,
    };

    userModel.findOne.mockImplementation(async ({ where }: any) => {
      if (
        matchesObjectId(where.id, CURRENT_USER_ID) ||
        matchesObjectId(where._id, CURRENT_USER_ID)
      ) {
        return user;
      }

      return null;
    });

    const result = await service.updateCurrentUserRegion(
      {
        sub: CURRENT_USER_ID,
        accountId: CURRENT_ACCOUNT_ID,
        account: '13800138000',
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: 'nonce',
      },
      {
        provinceCode: '44',
        cityCode: '4403',
      }
    );

    expect(result.region).toEqual({
      countryCode: 'CN',
      countryName: '中国',
      provinceCode: '44',
      provinceName: '广东省',
      cityCode: '4403',
      cityName: '深圳市',
    });
    expect(userModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: userId,
        region: result.region,
        updatedAt: expect.any(Date),
      })
    );
  });

  it('rejects invalid current user region codes', async () => {
    const { service, userModel } = createService();

    await expect(
      service.updateCurrentUserRegion(
        {
          sub: CURRENT_USER_ID,
          accountId: CURRENT_ACCOUNT_ID,
          account: '13800138000',
          iat: 0,
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce: 'nonce',
        },
        {
          provinceCode: '44',
          cityCode: '1101',
        }
      )
    ).rejects.toMatchObject({
      code: 'INVALID_USER_REGION',
      status: 400,
    });
    expect(userModel.save).not.toHaveBeenCalled();
  });
});
