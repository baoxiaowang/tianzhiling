import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type {
  AdminMonthlyOrderRecordDTO,
  AdminMonthlyOrderReportDTO,
  AdminMonthlyRefundRecordDTO,
  AdminOrderAnalyticsDistributionItemDTO,
} from '@tzl/shared';
import {
  OrderEntity,
  OrderMonthlyReportSnapshotEntity,
  OrderRefundEntity,
  OrderRefundStatus,
  OrderStatus,
  TableName,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const CURRENT_MONTH_TTL_MS = 5 * 60 * 1000;
const CALCULATION_VERSION = 4;

type RawMonthlyOrder = {
  _id: { toString(): string };
  orderNo?: string;
  createdAt?: Date;
  paidAt?: Date;
  targetCode?: string;
  payableAmount?: number;
  paidAmount?: number;
  refundAmount?: number;
  status?: string;
  source?: string;
  paymentProvider?: string;
  snapshot?: { agent?: { name?: string } };
  user?: { name?: string; phone?: string; createdAt?: Date };
  directAgent?: { name?: string };
  agents?: Array<{
    _id?: unknown;
    name?: string;
    iCallAgent?: string;
    agentCallMe?: string;
    description?: string;
    createdAt?: Date;
  }>;
  interactionCount?: number;
  relationship?: string;
};

type RawMonthlyRefund = {
  _id: { toString(): string };
  refundNo?: string;
  originalOrderNo?: string;
  requestedAt?: Date;
  completedAt?: Date;
  refundType?: string;
  amount?: number;
  paymentProvider?: string;
  source?: string;
  status?: string;
  targetCode?: string;
  user?: { name?: string; phone?: string };
};

@Provide()
export class AdminOrderStatisticsService {
  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(OrderMonthlyReportSnapshotEntity)
  snapshotModel: MongoRepository<OrderMonthlyReportSnapshotEntity>;

  @InjectEntityModel(OrderRefundEntity)
  orderRefundModel: MongoRepository<OrderRefundEntity>;

  async getMonthlyReport(
    month?: string,
    forceRefresh = false
  ): Promise<AdminMonthlyOrderReportDTO> {
    const now = new Date();
    const normalizedMonth = this.normalizeMonth(month, this.beijingMonth(now));
    const stored = await this.snapshotModel.findOne({
      where: { month: normalizedMonth },
    });
    const isCurrentMonth = normalizedMonth === this.beijingMonth(now);
    const isFresh = Boolean(
      stored &&
        stored.calculationVersion === CALCULATION_VERSION &&
        (!isCurrentMonth ||
          now.getTime() - new Date(stored.updatedAt).getTime() <
            CURRENT_MONTH_TTL_MS)
    );

    if (!forceRefresh && stored && isFresh) {
      return {
        ...(stored.payload as unknown as AdminMonthlyOrderReportDTO),
        snapshot: {
          persisted: true,
          calculationVersion: stored.calculationVersion,
          updatedAt: new Date(stored.updatedAt).toISOString(),
        },
      };
    }

    const [yearText, monthText] = normalizedMonth.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const start = new Date(Date.UTC(year, monthIndex, 1) - BEIJING_OFFSET_MS);
    const end = new Date(Date.UTC(year, monthIndex + 1, 1) - BEIJING_OFFSET_MS);
    const [rows, refundRows] = await Promise.all([
      this.loadMonthlyOrders(start, end),
      this.loadMonthlyRefunds(start, end),
    ]);
    const records = rows.map(row => this.toRecord(row));
    const refundOrders = refundRows.map(row => this.toRefundRecord(row));
    const validOrders = records.filter(
      record => record.abnormalTypes.length === 0
    );
    const abnormalOrders = records.filter(
      record => record.abnormalTypes.length > 0
    );
    const report: AdminMonthlyOrderReportDTO = {
      month: normalizedMonth,
      timezone: 'Asia/Shanghai',
      generatedAt: now.toISOString(),
      snapshot: {
        persisted: true,
        calculationVersion: CALCULATION_VERSION,
        updatedAt: now.toISOString(),
      },
      totals: {
        allOrders: records.length,
        validOrders: validOrders.length,
        abnormalOrders: abnormalOrders.length,
        validAmount: this.roundMoney(
          validOrders.reduce((sum, order) => sum + order.amount, 0)
        ),
        completedRefunds: refundOrders.length,
        refundedAmount: this.roundMoney(
          refundOrders.reduce((sum, refund) => sum + refund.amount, 0)
        ),
        netAmount: this.roundMoney(
          validOrders.reduce((sum, order) => sum + order.amount, 0) -
            refundOrders.reduce((sum, refund) => sum + refund.amount, 0)
        ),
      },
      validOrders,
      abnormalOrders,
      refundOrders,
      statusDistribution: this.distribution(
        records.map(item => item.statusLabel)
      ),
      productDistribution: this.distribution(
        validOrders.map(item => item.productName)
      ),
      relationshipDistribution: this.distribution(
        validOrders.map(item => item.relationship || '未识别')
      ),
      abnormalTypeDistribution: this.distribution(
        abnormalOrders.reduce<string[]>(
          (types, item) => types.concat(item.abnormalTypes),
          []
        )
      ),
      refundTypeDistribution: this.distribution(
        refundOrders.map(item => item.refundTypeLabel)
      ),
    };

    await this.snapshotModel.updateOne(
      { month: normalizedMonth },
      {
        $set: {
          calculationVersion: CALCULATION_VERSION,
          payload: report,
          generatedAt: now,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      } as never,
      { upsert: true }
    );

    return report;
  }

  private loadMonthlyOrders(
    start: Date,
    end: Date
  ): Promise<RawMonthlyOrder[]> {
    return this.orderModel
      .aggregate<RawMonthlyOrder>([
        {
          $match: {
            paidAt: { $gte: start, $lt: end },
            targetCode: { $ne: 'voice_one' },
          },
        },
        { $sort: { createdAt: 1, _id: 1 } },
        {
          $lookup: {
            from: TableName.user,
            localField: 'userId',
            foreignField: '_id',
            as: 'userRows',
          },
        },
        {
          $lookup: {
            from: TableName.agent,
            localField: 'agentId',
            foreignField: '_id',
            as: 'directAgentRows',
          },
        },
        {
          $lookup: {
            from: TableName.agent,
            localField: 'userId',
            foreignField: 'createdUserId',
            as: 'agents',
          },
        },
        {
          $lookup: {
            from: TableName.message,
            let: {
              userId: '$userId',
              orderTime: '$createdAt',
              agentIds: '$agents._id',
            },
            pipeline: [
              {
                $match: {
                  role: 'user',
                  type: 'text',
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$userId'] },
                      { $in: ['$agentId', '$$agentIds'] },
                      { $lt: ['$createdAt', '$$orderTime'] },
                    ],
                  },
                },
              },
              { $count: 'count' },
            ],
            as: 'interactionRows',
          },
        },
        {
          $project: {
            orderNo: 1,
            createdAt: 1,
            paidAt: 1,
            targetCode: 1,
            payableAmount: 1,
            paidAmount: 1,
            refundAmount: 1,
            status: 1,
            source: 1,
            paymentProvider: 1,
            snapshot: 1,
            relationship: 1,
            user: { $arrayElemAt: ['$userRows', 0] },
            directAgent: { $arrayElemAt: ['$directAgentRows', 0] },
            agents: 1,
            interactionCount: {
              $ifNull: [{ $arrayElemAt: ['$interactionRows.count', 0] }, 0],
            },
          },
        },
      ])
      .toArray();
  }

  private loadMonthlyRefunds(
    start: Date,
    end: Date
  ): Promise<RawMonthlyRefund[]> {
    return this.orderRefundModel
      .aggregate<RawMonthlyRefund>([
        {
          $match: {
            status: OrderRefundStatus.completed,
            completedAt: { $gte: start, $lt: end },
            targetCode: { $ne: 'voice_one' },
            source: { $ne: 'admin' },
            paymentProvider: { $ne: 'admin_manual' },
          },
        },
        { $sort: { completedAt: 1, _id: 1 } },
        {
          $lookup: {
            from: TableName.user,
            localField: 'userId',
            foreignField: '_id',
            as: 'userRows',
          },
        },
        {
          $project: {
            refundNo: 1,
            originalOrderNo: 1,
            requestedAt: 1,
            completedAt: 1,
            refundType: 1,
            amount: 1,
            paymentProvider: 1,
            source: 1,
            status: 1,
            targetCode: 1,
            user: { $arrayElemAt: ['$userRows', 0] },
          },
        },
      ])
      .toArray();
  }

  private toRefundRecord(row: RawMonthlyRefund): AdminMonthlyRefundRecordDTO {
    return {
      id: row._id.toString(),
      refundNo: row.refundNo ?? '',
      originalOrderNo: row.originalOrderNo ?? '',
      occurredAt: new Date(
        row.completedAt ?? row.requestedAt ?? 0
      ).toISOString(),
      refundType: row.refundType ?? '',
      refundTypeLabel: this.refundTypeLabel(row.refundType),
      amount: this.roundMoney((Number(row.amount) || 0) / 100),
      userName: this.userName(row.user),
      productName: this.productName(row.targetCode),
      paymentProvider: row.paymentProvider ?? '-',
      source: row.source ?? '-',
      status: row.status ?? '',
    };
  }

  private toRecord(row: RawMonthlyOrder): AdminMonthlyOrderRecordDTO {
    // 过滤系统创建的"小使者/小天使"智能体，只保留用户创建的亲人智能体
    const agents = (row.agents ?? []).filter(
      agent => !/小使者|小天使/.test(agent.name ?? '')
    );
    // 优先读订单文档上的 relationship 快照（付款时写入，稳定不变）；
    // 历史订单无此字段时，用关键词推断兜底
    let relationship: { label: string; source: string };
    if (row.relationship) {
      relationship = { label: row.relationship, source: '订单快照' };
    } else {
      relationship = this.inferRelationship(agents);
    }
    const agentCreatedAt = agents
      .map(agent => agent.createdAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const orderTime = row.paidAt ? new Date(row.paidAt) : row.createdAt ? new Date(row.createdAt) : undefined;
    const userCreatedAt = row.user?.createdAt
      ? new Date(row.user.createdAt)
      : undefined;
    const abnormalTypes = this.abnormalTypes(row);
    const fallbackAgentNames = [
      ...new Set(agents.map(agent => agent.name).filter(Boolean)),
    ]
      .sort()
      .join('/');
    const agentNames =
      row.snapshot?.agent?.name || row.directAgent?.name || fallbackAgentNames;

    // 降级订单按降级后实际收入计：实付金额 − 累计退款（含降级差价）
    const grossAmount = Number(row.paidAmount ?? row.payableAmount ?? 0);
    const refunded = Number(row.refundAmount ?? 0);
    const netOrderAmount = Math.max(0, grossAmount - refunded);

    return {
      id: row._id.toString(),
      orderNo: row.orderNo ?? '',
      orderedAt: orderTime?.toISOString() ?? '',
      productName: this.productName(row.targetCode),
      amount: this.roundMoney(netOrderAmount / 100),
      agentNames: agentNames || '-',
      userName: this.userName(row.user),
      relationship: relationship.label,
      relationshipSource: relationship.source,
      interactionCount: Number(row.interactionCount) || 0,
      agentCreatedAt: agentCreatedAt?.toISOString() ?? '',
      paymentCycleDays:
        orderTime && userCreatedAt
          ? Math.max(
              0,
              Math.floor(
                (orderTime.getTime() - userCreatedAt.getTime()) / 86400000
              )
            )
          : 0,
      status: row.status ?? '',
      statusLabel: this.statusLabel(row.status),
      abnormalTypes,
      abnormalReason: this.abnormalReason(row, abnormalTypes),
      paymentProvider: row.paymentProvider ?? '-',
      source: row.source ?? '-',
    };
  }

  private abnormalTypes(row: RawMonthlyOrder): string[] {
    const result: string[] = [];
    const statusLabels: Record<string, string> = {
      closed: '未付款',
      refunded: '已退款',
      pending: '待支付',
      refund_requested: '退款申请中',
      paid: '待发放',
      granting: '发放中',
      grant_failed: '发放失败',
    };
    if (row.status !== OrderStatus.completed) {
      result.push(
        statusLabels[row.status ?? ''] ?? this.statusLabel(row.status)
      );
    }
    if (row.source === 'admin' || row.paymentProvider === 'admin_manual') {
      result.push('管理端创建');
    }
    return [...new Set(result)];
  }

  private abnormalReason(row: RawMonthlyOrder, types: string[]): string {
    if (types.length === 0) return '';
    const statusReasons: Record<string, string> = {
      closed: '订单已关闭，未完成付款',
      refunded: '已付款后全额退款',
      pending: '订单待支付',
      refund_requested: '用户申请退款待处理',
      paid: '支付完成，权益待发放',
      granting: '权益正在发放',
      grant_failed: '权益发放失败',
    };
    const base =
      statusReasons[row.status ?? ''] ?? this.statusLabel(row.status);
    return types.includes('管理端创建')
      ? `${base}（后台管理员手动创建）`
      : base;
  }

  private inferRelationship(agents: NonNullable<RawMonthlyOrder['agents']>): {
    label: string;
    source: string;
  } {
    for (const agent of agents) {
      const called = this.firstSegment(agent.iCallAgent);
      const callsUser = this.firstSegment(agent.agentCallMe);
      const text = `${called} ${agent.name ?? ''} ${agent.description ?? ''}`;
      const maleChild = /儿子|弟弟|小宝/.test(callsUser);
      if (/爸爸|父亲|老爸|老爹|爹|爸/.test(text))
        return {
          label: maleChild ? '父子' : '父女',
          source: called ? '称呼' : '档案',
        };
      if (/妈妈|母亲|老妈|妈咪|娘|妈/.test(text))
        return {
          label: maleChild ? '母子' : '母女',
          source: called ? '称呼' : '档案',
        };
      if (/爷爷|姥爷|外公|外姥|姨爹|嗲嗲/.test(text))
        return { label: '爷孙', source: called ? '称呼' : '档案' };
      if (/奶奶|姥姥|外婆|阿姨|姑姑|二姨|小姑|姨夫|婆婆/.test(text))
        return { label: '奶孙', source: called ? '称呼' : '档案' };
      if (/老公|老婆|丈夫|妻子|先生|夫人|爱人/.test(text))
        return { label: '夫妻', source: called ? '称呼' : '档案' };
      if (/前任|男朋友|女朋友|恋人/.test(text))
        return { label: '恋人', source: called ? '称呼' : '档案' };
      if (/哥哥|哥/.test(called))
        return {
          label: /弟弟|弟/.test(callsUser) ? '兄弟' : '兄妹',
          source: '称呼',
        };
      if (/姐姐|姐/.test(called))
        return {
          label: /弟弟|弟/.test(callsUser) ? '姐弟' : '姐妹',
          source: '称呼',
        };
      if (/儿子|小宝/.test(callsUser))
        return { label: '母子', source: '反向称呼' };
      if (/女儿|闺女|姑娘|妞妞/.test(callsUser))
        return { label: '母女', source: '反向称呼' };
    }
    return { label: '未识别', source: '待人工确认' };
  }

  private distribution(
    labels: string[]
  ): AdminOrderAnalyticsDistributionItemDTO[] {
    const counts = new Map<string, number>();
    labels.forEach(label => counts.set(label, (counts.get(label) ?? 0) + 1));
    const total = labels.length;
    return [...counts.entries()]
      .map(([label, count]) => ({
        label,
        count,
        percentage: total ? Number(((count / total) * 100).toFixed(1)) : 0,
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label)
      );
  }

  private firstSegment(value?: string): string {
    return (
      String(value ?? '')
        .split(/[，,、/]/)[0]
        ?.trim() ?? ''
    );
  }

  private userName(user?: RawMonthlyOrder['user']): string {
    if (user?.name) return user.name;
    const phone = String(user?.phone ?? '');
    if (phone.length >= 11)
      return `微信用户(${phone.slice(0, 3)}****${phone.slice(-4)})`;
    return '微信用户';
  }

  private productName(code?: string): string {
    const labels: Record<string, string> = {
      vip_year: '一年会员',
      vip_infinity: '永久会员',
      vip_master: '三年会员+声音模型',
      voice_putonghua: '声音模型',
      voice_fanyan: '声音模型',
      voice_vip_year: '一年声音会员',
      voice_vip_master: '三年声音会员',
      voice_vip_infinity: '永久声音会员',
    };
    return labels[code ?? ''] ?? code ?? '未知';
  }

  private statusLabel(status?: string): string {
    const labels: Record<string, string> = {
      pending: '待支付',
      paid: '已支付',
      granting: '发放中',
      completed: '已完成',
      closed: '未付款',
      refund_requested: '退款申请中',
      refunded: '已退款',
      grant_failed: '发放失败',
    };
    return labels[status ?? ''] ?? status ?? '未知';
  }

  private refundTypeLabel(type?: string): string {
    const labels: Record<string, string> = {
      order_refund: '普通退订退款',
      voice_membership_downgrade: '会员降级退款',
      voice_membership_final_refund: '最终退订退款',
    };
    return labels[type ?? ''] ?? type ?? '未知退款';
  }

  private normalizeMonth(value: string | undefined, fallback: string): string {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '')
      ? String(value)
      : fallback;
  }

  private beijingMonth(date: Date): string {
    return new Date(date.getTime() + BEIJING_OFFSET_MS)
      .toISOString()
      .slice(0, 7);
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
