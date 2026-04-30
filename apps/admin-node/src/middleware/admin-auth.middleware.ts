import { AppError, AdminAuthenticatedPayload } from '@tzl/shared';
import { Config, IMiddleware, Middleware, Inject } from '@midwayjs/core';
import { JwtService } from '@midwayjs/jwt';
import { Context, NextFunction } from '@midwayjs/koa';

interface JwtConfig {
  secret?: string;
  verify?: Record<string, unknown>;
}

const PUBLIC_ADMIN_API_PATHS = new Set([
  '/admin_api/system/health',
  '/admin_api/auth/bootstrap-status',
  '/admin_api/auth/bootstrap-register',
  '/admin_api/auth/login',
]);

@Middleware()
export class AdminAuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Config('jwt')
  jwtConfig: JwtConfig;

  @Inject()
  jwtService: JwtService;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const token = this.extractBearerToken(ctx.get('authorization'));
      const auth = this.verifyAccessToken(token);

      if (!auth.roles?.includes('admin')) {
        throw new AppError('ADMIN_FORBIDDEN', 'admin role is required', 403);
      }

      ctx.state.adminAuth = auth;

      return next();
    };
  }

  ignore = [
    (ctx: Context): boolean => {
      return (
        ctx.method === 'OPTIONS' ||
        !ctx.path.startsWith('/admin_api/') ||
        PUBLIC_ADMIN_API_PATHS.has(this.normalizePath(ctx.path))
      );
    },
  ];

  static getName(): string {
    return 'adminAuth';
  }

  private extractBearerToken(authorization?: string): string {
    const value = authorization?.trim();

    if (!value) {
      throw new AppError('UNAUTHORIZED', 'authorization is required', 401);
    }

    const [type, token] = value.split(/\s+/);

    if (type !== 'Bearer' || !token) {
      throw new AppError(
        'INVALID_AUTHORIZATION',
        'authorization must use Bearer token',
        401
      );
    }

    return token;
  }

  private normalizePath(path: string): string {
    if (path.length > 1 && path.endsWith('/')) {
      return path.slice(0, -1);
    }

    return path;
  }

  private verifyAccessToken(token: string): AdminAuthenticatedPayload {
    try {
      const payload = this.jwtService.verifySync(
        token,
        this.jwtConfig?.secret?.trim() || '1774073039411_5782',
        this.jwtConfig?.verify ?? {}
      ) as AdminAuthenticatedPayload;

      if (!payload?.sub || !payload?.account || !payload?.exp) {
        throw new AppError('INVALID_TOKEN', 'token payload is incomplete', 401);
      }

      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const errorName = (error as { name?: string } | undefined)?.name;

      if (errorName === 'TokenExpiredError') {
        throw new AppError('TOKEN_EXPIRED', 'token has expired', 401);
      }

      throw new AppError('INVALID_TOKEN', 'token is invalid', 401);
    }
  }
}
