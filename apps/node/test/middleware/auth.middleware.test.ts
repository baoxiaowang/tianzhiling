import { AuthMiddleware } from '../../src/middleware/auth.middleware';

describe('AuthMiddleware route matching', () => {
  function createMiddleware() {
    const middleware = new AuthMiddleware();
    middleware.globalPrefix = '/api';
    return middleware;
  }

  function createContext(path: string, method = 'GET') {
    return {
      path,
      method,
      get: () => '',
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

  it('does not protect unrelated membership route names', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match(createContext('/api/membership/plans') as never)
    ).toBe(false);
  });
});
