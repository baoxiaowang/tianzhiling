import { AuthMiddleware } from '../../src/middleware/auth.middleware';

describe('AuthMiddleware route matching', () => {
  function createMiddleware() {
    const middleware = new AuthMiddleware();
    middleware.globalPrefix = '/api';
    return middleware;
  }

  it.each([
    '/api/membership/center',
    '/api/membership/status',
  ])('protects membership route %s', path => {
    const middleware = createMiddleware();

    expect(
      middleware.match({
        path,
        method: 'GET',
      } as never)
    ).toBe(true);
  });

  it('does not protect unrelated membership route names', () => {
    const middleware = createMiddleware();

    expect(
      middleware.match({
        path: '/api/membership/plans',
        method: 'GET',
      } as never)
    ).toBe(false);
  });
});
