import { Middleware, IMiddleware } from '@midwayjs/core';
import { NextFunction, Context } from '@midwayjs/koa';
import { isApiResponse, successResponse } from '../common/response';

@Middleware()
export class FormatMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const result = await next();

      if (typeof result === 'undefined') {
        return result;
      }

      if (ctx.status === 404 || ctx.status < 200) {
        ctx.status = 200;
      }

      if (isApiResponse(result)) {
        return result;
      }

      return successResponse(result);
    };
  }

  static getName(): string {
    return 'format';
  }

  // match(ctx) {
  //   return ctx.path.indexOf('/api') !== -1;
  // }
  ignore = [
    (ctx: Context): boolean => {
      const ignoreList = ['/api/agent/[\\S]*/chat'];
      const ignore = ignoreList.some(path => new RegExp(path).test(ctx.path));
      return ignore;
    },
  ];
}
