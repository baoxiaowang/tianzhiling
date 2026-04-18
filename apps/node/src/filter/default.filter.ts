import { Catch } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AppError } from '../common/errors';
import { errorResponse } from '../common/response';

@Catch()
export class DefaultErrorFilter {
  async catch(err: Error, ctx: Context) {
    const isAppError = err instanceof AppError;
    const status = isAppError ? err.status : 500;

    ctx.status = status;
    ctx.logger.error(err);

    return errorResponse(
      isAppError ? err.code : 'INTERNAL_SERVER_ERROR',
      isAppError ? err.message : 'Internal server error',
      isAppError ? err.data : null
    );
  }
}
