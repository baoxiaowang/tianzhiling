import { ReportMiddleware } from '../../src/middleware/report.middleware';

describe('ReportMiddleware', () => {
  it('returns request correlation and server timing headers', async () => {
    const headers = new Map<string, string>();
    const logger = { info: jest.fn() };
    const ctx = {
      state: {},
      method: 'GET',
      path: '/api/post',
      status: 200,
      headerSent: false,
      logger,
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'x-request-id' ? 'request-123' : ''
      ),
      set: jest.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
    } as any;
    const middleware = new ReportMiddleware().resolve();

    await expect(
      middleware(ctx, jest.fn().mockResolvedValue('ok'))
    ).resolves.toBe('ok');

    expect(ctx.state.requestId).toBe('request-123');
    expect(headers.get('X-Request-Id')).toBe('request-123');
    expect(headers.get('Server-Timing')).toMatch(/^app;dur=\d+(?:\.\d)$/);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('request_id=request-123')
    );
  });
});
