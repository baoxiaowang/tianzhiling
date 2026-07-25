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
  OrderStatus.refundRequested,
  OrderStatus.grantFailed,
]);

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

    const paidAmount = normalizeAmount(order.paidAmount ?? order.payableAmount);
    const refundAmount = normalizeAmount(order.refundAmount);

    return total + Math.max(paidAmount - refundAmount, 0);
  }, 0);
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

function normalizeAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(Math.trunc(value ?? 0), 0) : 0;
}
