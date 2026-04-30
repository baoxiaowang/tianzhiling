import { IMiddleware, Middleware } from '@midwayjs/core';
import { Context, NextFunction } from '@midwayjs/koa';
import { isApiResponse, successResponse } from '@tzl/shared';

@Middleware()
export class FormatMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (_ctx: Context, next: NextFunction) => {
      const result = await next();

      if (isApiResponse(result)) {
        return result;
      }

      return successResponse(result);
    };
  }

  static getName(): string {
    return 'format';
  }
}
