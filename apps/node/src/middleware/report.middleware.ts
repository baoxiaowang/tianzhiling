import { Middleware, IMiddleware } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';
import { randomBytes } from 'crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

@Middleware()
export class ReportMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const startTime = process.hrtime.bigint();
      const incomingRequestId = ctx.get('x-request-id').trim();
      const requestId = REQUEST_ID_PATTERN.test(incomingRequestId)
        ? incomingRequestId
        : randomBytes(12).toString('hex');
      ctx.state.requestId = requestId;
      ctx.set('X-Request-Id', requestId);

      try {
        return await next();
      } finally {
        const durationMs =
          Number(process.hrtime.bigint() - startTime) / 1_000_000;

        if (!ctx.headerSent) {
          ctx.set('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
        }
        ctx.logger.info(
          `request_id=${requestId} method=${ctx.method} path=${
            ctx.path
          } status=${ctx.status} app_ms=${durationMs.toFixed(1)}`
        );
      }
    };
  }

  static getName(): string {
    return 'report';
  }
}
