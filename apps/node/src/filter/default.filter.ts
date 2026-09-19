import { Catch } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AppError } from '../common/errors';
import { errorResponse } from '../common/response';

@Catch()
export class DefaultErrorFilter {
  async catch(err: Error, ctx: Context) {
    const isAppError = err instanceof AppError;
    const status = isAppError ? err.status : this.resolveErrorStatus(err);
    const isClientError = status >= 400 && status < 500;
    const code =
      isAppError || isClientError
        ? this.resolveErrorCode(err)
        : 'INTERNAL_SERVER_ERROR';

    ctx.status = status;

    if (isAppError && isClientError) {
      // 4xx 且是我们自己主动抛的业务分支（例如未注册账号的登录探测、token 过期），
      // 属于预期内的正常应答，不是故障。此前统一 ctx.logger.error(err) 会把每天的
      // 上千条堆栈写进 common-error.log，把真正需要处理的 5xx 淹掉；这里降为 WARN
      // 并只留一行可检索的上下文（WARN 只进 midway-app.log，不进错误日志）。
      ctx.logger.warn(
        '[http] client error status=%s code=%s method=%s path=%s message=%s',
        status,
        code,
        ctx.method,
        ctx.path,
        err.message
      );
    } else {
      // 5xx，以及非预期来源的 4xx（如解析失败）：保留完整堆栈。
      ctx.logger.error(err);
    }

    return errorResponse(
      code,
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
