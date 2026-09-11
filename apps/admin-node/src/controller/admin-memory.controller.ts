import { Controller, Get, Inject, Query } from '@midwayjs/core';
import { ListAdminMemoriesQueryDTO } from '../dto/admin-memory.dto';
import { AdminMemoryService } from '../service/admin-memory.service';

/**
 * 记忆系统修复：后台记忆事实管理控制器。
 * 提供记忆事实列表查询，支持按 status 筛选（默认返回所有状态）。
 * 路由前缀由全局配置统一加上 /admin_api，实际访问为 /admin_api/memories。
 */
@Controller('/memories')
export class AdminMemoryController {
  @Inject()
  adminMemoryService: AdminMemoryService;

  @Get('/')
  async list(@Query() query: ListAdminMemoriesQueryDTO) {
    return this.adminMemoryService.listFacts(query);
  }
}
