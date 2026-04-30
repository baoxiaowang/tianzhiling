import { Rule, RuleType } from '@midwayjs/validate';

const statusRule = RuleType.string().valid('active', 'disabled');

const benefitRule = RuleType.object({
  title: RuleType.string().trim().min(1).max(80).required(),
  description: RuleType.string().allow('').max(300).optional(),
});

const entitlementGrantRule = RuleType.object({
  type: RuleType.string()
    .valid('voice_model', 'chat_import', 'interview', 'family_seat')
    .required(),
  totalQuota: RuleType.number().integer().min(1).max(9999).required(),
  durationDays: RuleType.number().integer().min(1).max(36500).optional(),
});

export class ListAdminVipPlansQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(statusRule.optional())
  status?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class SaveAdminVipPlanDTO {
  @Rule(
    RuleType.string()
      .trim()
      .pattern(/^[a-zA-Z][a-zA-Z0-9_]{1,49}$/)
      .required()
  )
  code: string;

  @Rule(RuleType.string().trim().min(1).max(50).required())
  name: string;

  @Rule(RuleType.string().allow('').max(500).optional())
  description?: string;

  @Rule(RuleType.number().integer().min(0).max(99999999).required())
  priceAmount: number;

  @Rule(RuleType.number().integer().min(0).max(99999999).optional())
  originalPriceAmount?: number;

  @Rule(RuleType.string().trim().valid('CNY').optional())
  currency?: string;

  @Rule(RuleType.number().integer().min(1).max(36500).optional())
  durationDays?: number;

  @Rule(RuleType.boolean().optional())
  lifetime?: boolean;

  @Rule(RuleType.array().items(benefitRule).max(20).optional())
  benefits?: Array<{ title: string; description?: string }>;

  @Rule(RuleType.array().items(entitlementGrantRule).max(20).optional())
  entitlementGrants?: Array<{
    type: string;
    totalQuota: number;
    durationDays?: number;
  }>;

  @Rule(RuleType.number().integer().min(0).max(99999999).optional())
  couponGrantAmount?: number;

  @Rule(statusRule.optional())
  status?: string;

  @Rule(RuleType.number().integer().min(0).max(999999).optional())
  sort?: number;
}
