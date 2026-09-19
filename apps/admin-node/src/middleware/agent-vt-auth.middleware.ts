import { Config, IMiddleware, Middleware } from '@midwayjs/core';
import { Context, NextFunction } from '@midwayjs/koa';
import { AppError } from '@tzl/shared';
import { MongoObjectId } from '@tzl/entities';
import { AgentVtTokenService } from '../service/agent-vt-token.service';

interface AgentVtConfig {
  secret?: string;
  allowPageWithoutSecret?: boolean;
}

export interface AgentVtAuthState {
  token: string;
  userId: MongoObjectId;
  agentId: MongoObjectId;
  agentName?: string;
}

/**
 * 声音训练 Agent 工作台独立鉴权（与管理员 JWT 完全解耦）。
 *
 * - 页面路由 /admin_api/agent_vt/p/:token —— 仅凭 token（高熵随机串即密钥）；
 * - 受限 API /admin_api/agent_vt/api/:token/* —— token + X-Agent-Vt-Secret 双因子
 *   （配置了 AGENT_VOICE_SECRET 时校验；未配置时仅 token，便于本地联调）。
 *
 * 鉴权结果注入 ctx.state.agentVt，业务层只使用该身份，不信任请求体身份。
 */
@Middleware()
export class AgentVtAuthMiddleware
  implements IMiddleware<Context, NextFunction>
{
  @Config('agentVt')
  agentVtConfig?: AgentVtConfig;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const path = ctx.path;
      const prefix = '/admin_api/agent_vt/';
      if (!path.startsWith(prefix)) {
        return next();
      }

      const rest = path.slice(prefix.length);
      const segments = rest.split('/');
      const kind = segments[0]; // 'p' | 'api'
      const token = segments[1] ?? '';

      if (kind !== 'p' && kind !== 'api') {
        throw new AppError('AGENT_VT_LINK_NOT_FOUND', 'training link not found', 404);
      }

      const tokenService = await ctx.requestContext.getAsync(AgentVtTokenService);
      const link = await tokenService.resolveByToken(token);
      if (!link) {
        throw new AppError('AGENT_VT_LINK_NOT_FOUND', 'training link not found', 404);
      }

      if (kind === 'api') {
        const secret = ctx.get('x-agent-vt-secret')?.trim() ?? '';
        const configured = this.agentVtConfig?.secret?.trim() ?? '';
        if (configured && secret !== configured) {
          throw new AppError(
            'AGENT_VT_FORBIDDEN',
            'invalid training link secret',
            401
          );
        }
      }

      ctx.state.agentVt = {
        token: link.token,
        userId: new MongoObjectId(link.userId),
        agentId: new MongoObjectId(link.agentId),
        agentName: link.agentName,
      } as AgentVtAuthState;

      return next();
    };
  }

  ignore = [
    (ctx: Context): boolean => {
      return !ctx.path.startsWith('/admin_api/agent_vt/');
    },
  ];

  static getName(): string {
    return 'agentVtAuth';
  }
}
