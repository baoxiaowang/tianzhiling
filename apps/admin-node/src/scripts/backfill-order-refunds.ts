import { createHash } from 'crypto';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import {
  MongoObjectId,
  OrderEntity,
  OrderRefundEntity,
  OrderRefundStatus,
  OrderStatus,
} from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';
import {
  buildHistoricalRefundPlan,
  HistoricalRefundCandidate,
} from './order-refund-backfill-plan';

const APPLY_CONFIRMATION = 'write-reviewed-refund-orders';

interface AuditedOrder {
  orderId: string;
  orderNo: string;
  effectiveRefundAmount: number;
  candidateAmount: number;
  candidates: Array<{
    refundNo: string;
    refundType: string;
    amount: number;
    requestedAt: string;
    completedAt: string;
    existing: 'missing' | 'exact' | 'conflict';
  }>;
  errors: string[];
  warnings: string[];
}

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

function sameDate(left: Date | undefined, right: Date): boolean {
  return Boolean(left && new Date(left).getTime() === right.getTime());
}

function existingRecordMatches(
  existing: OrderRefundEntity,
  order: OrderEntity,
  candidate: HistoricalRefundCandidate
): boolean {
  return (
    existing.refundNo === candidate.refundNo &&
    String(existing.originalOrderId) === String(order.id) &&
    existing.originalOrderNo === order.orderNo &&
    String(existing.userId) === String(order.userId) &&
    existing.orderType === order.orderType &&
    existing.refundType === candidate.refundType &&
    existing.amount === candidate.amount &&
    existing.status === OrderRefundStatus.completed &&
    sameDate(existing.requestedAt, candidate.requestedAt) &&
    sameDate(existing.completedAt, candidate.completedAt)
  );
}

