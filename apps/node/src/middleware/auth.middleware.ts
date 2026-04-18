import { AppError } from '../common/errors';
import { Config, IMiddleware, Middleware, Inject } from '@midwayjs/core';
import { JwtService } from '@midwayjs/jwt';
import { RedisService } from '@midwayjs/redis';
import { Context, NextFunction } from '@midwayjs/koa';
import { getRevokedAccessTokenRedisKey } from '../common/auth-token';
import { AuthenticatedUserPayload } from '../interface';

interface JwtConfig {
  secret?: string;
  verify?: Record<string, unknown>;
}

@Middleware()
export class AuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Config('jwt')
  jwtConfig: JwtConfig;

  @Inject()
  jwtService: JwtService;

  @Inject()
  redisService: RedisService;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const token = this.extractBearerToken(ctx.get('authorization'));
      const auth = this.verifyAccessToken(token);
      await this.ensureTokenIsActive(auth);

      ctx.state.auth = auth;

      return next();
    };
  }

  ignore = [
    (ctx: Context): boolean => {
      return (
        !ctx.path.startsWith('/api/') ||
        ctx.path === '/api/system/health' ||
        ctx.path === '/api/user/sms-code' ||
        ctx.path === '/api/user/phone-login' ||
        ctx.path === '/api/user/password-login' ||
        /^\/api\/users\/[^/]+$/.test(ctx.path)
      );
    },
  ];

  static getName(): string {
    return 'auth';
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

  private verifyAccessToken(token: string): AuthenticatedUserPayload {
    try {
      const payload = this.jwtService.verifySync(
        token,
        this.jwtConfig?.secret?.trim() || '1774073039411_5782',
        this.jwtConfig?.verify ?? {}
      ) as AuthenticatedUserPayload;

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

  private async ensureTokenIsActive(
    auth: AuthenticatedUserPayload
  ): Promise<void> {
    const nonce = auth?.nonce?.trim();

    if (!nonce) {
      throw new AppError('INVALID_TOKEN', 'token nonce is missing', 401);
    }

    const revoked = await this.redisService.get(
      getRevokedAccessTokenRedisKey(nonce)
    );

    if (revoked) {
      throw new AppError('TOKEN_REVOKED', 'token has been revoked', 401);
    }
  }
}
