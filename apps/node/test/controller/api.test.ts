import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { Framework, IMidwayKoaApplication } from '@midwayjs/koa';

// 全量套件并行跑时 createApp 会超过 Jest 默认 5s 钩子超时；按应用真实启动时间放宽。
jest.setTimeout(60000);

describe('test/controller/home.test.ts', () => {
  let app: IMidwayKoaApplication;

  beforeAll(async () => {
    app = await createApp<Framework>();
  });

  afterAll(async () => {
    await close(app);
  });

  it('should GET /api/users/:uid', async () => {
    const result = await createHttpRequest(app).get('/api/users/123');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.code).toBe('OK');
    expect(result.body.data.uid).toBe(123);
    expect(result.body.data.nickname).toBe('天之灵用户');
  });

  it('should reject invalid uid', async () => {
    const result = await createHttpRequest(app).get('/api/users/abc');

    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.code).toBe('INVALID_UID');
  });
});
