import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';

describe('test/controller/home.test.ts', () => {
  it('should GET /api/users/:uid', async () => {
    const app = await createApp<Framework>();

    const result = await createHttpRequest(app).get('/api/users/123');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.code).toBe('OK');
    expect(result.body.data.uid).toBe(123);
    expect(result.body.data.nickname).toBe('天之灵用户');

    await close(app);
  });

  it('should reject invalid uid', async () => {
    const app = await createApp<Framework>();

    const result = await createHttpRequest(app).get('/api/users/abc');

    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.code).toBe('INVALID_UID');

    await close(app);
  });
});
