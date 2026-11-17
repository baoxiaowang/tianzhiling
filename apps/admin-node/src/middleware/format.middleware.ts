import { IMiddleware, Middleware } from '@midwayjs/core';
import { Readable } from 'stream';
import { Context, NextFunction } from '@midwayjs/koa';
import { isApiResponse, successResponse } from '@tzl/shared';

@Middleware()
export class FormatMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const result = await next();

      // HTML 页面（如声音训练工作台独立页）原样输出，不包 JSON 信封
      if (String(ctx.type || '').includes('text/html')) {
        return result;
      }

      // 文件下载等二进制响应：原样返回，不能套 JSON 信封
      const body = ctx.body ?? result;
      if (Buffer.isBuffer(body) || body instanceof Readable) {
        return body;
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
}
