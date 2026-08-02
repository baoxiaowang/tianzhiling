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

  it.each([
    '/api/membership/center',
    '/api/membership/status',
  ])('protects membership route %s', path => {
    const middleware = createMiddleware();

    expect(
      middleware.match(createContext(path) as never)
    ).toBe(true);
  });

  it('protects voice package center route', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(
        createContext(
          '/api/voice-packages/agent/69fa1150b21e11e4ddf9a0cf/center'
        ) as never
      )
    ).toBe(true);
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
    [
      '/api/post/notifications/665000000000000000000400/read',
      'POST',
    ],
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
