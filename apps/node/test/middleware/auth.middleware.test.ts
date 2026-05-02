import { AuthMiddleware } from '../../src/middleware/auth.middleware';

describe('AuthMiddleware route matching', () => {
  function createMiddleware() {
    const middleware = new AuthMiddleware();
    middleware.globalPrefix = '/api';
    return middleware;
  }

  it.each([
    '/api/membership/center/69f5b418d37d566df0d3cf13',
    '/api/membership/status/69f5b418d37d566df0d3cf13',
  ])('protects agent-scoped membership route %s', path => {
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
