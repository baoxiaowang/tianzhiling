import { Controller, Get, Inject, Param } from '@midwayjs/core';
import { AgentVtTokenService } from '../service/agent-vt-token.service';

/**
 * 管理端：声音训练 Agent 工作台唯一链接（走管理员 JWT 鉴权）。
 */
@Controller('/agent-vt')
export class AdminAgentVtController {
  @Inject()
  agentVtTokenService: AgentVtTokenService;

  /** 获取（无则自动创建）指定用户的声音训练唯一链接。 */
  @Get('/links/:userId')
  async getOrCreateLink(@Param('userId') userId: string) {
    return this.agentVtTokenService.getOrCreateLink(userId);
  }
}
