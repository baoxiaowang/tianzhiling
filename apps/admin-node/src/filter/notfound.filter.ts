import { Catch, httpError, MidwayHttpError } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { errorResponse } from '@tzl/shared';

@Catch(httpError.NotFoundError)
export class NotFoundFilter {
  async catch(err: MidwayHttpError, ctx: Context) {
    ctx.status = 404;
    ctx.logger.warn(err.message);

    return errorResponse(
      'RESOURCE_NOT_FOUND',
      'Requested resource was not found'
    );
  }
}