function digestAudit(rows: AuditedOrder[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function main(): Promise<void> {
  const mode = readStringFrom(['ORDER_REFUND_BACKFILL_MODE'], 'audit')
    .trim()
    .toLowerCase();
  if (mode !== 'audit' && mode !== 'apply') {
    throw new Error('ORDER_REFUND_BACKFILL_MODE 只能是 audit 或 apply');
  }

  const dataSource = new DataSource({
    type: 'mongodb',
    database: readStringFrom(
      ['ADMIN_API_MONGO_DB', 'NODE_MONGO_DB', 'MONGO_DB'],
      'tzl'
    ),
    host: readStringFrom(
      ['ADMIN_API_MONGO_HOST', 'NODE_MONGO_HOST', 'MONGO_HOST'],
      '127.0.0.1'
    ),
    port: readNumberFrom(
      ['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'],
      17271
    ),
    authSource: readStringFrom(
      [
        'ADMIN_API_MONGO_AUTH_SOURCE',
        'NODE_MONGO_AUTH_SOURCE',
        'MONGO_AUTH_SOURCE',
      ],
      'admin'
    ),
    username: readStringFrom(
      ['ADMIN_API_MONGO_USERNAME', 'NODE_MONGO_USERNAME', 'MONGO_USERNAME'],
      'admin'
    ),
    password: readStringFrom(
      ['ADMIN_API_MONGO_PASSWORD', 'NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'],
      'qwerasdf'
    ),
    synchronize: false,
    logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
    entities: [OrderEntity, OrderRefundEntity],
  } as never);

  await dataSource.initialize();
  try {
    const orderRepository = dataSource.getMongoRepository(OrderEntity);
    const refundRepository = dataSource.getMongoRepository(OrderRefundEntity);
    const orders = await orderRepository.find({
      where: {
        $or: [
          { refundAmount: { $gt: 0 } },
          { status: OrderStatus.refunded },
          {
            'snapshot.voiceMembershipDowngrade.status': {
              $in: ['completed', 'benefits_failed'],
            },
          },
          {
            'snapshot.voiceMembershipDowngrade.wechatRefundStatus': {
              $in: ['SUCCESS', 'success'],
            },
          },
          {
            'snapshot.voiceMembershipFinalRefund.status': {
              $in: ['completed', 'benefits_processing', 'benefits_failed'],
            },
          },
          {
            'snapshot.voiceMembershipFinalRefund.wechatRefundStatus': {
              $in: ['SUCCESS', 'success'],
            },
          },
        ],
      } as never,
    });
    orders.sort((left, right) =>
      String(left.id).localeCompare(String(right.id))
    );

    const plans = orders.map(order => ({
      order,
      plan: buildHistoricalRefundPlan(order),
    }));
    const refundNos = plans.reduce<string[]>((all, item) => {
      item.plan.candidates.forEach(candidate => all.push(candidate.refundNo));
      return all;
    }, []);
    const candidateIds = plans.reduce<string[]>((all, item) => {
      item.plan.candidates.forEach(candidate => all.push(String(candidate.id)));
      return all;
    }, []);
    const existingRecords = refundNos.length
      ? await refundRepository.find({
          where: {
            $or: [
              { refundNo: { $in: refundNos } },
              {
                _id: {
                  $in: candidateIds.map(value => new MongoObjectId(value)),
                },
              },
            ],
          } as never,
        })
      : [];
    const existingByRefundNo = new Map(
      existingRecords.map(record => [record.refundNo, record])
    );
    const existingById = new Map(
      existingRecords.map(record => [String(record.id), record])
    );
    const ownerByRefundNo = new Map<string, string>();
    const audited: AuditedOrder[] = [];

    for (const { order, plan } of plans) {
      const errors = [...plan.errors];
      const orderId = String(order.id);
      const candidates = plan.candidates.map(candidate => {
        const priorOwner = ownerByRefundNo.get(candidate.refundNo);
        if (priorOwner && priorOwner !== orderId) {
          errors.push(
            `退款单号 ${candidate.refundNo} 同时属于订单 ${priorOwner} 和 ${orderId}`
          );
        } else {
          ownerByRefundNo.set(candidate.refundNo, orderId);
        }

        const existing =
          existingByRefundNo.get(candidate.refundNo) ??
          existingById.get(String(candidate.id));
        const state: 'missing' | 'exact' | 'conflict' = !existing
          ? 'missing'
          : existingRecordMatches(existing, order, candidate)
          ? 'exact'
          : 'conflict';
        if (state === 'conflict') {
          errors.push(`已有退款流水与历史证据冲突：${candidate.refundNo}`);
        }
        return {
          refundNo: candidate.refundNo,
          refundType: candidate.refundType,
          amount: candidate.amount,
          requestedAt: candidate.requestedAt.toISOString(),
          completedAt: candidate.completedAt.toISOString(),
          existing: state,
        };
      });
      audited.push({
        orderId,
        orderNo: order.orderNo,
        effectiveRefundAmount: plan.effectiveRefundAmount,
        candidateAmount: plan.candidateAmount,
        candidates,
        errors,
        warnings: plan.warnings,
      });
    }

    const digest = digestAudit(audited);
    const errorCount = audited.reduce(
      (sum, item) => sum + item.errors.length,
      0
    );
    const missingCount = audited.reduce(
      (sum, item) =>
        sum +
        item.candidates.filter(candidate => candidate.existing === 'missing')
          .length,
      0
    );
    const summary = {
      mode,
      scannedOrders: audited.length,
      candidateRefunds: refundNos.length,
      missingRefunds: missingCount,
      errors: errorCount,
      approvalDigest: digest,
      orders: audited,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (mode === 'audit') return;
    if (errorCount > 0) {
      throw new Error('审计存在异常，已阻断全部财务回填');
    }
    const confirmation = readStringFrom(
      ['ORDER_REFUND_BACKFILL_CONFIRM'],
      ''
    ).trim();
    if (confirmation !== APPLY_CONFIRMATION) {
      throw new Error(
        `回填前必须设置 ORDER_REFUND_BACKFILL_CONFIRM=${APPLY_CONFIRMATION}`
      );
    }
    const approvedDigest = readStringFrom(
      ['ORDER_REFUND_BACKFILL_APPROVED_DIGEST'],
      ''
    ).trim();
    if (approvedDigest !== digest) {
      throw new Error('审核摘要与当前数据不一致，已阻断全部财务回填');
    }

    for (const { order, plan } of plans) {
      for (const candidate of plan.candidates) {
        if (existingByRefundNo.has(candidate.refundNo)) continue;
        await refundRepository.updateOne(
          { _id: candidate.id } as never,
          {
            $setOnInsert: {
              refundNo: candidate.refundNo,
              originalOrderId: order.id,
              originalOrderNo: order.orderNo,
              userId: order.userId,
              orderType: order.orderType,
              targetCode: order.targetCode,
              refundType: candidate.refundType,
              amount: candidate.amount,
              currency: order.currency || 'CNY',
              status: OrderRefundStatus.completed,
              source: order.source,
              paymentProvider: order.paymentProvider,
              paymentRefundId: candidate.paymentRefundId,
              requestedAt: candidate.requestedAt,
              completedAt: candidate.completedAt,
              createdAt: candidate.requestedAt,
              updatedAt: candidate.completedAt,
            },
          } as never,
          { upsert: true }
        );
      }
    }
    console.log(`财务回填完成：新增 ${missingCount} 笔独立退款流水。`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
