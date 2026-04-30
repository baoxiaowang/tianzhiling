import { Rule, RuleType } from '@midwayjs/validate';

export class ListAdminAppUsersQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class ListAdminAppUserAgentsQueryDTO {
  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class UpdateAdminAppUserDTO {
  @Rule(RuleType.string().trim().min(1).max(50).optional())
  name?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  avatar?: string;
}
