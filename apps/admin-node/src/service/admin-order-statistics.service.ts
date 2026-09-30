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
/**
 * 历史月份也会出现迟到退款/补录，不能永久固化快照；
 * 给一个更长的有限 TTL，既避免每次请求都重算，又能让补录在有限时间内反映出来。
 */
const PAST_MONTH_TTL_MS = 30 * 60 * 1000;
// 7 → 8：totals 新增 legacyRefundedAmount / legacyRefundCount，旧快照需重算
// 8 → 9：历史遗留退款并入 refundOrders/completedRefunds/refundedAmount，
//        netAmount = 当月实付 − refundedAmount（不再单独再减一次遗留退款）
export const CALCULATION_VERSION = 9;

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
  /** 历史遗留退款（订单文档内扣减、无独立 order_refund 记录） */
  legacy?: boolean;
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
    const snapshotTtlMs = isCurrentMonth
      ? CURRENT_MONTH_TTL_MS
      : PAST_MONTH_TTL_MS;
    const isFresh = Boolean(
      stored &&
        stored.calculationVersion === CALCULATION_VERSION &&
        now.getTime() - new Date(stored.updatedAt).getTime() < snapshotTtlMs
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
    const [rows, refundRows, legacyRefundRows] = await Promise.all([
      this.loadMonthlyOrders(start, end),
      this.loadMonthlyRefunds(start, end),
      this.loadMonthlyLegacyRefund(start, end),
    ]);
    const records = rows.map(row => this.toRecord(row));
    // 独立退款与遗留退款合并成同一份退款流水，按完成时间排序；
    // 遗留退款已排除存在独立退款单的订单，因此不会重复计入同一笔退款。
    const allRefundRows = [...refundRows, ...legacyRefundRows].sort(
      (left, right) =>
        this.timestampOf(left.completedAt ?? left.requestedAt) -
        this.timestampOf(right.completedAt ?? right.requestedAt)
    );
    const refundOrders = allRefundRows.map(row => this.toRefundRecord(row));
    const validOrders = records.filter(
      record => record.abnormalTypes.length === 0
    );
    const abnormalOrders = records.filter(
      record => record.abnormalTypes.length > 0
    );
    // 月度净额与仪表盘「本月收入」同口径：当月已付款总额（排除 voice_one、
    // 管理端手动单，不限订单状态）− 当月已完成退款（order_refund + 旧退款路径）。
    // 不能再按「有效订单 − 上月及更早订单本月退款」计算：订单稍后退款会被
    // 从付款月剔除，且退款完成月又扣一次，导致重复扣减/漏计。
    const netPaidAmount = rows
      .filter(
        row => row.source !== 'admin' && row.paymentProvider !== 'admin_manual'
      )
      .reduce(
        (sum, row) => sum + (Number(row.paidAmount ?? row.payableAmount) || 0),
        0
      );
    // refundedAmount 现在已包含历史遗留退款，净额只减一次，避免重复扣减。
    const netRefundAmount = allRefundRows.reduce(
      (sum, row) => sum + (Number(row.amount) || 0),
      0
    );
    const legacyRefundAmount = legacyRefundRows.reduce(
      (sum, row) => sum + (Number(row.amount) || 0),
      0
    );
    const netAmount = this.roundMoney((netPaidAmount - netRefundAmount) / 100);
    const validOrderAmount = validOrders.reduce(
      (sum, order) => sum + order.amount,
      0
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
        validAmount: this.roundMoney(validOrderAmount),
        completedRefunds: refundOrders.length,
        refundedAmount: this.roundMoney(
          refundOrders.reduce((sum, refund) => sum + refund.amount, 0)
        ),
        // 遗留退款已并入 refundedAmount / completedRefunds，这里保留小计便于勾稽：
        // 不变量：当月实付 − refundedAmount = netAmount
        legacyRefundedAmount: this.roundMoney(legacyRefundAmount / 100),
        legacyRefundCount: legacyRefundRows.length,
        netAmount,
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

  /**
   * 旧退款路径：订单文档上直接记录 `refundAmount`（无独立 order_refund 记录）
   * 且退款时间在本月的冲抵金额（分）。口径与仪表盘
   * `aggregateLegacyDailyRefundAmounts` 保持一致。
   */
  /**
   * 历史遗留退款（订单自身带 refundAmount 且没有独立退款单）的金额与笔数。
   * 两者都要返回：金额进净值公式，笔数用于和 completedRefunds 勾稽总笔数。
   */
  /**
   * 历史遗留退款：订单文档自身记录 `refundAmount`（无独立 order_refund 记录）
   * 且退款完成在本月的记录。
   *
   * 返回**明细行**而不是仅汇总，使这些退款能作为独立退款流水出现在
   * refundOrders 里并计入 completedRefunds / refundedAmount；
   * `legacy` 标记用于给出可追溯的类型标签。
   */
  private async loadMonthlyLegacyRefund(
    start: Date,
    end: Date
  ): Promise<RawMonthlyRefund[]> {
    return this.orderModel
      .aggregate<RawMonthlyRefund>([
        {
          $match: {
            targetCode: { $ne: 'voice_one' },
            source: { $ne: 'admin' },
            paymentProvider: { $ne: 'admin_manual' },
            $or: [
              { refundedAt: { $gte: start, $lt: end } },
              {
                status: 'refunded',
                refundedAt: null,
                updatedAt: { $gte: start, $lt: end },
              },
              {
                status: 'completed',
                refundAmount: { $gt: 0 },
                refundedAt: null,
                updatedAt: { $gte: start, $lt: end },
              },
            ],
          },
        },
        {
          $lookup: {
            from: TableName.order_refund,
            localField: '_id',
            foreignField: 'originalOrderId',
            as: 'independentRefundOrders',
          },
        },
        { $match: { 'independentRefundOrders.0': { $exists: false } } },
        {
          $lookup: {
            from: TableName.user,
            localField: 'userId',
            foreignField: '_id',
            as: 'userRows',
          },
        },
        { $sort: { updatedAt: 1, _id: 1 } },
        {
          $project: {
            // 遗留退款没有独立退款单号，用原订单号占位，保证行可追溯且不重复
            refundNo: '$orderNo',
            originalOrderNo: '$orderNo',
            requestedAt: { $ifNull: ['$refundRequestedAt', '$refundedAt'] },
            completedAt: {
              $cond: [
                { $ne: [{ $ifNull: ['$refundedAt', null] }, null] },
                '$refundedAt',
                '$updatedAt',
              ],
            },
            refundType: { $literal: 'legacy_refund' },
            amount: {
              $cond: [
                { $gt: [{ $ifNull: ['$refundAmount', 0] }, 0] },
                '$refundAmount',
                '$payableAmount',
              ],
            },
            paymentProvider: 1,
            source: 1,
            status: { $literal: 'completed' },
            targetCode: 1,
            user: { $arrayElemAt: ['$userRows', 0] },
            legacy: { $literal: true },
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
    const orderTime = row.paidAt
      ? new Date(row.paidAt)
      : row.createdAt
      ? new Date(row.createdAt)
      : undefined;
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
      userCreatedAt: userCreatedAt?.toISOString() ?? '',
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
      legacy_refund: '遗留退款（订单内扣减）',
    };
    return labels[type ?? ''] ?? type ?? '未知退款';
  }

  private timestampOf(value?: Date): number {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value.getTime()
      : 0;
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
