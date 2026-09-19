import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';

// 全量套件并行跑时 createApp 会超过 Jest 默认 5s 超时；按应用真实启动时间放宽。
jest.setTimeout(60000);

describe('test/controller/home.test.ts', () => {
  it('should GET /api/system/health', async () => {
    const app = await createApp<Framework>();

    const result = await createHttpRequest(app).get('/api/system/health');

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.code).toBe('OK');
    expect(result.body.data.status).toBe('ok');
    expect(result.body.data.service).toBe('tianzhiling-node');

    await close(app);
  });
});
