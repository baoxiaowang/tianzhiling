import { AuthMiddleware } from '../../src/middleware/auth.middleware';

describe('AuthMiddleware route matching', () => {
  function createMiddleware() {
    const middleware = new AuthMiddleware();
    middleware.globalPrefix = '/api';
    return middleware;
  }

  function createContext(path: string, method = 'GET', authorization = '') {
    return {
      path,
      method,
      get: () => authorization,
    };
  }

  it.each(['/api/membership/center', '/api/membership/status'])(
    'protects membership route %s',
    path => {
      const middleware = createMiddleware();

      expect(middleware.match(createContext(path) as never)).toBe(true);
    }
  );

  it.each([
    '/api/voice-packages/agent/69fa1150b21e11e4ddf9a0cf/center',
    '/api/voice-services/current',
  ])('protects voice service route %s', path => {
    const middleware = createMiddleware();

    expect(middleware.match(createContext(path) as never)).toBe(true);
  });

  it('protects deleting a post', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(
        createContext('/api/post/665000000000000000000100', 'DELETE') as never
      )
    ).toBe(true);
  });

  it.each([
    ['/api/post/notifications/entry-summary', 'GET'],
    ['/api/post/notifications/seen', 'POST'],
    ['/api/post/notifications/entry-seen', 'POST'],
    ['/api/post/notifications/665000000000000000000400/read', 'POST'],
  ])('protects post notification route %s', (path, method) => {
    const middleware = createMiddleware();

    expect(middleware.match(createContext(path, method) as never)).toBe(true);
  });

  it('accepts optional auth for post comments', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(
        createContext(
          '/api/post/665000000000000000000100/comments',
          'GET',
          'Bearer token'
        ) as never
      )
    ).toBe(true);
  });

  it('leaves public post comments readable without auth', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(
        createContext(
          '/api/post/665000000000000000000100/comments',
          'GET'
        ) as never
      )
    ).toBe(false);
  });

  it('does not protect unrelated membership route names', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(createContext('/api/membership/plans') as never)
    ).toBe(false);
  });

  it('keeps invitation preview public while protecting acceptance', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(
        createContext('/api/agent-share/example-token/preview', 'GET') as never
      )
    ).toBe(false);
    expect(
      middleware.match(
        createContext('/api/agent/share-invites/accept', 'POST') as never
      )
    ).toBe(true);
  });
});

describe('AuthMiddleware account revocation', () => {
  function createActiveTokenMiddleware(redisGet: jest.Mock) {
    const middleware = new AuthMiddleware();
    middleware.redisService = {
      get: redisGet,
      set: jest.fn(),
    } as never;
    middleware.userModel = {
      findOne: jest.fn().mockResolvedValue({ accountStatus: 'active' }),
    } as never;
    return middleware;
  }

  const auth = {
    sub: '507f1f77bcf86cd799439011',
    accountId: '507f1f77bcf86cd799439012',
    account: 'weapp:test',
    iat: 0,
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: 'nonce-1',
  };

  it('checks both the token nonce and the whole user account', async () => {
    const redisGet = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('active');
    const middleware = createActiveTokenMiddleware(redisGet);

    await expect(
      (middleware as any).ensureTokenIsActive(auth)
    ).resolves.toBeUndefined();
    expect(redisGet).toHaveBeenNthCalledWith(1, 'auth:revoked-token:nonce-1');
    expect(redisGet).toHaveBeenNthCalledWith(
      2,
      `auth:revoked-user:${auth.sub}`
    );
    expect(redisGet).toHaveBeenNthCalledWith(3, `auth:user-status:${auth.sub}`);
  });

  it('rejects every token after the user account is canceled', async () => {
    const redisGet = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('{"canceledAt":1}');
    const middleware = createActiveTokenMiddleware(redisGet);

    await expect(
      (middleware as any).ensureTokenIsActive(auth)
    ).rejects.toMatchObject({
      code: 'ACCOUNT_CANCELED',
      status: 401,
    });
  });

  it('keeps cancellation durable when Redis has lost the revocation marker', async () => {
    const redisGet = jest.fn().mockResolvedValue(null);
    const middleware = createActiveTokenMiddleware(redisGet);
    middleware.userModel = {
      findOne: jest.fn().mockResolvedValue({
        accountStatus: 'canceled',
        canceledAt: new Date('2026-08-03T00:00:00.000Z'),
      }),
    } as never;

    await expect(
      (middleware as any).ensureTokenIsActive(auth)
    ).rejects.toMatchObject({
      code: 'ACCOUNT_CANCELED',
      status: 401,
    });
    expect(middleware.redisService.set).toHaveBeenCalledWith(
      `auth:revoked-user:${auth.sub}`,
      expect.stringContaining('canceledAt')
    );
  });
});
