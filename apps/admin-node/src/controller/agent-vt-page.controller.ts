import { Controller, Get, Inject, Param } from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { AgentVtPageService } from '../service/agent-vt-page.service';
import type { AgentVtAuthState } from '../middleware/agent-vt-auth.middleware';

/**
 * 声音训练 Agent 工作台独立页面（GET /admin_api/agent_vt/p/:token）。
 * 鉴权由 AgentVtAuthMiddleware 完成（仅凭 token）。
 */
@Controller('/agent_vt/p')
export class AgentVtPageController {
  @Inject()
  agentVtPageService: AgentVtPageService;

  @Get('/:token')
  async renderPage(ctx: Context, @Param('token') token: string) {
    const state = ctx.state?.agentVt as AgentVtAuthState | undefined;
    const html = this.agentVtPageService.render({
      token,
      agentName: state?.agentName,
    });
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = html;
  }
}
