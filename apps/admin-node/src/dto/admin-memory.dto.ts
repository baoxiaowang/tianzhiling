import { Rule, RuleType } from '@midwayjs/validate';

/**
 * 记忆系统修复：后台记忆事实管理列表查询 DTO。
 * 支持按 status 筛选，默认返回所有状态（含 archived）。
 */
export class ListAdminMemoriesQueryDTO {
  @Rule(
    RuleType.string()
      .valid(
        'active',
        'candidate',
        'conflicted',
        'pending',
        'rejected',
        'archived'
      )
      .allow('')
      .optional()
  )
  status?: string;

  @Rule(RuleType.string().allow('').max(64).optional())
  agentId?: string;

  @Rule(RuleType.string().allow('').max(64).optional())
  userId?: string;

  @Rule(RuleType.string().allow('').max(40).optional())
  type?: string;

  @Rule(RuleType.string().allow('').max(64).optional())
  keyword?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}
