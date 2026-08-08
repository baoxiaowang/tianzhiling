import { AppError } from '../common/errors';
import { Config, IMiddleware, Middleware, Inject } from '@midwayjs/core';
import { JwtService } from '@midwayjs/jwt';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Context, NextFunction } from '@midwayjs/koa';
import {
  MongoObjectId,
  UserAccountStatus,
  UserEntity,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  getRevokedAccessTokenRedisKey,
  getRevokedUserRedisKey,
  getUserAccountStatusRedisKey,
} from '../common/auth-token';
import { AuthenticatedUserPayload } from '../interface';

interface JwtConfig {
  secret?: string;
  verify?: Record<string, unknown>;
}

interface ProtectedRoute {
  methods?: string[];
  path: RegExp;
}

const ACTIVE_USER_STATUS_CACHE_SECONDS = 300;

const PROTECTED_ROUTES: ProtectedRoute[] = [
  { path: /^\/user\/me(?:\/.*)?$/ },
  { methods: ['POST'], path: /^\/user\/logout\/?$/ },
  { path: /^\/agent(?:\/.*)?$/ },
  { path: /^\/conversation(?:\/.*)?$/ },
  { path: /^\/membership\/(?:center|purchase-center|status)(?:\/.*)?$/ },
  { path: /^\/voice-packages(?:\/.*)?$/ },
  { path: /^\/voice-services(?:\/.*)?$/ },
  { path: /^\/orders(?:\/.*)?$/ },
  { methods: ['POST'], path: /^\/storage\/upload\/?$/ },
  { path: /^\/storage\/(?:oss|cos)\/sign-upload\/?$/ },
  { methods: ['POST'], path: /^\/post\/?$/ },
  { methods: ['GET'], path: /^\/post\/comment-notifications\/?$/ },
  { methods: ['GET'], path: /^\/post\/comment-notifications\/summary\/?$/ },
  { methods: ['POST'], path: /^\/post\/comment-notifications\/read\/?$/ },
  { methods: ['GET'], path: /^\/post\/notifications\/?$/ },
  { methods: ['GET'], path: /^\/post\/notifications\/summary\/?$/ },
  { methods: ['GET'], path: /^\/post\/notifications\/entry-summary\/?$/ },
  { methods: ['POST'], path: /^\/post\/notifications\/read\/?$/ },
  { methods: ['POST'], path: /^\/post\/notifications\/seen\/?$/ },
  { methods: ['POST'], path: /^\/post\/notifications\/entry-seen\/?$/ },
  {
    methods: ['POST'],
    path: /^\/post\/notifications\/[^/]+\/read\/?$/,
  },
  { methods: ['POST'], path: /^\/post\/[^/]+\/likes\/?$/ },
  { methods: ['DELETE'], path: /^\/post\/[^/]+\/likes\/?$/ },
  { methods: ['DELETE'], path: /^\/post\/[^/]+\/?$/ },
  {
    methods: ['POST'],
    path: /^\/post\/[^/]+\/comments\/?$/,
  },
  { path: /^\/admin(?:\/.*)?$/ },
];

const OPTIONAL_AUTH_ROUTES: ProtectedRoute[] = [
  { path: /^\/post(?:\/.*)?$/ },
];

/// Routes where an *expired* token is still accepted — the controller
/// is responsible for token renewal (e.g. /user/me/refresh).
const REFRESH_ROUTES = new Set(['/user/me/refresh']);

@Middleware()
export class AuthMiddleware implements IMiddleware<Context, NextFunction> {
  @Config('jwt')
  jwtConfig: JwtConfig;

  @Inject()
  jwtService: JwtService;

  @Inject()
  redisService: RedisService;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const token = this.extractBearerToken(ctx.get('authorization'));

      const isRefreshPath = REFRESH_ROUTES.has(
        this.normalizePath(ctx.path)
      );

      const auth = isRefreshPath
        ? this.verifyAccessTokenAllowExpired(token)
        : this.verifyAccessToken(token);

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
    const prefix = this.normalizePath('/');

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

  /// Like verifyAccessToken, but accepts expired (signature-valid) tokens
  /// so /user/me/refresh can issue a new one.
  private verifyAccessTokenAllowExpired(
    token: string
  ): AuthenticatedUserPayload {
    try {
      const payload = this.jwtService.verifySync(
        token,
        this.jwtConfig?.secret?.trim() || '1774073039411_5782',
        {
          ...(this.jwtConfig?.verify ?? {}),
          ignoreExpiration: true,
        }
      ) as AuthenticatedUserPayload;

      if (!payload?.sub || !payload?.account || !payload?.exp) {
        throw new AppError('INVALID_TOKEN', 'token payload is incomplete', 401);
      }

      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
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

    const revokedUser = await this.redisService.get(
      getRevokedUserRedisKey(auth.sub)
    );

    if (revokedUser) {
      throw new AppError('ACCOUNT_CANCELED', 'account has been canceled', 401);
    }

    const statusKey = getUserAccountStatusRedisKey(auth.sub);
    const cachedStatus = await this.redisService.get(statusKey);
    if (cachedStatus === UserAccountStatus.active) {
      return;
    }

    const userId = MongoObjectId.isValid(auth.sub)
      ? auth.sub
      : null;

    if (!userId) {
      throw new AppError('INVALID_TOKEN', 'token user id is invalid', 401);
    }

    const user = await this.userModel.findOne({ where: { id: userId } });

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 401);
    }

    if (user.accountStatus === UserAccountStatus.canceled) {
      throw new AppError('ACCOUNT_CANCELED', 'account has been canceled', 401);
    }

    await this.redisService.set(
      statusKey,
      UserAccountStatus.active,
      'EX',
      ACTIVE_USER_STATUS_CACHE_SECONDS
    );
  }
}
