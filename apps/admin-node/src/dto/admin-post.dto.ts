import { Rule, RuleType } from '@midwayjs/validate';

export class ListAdminPostsQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(RuleType.string().allow('').optional())
  userId?: string;

  @Rule(
    RuleType.string().valid('normal', 'risk_controlled').allow('').optional()
  )
  moderationStatus?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class UpdateAdminPostModerationDTO {
  @Rule(RuleType.string().valid('normal', 'risk_controlled').required())
  moderationStatus: string;

  @Rule(RuleType.string().allow('').max(200).optional())
  moderationReason?: string;
}

export class UpdateAdminPostPinningDTO {
  @Rule(RuleType.boolean().required())
  isPinned: boolean;
}
