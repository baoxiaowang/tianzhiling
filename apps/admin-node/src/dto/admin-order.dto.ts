import { Rule, RuleType } from '@midwayjs/validate';

const orderStatusRule = RuleType.string().valid(
  'pending',
  'paid',
  'granting',
  'completed',
  'closed',
  'refund_requested',
  'refunded',
  'grant_failed',
  // 合并列表的 status 同时作用于退款行，故加入退款状态取值
  'processing',
  'failed'
);

const orderTypeRule = RuleType.string().valid('vip_plan', 'voice_package');

const orderSourceRule = RuleType.string().valid('app', 'weapp', 'admin');

const adminOrderPaymentTypeRule = RuleType.string().valid('normal', 'virtual');

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

  @Rule(RuleType.boolean().optional())
  replaceActiveVoiceTrainingTask?: boolean;
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

  @Rule(adminOrderPaymentTypeRule.allow('').optional())
  paymentType?: string;

  @Rule(RuleType.alternatives(RuleType.boolean(), RuleType.string()).optional())
  excludeAdminManual?: boolean | string;

  /** 行类型筛选：order=只看购买订单，refund=只看退款，缺省=两者都看 */
  @Rule(RuleType.string().valid('order', 'refund').allow('').optional())
  kind?: string;

  /**
   * 日期区间（含首尾）。
   * **购买订单按支付时间 paidAt，退款按完成时间 completedAt**，两者分别归入，
   * 避免「本月支付、下月退款」的订单被错算到任一侧。
   */
  @Rule(RuleType.string().allow('').optional())
  createdAtStart?: string;

  @Rule(RuleType.string().allow('').optional())
  createdAtEnd?: string;

  @Rule(
    RuleType.string()
      .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
      .allow('')
      .optional()
  )
  registeredMonth?: string;

  @Rule(RuleType.string().allow('').optional())
  userId?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class VoiceMembershipDowngradeDTO {
  @Rule(RuleType.string().required())
  targetVipPlanId: string;
}

export class RejectRefundDTO {
  @Rule(RuleType.string().valid('not_refund', 'rejected').required())
  action: 'not_refund' | 'rejected';
}
