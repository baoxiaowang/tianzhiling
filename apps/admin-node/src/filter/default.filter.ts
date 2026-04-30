import { Catch } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AppError, errorResponse } from '@tzl/shared';

@Catch()
export class DefaultErrorFilter {
  async catch(err: Error, ctx: Context) {
    const isAppError = err instanceof AppError;
    const status = isAppError ? err.status : this.resolveErrorStatus(err);
    const isClientError = status >= 400 && status < 500;

    ctx.status = status;
    ctx.logger.error(err);

    return errorResponse(
      isAppError || isClientError
        ? this.resolveErrorCode(err)
        : 'INTERNAL_SERVER_ERROR',
      isAppError || isClientError ? err.message : 'Internal server error',
      isAppError ? err.data : null
    );
  }

  private resolveErrorStatus(err: Error): number {
    const status = Number((err as { status?: unknown }).status);

    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return status;
    }

    return 500;
  }

  private resolveErrorCode(err: Error): string {
    const code = (err as { code?: unknown }).code;

    return typeof code === 'string' && code ? code : 'BAD_REQUEST';
  }
}
