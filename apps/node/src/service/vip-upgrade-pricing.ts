import {
  MongoObjectId,
  OrderEntity,
  OrderStatus,
  OrderType,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

const paidOrderStatuses = new Set<OrderStatus>([
  OrderStatus.paid,
  OrderStatus.granting,
  OrderStatus.completed,
  OrderStatus.grantFailed,
]);

const LEGACY_WECHAT_PAYMENT_PROVIDER = 'legacy_wechat';

type MoneyUnit = 'fen' | 'yuan';

interface HistoricalAmountCandidate {
  value: unknown;
  legacyYuanField?: boolean;
}

interface MembershipLike {
  vipPlanCode: string;
  lifetime: boolean;
}

interface VipPlanLike {
  code: string;
  planGroup?: string;
  lifetime?: boolean;
}

export interface VipUpgradePricing {
  historicalPaidAmount: number;
  deductedAmount: number;
  payableAmount: number;
}

export async function getHistoricalVipPaidAmount(
  orderModel: MongoRepository<OrderEntity>,
  userId: MongoObjectId
): Promise<number> {
  const orders = await orderModel.find({
    where: {
      userId,
      orderType: OrderType.vipPlan,
    },
  });

  return orders.reduce((total, order) => {
    if (!paidOrderStatuses.has(order.status)) {
      return total;
    }

    const paidAmount = readHistoricalOrderAmount(order, 'paid');
    const refundAmount = Math.max(
      readHistoricalOrderAmount(order, 'refund'),
      readReservedVoiceMembershipDowngradeRefundAmount(order)
    );

    return total + Math.max(paidAmount - refundAmount, 0);
  }, 0);
}

function readReservedVoiceMembershipDowngradeRefundAmount(
  order: OrderEntity
): number {
  const downgrade = getRecord(
    getRecord(order.snapshot)?.voiceMembershipDowngrade
  );

  if (!downgrade) {
    return 0;
  }

  const wechatRefundStatus =
    typeof downgrade.wechatRefundStatus === 'string'
      ? downgrade.wechatRefundStatus.trim().toUpperCase()
      : '';

  if (wechatRefundStatus === 'CLOSED') {
    return 0;
  }

  return normalizeAmount(downgrade.refundAmount);
}

export function calculateVipUpgradePricing(
  priceAmount: number,
  historicalPaidAmount: number
): VipUpgradePricing {
  const normalizedPrice = normalizeAmount(priceAmount);
  const normalizedHistoricalPaid = normalizeAmount(historicalPaidAmount);
  const deductedAmount = Math.min(normalizedPrice, normalizedHistoricalPaid);

  return {
    historicalPaidAmount: normalizedHistoricalPaid,
    deductedAmount,
    payableAmount: Math.max(normalizedPrice - deductedAmount, 0),
  };
}

export function isVipPlanUpgrade(
  membership: MembershipLike,
  currentPlan: VipPlanLike | null | undefined,
  targetPlan: VipPlanLike
): boolean {
  if (
    !targetPlan.lifetime ||
    targetPlan.code === membership.vipPlanCode ||
    targetPlan.code === currentPlan?.code
  ) {
    return false;
  }

  const currentGroup = getPlanGroup(
    currentPlan?.planGroup,
    membership.vipPlanCode
  );
  const targetGroup = getPlanGroup(targetPlan.planGroup, targetPlan.code);
  const currentIsLifetime =
    Boolean(membership.lifetime) || Boolean(currentPlan?.lifetime);

  if (currentGroup === 'voice') {
    return !currentIsLifetime && targetGroup === 'voice';
  }

  if (targetGroup === 'basic') {
    return !currentIsLifetime;
  }

  return targetGroup === 'voice';
}

function getPlanGroup(planGroup: string | undefined, code: string) {
  if (planGroup === 'voice') {
    return 'voice';
  }

  if (planGroup === 'basic') {
    return 'basic';
  }

  return code.toLowerCase().includes('voice') ? 'voice' : 'basic';
}

function readHistoricalOrderAmount(
  order: OrderEntity,
  kind: 'paid' | 'refund'
): number {
  const rawOrder = order as OrderEntity & Record<string, unknown>;
  const candidate =
    kind === 'paid'
      ? firstAmountCandidate([
          { value: order.paidAmount },
          { value: order.payableAmount },
          { value: order.amount },
          { value: rawOrder.pay_amount, legacyYuanField: true },
          { value: rawOrder.total_money, legacyYuanField: true },
          { value: rawOrder.totalMoney, legacyYuanField: true },
        ])
      : firstAmountCandidate([
          { value: order.refundAmount },
          { value: rawOrder.refund_money, legacyYuanField: true },
          { value: rawOrder.refundMoney, legacyYuanField: true },
        ]);

  if (!candidate) {
    return 0;
  }

  const amount = parseAmount(candidate.value);
  const unit = resolveHistoricalMoneyUnit(order, candidate);

  return unit === 'yuan' ? Math.round(amount * 100) : Math.trunc(amount);
}

function firstAmountCandidate(
  candidates: HistoricalAmountCandidate[]
): HistoricalAmountCandidate | undefined {
  return candidates.find(candidate => isAmountValue(candidate.value));
}

function resolveHistoricalMoneyUnit(
  order: OrderEntity,
  candidate: HistoricalAmountCandidate
): MoneyUnit {
  const legacy = getRecord(getRecord(order.snapshot)?.legacy);
  const explicitUnit = normalizeMoneyUnit(
    legacy?.moneyUnit ?? legacy?.storedMoneyUnit
  );

  if (explicitUnit) {
    return explicitUnit;
  }

  if (
    candidate.legacyYuanField ||
    (order.paymentProvider === LEGACY_WECHAT_PAYMENT_PROVIDER && legacy)
  ) {
    return 'yuan';
  }

  return 'fen';
}

function normalizeMoneyUnit(value: unknown): MoneyUnit | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'fen' || normalized === 'cent' || normalized === 'cents') {
    return 'fen';
  }

  if (normalized === 'yuan' || normalized === 'rmb') {
    return 'yuan';
  }

  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isAmountValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  );
}

function normalizeAmount(value: unknown): number {
  return Math.trunc(parseAmount(value));
}

function parseAmount(value: unknown): number {
  if (!isAmountValue(value)) {
    return 0;
  }

  return Math.max(Number(value), 0);
}
