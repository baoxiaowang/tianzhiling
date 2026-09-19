import { AppError } from '../../src/common/errors';
import { DefaultErrorFilter } from '../../src/filter/default.filter';

function createContext() {
  return {
    logger: {
      warn: jest.fn(),
      error: jest.fn(),
    },
    method: 'POST',
    path: '/api/user/weapp-login',
    status: 200,
  } as any;
}

describe('DefaultErrorFilter', () => {
  it('keeps client validation errors instead of masking them as 500', async () => {
    const filter = new DefaultErrorFilter();
    const ctx = createContext();
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

  it('logs expected AppError 4xx as a single WARN line without a stack', async () => {
    const filter = new DefaultErrorFilter();
    const ctx = createContext();
    const error = new AppError(
      'WEAPP_ACCOUNT_NOT_FOUND',
      'wechat account does not exist',
      404
    );

    const result = await filter.catch(error, ctx);

    expect(ctx.status).toBe(404);
    expect(ctx.logger.error).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    const [message, ...args] = ctx.logger.warn.mock.calls[0];
    expect(message).toContain('[http] client error');
    expect(args).toEqual([
      404,
      'WEAPP_ACCOUNT_NOT_FOUND',
      'POST',
      '/api/user/weapp-login',
      'wechat account does not exist',
    ]);
    expect(result).toMatchObject({
      success: false,
      code: 'WEAPP_ACCOUNT_NOT_FOUND',
      message: 'wechat account does not exist',
    });
  });

  it('keeps the full stack for unexpected 4xx that is not an AppError', async () => {
    const filter = new DefaultErrorFilter();
    const ctx = createContext();
    const error = Object.assign(new Error('body parse failed'), {
      status: 400,
    });

    await filter.catch(error, ctx);

    expect(ctx.logger.warn).not.toHaveBeenCalled();
    expect(ctx.logger.error).toHaveBeenCalledWith(error);
  });

  it('keeps the full stack for 5xx failures', async () => {
    const filter = new DefaultErrorFilter();
    const ctx = createContext();
    const error = new AppError('MEMORY_MODEL_FAILED', 'boom', 500);

    const result = await filter.catch(error, ctx);

    expect(ctx.logger.warn).not.toHaveBeenCalled();
    expect(ctx.logger.error).toHaveBeenCalledWith(error);
    expect(result).toMatchObject({
      success: false,
      code: 'MEMORY_MODEL_FAILED',
      message: 'boom',
    });
  });
});
