import { Rule, RuleType } from '@midwayjs/validate';

export class ListAdminAppUsersQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class ListAdminAppUserMembersQueryDTO extends ListAdminAppUsersQueryDTO {
  @Rule(
    RuleType.string()
      .allow('')
      .valid('one_year', 'three_year', 'lifetime')
      .optional()
  )
  membershipType?: 'one_year' | 'three_year' | 'lifetime';
}

export class ListAdminAppUserVoiceServicesQueryDTO extends ListAdminAppUsersQueryDTO {
  @Rule(
    RuleType.string()
      .allow('')
      .valid('pending', 'servicing', 'refunded')
      .optional()
  )
  serviceStatus?: 'pending' | 'servicing' | 'refunded';
}

export class ListAdminAppUserAgentsQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

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

  @Rule(RuleType.string().allow('').optional())
  riskControlUntilAt?: string;
}
