import { IMiddleware, Middleware } from '@midwayjs/core';
import { Context, NextFunction } from '@midwayjs/koa';

@Middleware()
export class AdminPerformanceMiddleware
  implements IMiddleware<Context, NextFunction>
{
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const startedAt = process.hrtime.bigint();
      try {
        return await next();
      } finally {
        const durationMs =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const body = ctx.body;
        const responseBytes = body
          ? Buffer.byteLength(
              typeof body === 'string' ? body : JSON.stringify(body),
              'utf8'
            )
          : 0;
        const message = `admin_request method=${ctx.method} path=${
          ctx.path
        } status=${ctx.status} app_ms=${durationMs.toFixed(
          1
        )} response_bytes=${responseBytes}`;

        if (durationMs >= 500 || responseBytes >= 256 * 1024) {
          ctx.logger.warn(message);
        } else {
          ctx.logger.info(message);
        }
        if (!ctx.headerSent) {
          ctx.set('Server-Timing', `app;dur=${durationMs.toFixed(1)}`);
        }
      }
    };
  }

  static getName(): string {
    return 'adminPerformance';
  }
}
