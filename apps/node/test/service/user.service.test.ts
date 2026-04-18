import { UserService } from '../../src/service/user.service';

function createObjectId(value: string) {
  return {
    toHexString: () => value,
  };
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

  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as any;
  service.redisService = redisService as any;
  service.userModel = userModel as any;
  service.userAccountModel = userAccountModel as any;
  service.jwtService = {
    signSync: jest.fn().mockReturnValue('test-token'),
  } as any;

  return {
    service,
    redisService,
    userModel,
    userAccountModel,
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
});
