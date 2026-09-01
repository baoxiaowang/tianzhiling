import { createHash } from 'crypto';
import {
  MongoObjectId,
  OrderEntity,
  OrderRefundType,
  OrderStatus,
} from '@tzl/entities';

type SnapshotValue = Record<string, unknown>;

export interface HistoricalRefundCandidate {
  id: MongoObjectId;
  refundNo: string;
  refundType: OrderRefundType;
  amount: number;
  paymentRefundId?: string;
  requestedAt: Date;
  completedAt: Date;
}

export interface HistoricalRefundPlan {
  candidates: HistoricalRefundCandidate[];
  errors: string[];
  warnings: string[];
  effectiveRefundAmount: number;
  candidateAmount: number;
  eligible: boolean;
}

export function buildRefundRecordId(refundNo: string): MongoObjectId {
  return new MongoObjectId(
    createHash('sha256').update(refundNo).digest('hex').slice(0, 24)
  );
}

function asSnapshot(value: unknown): SnapshotValue | undefined {
  return value && typeof value === 'object'
    ? (value as SnapshotValue)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asValidAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (!(typeof value === 'string' || value instanceof Date)) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isRefundCompleted(snapshot: SnapshotValue): boolean {
  const status = asTrimmedString(snapshot.status);
  const wechatStatus = asTrimmedString(snapshot.wechatRefundStatus);
  return (
    status === 'completed' ||
    status === 'benefits_processing' ||
    status === 'benefits_failed' ||
    wechatStatus?.toUpperCase() === 'SUCCESS'
  );
}

function buildSnapshotCandidate(
  snapshot: SnapshotValue,
  refundType: OrderRefundType,
  errors: string[]
): HistoricalRefundCandidate | undefined {
  if (!isRefundCompleted(snapshot)) {
    return undefined;
  }

  const label =
    refundType === OrderRefundType.voiceMembershipDowngrade
      ? '会员降级退款'
      : '会员最终退订退款';
  const refundNo = asTrimmedString(snapshot.refundNo);
  const amount = asValidAmount(snapshot.refundAmount);
  const requestedAt = parseDate(
    snapshot.attemptRequestedAt ?? snapshot.requestedAt
  );
  const completedAt = parseDate(
    snapshot.completedAt ?? snapshot.refundRecordedAt
  );

  if (!refundNo) errors.push(`${label}缺少退款单号`);
  if (!amount) errors.push(`${label}金额不是正的安全整数`);
  if (!requestedAt) errors.push(`${label}缺少有效申请时间`);
  if (!completedAt) errors.push(`${label}缺少有效完成时间`);
  if (!refundNo || !amount || !requestedAt || !completedAt) return undefined;

  return {
    id: buildRefundRecordId(refundNo),
    refundNo,
    refundType,
    amount,
    paymentRefundId: asTrimmedString(snapshot.wechatRefundId),
    requestedAt,
    completedAt,
  };
}

export function buildHistoricalRefundPlan(
  order: OrderEntity
): HistoricalRefundPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidates: HistoricalRefundCandidate[] = [];
  const refundedAt = parseDate(order.refundedAt);
  const snapshot = asSnapshot(order.snapshot) ?? {};
  const downgrade = asSnapshot(snapshot.voiceMembershipDowngrade);
  const finalRefund = asSnapshot(snapshot.voiceMembershipFinalRefund);

  if (!order.id || !MongoObjectId.isValid(String(order.id))) {
    errors.push('原订单缺少有效 ObjectId');
  }
  if (!order.userId || !MongoObjectId.isValid(String(order.userId))) {
    errors.push('用户缺少有效 ObjectId');
  }
  if (!asTrimmedString(order.orderNo)) errors.push('原订单号为空');

  if (downgrade) {
    const candidate = buildSnapshotCandidate(
      downgrade,
      OrderRefundType.voiceMembershipDowngrade,
      errors
    );
    if (candidate) candidates.push(candidate);
  }
  if (finalRefund) {
    const candidate = buildSnapshotCandidate(
      finalRefund,
      OrderRefundType.voiceMembershipFinalRefund,
      errors
    );
    if (candidate) candidates.push(candidate);
  }

  const completedSnapshots = [downgrade, finalRefund].filter(
    (value): value is SnapshotValue =>
      Boolean(value && isRefundCompleted(value))
  );
  const claimedKnownAmount = completedSnapshots.reduce(
    (sum, value) => sum + (asValidAmount(value.refundAmount) ?? 0),
    0
  );
  const storedRefundAmount = asValidAmount(order.refundAmount);
  let effectiveRefundAmount = storedRefundAmount ?? 0;

  if (!storedRefundAmount && order.status === OrderStatus.refunded) {
    effectiveRefundAmount =
      asValidAmount(order.paidAmount) ??
      asValidAmount(order.payableAmount) ??
      0;
    if (effectiveRefundAmount > 0) {
      warnings.push('原订单缺少累计退款额，按已退款订单实付金额核对');
    }
  }
  if (effectiveRefundAmount === 0 && claimedKnownAmount > 0) {
    effectiveRefundAmount = claimedKnownAmount;
    warnings.push('原订单缺少累计退款额，按已成功的分段退款金额合计核对');
  }

  if (claimedKnownAmount > effectiveRefundAmount) {
    errors.push(
      `分段退款合计 ${claimedKnownAmount} 大于原订单累计退款额 ${effectiveRefundAmount}`
    );
  }

  const remainder = effectiveRefundAmount - claimedKnownAmount;
  const ambiguousMembershipRefund =
    order.orderType === 'vip_plan' &&
    order.status !== OrderStatus.refunded &&
    effectiveRefundAmount > 0 &&
    claimedKnownAmount === 0;
  if (ambiguousMembershipRefund) {
    errors.push('会员订单存在退款金额，但缺少可判定退款性质的成功快照');
  }
  if (remainder > 0) {
    const orderNo = asTrimmedString(order.orderNo);
    if (!orderNo) {
      errors.push('普通退款无法生成退款单号');
    } else if (!refundedAt) {
      errors.push('普通退款缺少有效完成时间');
    } else if (!ambiguousMembershipRefund) {
      const refundNo = `R${orderNo}`;
      candidates.push({
        id: buildRefundRecordId(refundNo),
        refundNo,
        refundType: OrderRefundType.orderRefund,
        amount: remainder,
        requestedAt: refundedAt,
        completedAt: refundedAt,
      });
    }
  }

  const refundNos = new Set<string>();
  for (const candidate of candidates) {
    if (refundNos.has(candidate.refundNo)) {
      errors.push(`订单内退款单号重复：${candidate.refundNo}`);
    }
    refundNos.add(candidate.refundNo);
  }

  const candidateAmount = candidates.reduce(
    (sum, item) => sum + item.amount,
    0
  );
  if (candidateAmount !== effectiveRefundAmount) {
    errors.push(
      `退款金额不守恒：拆分合计 ${candidateAmount}，应为 ${effectiveRefundAmount}`
    );
  }

  return {
    candidates,
    errors,
    warnings,
    effectiveRefundAmount,
    candidateAmount,
    eligible: errors.length === 0 && effectiveRefundAmount > 0,
  };
}
