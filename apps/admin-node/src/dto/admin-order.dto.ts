import { Rule, RuleType } from '@midwayjs/validate';

const orderStatusRule = RuleType.string().valid(
  'pending',
  'paid',
  'granting',
  'completed',
  'closed',
  'refund_requested',
  'refunded',
  'grant_failed'
);

const orderTypeRule = RuleType.string().valid('vip_plan', 'voice_package');

const orderSourceRule = RuleType.string().valid('app', 'weapp', 'admin');

export class CreateAdminOrderDTO {
  @Rule(orderTypeRule.required())
  orderType: string;

  @Rule(RuleType.string().required())
  userId: string;

  @Rule(RuleType.string().allow('').optional())
  vipPlanId?: string;

  @Rule(RuleType.string().allow('').optional())
  voicePackageId?: string;

  @Rule(RuleType.string().allow('').optional())
  agentId?: string;
}

export class ListAdminOrdersQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(orderStatusRule.allow('').optional())
  status?: string;

  @Rule(orderTypeRule.allow('').optional())
  orderType?: string;

  @Rule(orderSourceRule.allow('').optional())
  source?: string;

  @Rule(RuleType.string().allow('').optional())
  userId?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}
