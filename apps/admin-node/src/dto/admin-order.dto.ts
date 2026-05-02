import { Rule, RuleType } from '@midwayjs/validate';

const orderStatusRule = RuleType.string().valid(
  'pending',
  'paid',
  'granting',
  'completed',
  'closed',
  'refunded',
  'grant_failed'
);

const orderTypeRule = RuleType.string().valid('vip_plan');

const orderSourceRule = RuleType.string().valid('app', 'weapp', 'admin');

export class ListAdminOrdersQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(orderStatusRule.optional())
  status?: string;

  @Rule(orderTypeRule.optional())
  orderType?: string;

  @Rule(orderSourceRule.optional())
  source?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}
