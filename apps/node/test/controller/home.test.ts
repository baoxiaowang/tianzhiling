import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';

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
