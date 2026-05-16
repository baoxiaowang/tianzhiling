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

interface ProtectedRoute {
  methods?: string[];
  path: RegExp;
}

const PROTECTED_ROUTES: ProtectedRoute[] = [
  { path: /^\/user\/me(?:\/.*)?$/ },
  { methods: ['POST'], path: /^\/user\/logout\/?$/ },
  { path: /^\/agent(?:\/.*)?$/ },
  { path: /^\/conversation(?:\/.*)?$/ },
  { path: /^\/membership\/(?:center|status)(?:\/.*)?$/ },
  { path: /^\/voice-packages(?:\/.*)?$/ },
  { path: /^\/orders(?:\/.*)?$/ },
  { methods: ['POST'], path: /^\/storage\/upload\/?$/ },
  { path: /^\/storage\/(?:oss|cos)\/sign-upload\/?$/ },
  { methods: ['POST'], path: /^\/post\/?$/ },
  { methods: ['GET'], path: /^\/post\/comment-notifications\/?$/ },
  { methods: ['GET'], path: /^\/post\/comment-notifications\/summary\/?$/ },
  { methods: ['POST'], path: /^\/post\/comment-notifications\/read\/?$/ },
  { methods: ['POST'], path: /^\/post\/[^/]+\/likes\/?$/ },
  { methods: ['DELETE'], path: /^\/post\/[^/]+\/likes\/?$/ },
  {
    methods: ['POST'],
    path: /^\/post\/[^/]+\/comment-notifications\/read\/?$/,
  },
  { methods: ['POST'], path: /^\/post\/[^/]+\/comments\/?$/ },
];

const OPTIONAL_AUTH_ROUTES: ProtectedRoute[] = [
  { methods: ['GET'], path: /^\/post\/?$/ },
  { methods: ['GET'], path: /^\/post\/[^/]+\/?$/ },
];

@Middleware()
export class AuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Config('koa.globalPrefix')
  globalPrefix: string;

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

  match(ctx: Context): boolean {
    const normalizedPath = this.normalizePath(ctx.path);
    const routePaths = this.resolveRoutePathCandidates(normalizedPath);

    if (
      PROTECTED_ROUTES.some(route =>
        routePaths.some(routePath =>
          this.isProtectedRoute(route, ctx.method, routePath)
        )
      )
    ) {
      return true;
    }

    if (!ctx.get('authorization')?.trim()) {
      return false;
    }

    return OPTIONAL_AUTH_ROUTES.some(route =>
      routePaths.some(routePath =>
        this.isProtectedRoute(route, ctx.method, routePath)
      )
    );
  }

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

  private isProtectedRoute(
    route: ProtectedRoute,
    method: string,
    path: string
  ): boolean {
    if (route.methods && !route.methods.includes(method)) {
      return false;
    }

    return route.path.test(path);
  }

  private resolveRoutePathCandidates(path: string): string[] {
    const strippedPath = this.stripGlobalPrefix(path);
    const paths = [path, strippedPath];

    return Array.from(new Set(paths.filter(Boolean)));
  }

  private stripGlobalPrefix(path: string): string {
    const normalizedPath = this.normalizePath(path);
    const prefix = this.normalizePath(this.globalPrefix || '');

    if (!prefix || normalizedPath === prefix) {
      return normalizedPath;
    }

    if (normalizedPath.startsWith(`${prefix}/`)) {
      return normalizedPath.slice(prefix.length) || '/';
    }

    return normalizedPath;
  }

  private normalizePath(path: string): string {
    const trimmed = path.trim().replace(/^\/+|\/+$/g, '');

    return trimmed ? `/${trimmed}` : '';
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
