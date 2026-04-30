import { DefaultErrorFilter } from './default.filter';

describe('DefaultErrorFilter', () => {
  it('returns validation errors with their client status', async () => {
    const filter = new DefaultErrorFilter();
    const ctx = {
      logger: {
        error: jest.fn(),
      },
      status: 200,
    } as any;
    const error = Object.assign(new Error('字段校验失败'), {
      code: 'VALIDATE_10000',
      status: 422,
    });

    const result = await filter.catch(error, ctx);

    expect(ctx.status).toBe(422);
    expect(result).toMatchObject({
      success: false,
      code: 'VALIDATE_10000',
      message: '字段校验失败',
      data: null,
    });
  });
});
