import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import type {
  AdminAuthenticatedPayload,
  AdminOrderListDTO,
  AdminOrderRecordDTO,
  AdminOrderUserDTO,
  AdminVoiceMembershipFinalRefundRecordDTO,
  AdminVoiceMembershipDowngradePreviewDTO,
  AdminVoiceMembershipDowngradeRecordDTO,
  AdminVoiceMembershipDowngradeTargetDTO,
  VoiceMembershipDowngradePlanDTO,
} from '@tzl/shared';
import { AppError } from '@tzl/shared';
import {
  AgentEntity,
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntitlementType,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MongoObjectId,
  OrderEntity,
  OrderRefundEntity,
  OrderRefundStatus,
  OrderRefundType,
  OrderSource,
  OrderStatus,
  OrderType,
  TableName,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
  VirtualGoodsProvideStatus,
  VipPlanEntity,
  VipPlanGroup,
  VipPlanStatus,
  VoicePackageEntity,
  VoicePackageStatus,
  VoiceServiceEventType,
  VoiceServiceSessionEntity,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
  VoiceTrainingTaskTrainingStrategy,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  CreateAdminOrderDTO,
  ListAdminOrdersQueryDTO,
  VoiceMembershipDowngradeDTO,
} from '../dto/admin-order.dto';
import {
  AdminWechatPayService,
  AdminWechatTransactionPayload,
  AdminWechatVirtualOrderPayload,
  WechatRefundPayload,
} from './admin-wechat-pay.service';

type MongoWhere = Record<string, unknown>;

/** 订单明细合并查询的原始行：购买订单 / 独立退款 / 遗留退款 共用。 */
interface RawUnifiedOrderRow {
  _id: MongoObjectId;
  kind: 'order' | 'refund';
  orderId?: MongoObjectId;
  orderNo?: string;
  refundNo?: string;
  originalOrderNo?: string;
  originalOrderId?: MongoObjectId;
  userId?: MongoObjectId;
  orderType?: string;
  targetCode?: string;
  source?: string;
  paymentProvider?: string;
  status?: string;
  refundType?: string;
  amount?: number;
  requestedAt?: Date;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
  sortAt?: Date;
  failureReason?: string;
  failedAt?: Date;
}

const WECHAT_PAY_PROVIDER = 'wechat_pay';
const WECHAT_VIRTUAL_PAY_PROVIDER = 'wechat_virtual_pay';
const ADMIN_MANUAL_PAYMENT_PROVIDER = 'admin_manual';
/**
 * 虚拟支付退款的观察期：退款提交后，本地退款记录先记 `processing`，
 * 必须连续在微信侧「存活」满这个时长，才由定时对账收敛为 `completed`（并计入净收入）。
 *
 * 为什么需要：虚拟支付退款是异步的，接口返回 OK、退款单也确实出现在
 * `refund_info.refund_order` 里，仍可能在约 1 小时后被微信异步撤销
 * （2026-10-05 实测：退款单出现 → 约 1 小时后消失、`left_fee` 退回、用户没收到钱）。
 * 提交时就记为「已退款」会让净收入先加后减，运营看到的成功也是假的。
 */
const VIRTUAL_REFUND_OBSERVATION_MS = 2 * 60 * 60 * 1000;
/**
 * 缺失判定的最小等待：刚提交的退款单可能还没出现在微信侧退款单列表里，
 * 未满这个时长只保持 `processing`，不做「退款失败」判定。
 */
const VIRTUAL_REFUND_MISSING_GRACE_MS = 10 * 60 * 1000;
const ACTIVE_VOICE_TRAINING_TASK_STATUSES = [
  VoiceTrainingTaskStatus.paid,
  VoiceTrainingTaskStatus.awaitingMaterial,
  VoiceTrainingTaskStatus.processing,
  VoiceTrainingTaskStatus.training,
];
const VOICE_TRAINING_TASK_REPLACED_REMARK =
  '管理端创建新声音套餐订单时覆盖关闭。';
const VOICE_MEMBERSHIP_DOWNGRADE_REASON = '声音版会员降级为基础版';
const VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY = 'voiceMembershipDowngrade';
const VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY = 'voiceMembershipFinalRefund';
const MEMBERSHIP_FINANCIAL_OPERATION_LOCK_KEY =
  'membershipFinancialOperationLock';
const MEMBERSHIP_FINANCIAL_OPERATION_LOCK_TTL_MS = 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

interface VoiceMembershipDowngradeSnapshot {
  status: 'processing' | 'benefits_failed' | 'completed' | 'failed';
  sourcePlan: VoiceMembershipDowngradePlanDTO;
  targetPlan: VoiceMembershipDowngradePlanDTO;
  targetPlanSnapshot: Record<string, unknown>;
  refundAmount: number;
  refundNo: string;
  wechatRefundId?: string;
  wechatRefundStatus?: string;
  refundRecordedAt?: string;
  requestedAt: string;
  completedAt?: string;
  updatedAt: string;
  operatorId?: string;
  operatorAccount?: string;
  failureReason?: string;
  benefitsApplyToken?: string;
  benefitsApplyStartedAt?: string;
}

interface VoiceMembershipFinalRefundSnapshot {
  status:
    | 'processing'
    | 'benefits_processing'
    | 'benefits_failed'
    | 'completed'
    | 'failed';
  refundAmount: number;
  refundNo: string;
  attempt?: number;
  attemptRequestedAt?: string;
  wechatRefundId?: string;
  wechatRefundStatus?: string;
  requestedAt: string;
  completedAt?: string;
  updatedAt: string;
  failureReason?: string;
}

@Provide()
export class AdminOrderService {
  @Logger()
  logger: ILogger;

  @Inject()
  adminWechatPayService: AdminWechatPayService;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(OrderRefundEntity)
  orderRefundModel: MongoRepository<OrderRefundEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @InjectEntityModel(VoicePackageEntity)
  voicePackageModel: MongoRepository<VoicePackageEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

  @InjectEntityModel(VoiceServiceSessionEntity)
  voiceServiceSessionModel: MongoRepository<VoiceServiceSessionEntity>;

  /**
   * 订单明细列表：购买订单与退款**合并成同一份分页结果**。
   *
   * 退款以 order_refund 为准独立成行；没有独立退款单的历史遗留退款
   * （订单自身 refundAmount/status=refunded）也会生成一条可追溯的退款行，
   * 并排除已存在独立退款单的订单，保证同一笔退款只出现一次。
   * 筛选、排序、分页与总数都覆盖退款行；购买与退款笔数分别返回。
   */
  async listOrders(query: ListAdminOrdersQueryDTO): Promise<AdminOrderListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const includeRefunds = this.normalizeBoolean(query?.includeRefunds);
    const filter = await this.buildUnifiedOrderFilter(query);
    const skip = (page - 1) * pageSize;
    const [facet] = await this.orderModel
      .aggregate<{
        items: RawUnifiedOrderRow[];
        totalCount: Array<{ count: number }>;
        orderCount: Array<{ count: number }>;
        refundCount: Array<{ count: number }>;
      }>([
        ...this.buildUnifiedOrderSourcePipeline(),
        { $match: filter as never },
        {
          $facet: {
            items: [
              {
                $sort: includeRefunds
                  ? { sortAt: -1, _id: -1 }
                  : { createdAt: -1 },
              },
              { $skip: skip },
              { $limit: pageSize },
            ],
            totalCount: [{ $count: 'count' }],
            orderCount: [{ $match: { kind: 'order' } }, { $count: 'count' }],
            refundCount: [{ $match: { kind: 'refund' } }, { $count: 'count' }],
          },
        },
      ])
      .toArray();

    const rows = facet?.items ?? [];
    const userMap = await this.getOrderUserMap(
      rows.map(row => Object.assign(new OrderEntity(), { userId: row.userId }))
    );
    const orderRows = rows.filter(row => row.kind !== 'refund');
    const messageCountMap = await this.resolveAgentUserMessageCounts(
      orderRows.map(row => Object.assign(new OrderEntity(), row))
    );

    const items = rows.map(row => {
      if (row.kind === 'refund') {
        return this.buildRefundRecord(row, userMap);
      }

      const order = Object.assign(new OrderEntity(), row);

      return this.buildOrderRecord(
        order,
        userMap,
        this.getAgentUserMessageCount(messageCountMap, order)
      );
    });

    const orderTotal = this.firstCount(facet?.orderCount);
    const refundTotal = includeRefunds
      ? this.firstCount(facet?.refundCount)
      : 0;

    return {
      items,
      // 兼容语义：不合并退款时 total = 购买订单数（与改动前一致）；
      // 合并时 total = 购买 + 退款行数，并由 orderTotal/refundTotal 拆分告知。
      total: includeRefunds ? this.firstCount(facet?.totalCount) : orderTotal,
      orderTotal,
      refundTotal,
      page,
      pageSize,
    };
  }

  private firstCount(rows?: Array<{ count?: number }>): number {
    return Number(rows?.[0]?.count) || 0;
  }

  /**
   * 三源合并：购买订单 + 独立退款（order_refund）+ 历史遗留退款。
   *
   * 每行都带 `kind` 与 `sortAt`，后续筛选/排序/分页在同一份流上完成。
   */
  private buildUnifiedOrderSourcePipeline(): Record<string, unknown>[] {
    return [
      {
        $addFields: {
          kind: 'order',
          // 聚合结果是原始文档，只有 _id；TypeORM 实体主键是 id，
          // 不透传会让 order.id 变成空串，影响详情与操作。
          id: '$_id',
          orderId: '$_id',
          sortAt: { $ifNull: ['$createdAt', '$updatedAt'] },
        },
      },
      {
        $unionWith: {
          coll: TableName.order_refund,
          pipeline: [
            {
              $project: {
                kind: { $literal: 'refund' },
                orderId: '$originalOrderId',
                orderNo: '$originalOrderNo',
                refundNo: 1,
                originalOrderNo: 1,
                originalOrderId: 1,
                userId: 1,
                orderType: 1,
                targetCode: 1,
                source: 1,
                paymentProvider: 1,
                status: 1,
                refundType: 1,
                amount: 1,
                requestedAt: 1,
                completedAt: 1,
                createdAt: 1,
                updatedAt: 1,
                failureReason: 1,
                failedAt: 1,
                sortAt: { $ifNull: ['$completedAt', '$requestedAt'] },
              },
            },
          ],
        },
      },
      {
        $unionWith: {
          coll: TableName.order,
          pipeline: [
            {
              $match: {
                $or: [{ refundAmount: { $gt: 0 } }, { status: 'refunded' }],
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
              $project: {
                kind: { $literal: 'refund' },
                orderId: '$_id',
                orderNo: '$orderNo',
                // 遗留退款没有独立退款单号：用原订单号占位，行仍可追溯
                refundNo: '$orderNo',
                originalOrderNo: '$orderNo',
                originalOrderId: '$_id',
                userId: 1,
                orderType: 1,
                targetCode: 1,
                source: 1,
                paymentProvider: 1,
                status: { $literal: 'completed' },
                refundType: { $literal: 'legacy_refund' },
                amount: {
                  $cond: [
                    { $gt: [{ $ifNull: ['$refundAmount', 0] }, 0] },
                    '$refundAmount',
                    '$payableAmount',
                  ],
                },
                requestedAt: { $ifNull: ['$refundRequestedAt', '$refundedAt'] },
                completedAt: {
                  $cond: [
                    { $ne: [{ $ifNull: ['$refundedAt', null] }, null] },
                    '$refundedAt',
                    '$updatedAt',
                  ],
                },
                createdAt: 1,
                updatedAt: 1,
                sortAt: {
                  $cond: [
                    { $ne: [{ $ifNull: ['$refundedAt', null] }, null] },
                    '$refundedAt',
                    '$updatedAt',
                  ],
                },
              },
            },
          ],
        },
      },
    ];
  }

  /**
   * 合并行的筛选条件。
   *
   * 日期区间按类型区分：**购买按支付时间 `paidAt`，退款按完成时间 `completedAt`**，
   * 因此不会把「本月支付、下月退款」的订单错算进任一侧。
   */
  private async buildUnifiedOrderFilter(
    query: ListAdminOrdersQueryDTO
  ): Promise<Record<string, unknown>> {
    const and: Record<string, unknown>[] = [];
    const includeRefunds = this.normalizeBoolean(query?.includeRefunds);
    const kind = query?.kind?.trim();

    // 不合并退款时（默认，兼容既有客户端）：只返回购买订单，
    // total 仍是"购买订单数"，items 与分页行为与改动前一致。
    if (!includeRefunds) {
      and.push({ kind: 'order' });
    } else if (kind === 'order' || kind === 'refund') {
      and.push({ kind });
    }

    const status = this.normalizeOptionalStatus(query?.status);
    const refundStatus = this.normalizeOptionalRefundStatus(query?.status);
    if (status || refundStatus) {
      // 订单状态与退款状态取值不重叠，同一入参各自匹配对应的行类型
      and.push({
        $or: [
          ...(status ? [{ kind: 'order', status }] : []),
          ...(refundStatus ? [{ kind: 'refund', status: refundStatus }] : []),
        ],
      });
    }

    const orderType = this.normalizeOptionalOrderType(query?.orderType);
    if (orderType) {
      and.push({ orderType });
    }

    const source = this.normalizeOptionalSource(query?.source);
    if (source) {
      and.push({ source });
    }

    const paymentType = this.normalizeOptionalPaymentType(query?.paymentType);
    const excludeAdminManual = this.normalizeBoolean(query?.excludeAdminManual);

    if (paymentType === 'virtual') {
      and.push({ paymentProvider: WECHAT_VIRTUAL_PAY_PROVIDER });
    } else if (paymentType === 'normal') {
      and.push({
        paymentProvider: excludeAdminManual
          ? {
              $nin: [
                WECHAT_VIRTUAL_PAY_PROVIDER,
                ADMIN_MANUAL_PAYMENT_PROVIDER,
              ],
            }
          : { $ne: WECHAT_VIRTUAL_PAY_PROVIDER },
      });
    } else if (excludeAdminManual) {
      and.push({ paymentProvider: { $ne: ADMIN_MANUAL_PAYMENT_PROVIDER } });
    }

    const userId = this.normalizeOptionalObjectId(query?.userId);
    const registeredMonth = query?.registeredMonth?.trim();

    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(registeredMonth ?? '')) {
      const registeredUserIds = await this.findUserIdsByRegisteredMonth(
        registeredMonth as string
      );
      and.push({
        userId: userId
          ? {
              $in: registeredUserIds.filter(
                item =>
                  this.stringifyObjectId(item) ===
                  this.stringifyObjectId(userId)
              ),
            }
          : { $in: registeredUserIds },
      });
    } else if (userId) {
      and.push({ userId });
    }

    const createdAtStart = this.normalizeOptionalDate(query?.createdAtStart);
    const createdAtEnd = this.normalizeOptionalDate(query?.createdAtEnd);

    if (createdAtStart || createdAtEnd) {
      const range: Record<string, Date> = {};

      if (createdAtStart) {
        range.$gte = createdAtStart;
      }

      if (createdAtEnd) {
        range.$lte = createdAtEnd;
      }

      if (includeRefunds) {
        // 合并流水模式：购买按支付时间、退款按完成时间分别归入
        and.push({
          $or: [
            { kind: 'order', paidAt: range },
            { kind: 'refund', completedAt: range },
          ],
        });
      } else {
        // 旧模式（默认，兼容既有客户端）：仍按订单 createdAt 筛选，
        // 待支付订单不会被排除，退款处理页行为与改动前一致。
        and.push({ createdAt: range });
      }
    }

    const keyword = query?.keyword?.trim() ?? '';
    if (!keyword) {
      return and.length ? { $and: and } : {};
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const keywordFilters: Record<string, unknown>[] = [
      { orderNo: { $regex: escapedKeyword, $options: 'i' } },
      { refundNo: { $regex: escapedKeyword, $options: 'i' } },
      { originalOrderNo: { $regex: escapedKeyword, $options: 'i' } },
      { title: { $regex: escapedKeyword, $options: 'i' } },
      { targetCode: { $regex: escapedKeyword, $options: 'i' } },
      { paymentTradeNo: { $regex: escapedKeyword, $options: 'i' } },
    ];
    const matchedUserIds = await this.findUserIdsByKeyword(escapedKeyword);

    if (matchedUserIds.length > 0) {
      keywordFilters.push({ userId: { $in: matchedUserIds } });
    }

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);
      keywordFilters.push({ _id: objectId });
      keywordFilters.push({ userId: objectId });
      keywordFilters.push({ originalOrderId: objectId });
    }

    and.push({ $or: keywordFilters });

    return { $and: and };
  }

  /**
   * 退款行的列表记录。
   *
   * `kind='refund'` 让前端能明确区分并禁止对退款行执行购买订单的退款/发货等操作；
   * 金额按退款金额展示（列表以正数展示，收入侧才取负）。
   */
  private buildRefundRecord(
    row: RawUnifiedOrderRow,
    userMap: Map<string, AdminOrderUserDTO>
  ): AdminOrderRecordDTO {
    const userId = this.stringifyObjectId(row.userId);
    const refundType = row.refundType || 'order_refund';
    // 列表金额与订单行一致，统一用「分」
    const amount = Number(row.amount) || 0;

    return {
      id: `refund:${this.stringifyObjectId(row._id)}`,
      kind: 'refund',
      orderNo: row.refundNo || row.orderNo || '-',
      refundNo: row.refundNo || row.orderNo || '',
      originalOrderNo: row.originalOrderNo || row.orderNo || '',
      originalOrderId: this.stringifyObjectId(row.originalOrderId),
      userId,
      user: userMap.get(userId),
      orderType: row.orderType || OrderType.vipPlan,
      targetCode: row.targetCode || '',
      title: `退款 · ${row.targetCode || ''}`.trim(),
      amount,
      discountAmount: 0,
      couponAmount: 0,
      payableAmount: amount,
      paidAmount: undefined,
      refundAmount: amount,
      currency: 'CNY',
      status: (row.status || OrderRefundStatus.completed) as OrderStatus,
      refundStatus: row.status || OrderRefundStatus.completed,
      refundType,
      refundTypeLabel: this.refundTypeLabel(refundType),
      source: (row.source || OrderSource.weapp) as OrderSource,
      paymentProvider: row.paymentProvider || '',
      refundRequestedAt: this.formatOptionalDate(row.requestedAt),
      refundedAt: this.formatOptionalDate(row.completedAt),
      refundFailureReason: row.failureReason || '',
      refundFailedAt: this.formatOptionalDate(row.failedAt),
      createdAt: this.formatOptionalDate(row.requestedAt || row.createdAt),
      updatedAt: this.formatOptionalDate(row.completedAt || row.updatedAt),
    } as unknown as AdminOrderRecordDTO;
  }

  /** 退款行可能缺申请/完成时间（如处理中的退款、无 refundedAt 的遗留退款）。 */
  private formatOptionalDate(value?: Date): string {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value.toISOString()
      : '';
  }

  private refundTypeLabel(refundType: string): string {
    const labels: Record<string, string> = {
      order_refund: '普通退订退款',
      voice_membership_downgrade: '会员降级退款',
      voice_membership_final_refund: '最终退订退款',
      legacy_refund: '遗留退款（订单内扣减）',
    };

    return labels[refundType] ?? refundType;
  }

  async createOrder(
    payload: CreateAdminOrderDTO
  ): Promise<AdminOrderRecordDTO> {
    const orderType = this.normalizeOrderType(payload?.orderType);
    const user = await this.getUserById(payload.userId);
    const userObjectId = this.getEntityObjectId(user);

    if (!userObjectId) {
      throw new AppError('USER_ID_MISSING', 'user id is missing', 500);
    }

    if (orderType === OrderType.vipPlan) {
      return this.createAdminVipPlanOrder(userObjectId, payload);
    }

    if (orderType === OrderType.voicePackage) {
      return this.createAdminVoicePackageOrder(userObjectId, payload);
    }

    throw new AppError(
      'ADMIN_ORDER_TYPE_UNSUPPORTED',
      'admin order type is unsupported',
      400
    );
  }

  private async createAdminVipPlanOrder(
    userId: MongoObjectId,
    payload: CreateAdminOrderDTO
  ): Promise<AdminOrderRecordDTO> {
    const plan = await this.getActiveVipPlanById(payload.vipPlanId ?? '');
    const now = new Date();
    const order = new OrderEntity();

    Object.assign(order, {
      orderNo: this.generateOrderNo('ADMINVIP'),
      userId,
      orderType: OrderType.vipPlan,
      targetId: plan.id,
      targetCode: plan.code,
      title: plan.name,
      amount: plan.priceAmount,
      discountAmount: Math.max(
        (plan.originalPriceAmount ?? plan.priceAmount) - plan.priceAmount,
        0
      ),
      couponAmount: 0,
      payableAmount: plan.priceAmount,
      paidAmount: plan.priceAmount,
      currency: plan.currency || 'CNY',
      status: OrderStatus.granting,
      source: OrderSource.admin,
      paymentProvider: ADMIN_MANUAL_PAYMENT_PROVIDER,
      paymentNotifyAt: now,
      paidAt: now,
      snapshot: {
        vipPlan: this.buildVipPlanSnapshot(plan),
      },
      createdAt: now,
      updatedAt: now,
    });

    const savedOrder = await this.orderModel.save(order);

    try {
      await this.grantOrderBenefits(savedOrder);
      savedOrder.status = OrderStatus.completed;
      savedOrder.updatedAt = new Date();
      await this.orderModel.save(savedOrder);
    } catch (error) {
      savedOrder.status = OrderStatus.grantFailed;
      savedOrder.updatedAt = new Date();
      await this.orderModel.save(savedOrder);
      throw error;
    }

    const userMap = await this.getOrderUserMap([savedOrder]);

    return this.buildOrderRecord(savedOrder, userMap);
  }

  private async createAdminVoicePackageOrder(
    userId: MongoObjectId,
    payload: CreateAdminOrderDTO
  ): Promise<AdminOrderRecordDTO> {
    const [voicePackage, agent] = await Promise.all([
      this.getActiveVoicePackageById(payload.voicePackageId ?? ''),
      this.getUserAgentById(userId, payload.agentId ?? ''),
    ]);
    const activeTasks = await this.findActiveVoiceTrainingTasks(agent.id);

    if (activeTasks.length && !payload.replaceActiveVoiceTrainingTask) {
      throw new AppError(
        'VOICE_TRAINING_TASK_EXISTS',
        'voice training task already exists',
        400
      );
    }

    const now = new Date();
    const order = new OrderEntity();

    Object.assign(order, {
      orderNo: this.generateOrderNo('ADMINVOICE'),
      userId,
      orderType: OrderType.voicePackage,
      targetId: voicePackage.id,
      targetCode: voicePackage.code,
      agentId: agent.id,
      title: voicePackage.name,
      amount: voicePackage.priceAmount,
      discountAmount: Math.max(
        (voicePackage.originalPriceAmount ?? voicePackage.priceAmount) -
          voicePackage.priceAmount,
        0
      ),
      couponAmount: 0,
      payableAmount: voicePackage.priceAmount,
      paidAmount: voicePackage.priceAmount,
      currency: voicePackage.currency || 'CNY',
      status: OrderStatus.granting,
      source: OrderSource.admin,
      paymentProvider: ADMIN_MANUAL_PAYMENT_PROVIDER,
      paymentNotifyAt: now,
      paidAt: now,
      snapshot: {
        voicePackage: this.buildVoicePackageSnapshot(voicePackage),
        agent: this.buildAgentSnapshot(agent),
      },
      createdAt: now,
      updatedAt: now,
    });

    const savedOrder = await this.orderModel.save(order);

    try {
      await this.grantOrderBenefits(savedOrder);
      await this.replaceActiveVoiceTrainingTasks(activeTasks);
      savedOrder.status = OrderStatus.completed;
      savedOrder.updatedAt = new Date();
      await this.orderModel.save(savedOrder);
    } catch (error) {
      savedOrder.status = OrderStatus.grantFailed;
      savedOrder.updatedAt = new Date();
      await this.orderModel.save(savedOrder);
      throw error;
    }

    const userMap = await this.getOrderUserMap([savedOrder]);

    return this.buildOrderRecord(savedOrder, userMap);
  }

  async refundOrder(orderId: string): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);

    await this.refundPaidOrder(order, '管理端退订退款');
    const userMap = await this.getOrderUserMap([order]);

    return this.buildOrderRecordWithUsage(order, userMap);
  }

  async rejectRefundOrder(
    orderId: string,
    action: 'not_refund' | 'rejected',
    operator: AdminAuthenticatedPayload
  ): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);

    await this.rejectRefundRequest(order, action, operator);
    const userMap = await this.getOrderUserMap([order]);

    return this.buildOrderRecordWithUsage(order, userMap);
  }

  async getVoiceMembershipDowngradePreview(
    orderId: string
  ): Promise<AdminVoiceMembershipDowngradePreviewDTO> {
    const order = await this.getOrderById(orderId);
    const paidAmount = order.paidAmount ?? order.payableAmount ?? 0;
    const existingDowngrade = this.getVoiceMembershipDowngrade(order);
    const sourcePlan = await this.resolveVoiceMembershipSourcePlan(order);
    const membership = await this.userMembershipModel.findOne({
      where: {
        sourceOrderId: order.id,
      },
    });
    const targetPlans = sourcePlan
      ? await this.findVoiceMembershipDowngradeTargets(order, sourcePlan)
      : [];
    const unavailableReason = this.getVoiceMembershipDowngradeUnavailableReason(
      order,
      sourcePlan,
      membership,
      targetPlans,
      existingDowngrade
    );

    return {
      eligible: !unavailableReason,
      unavailableReason,
      orderId: this.stringifyObjectId(order.id),
      paidAmount,
      sourcePlan,
      membershipStartedAt: this.formatDate(membership?.startedAt),
      membershipExpiredAt: this.formatDate(membership?.expiredAt),
      membershipLifetime: membership?.lifetime,
      targetPlans,
      existingDowngrade: existingDowngrade
        ? this.buildVoiceMembershipDowngradeRecord(existingDowngrade)
        : undefined,
    };
  }

  async downgradeVoiceMembership(
    orderId: string,
    payload: VoiceMembershipDowngradeDTO,
    operator: AdminAuthenticatedPayload
  ): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);
    const lockToken = await this.acquireMembershipFinancialOperationLock(
      order.userId,
      'voice_membership_final_refund'
    );
    let downgrade: VoiceMembershipDowngradeSnapshot;

    try {
      await this.refreshOrderEntity(order);
      const preview = await this.getVoiceMembershipDowngradePreview(orderId);

      if (!preview.eligible) {
        throw new AppError(
          'VOICE_MEMBERSHIP_DOWNGRADE_UNAVAILABLE',
          preview.unavailableReason || 'voice membership cannot be downgraded',
          400
        );
      }

      const targetPlan = preview.targetPlans.find(
        item => item.id === payload?.targetVipPlanId?.trim()
      );

      if (!targetPlan) {
        throw new AppError(
          'VOICE_MEMBERSHIP_DOWNGRADE_TARGET_INVALID',
          '请选择周期一致的基础版会员',
          400
        );
      }

      await this.assertDowngradedMembershipStillOwnedByOrder(order);
      const targetEntity = await this.getActiveVipPlanById(targetPlan.id);
      const now = new Date();
      downgrade = {
        status: 'processing',
        sourcePlan: preview.sourcePlan as VoiceMembershipDowngradePlanDTO,
        targetPlan: this.buildVoiceMembershipDowngradePlan(targetEntity),
        targetPlanSnapshot: this.buildVipPlanSnapshot(targetEntity),
        refundAmount: targetPlan.refundAmount,
        refundNo: this.generateVoiceMembershipDowngradeRefundNo(order),
        requestedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        operatorId: operator?.sub,
        operatorAccount: operator?.account,
      };

      const createResult = await this.orderModel.updateOne(
        {
          _id: order.id,
          status: OrderStatus.completed,
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}`]: {
            $exists: false,
          },
        } as never,
        {
          $set: {
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}`]: downgrade,
            updatedAt: now,
          },
        } as never
      );

      if (!this.didMongoUpdate(createResult)) {
        throw new AppError(
          'VOICE_MEMBERSHIP_DOWNGRADE_STATE_CONFLICT',
          '订单状态已变化，请刷新后重试会员降级',
          409
        );
      }

      this.setVoiceMembershipDowngrade(order, downgrade);
      order.updatedAt = now;
      await this.refreshOrderEntity(order);
    } finally {
      await this.releaseMembershipFinancialOperationLock(
        order.userId,
        lockToken
      );
    }

    let refund: WechatRefundPayload;

    try {
      refund = await this.submitVoiceMembershipDowngradeRefund(
        order,
        downgrade
      );
    } catch (error) {
      downgrade.status = 'failed';
      downgrade.failureReason = this.getOperationFailureReason(error);
      downgrade.updatedAt = new Date().toISOString();
      await this.persistVoiceMembershipDowngradeState(
        order,
        downgrade,
        new Date(),
        'processing'
      );

      const refreshedOrder = await this.refreshOrderEntity(order);
      const userMap = await this.getOrderUserMap([refreshedOrder]);

      return this.buildOrderRecordWithUsage(refreshedOrder, userMap);
    }

    await this.applyVoiceMembershipDowngradeRefundStatus(
      order,
      downgrade,
      refund
    );
    const refreshedOrder = await this.refreshOrderEntity(order);
    const userMap = await this.getOrderUserMap([refreshedOrder]);

    return this.buildOrderRecordWithUsage(refreshedOrder, userMap);
  }

  async syncVoiceMembershipDowngrade(
    orderId: string,
    operator: AdminAuthenticatedPayload
  ): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);
    const downgrade = this.getVoiceMembershipDowngrade(order);

    if (!downgrade) {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_NOT_FOUND',
        '该订单没有声音版降级记录',
        404
      );
    }

    if (downgrade.status === 'completed') {
      // 降级已完成，但退款未必真的成功（虚拟支付存在"返回 OK 却没创建退款单"）。
      // 只要本地退款记录是 failed，就允许在原订单上重新发起这笔降级退款。
      await this.retryFailedDowngradeRefund(order, downgrade, operator);
    } else {
      const refund =
        order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER
          ? await this.refundVirtualMembershipPayment(
              order,
              downgrade.refundNo,
              downgrade.refundAmount,
              downgrade.refundAmount,
              VOICE_MEMBERSHIP_DOWNGRADE_REASON
            )
          : await this.adminWechatPayService.queryRefundByRefundNo(
              downgrade.refundNo
            );

      downgrade.operatorId = operator?.sub || downgrade.operatorId;
      downgrade.operatorAccount =
        operator?.account || downgrade.operatorAccount;

      if (refund) {
        await this.applyVoiceMembershipDowngradeRefundStatus(
          order,
          downgrade,
          refund
        );
      } else {
        const retriedRefund = await this.adminWechatPayService.refundOrder({
          orderNo: order.orderNo,
          refundNo: downgrade.refundNo,
          reason: VOICE_MEMBERSHIP_DOWNGRADE_REASON,
          amount: downgrade.refundAmount,
          totalAmount: order.paidAmount ?? order.payableAmount,
        });

        await this.applyVoiceMembershipDowngradeRefundStatus(
          order,
          downgrade,
          retriedRefund
        );
      }
    }

    const refreshedOrder = await this.refreshOrderEntity(order);
    const userMap = await this.getOrderUserMap([refreshedOrder]);

    return this.buildOrderRecordWithUsage(refreshedOrder, userMap);
  }

  /**
   * 自动收敛卡在 processing 的会员降级退款（供定时任务调用）。
   *
   * 只做「向微信查询退款状态并回写」，**绝不发起或重试退款**：
   * - 仅非虚拟支付通道：虚拟支付的同步路径会重新发起退款，不能自动执行；
   * - 仅 status=processing 且已有 wechatRefundId（确认退款已提交过）；
   * - 仅 requestedAt 早于 graceMinutes 的记录，避免与刚提交的退款抢跑；
   * - 微信查询无结果时保持原状留待下一轮，不做任何兜底动作。
   *
   * 背景：降级退款只在同步成功后才会写入 `order_refund`；长期停在 processing
   * 会让这笔退款在所有收入统计（净收入、净收入下钻、月度报表）里消失。
   */
  async reconcilePendingVoiceMembershipDowngrades(
    graceMinutes = 30,
    limit = 50
  ): Promise<{
    scanned: number;
    completed: number;
    pending: number;
    failed: number;
    errors: string[];
  }> {
    const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);
    const field = (key: string) =>
      `snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.${key}`;

    const orders = await this.orderModel.find({
      where: {
        paymentProvider: { $ne: WECHAT_VIRTUAL_PAY_PROVIDER },
        [field('status')]: 'processing',
        [field('wechatRefundId')]: { $exists: true, $nin: [null, ''] },
        $or: [
          { [field('requestedAt')]: { $lte: cutoff.toISOString() } },
          { [field('requestedAt')]: { $lte: cutoff } },
        ],
      } as never,
      order: { createdAt: 'ASC' } as never,
    });

    const summary = {
      scanned: orders.length,
      completed: 0,
      pending: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const order of orders.slice(0, limit)) {
      const downgrade = this.getVoiceMembershipDowngrade(order);
      if (!downgrade) continue;
      try {
        const refund = await this.adminWechatPayService.queryRefundByRefundNo(
          downgrade.refundNo
        );
        if (!refund) {
          summary.pending += 1;
          continue;
        }
        await this.applyVoiceMembershipDowngradeRefundStatus(
          order,
          downgrade,
          refund
        );
        const status = refund.status?.trim().toUpperCase() || 'PROCESSING';
        if (status === 'SUCCESS') summary.completed += 1;
        else if (status === 'CLOSED' || status === 'ABNORMAL') summary.failed += 1;
        else summary.pending += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push(`${order.orderNo}: ${(err as Error).message}`);
      }
    }

    return summary;
  }

  /**
   * 降级已完成、但退款被判定失败时，在原订单上重新发起这笔降级退款。
   *
   * 关键点：
   * - **必须换新的退款单号**：微信对同一 refund_order_id 会幂等返回上次那个
   *   「返回 OK 但从未真正创建」的幽灵退款（2026-10-05 实测）。
   * - 提交后一律回查确认，未确认不记为成功。
   * - 只有本地退款记录为 failed 时才重试；已成功则不动作（由调用方给出提示）。
   */
  private async retryFailedDowngradeRefund(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    operator: AdminAuthenticatedPayload
  ): Promise<boolean> {
    const record = await this.orderRefundModel.findOne({
      where: {
        originalOrderId: order.id,
        refundType: OrderRefundType.voiceMembershipDowngrade,
      } as never,
    } as never);

    if (!record) return false;
    if (record.status !== OrderRefundStatus.failed) return false;

    const oldRefundNo = downgrade.refundNo;
    const newRefundNo = `${oldRefundNo}R${Date.now().toString(36)}`;
    const reason = VOICE_MEMBERSHIP_DOWNGRADE_REASON;
    const now = new Date();

    try {
      let paymentRefundId: string | undefined;
      let completedAt = now;

      if (order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER) {
        const refund = await this.refundVirtualMembershipPayment(
          order,
          newRefundNo,
          downgrade.refundAmount,
          downgrade.refundAmount,
          reason
        );
        paymentRefundId = refund.refund_id;
        const confirmed = await this.confirmVirtualRefund(
          order,
          paymentRefundId
        );
        if (!confirmed) {
          throw new AppError(
            'WECHAT_VIRTUAL_REFUND_NOT_CONFIRMED',
            '微信未确认重新发起的降级退款，请稍后重试或到微信商户平台核对。',
            502
          );
        }
        completedAt = this.parseWechatDate(refund.success_time) ?? now;
      } else {
        const refund = await this.adminWechatPayService.refundOrder({
          orderNo: order.orderNo,
          refundNo: newRefundNo,
          reason,
          amount: downgrade.refundAmount,
          totalAmount: order.paidAmount ?? order.payableAmount,
        });
        paymentRefundId = refund?.refund_id;
        const status = refund?.status?.trim().toUpperCase();
        if (status && status !== 'SUCCESS') {
          throw new AppError(
            'WECHAT_REFUND_NOT_COMPLETED',
            `微信退款状态为 ${status}，尚未成功，请稍后重试。`,
            502
          );
        }
        completedAt = this.parseWechatDate(refund?.success_time) ?? now;
      }

      // 快照换用新退款单号：后续对账/同步以它为准
      downgrade.refundNo = newRefundNo;
      downgrade.status = 'completed';
      downgrade.wechatRefundId = paymentRefundId ?? downgrade.wechatRefundId;
      downgrade.wechatRefundStatus = 'SUCCESS';
      downgrade.failureReason = undefined;
      downgrade.operatorId = operator?.sub || downgrade.operatorId;
      downgrade.operatorAccount =
        operator?.account || downgrade.operatorAccount;
      downgrade.updatedAt = now.toISOString();
      await this.orderModel.updateOne(
        {
          _id: order.id,
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
            oldRefundNo,
        } as never,
        {
          $set: {
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}`]: downgrade,
            updatedAt: now,
          },
        } as never
      );

      // 本地退款记录转为成功，清掉失败痕迹（虚拟支付仍受观察期约束，先记处理中）
      const retryStatus = this.resolveRefundRecordStatus(
        order,
        now,
        OrderRefundStatus.completed
      );
      await this.orderRefundModel.updateOne(
        { _id: record.id } as never,
        {
          $set: {
            refundNo: newRefundNo,
            status: retryStatus,
            paymentRefundId,
            ...(retryStatus === OrderRefundStatus.completed
              ? { completedAt }
              : {}),
            updatedAt: now,
          },
          $unset: { failureReason: '', failedAt: '' },
        } as never
      );

      this.logger?.warn?.(
        '[order] downgrade refund retried and confirmed: orderNo=%s oldRefundNo=%s newRefundNo=%s',
        order.orderNo,
        oldRefundNo,
        newRefundNo
      );
      return true;
    } catch (err) {
      this.alertRefundFailure(
        '[refund-alert] downgrade refund retry FAILED: orderNo=%s oldRefundNo=%s newRefundNo=%s err=%s',
        order.orderNo,
        oldRefundNo,
        newRefundNo,
        (err as Error).message
      );
      throw err;
    }
  }

  /**
   * 在原订单上重新发起「失败的降级退款」（后台按钮入口）。
   *
   * 只有本地退款记录为 failed 时才真正重发；否则明确拒绝，避免误操作导致重复退款。
   */
  async retryVoiceMembershipDowngradeRefund(
    orderId: string,
    operator: AdminAuthenticatedPayload
  ): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);
    const downgrade = this.getVoiceMembershipDowngrade(order);

    if (!downgrade) {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_NOT_FOUND',
        '该订单没有声音版降级记录',
        404
      );
    }

    const retried = await this.retryFailedDowngradeRefund(
      order,
      downgrade,
      operator
    );
    if (!retried) {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_REFUND_NOT_RETRYABLE',
        '该订单的降级退款当前不是失败状态（可能已成功或在处理中），无需重试。',
        409
      );
    }

    const refreshedOrder = await this.refreshOrderEntity(order);
    const userMap = await this.getOrderUserMap([refreshedOrder]);
    return this.buildOrderRecordWithUsage(refreshedOrder, userMap);
  }

  /**
   * 撤回失败的会员降级任务：清空降级记录，使订单恢复可退款/可重新降级。
   * 仅允许撤回 status=failed 的降级（退款已成功的 benefits_failed 不允许），
   * 原记录转入 snapshot.voiceMembershipDowngradeWithdrawn 保留审计。
   */
  async withdrawVoiceMembershipDowngrade(
    orderId: string,
    operator: AdminAuthenticatedPayload
  ): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);
    const downgrade = this.getVoiceMembershipDowngrade(order);

    if (!downgrade) {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_NOT_FOUND',
        '该订单没有声音版降级记录',
        404
      );
    }

    if (downgrade.status !== 'failed') {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_NOT_WITHDRAWABLE',
        '只有失败的降级任务才能撤回',
        409
      );
    }

    const now = new Date();
    const withdrawn = {
      ...downgrade,
      withdrawnAt: now.toISOString(),
      withdrawnBy: operator?.sub,
      withdrawnByAccount: operator?.account,
    };

    const result = await this.orderModel.updateOne(
      {
        _id: order.id,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
          downgrade.refundNo,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
          'failed',
      } as never,
      {
        $set: {
          'snapshot.voiceMembershipDowngradeWithdrawn': withdrawn,
          updatedAt: now,
        },
        $unset: {
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}`]: '',
        },
      } as never
    );

    if (!this.didMongoUpdate(result)) {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_STATE_CONFLICT',
        '降级状态已变化，请刷新后重试',
        409
      );
    }

    const refreshedOrder = await this.refreshOrderEntity(order);
    const userMap = await this.getOrderUserMap([refreshedOrder]);

    return this.buildOrderRecordWithUsage(refreshedOrder, userMap);
  }

  private async applyVoiceMembershipDowngradeRefundStatus(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    refund: WechatRefundPayload
  ): Promise<void> {
    const expectedStatus = downgrade.status;
    const status = refund.status?.trim().toUpperCase() || 'PROCESSING';
    const now = new Date();

    downgrade.wechatRefundId = refund.refund_id || downgrade.wechatRefundId;
    downgrade.wechatRefundStatus = status;
    downgrade.failureReason = undefined;
    downgrade.updatedAt = now.toISOString();

    if (status === 'SUCCESS') {
      // 按微信返回的实际退款成功时间归集，避免补记时把退款记到同步当天，
      // 导致该笔退款在月度/每日净收入里跨期错位。
      await this.completeVoiceMembershipDowngrade(
        order,
        downgrade,
        this.parseWechatDate(refund.success_time)
      );
      return;
    }

    if (status === 'CLOSED' || status === 'ABNORMAL') {
      downgrade.status = 'failed';
      downgrade.failureReason =
        status === 'CLOSED'
          ? '微信退款已关闭，请核对后重新处理'
          : '微信退款状态异常，请先在微信支付商户平台处理';
    } else {
      downgrade.status = 'processing';
    }

    await this.persistVoiceMembershipDowngradeState(
      order,
      downgrade,
      now,
      expectedStatus
    );
    await this.refreshOrderEntity(order);
  }

  private async persistVoiceMembershipDowngradeState(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    now = new Date(),
    expectedStatus: VoiceMembershipDowngradeSnapshot['status'] = downgrade.status
  ): Promise<boolean> {
    const result = await this.orderModel.updateOne(
      {
        _id: order.id,
        status: {
          $in: [OrderStatus.completed, OrderStatus.refundRequested],
        },
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
          downgrade.refundNo,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
          expectedStatus,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
          {
            $exists: false,
          },
      } as never,
      {
        $set: {
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}`]: downgrade,
          updatedAt: now,
        },
      } as never
    );

    return this.didMongoUpdate(result);
  }

  /** 解析微信 RFC3339 时间；非法或缺失时返回 undefined。 */
  private parseWechatDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private async completeVoiceMembershipDowngrade(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    completedAt?: Date
  ): Promise<void> {
    const now = new Date();
    /** 退款在收入统计里的归属时间：优先用微信实际成功时间。 */
    const recordedAt = completedAt ?? now;
    const benefitsApplyToken = randomBytes(16).toString('hex');
    const claimResult = await this.orderModel.updateOne(
      {
        _id: order.id,
        status: {
          $in: [OrderStatus.completed, OrderStatus.refundRequested],
        },
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
          downgrade.refundNo,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]: {
          $in: ['processing', 'benefits_failed', 'failed'],
        },
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
          {
            $exists: false,
          },
      } as never,
      {
        $set: {
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
            benefitsApplyToken,
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyStartedAt`]:
            now.toISOString(),
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.wechatRefundId`]:
            downgrade.wechatRefundId,
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.wechatRefundStatus`]:
            'SUCCESS',
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.updatedAt`]:
            now.toISOString(),
          updatedAt: now,
        },
        $unset: {
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.failureReason`]:
            '',
        },
      } as never
    );

    if (!this.didMongoUpdate(claimResult)) {
      await this.refreshOrderEntity(order);
      return;
    }

    try {
      const claimedOrder = await this.refreshOrderEntity(order);
      const claimedDowngrade =
        this.getVoiceMembershipDowngrade(claimedOrder) ?? downgrade;

      await this.recordCompletedRefundOrder(
        claimedOrder,
        claimedDowngrade.refundNo,
        OrderRefundType.voiceMembershipDowngrade,
        claimedDowngrade.refundAmount,
        claimedDowngrade.wechatRefundId,
        new Date(claimedDowngrade.requestedAt),
        recordedAt
      );

      if (!claimedDowngrade.refundRecordedAt) {
        // 记录部分退款时间，用于收入统计按退款时间归集
        const refundRecordResult = await this.orderModel.updateOne(
          {
            _id: claimedOrder.id,
            status: {
              $in: [OrderStatus.completed, OrderStatus.refundRequested],
            },
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
              claimedDowngrade.refundNo,
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
              benefitsApplyToken,
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundRecordedAt`]:
              {
                $exists: false,
              },
          } as never,
          {
            $inc: {
              refundAmount: claimedDowngrade.refundAmount,
            },
            $set: {
              refundedAt: claimedOrder.refundedAt ?? recordedAt,
              [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundRecordedAt`]:
                recordedAt.toISOString(),
              [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.updatedAt`]:
                now.toISOString(),
              updatedAt: now,
            },
          } as never
        );

        if (!this.didMongoUpdate(refundRecordResult)) {
          throw new AppError(
            'VOICE_MEMBERSHIP_DOWNGRADE_STATE_CONFLICT',
            '降级退款已成功，但退款金额记录冲突，请刷新后重试权益处理',
            409
          );
        }

        await this.refreshOrderEntity(claimedOrder);
      }

      const latestDowngrade =
        this.getVoiceMembershipDowngrade(claimedOrder) ?? claimedDowngrade;
      await this.applyVoiceMembershipDowngradeBenefits(
        claimedOrder,
        latestDowngrade,
        now
      );

      const completeResult = await this.orderModel.updateOne(
        {
          _id: claimedOrder.id,
          status: {
            $in: [OrderStatus.completed, OrderStatus.refundRequested],
          },
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
            claimedDowngrade.refundNo,
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
            benefitsApplyToken,
        } as never,
        {
          $set: {
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
              'completed',
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.completedAt`]:
              now.toISOString(),
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.updatedAt`]:
              now.toISOString(),
            updatedAt: now,
          },
          $unset: {
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
              '',
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyStartedAt`]:
              '',
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.failureReason`]:
              '',
          },
        } as never
      );

      if (!this.didMongoUpdate(completeResult)) {
        throw new AppError(
          'VOICE_MEMBERSHIP_DOWNGRADE_STATE_CONFLICT',
          '降级权益已处理，但完成状态写入失败，请刷新后重试',
          409
        );
      }

      await this.refreshOrderEntity(order);

      // 通知主服务触发小使者降级提示（异步，失败不影响降级主流程）
      this.notifyMessengerEvent(order, claimedDowngrade).catch(() => undefined);
      return;
    } catch (error) {
      const failedAt = new Date();
      const releaseResult = await this.orderModel.updateOne(
        {
          _id: order.id,
          status: {
            $in: [OrderStatus.completed, OrderStatus.refundRequested],
          },
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.refundNo`]:
            downgrade.refundNo,
          [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
            benefitsApplyToken,
        } as never,
        {
          $set: {
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
              'benefits_failed',
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.failureReason`]:
              this.getOperationFailureReason(error),
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.updatedAt`]:
              failedAt.toISOString(),
            updatedAt: failedAt,
          },
          $unset: {
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
              '',
            [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyStartedAt`]:
              '',
          },
        } as never
      );

      await this.refreshOrderEntity(order);

      if (!this.didMongoUpdate(releaseResult)) {
        const currentDowngrade = this.getVoiceMembershipDowngrade(order);

        if (currentDowngrade?.status !== 'completed') {
          throw error;
        }
      }
    }
  }

  private async notifyMessengerEvent(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot
  ): Promise<void> {
    const baseUrl =
      process.env.TZL_NODE_API_URL?.trim() || 'http://tzl_node:7001';
    const secret = process.env.INTERNAL_API_SECRET?.trim();
    if (!secret) {
      this.logger?.warn?.(
        '[admin-order] messenger event skipped, INTERNAL_API_SECRET not configured'
      );
      return;
    }
    try {
      const response = await fetch(`${baseUrl}/api/system/messenger-event`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify({
          eventType: 'membership_downgrade',
          userId: String(order.userId || ''),
          orderId: String(order.id || ''),
          refundAmount:
            typeof downgrade.refundAmount === 'number'
              ? downgrade.refundAmount
              : 0,
        }),
      });
      const text = await response.text();
      this.logger?.info?.(
        '[admin-order] messenger event notified, orderId=%s status=%d body=%s',
        String(order.id || ''),
        response.status,
        text.slice(0, 200)
      );
    } catch (error) {
      this.logger?.warn?.(
        '[admin-order] messenger event notify failed, orderId=%s reason=%s',
        String(order.id || ''),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async applyVoiceMembershipDowngradeBenefits(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    now: Date
  ): Promise<void> {
    const sourceMembership = await this.userMembershipModel.findOne({
      where: {
        sourceOrderId: order.id,
      },
    });
    const targetPlanId = this.parseObjectId(
      downgrade.targetPlan.id,
      'INVALID_VIP_PLAN_ID'
    );
    let membershipOwnershipRetained = false;
    let membershipForOldBenefits = sourceMembership;

    if (sourceMembership) {
      const membershipResult = await this.userMembershipModel.updateOne(
        {
          _id: sourceMembership.id,
          sourceOrderId: order.id,
          status: UserMembershipStatus.active,
        } as never,
        {
          $set: {
            vipPlanId: targetPlanId,
            vipPlanCode: downgrade.targetPlan.code,
            updatedAt: now,
          },
        } as never
      );

      membershipOwnershipRetained = this.didMongoUpdate(membershipResult);

      if (membershipOwnershipRetained) {
        sourceMembership.vipPlanId = targetPlanId;
        sourceMembership.vipPlanCode = downgrade.targetPlan.code;
        sourceMembership.status = UserMembershipStatus.active;
        sourceMembership.updatedAt = now;
      }
    }

    if (!membershipOwnershipRetained) {
      const activeMembership = await this.findActiveMembership(order.userId);

      if (
        !activeMembership ||
        this.stringifyObjectId(activeMembership.sourceOrderId) ===
          this.stringifyObjectId(order.id)
      ) {
        throw new AppError(
          'VOICE_MEMBERSHIP_DOWNGRADE_MEMBERSHIP_NOT_FOUND',
          '未找到可安全降级的会员记录',
          409
        );
      }

      membershipForOldBenefits = sourceMembership ?? activeMembership;
    }

    const benefitMembership = {
      ...membershipForOldBenefits,
      vipPlanId: targetPlanId,
      vipPlanCode: downgrade.targetPlan.code,
    } as UserMembershipEntity;

    await this.reconcileDowngradedMembershipEntitlements(
      order,
      benefitMembership,
      downgrade.targetPlanSnapshot,
      now,
      membershipOwnershipRetained
    );
    await this.revokeDowngradedMembershipVoiceBindings(
      order,
      membershipOwnershipRetained ? sourceMembership?.id : undefined,
      now
    );
  }

  private async reconcileDowngradedMembershipEntitlements(
    order: OrderEntity,
    membership: UserMembershipEntity,
    targetPlanSnapshot: Record<string, unknown>,
    now: Date,
    allowCreateMissingGrants = true
  ): Promise<void> {
    const targetGrants = this.parseEntitlementGrants(
      targetPlanSnapshot.entitlementGrants
    );
    const targetGrantMap = new Map(
      targetGrants.map(grant => [grant.type, grant])
    );
    const entitlements = await this.agentEntitlementModel.find({
      where: {
        sourceOrderId: order.id,
      },
    });

    for (const entitlement of entitlements) {
      const grant = targetGrantMap.get(entitlement.type);

      if (!grant) {
        if (entitlement.status !== AgentEntitlementStatus.refunded) {
          entitlement.status = AgentEntitlementStatus.refunded;
          entitlement.updatedAt = now;
          await this.agentEntitlementModel.save(entitlement);
        }
        continue;
      }

      entitlement.sourceVipPlanId = membership.vipPlanId;
      entitlement.totalQuota = Math.max(
        entitlement.usedQuota ?? 0,
        grant.totalQuota
      );
      entitlement.expiredAt = grant.durationDays
        ? this.calculateEntitlementExpiredAt(
            order.paidAt ?? membership.startedAt,
            grant.durationDays,
            membership
          )
        : allowCreateMissingGrants
        ? membership.lifetime
          ? undefined
          : membership.expiredAt
        : entitlement.expiredAt;
      entitlement.status =
        entitlement.expiredAt && entitlement.expiredAt <= now
          ? AgentEntitlementStatus.expired
          : (entitlement.usedQuota ?? 0) >= entitlement.totalQuota
          ? AgentEntitlementStatus.used
          : AgentEntitlementStatus.available;
      entitlement.updatedAt = now;
      await this.agentEntitlementModel.save(entitlement);
      targetGrantMap.delete(entitlement.type);
    }

    if (!allowCreateMissingGrants) {
      return;
    }

    for (const grant of targetGrantMap.values()) {
      const entitlement = new AgentEntitlementEntity();
      entitlement.userId = order.userId;
      entitlement.type = grant.type;
      entitlement.totalQuota = grant.totalQuota;
      entitlement.usedQuota = 0;
      entitlement.status = AgentEntitlementStatus.available;
      entitlement.sourceOrderId = order.id;
      entitlement.sourceVipPlanId = membership.vipPlanId;
      entitlement.activatedAt = order.paidAt ?? membership.startedAt;
      entitlement.expiredAt = this.calculateEntitlementExpiredAt(
        entitlement.activatedAt,
        grant.durationDays,
        membership
      );
      entitlement.createdAt = now;
      entitlement.updatedAt = now;
      await this.agentEntitlementModel.save(entitlement);
    }
  }

  private async revokeDowngradedMembershipVoiceBindings(
    order: OrderEntity,
    membershipIdValue: MongoObjectId | undefined,
    now: Date
  ): Promise<void> {
    const orderId = this.stringifyObjectId(order.id);
    const entitlements = await this.agentEntitlementModel.find({
      where: {
        sourceOrderId: order.id,
      },
    });
    const accessReferenceIds = new Set([
      orderId,
      ...(membershipIdValue ? [this.stringifyObjectId(membershipIdValue)] : []),
      ...entitlements.map(item => this.stringifyObjectId(item.id)),
    ]);
    const sessions = (
      await this.voiceServiceSessionModel.find({
        where: {
          userId: order.userId,
        },
      })
    ).filter(session =>
      accessReferenceIds.has(session.voiceAccessReferenceId ?? '')
    );

    for (const session of sessions) {
      const agentIds = new Map<string, MongoObjectId>();

      for (const agentId of [
        ...(session.voiceBoundAgentIds ?? []),
        ...(session.selectedAgentId ? [session.selectedAgentId] : []),
      ]) {
        agentIds.set(this.stringifyObjectId(agentId), agentId);
      }

      for (const agentId of agentIds.values()) {
        const agent = await this.findAgentByObjectId(agentId);

        if (
          agent?.voiceTimbreId &&
          session.voiceTimbreId &&
          this.stringifyObjectId(agent.voiceTimbreId) ===
            this.stringifyObjectId(session.voiceTimbreId)
        ) {
          agent.voiceTimbreId = null as never;
          agent.updatedAt = now;
          await this.agentModel.save(agent);
        }
      }

      session.voiceBindingStatus = 'purchase_required';
      session.voiceAccessSource = undefined;
      session.voiceAccessReferenceId = undefined;
      session.voiceAccessVerifiedAt = now;
      session.voiceAccessRevokedAt = now;
      session.voiceAccessRevokedReason = VOICE_MEMBERSHIP_DOWNGRADE_REASON;
      session.voiceAccessRevokedReferenceId = orderId;
      session.events = [
        ...(session.events ?? []),
        {
          id: `event_${randomBytes(8).toString('hex')}`,
          type: VoiceServiceEventType.voiceAccessRevoked,
          summary: '声音版会员已降级，声音接入已停止',
          metadata: {
            orderId,
          },
          createdAt: now,
        },
      ].slice(-200);
      session.updatedAt = now;
      await this.voiceServiceSessionModel.save(session);
    }
  }

  async revokeAdminManualOrder(orderId: string): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);

    await this.revokeAdminManualPaidOrder(order);
    const userMap = await this.getOrderUserMap([order]);

    return this.buildOrderRecordWithUsage(order, userMap);
  }

  async syncPaymentStatus(orderId: string): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);

    if (
      this.isPaymentSyncSkippedStatus(order.status) &&
      !this.shouldSyncCompletedVirtualGoods(order)
    ) {
      const userMap = await this.getOrderUserMap([order]);

      return this.buildOrderRecordWithUsage(order, userMap);
    }

    if (order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER) {
      await this.syncVirtualPaymentOrder(order);
    } else if (
      !order.paymentProvider ||
      order.paymentProvider === WECHAT_PAY_PROVIDER
    ) {
      await this.syncWechatPaymentOrder(order);
    } else {
      throw new AppError(
        'ORDER_PAYMENT_PROVIDER_UNSUPPORTED',
        'order payment provider cannot be synced',
        400
      );
    }

    const syncedOrder = await this.getOrderById(orderId);
    const userMap = await this.getOrderUserMap([syncedOrder]);

    return this.buildOrderRecordWithUsage(syncedOrder, userMap);
  }

  private async syncWechatPaymentOrder(order: OrderEntity): Promise<void> {
    const transaction =
      await this.adminWechatPayService.queryTransactionByOrderNo(order.orderNo);

    if (!transaction) {
      if (this.isPaymentExpired(order)) {
        await this.closeOrder(order);
      }

      return;
    }

    if (transaction.trade_state === 'SUCCESS') {
      await this.handleWechatPaymentSuccess(transaction);
      return;
    }

    if (
      this.isWechatTradeClosed(transaction.trade_state) ||
      this.isPaymentExpired(order)
    ) {
      await this.closeOrder(order);
    }
  }

  private async handleWechatPaymentSuccess(
    transaction: AdminWechatTransactionPayload
  ): Promise<void> {
    const orderNo = transaction.out_trade_no?.trim();

    if (!orderNo) {
      throw new AppError('WECHAT_ORDER_NO_MISSING', 'wechat order no missing');
    }

    const order = await this.orderModel.findOne({
      where: {
        orderNo,
      },
    });

    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'order not found', 404);
    }

    if (
      order.status === OrderStatus.completed ||
      order.status === OrderStatus.granting ||
      order.status === OrderStatus.refundRequested ||
      order.status === OrderStatus.refunded
    ) {
      return;
    }

    if (transaction.trade_state !== 'SUCCESS') {
      throw new AppError(
        'WECHAT_TRADE_NOT_SUCCESS',
        'wechat trade is not success'
      );
    }

    const paidAmount =
      transaction.amount?.total ?? transaction.amount?.payer_total;

    if (!paidAmount || paidAmount !== order.payableAmount) {
      const data = {
        orderId: this.stringifyObjectId(order.id),
        orderNo: order.orderNo,
        orderType: order.orderType,
        paymentProvider: order.paymentProvider,
        expectedAmount: order.payableAmount,
        actualAmount: paidAmount ?? null,
        wechatTotal: transaction.amount?.total ?? null,
        wechatPayerTotal: transaction.amount?.payer_total ?? null,
        transactionId: transaction.transaction_id,
      };

      this.logger?.warn?.(
        '[wechat-pay] amount mismatch: orderNo=%s expected=%s actual=%s total=%s payerTotal=%s transactionId=%s',
        data.orderNo,
        data.expectedAmount,
        data.actualAmount,
        data.wechatTotal,
        data.wechatPayerTotal,
        data.transactionId ?? ''
      );

      throw new AppError(
        'WECHAT_AMOUNT_MISMATCH',
        'wechat amount mismatch',
        400,
        data
      );
    }

    const now = new Date();
    order.status = OrderStatus.granting;
    order.paidAmount = paidAmount;
    order.paymentTradeNo = transaction.transaction_id;
    order.paymentNotifyAt = now;
    order.paidAt = transaction.success_time
      ? new Date(transaction.success_time)
      : now;
    order.updatedAt = now;
    await this.orderModel.save(order);

    try {
      await this.grantOrderBenefits(order);
      order.status = OrderStatus.completed;
      order.updatedAt = new Date();
      await this.orderModel.save(order);
    } catch (error) {
      order.status = OrderStatus.grantFailed;
      order.updatedAt = new Date();
      await this.orderModel.save(order);
      throw error;
    }
  }

  private async syncVirtualPaymentOrder(order: OrderEntity): Promise<void> {
    const virtualOrder = await this.queryVirtualPaymentOrder(order);

    if (!virtualOrder) {
      if (this.isPaymentExpired(order)) {
        await this.closeOrder(order);
      }

      return;
    }

    if (this.isVirtualPaymentPaid(virtualOrder.status)) {
      await this.handleVirtualPaymentSuccess(order, virtualOrder);
      await this.syncVirtualGoodsProvided(order, virtualOrder);
      return;
    }

    // 微信侧虚拟支付订单不会自动关闭：未支付且已过我方支付有效期时，必须按本地超时关单。
    if (
      this.isVirtualPaymentClosed(virtualOrder.status) ||
      this.isPaymentExpired(order)
    ) {
      await this.closeOrder(order);
    }
  }

  private async queryVirtualPaymentOrder(
    order: OrderEntity
  ): Promise<AdminWechatVirtualOrderPayload | null> {
    if (!order.payerOpenid || order.virtualPaymentEnv === undefined) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_ORDER_INCOMPLETE',
        'wechat virtual pay order is incomplete',
        500
      );
    }

    return this.adminWechatPayService.queryVirtualOrder({
      openid: order.payerOpenid,
      orderNo: order.orderNo,
      env: order.virtualPaymentEnv,
    });
  }

  private async handleVirtualPaymentSuccess(
    order: OrderEntity,
    virtualOrder: AdminWechatVirtualOrderPayload
  ): Promise<void> {
    if (
      order.status === OrderStatus.completed ||
      order.status === OrderStatus.granting ||
      order.status === OrderStatus.refundRequested ||
      order.status === OrderStatus.refunded
    ) {
      return;
    }

    const paidAmount = virtualOrder.paid_fee ?? virtualOrder.order_fee;

    if (!paidAmount || paidAmount !== order.payableAmount) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_AMOUNT_MISMATCH',
        'wechat virtual pay amount mismatch'
      );
    }

    const now = new Date();
    order.status = OrderStatus.granting;
    order.paidAmount = paidAmount;
    order.paymentTradeNo =
      virtualOrder.wxpay_order_id ||
      virtualOrder.wx_order_id ||
      virtualOrder.channel_order_id;
    order.paymentNotifyAt = now;
    order.paidAt = virtualOrder.paid_time
      ? new Date(virtualOrder.paid_time * 1000)
      : now;
    order.updatedAt = now;
    await this.orderModel.save(order);

    try {
      await this.grantOrderBenefits(order);
      order.status = OrderStatus.completed;
      order.updatedAt = new Date();
      await this.orderModel.save(order);
    } catch (error) {
      order.status = OrderStatus.grantFailed;
      order.updatedAt = new Date();
      await this.orderModel.save(order);
      throw error;
    }
  }

  private async syncVirtualGoodsProvided(
    order: OrderEntity,
    virtualOrder: AdminWechatVirtualOrderPayload
  ): Promise<void> {
    if (this.isVirtualPaymentDelivered(virtualOrder.status)) {
      await this.markVirtualGoodsProvided(order, virtualOrder.provide_time);
      return;
    }

    if (
      !this.shouldNotifyVirtualGoodsProvided(order, virtualOrder) ||
      this.isVirtualGoodsProvided(order)
    ) {
      return;
    }

    await this.markVirtualGoodsProvidePending(order);

    try {
      await this.adminWechatPayService.notifyVirtualGoodsProvided({
        orderNo: order.orderNo,
        wxOrderId: this.getVirtualPaymentWechatOrderId(virtualOrder),
        env:
          order.virtualPaymentEnv ??
          this.adminWechatPayService.getVirtualPayEnv(),
      });
    } catch (error) {
      await this.markVirtualGoodsProvideFailed(order, error);
      this.logger?.warn?.(
        '[wechat-virtual-pay] notify_provide_goods failed: orderNo=%s, status=%s, error=%s',
        order.orderNo,
        virtualOrder.status ?? 'none',
        this.getVirtualGoodsProvideError(error)
      );
      return;
    }

    await this.markVirtualGoodsProvided(order);
  }

  private shouldNotifyVirtualGoodsProvided(
    order: OrderEntity,
    virtualOrder: AdminWechatVirtualOrderPayload
  ): boolean {
    return (
      order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER &&
      order.status === OrderStatus.completed &&
      this.isVirtualPaymentProvidePending(virtualOrder.status)
    );
  }

  private async markVirtualGoodsProvided(
    order: OrderEntity,
    provideTime?: number
  ): Promise<void> {
    if (
      order.virtualGoodsProvideStatus === VirtualGoodsProvideStatus.provided &&
      order.virtualGoodsProvidedAt
    ) {
      return;
    }

    order.virtualGoodsProvideStatus = VirtualGoodsProvideStatus.provided;
    order.virtualGoodsProvidedAt = provideTime
      ? new Date(provideTime * 1000)
      : new Date();
    order.virtualGoodsProvideFailedAt = undefined;
    order.virtualGoodsProvideError = undefined;
    order.updatedAt = new Date();
    await this.orderModel.save(order);
  }

  private async markVirtualGoodsProvidePending(
    order: OrderEntity
  ): Promise<void> {
    order.virtualGoodsProvideStatus = VirtualGoodsProvideStatus.pending;
    order.virtualGoodsProvideFailedAt = undefined;
    order.virtualGoodsProvideError = undefined;
    order.updatedAt = new Date();
    await this.orderModel.save(order);
  }

  private async markVirtualGoodsProvideFailed(
    order: OrderEntity,
    error: unknown
  ): Promise<void> {
    order.virtualGoodsProvideStatus = VirtualGoodsProvideStatus.failed;
    order.virtualGoodsProvideFailedAt = new Date();
    order.virtualGoodsProvideError = this.getVirtualGoodsProvideError(error);
    order.updatedAt = new Date();
    await this.orderModel.save(order);
  }

  private getVirtualGoodsProvideError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 300);
  }

  private getVirtualPaymentWechatOrderId(
    virtualOrder: AdminWechatVirtualOrderPayload
  ): string | undefined {
    return (
      virtualOrder.wxpay_order_id ||
      virtualOrder.wx_order_id ||
      virtualOrder.channel_order_id
    );
  }

  private async grantOrderBenefits(order: OrderEntity): Promise<void> {
    if (order.orderType === OrderType.vipPlan) {
      await this.grantVipMembership(order);
      return;
    }

    if (order.orderType === OrderType.voicePackage) {
      await this.createVoiceTrainingTask(order);
      return;
    }

    throw new AppError('ORDER_TYPE_UNSUPPORTED', 'order type is unsupported');
  }

  private async refundPaidOrder(
    order: OrderEntity,
    reason: string
  ): Promise<void> {
    const voiceMembershipDowngrade = this.getVoiceMembershipDowngrade(order);
    const voiceMembershipFinalRefund =
      this.getVoiceMembershipFinalRefund(order);
    const finalRefundSucceeded =
      voiceMembershipFinalRefund?.wechatRefundStatus?.trim().toUpperCase() ===
      'SUCCESS';

    if (
      voiceMembershipDowngrade?.status === 'completed' &&
      (order.status === OrderStatus.refunded || finalRefundSucceeded)
    ) {
      await this.repairDowngradedMembershipFinalRefundBenefits(order);
      return;
    }

    if (order.status === OrderStatus.refunded) {
      const completedAt = order.refundedAt ?? order.updatedAt;
      const amount =
        order.refundAmount && order.refundAmount > 0
          ? order.refundAmount
          : order.paidAmount ?? order.payableAmount;

      if (amount > 0) {
        await this.recordCompletedRefundOrder(
          order,
          this.generateRefundNo(order),
          OrderRefundType.orderRefund,
          amount,
          undefined,
          completedAt,
          completedAt
        );
      }
      return;
    }

    if (!this.isRefundableOrderType(order.orderType)) {
      throw new AppError(
        'ORDER_REFUND_TYPE_UNSUPPORTED',
        'order type cannot be refunded',
        400
      );
    }

    if (!this.isRefundableOrderStatus(order.status)) {
      throw new AppError(
        'ORDER_NOT_REFUNDABLE',
        'order is not refundable',
        400
      );
    }

    if (
      voiceMembershipDowngrade &&
      voiceMembershipDowngrade.status !== 'completed'
    ) {
      throw new AppError(
        'ORDER_VOICE_MEMBERSHIP_DOWNGRADE_INCOMPLETE',
        '会员降级尚未完成，请先刷新降级状态',
        400
      );
    }

    if (
      voiceMembershipDowngrade?.status === 'completed' &&
      this.isVipUpgradeOrder(order)
    ) {
      throw new AppError(
        'ORDER_UPGRADE_REFUND_REQUIRES_HISTORY',
        '升级会员的费用来自多笔历史订单，请核对原基础会员订单后处理，系统不会自动少退或错退',
        409
      );
    }

    const paidAmount = order.paidAmount ?? order.payableAmount ?? 0;
    const recordedRefundAmount = Math.max(
      order.refundAmount ?? 0,
      voiceMembershipDowngrade?.status === 'completed'
        ? voiceMembershipDowngrade.refundAmount
        : 0
    );
    const refundAmount = Math.max(paidAmount - recordedRefundAmount, 0);

    if (refundAmount <= 0) {
      throw new AppError(
        'ORDER_REFUND_AMOUNT_INVALID',
        voiceMembershipDowngrade
          ? '这笔降级订单已无剩余可退金额，请核对历史基础会员订单'
          : 'order refund amount is invalid',
        400
      );
    }

    await this.assertRefundableOrderBenefits(order);

    const startsNewFinalRefundAttempt =
      !voiceMembershipFinalRefund ||
      (voiceMembershipFinalRefund.status === 'failed' &&
        voiceMembershipFinalRefund.wechatRefundStatus?.trim().toUpperCase() ===
          'CLOSED');

    if (
      voiceMembershipDowngrade?.status === 'completed' &&
      startsNewFinalRefundAttempt
    ) {
      if (order.paymentProvider === ADMIN_MANUAL_PAYMENT_PROVIDER) {
        throw new AppError(
          'ORDER_REFUND_PROVIDER_UNSUPPORTED',
          'admin manual order cannot be refunded',
          400
        );
      }

      const lockToken = await this.acquireMembershipFinancialOperationLock(
        order.userId,
        'voice_membership_final_refund'
      );
      let lockReleased = false;
      const releaseLock = async () => {
        if (lockReleased) {
          return;
        }

        lockReleased = true;
        await this.releaseMembershipFinancialOperationLock(
          order.userId,
          lockToken
        );
      };

      try {
        await this.assertDowngradedMembershipStillOwnedByOrder(order);
        await this.syncDowngradedMembershipFinalRefund(
          order,
          refundAmount,
          paidAmount,
          reason,
          releaseLock
        );
      } finally {
        await releaseLock();
      }
      return;
    }

    let virtualRefundId: string | undefined;
    /** 本次退款使用的单号：此前失败过则换新号，避免被微信幂等吞掉。 */
    const refundNo = await this.buildRetryAwareRefundNo(order);

    if (order.paymentProvider === ADMIN_MANUAL_PAYMENT_PROVIDER) {
      throw new AppError(
        'ORDER_REFUND_PROVIDER_UNSUPPORTED',
        'admin manual order cannot be refunded',
        400
      );
    } else if (voiceMembershipDowngrade?.status === 'completed') {
      await this.syncDowngradedMembershipFinalRefund(
        order,
        refundAmount,
        paidAmount,
        reason
      );
      return;
    } else if (order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER) {
      // 记下微信退款单号：没有它事后无法判断这笔钱是否真的退了。
      virtualRefundId = await this.refundVirtualPaymentOrder(
        order,
        refundAmount,
        reason,
        refundNo
      );
      // 虚拟支付退款是异步的：接口返回 OK 只代表「受理」，必须回查确认微信真的创建了退款单。
      // 真实事故：4 笔共 338 元本地记为已退款，但微信侧 left_fee 未变、退款单列表为空。
      const confirmed = await this.confirmVirtualRefund(
        order,
        virtualRefundId
      );
      if (!confirmed) {
        const unconfirmedAt = new Date();
        await this.recordCompletedRefundOrder(
          order,
          refundNo,
          OrderRefundType.orderRefund,
          refundAmount,
          virtualRefundId,
          unconfirmedAt,
          unconfirmedAt,
          OrderRefundStatus.processing
        );
        this.alertRefundFailure(
          '[refund-alert] virtual refund NOT confirmed by wechat: orderNo=%s refundNo=%s refundWxOrderId=%s amount=%s',
          order.orderNo,
          this.generateRefundNo(order),
          virtualRefundId || '-',
          refundAmount
        );
        throw new AppError(
          'WECHAT_VIRTUAL_REFUND_NOT_CONFIRMED',
          '微信未确认该笔退款已创建，订单未标记为已退款（已记为处理中并告警）。请稍后重试，或先在微信商户平台核对退款状态。',
          502
        );
      }
    } else {
      await this.adminWechatPayService.refundOrder({
        orderNo: order.orderNo,
        refundNo,
        reason,
        amount: refundAmount,
        totalAmount: paidAmount,
      });
    }

    const now = new Date();
    await this.recordCompletedRefundOrder(
      order,
      refundNo,
      OrderRefundType.orderRefund,
      refundAmount,
      virtualRefundId,
      now,
      now
    );
    await this.revokeOrderBenefits(order, now);

    order.status = OrderStatus.refunded;
    order.refundAmount = Math.min(
      recordedRefundAmount + refundAmount,
      paidAmount
    );
    order.refundedAt = now;
    order.updatedAt = now;
    await this.orderModel.save(order);
  }

  private async syncDowngradedMembershipFinalRefund(
    order: OrderEntity,
    refundAmount: number,
    paidAmount: number,
    reason: string,
    onClaimed?: () => Promise<void>
  ): Promise<void> {
    const now = new Date();
    const existingSnapshot = this.getVoiceMembershipFinalRefund(order);
    const storedAttempt = Number(existingSnapshot?.attempt ?? 1);
    const previousAttempt =
      Number.isSafeInteger(storedAttempt) && storedAttempt >= 1
        ? storedAttempt
        : 1;
    const retryClosedRefund = Boolean(
      existingSnapshot?.status === 'failed' &&
        existingSnapshot.wechatRefundStatus?.trim().toUpperCase() === 'CLOSED'
    );
    const attempt = retryClosedRefund ? previousAttempt + 1 : previousAttempt;
    const refundNo = retryClosedRefund
      ? this.generateVoiceMembershipFinalRefundNo(order, attempt)
      : existingSnapshot?.refundNo ??
        this.generateVoiceMembershipFinalRefundNo(order, attempt);
    const claimedUpdatedAt = now.toISOString();
    const finalRefund: VoiceMembershipFinalRefundSnapshot = {
      status: 'processing',
      refundAmount,
      refundNo,
      attempt,
      attemptRequestedAt:
        retryClosedRefund || !existingSnapshot
          ? claimedUpdatedAt
          : existingSnapshot.attemptRequestedAt ?? existingSnapshot.requestedAt,
      wechatRefundId: retryClosedRefund
        ? undefined
        : existingSnapshot?.wechatRefundId,
      wechatRefundStatus: retryClosedRefund
        ? undefined
        : existingSnapshot?.wechatRefundStatus,
      requestedAt: existingSnapshot?.requestedAt ?? claimedUpdatedAt,
      updatedAt: claimedUpdatedAt,
    };
    const claimFilter: MongoWhere = {
      _id: order.id,
      status: {
        $in: [OrderStatus.completed, OrderStatus.refundRequested],
      },
      [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
        'completed',
      [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
        {
          $exists: false,
        },
    };

    if (existingSnapshot) {
      claimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.refundNo`
      ] = existingSnapshot.refundNo;
      claimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.status`
      ] = existingSnapshot.status;
      claimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.updatedAt`
      ] = existingSnapshot.updatedAt;
      claimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.attempt`
      ] =
        existingSnapshot.attempt === undefined
          ? { $exists: false }
          : existingSnapshot.attempt;
    } else {
      claimFilter[`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`] = {
        $exists: false,
      };
    }

    const claimResult = await this.orderModel.updateOne(
      claimFilter as never,
      {
        $set: {
          status: OrderStatus.refundRequested,
          refundRequestedAt: order.refundRequestedAt ?? now,
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`]:
            finalRefund,
          updatedAt: now,
        },
      } as never
    );

    if (!this.didMongoUpdate(claimResult)) {
      const refreshed = await this.refreshOrderEntity(order);
      const refreshedFinalRefund =
        this.getVoiceMembershipFinalRefund(refreshed);

      if (
        refreshed.status === OrderStatus.refunded ||
        refreshedFinalRefund?.wechatRefundStatus?.trim().toUpperCase() ===
          'SUCCESS'
      ) {
        await this.repairDowngradedMembershipFinalRefundBenefits(refreshed);
        return;
      }

      throw new AppError(
        'ORDER_REFUND_STATE_CONFLICT',
        '会员降级权益仍在处理中，请先刷新降级状态',
        409
      );
    }

    order.status = OrderStatus.refundRequested;
    order.refundRequestedAt = order.refundRequestedAt ?? now;
    order.updatedAt = now;
    this.setVoiceMembershipFinalRefund(order, finalRefund);
    await onClaimed?.();

    const refund =
      order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER
        ? await this.refundVirtualMembershipPayment(
            order,
            refundNo,
            refundAmount,
            paidAmount,
            reason
          )
        : (await this.adminWechatPayService.queryRefundByRefundNo(refundNo)) ??
          (await this.adminWechatPayService.refundOrder({
            orderNo: order.orderNo,
            refundNo,
            reason,
            amount: refundAmount,
            totalAmount: paidAmount,
          }));
    const status = refund.status?.trim().toUpperCase() || 'PROCESSING';
    const statusUpdatedAt = new Date();
    const resolvedFinalRefund: VoiceMembershipFinalRefundSnapshot = {
      ...finalRefund,
      wechatRefundId: refund.refund_id ?? finalRefund.wechatRefundId,
      wechatRefundStatus: status,
      updatedAt: statusUpdatedAt.toISOString(),
    };

    if (status === 'SUCCESS') {
      resolvedFinalRefund.status = 'benefits_processing';
      resolvedFinalRefund.failureReason = undefined;

      // 记为成功却拿不到微信退款单号 = 很可能从未真正提交退款。
      // 历史事故：幂等预检误判，本地记为成功但微信侧 left_fee 未归零，
      // 用户没收到钱。这里必须留下可检索的告警，不能静默记完成。
      if (!resolvedFinalRefund.wechatRefundId) {
        this.logger?.warn?.(
          '[order] virtual refund recorded SUCCESS without wechat refund id, orderNo=%s refundNo=%s refundAmount=%s',
          order.orderNo,
          refundNo,
          refundAmount
        );
      }

      const recorded = await this.recordVoiceMembershipFinalRefundSuccess(
        order,
        resolvedFinalRefund,
        paidAmount,
        claimedUpdatedAt,
        statusUpdatedAt
      );

      if (!recorded) {
        throw new AppError(
          'ORDER_REFUND_STATE_CONFLICT',
          '微信退款已成功，但退款记录被其他操作更新，请刷新后重试权益回收',
          409
        );
      }

      await this.repairDowngradedMembershipFinalRefundBenefits(order);
      return;
    }

    if (status === 'CLOSED' || status === 'ABNORMAL') {
      resolvedFinalRefund.status = 'failed';
      resolvedFinalRefund.failureReason =
        status === 'CLOSED'
          ? '微信退款已关闭，请核对后处理'
          : '微信退款状态异常，请先在微信支付商户平台处理';
      await this.persistVoiceMembershipFinalRefundState(
        order,
        resolvedFinalRefund,
        'processing',
        claimedUpdatedAt,
        statusUpdatedAt
      );
      throw new AppError(
        'ORDER_REFUND_NOT_SUCCESSFUL',
        status === 'CLOSED'
          ? '微信退款已关闭，会员权益未收回，请核对后处理'
          : '微信退款状态异常，会员权益未收回，请先在微信支付商户平台处理',
        409
      );
    }

    resolvedFinalRefund.status = 'processing';
    resolvedFinalRefund.failureReason = undefined;
    await this.persistVoiceMembershipFinalRefundState(
      order,
      resolvedFinalRefund,
      'processing',
      claimedUpdatedAt,
      statusUpdatedAt
    );
  }

  private async persistVoiceMembershipFinalRefundState(
    order: OrderEntity,
    finalRefund: VoiceMembershipFinalRefundSnapshot,
    expectedStatus: VoiceMembershipFinalRefundSnapshot['status'],
    expectedUpdatedAt: string,
    now = new Date()
  ): Promise<boolean> {
    const result = await this.orderModel.updateOne(
      {
        _id: order.id,
        status: OrderStatus.refundRequested,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
          'completed',
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
          {
            $exists: false,
          },
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.refundNo`]:
          finalRefund.refundNo,
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.status`]:
          expectedStatus,
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.updatedAt`]:
          expectedUpdatedAt,
      } as never,
      {
        $set: {
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`]:
            finalRefund,
          updatedAt: now,
        },
      } as never
    );

    if (this.didMongoUpdate(result)) {
      order.status = OrderStatus.refundRequested;
      order.refundRequestedAt = order.refundRequestedAt ?? now;
      order.updatedAt = now;
      this.setVoiceMembershipFinalRefund(order, finalRefund);
      return true;
    }

    await this.refreshOrderEntity(order);
    return false;
  }

  private async recordVoiceMembershipFinalRefundSuccess(
    order: OrderEntity,
    finalRefund: VoiceMembershipFinalRefundSnapshot,
    paidAmount: number,
    expectedUpdatedAt: string,
    now: Date
  ): Promise<boolean> {
    await this.recordCompletedRefundOrder(
      order,
      finalRefund.refundNo,
      OrderRefundType.voiceMembershipFinalRefund,
      finalRefund.refundAmount,
      finalRefund.wechatRefundId,
      new Date(finalRefund.attemptRequestedAt ?? finalRefund.requestedAt),
      now
    );

    const result = await this.orderModel.updateOne(
      {
        _id: order.id,
        status: OrderStatus.refundRequested,
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
          'completed',
        [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.benefitsApplyToken`]:
          {
            $exists: false,
          },
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.refundNo`]:
          finalRefund.refundNo,
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.status`]:
          'processing',
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.updatedAt`]:
          expectedUpdatedAt,
      } as never,
      {
        $set: {
          status: OrderStatus.refunded,
          refundAmount: paidAmount,
          refundedAt: now,
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`]:
            finalRefund,
          updatedAt: now,
        },
      } as never
    );

    if (this.didMongoUpdate(result)) {
      order.status = OrderStatus.refunded;
      order.refundAmount = paidAmount;
      order.refundedAt = now;
      order.updatedAt = now;
      this.setVoiceMembershipFinalRefund(order, finalRefund);
      return true;
    }

    const refreshed = await this.refreshOrderEntity(order);
    const refreshedFinalRefund = this.getVoiceMembershipFinalRefund(refreshed);

    return Boolean(
      refreshedFinalRefund?.refundNo === finalRefund.refundNo &&
        refreshedFinalRefund.wechatRefundStatus?.trim().toUpperCase() ===
          'SUCCESS' &&
        (refreshed.refundAmount ?? 0) >= paidAmount
    );
  }

  private async repairDowngradedMembershipFinalRefundBenefits(
    order: OrderEntity
  ): Promise<void> {
    const now = new Date();
    const existing = this.getVoiceMembershipFinalRefund(order);
    const downgrade = this.getVoiceMembershipDowngrade(order);
    const paidAmount = order.paidAmount ?? order.payableAmount ?? 0;

    if (downgrade?.status === 'completed') {
      const downgradeCompletedAt = new Date(
        downgrade.completedAt ??
          downgrade.refundRecordedAt ??
          downgrade.updatedAt
      );

      await this.recordCompletedRefundOrder(
        order,
        downgrade.refundNo,
        OrderRefundType.voiceMembershipDowngrade,
        downgrade.refundAmount,
        downgrade.wechatRefundId,
        new Date(downgrade.requestedAt),
        Number.isNaN(downgradeCompletedAt.getTime())
          ? now
          : downgradeCompletedAt
      );
    }

    if (
      existing?.status === 'completed' &&
      order.status === OrderStatus.refunded &&
      (order.refundAmount ?? 0) >= paidAmount
    ) {
      await this.recordCompletedRefundOrder(
        order,
        existing.refundNo,
        OrderRefundType.voiceMembershipFinalRefund,
        existing.refundAmount,
        existing.wechatRefundId,
        new Date(existing.attemptRequestedAt ?? existing.requestedAt),
        new Date(existing.completedAt ?? existing.updatedAt)
      );
      await this.revokeOrderBenefits(order, now);
      return;
    }

    const finalRefund: VoiceMembershipFinalRefundSnapshot = existing
      ? { ...existing }
      : {
          status: 'benefits_processing',
          refundAmount: Math.max(
            paidAmount - (downgrade?.refundAmount ?? 0),
            0
          ),
          refundNo: this.generateVoiceMembershipFinalRefundNo(order, 1),
          attempt: 1,
          attemptRequestedAt: (order.refundedAt ?? now).toISOString(),
          wechatRefundStatus: 'SUCCESS',
          requestedAt: (order.refundedAt ?? now).toISOString(),
          updatedAt: now.toISOString(),
        };
    const refundWasConfirmed =
      order.status === OrderStatus.refunded ||
      finalRefund.wechatRefundStatus?.trim().toUpperCase() === 'SUCCESS';

    if (!refundWasConfirmed) {
      throw new AppError(
        'ORDER_REFUND_NOT_SUCCESSFUL',
        '微信尚未确认退款成功，会员权益未收回',
        409
      );
    }

    const snapshotUpdatedAt = new Date(finalRefund.updatedAt);
    const financialRefundedAt =
      (order.refundAmount ?? 0) >= paidAmount && order.refundedAt
        ? order.refundedAt
        : Number.isNaN(snapshotUpdatedAt.getTime())
        ? now
        : snapshotUpdatedAt;

    const expectedFinalRefund = existing ? { ...existing } : undefined;
    const expectedUpdatedAtMs = expectedFinalRefund
      ? new Date(expectedFinalRefund.updatedAt).getTime()
      : Number.NaN;
    const benefitClaimUpdatedAt = new Date(
      Number.isNaN(expectedUpdatedAtMs)
        ? now.getTime()
        : Math.max(now.getTime(), expectedUpdatedAtMs + 1)
    ).toISOString();
    finalRefund.status = 'benefits_processing';
    finalRefund.failureReason = undefined;
    finalRefund.updatedAt = benefitClaimUpdatedAt;
    const benefitClaimFilter: MongoWhere = {
      _id: order.id,
      status: {
        $in: [OrderStatus.refundRequested, OrderStatus.refunded],
      },
      [`snapshot.${VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY}.status`]:
        'completed',
    };

    if (expectedFinalRefund) {
      benefitClaimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.refundNo`
      ] = expectedFinalRefund.refundNo;
      benefitClaimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.status`
      ] = expectedFinalRefund.status;
      benefitClaimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.updatedAt`
      ] = expectedFinalRefund.updatedAt;
      benefitClaimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.attempt`
      ] =
        expectedFinalRefund.attempt === undefined
          ? { $exists: false }
          : expectedFinalRefund.attempt;
    } else {
      benefitClaimFilter[
        `snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`
      ] = { $exists: false };
    }

    const benefitClaimResult = await this.orderModel.updateOne(
      benefitClaimFilter as never,
      {
        $set: {
          status: OrderStatus.refunded,
          refundAmount: paidAmount,
          refundedAt: financialRefundedAt,
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`]:
            finalRefund,
          updatedAt: now,
        },
      } as never
    );

    if (!this.didMongoUpdate(benefitClaimResult)) {
      const refreshed = await this.refreshOrderEntity(order);
      const refreshedFinalRefund =
        this.getVoiceMembershipFinalRefund(refreshed);

      if (
        refreshedFinalRefund?.refundNo === finalRefund.refundNo &&
        refreshedFinalRefund.status === 'completed'
      ) {
        return;
      }

      throw new AppError(
        'ORDER_REFUND_STATE_CONFLICT',
        '退款已成功，但会员权益正在由其他操作处理，请刷新后重试',
        409
      );
    }

    order.status = OrderStatus.refunded;
    order.refundAmount = paidAmount;
    order.refundedAt = financialRefundedAt;
    order.updatedAt = now;
    this.setVoiceMembershipFinalRefund(order, finalRefund);

    try {
      await this.revokeOrderBenefits(order, now);
    } catch (error) {
      finalRefund.status = 'benefits_failed';
      finalRefund.failureReason = this.getOperationFailureReason(error);
      const failedAt = new Date(
        Math.max(Date.now(), new Date(benefitClaimUpdatedAt).getTime() + 1)
      );
      finalRefund.updatedAt = failedAt.toISOString();
      const failedResult = await this.orderModel.updateOne(
        {
          _id: order.id,
          status: {
            $in: [OrderStatus.refundRequested, OrderStatus.refunded],
          },
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.refundNo`]:
            finalRefund.refundNo,
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.status`]:
            'benefits_processing',
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.updatedAt`]:
            benefitClaimUpdatedAt,
        } as never,
        {
          $set: {
            [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`]:
              finalRefund,
            updatedAt: failedAt,
          },
        } as never
      );

      if (!this.didMongoUpdate(failedResult)) {
        const refreshed = await this.refreshOrderEntity(order);

        if (
          refreshed.status === OrderStatus.refunded &&
          this.getVoiceMembershipFinalRefund(refreshed)?.refundNo ===
            finalRefund.refundNo &&
          this.getVoiceMembershipFinalRefund(refreshed)?.status === 'completed'
        ) {
          return;
        }
      }
      throw error;
    }

    const completedAt = new Date(
      Math.max(Date.now(), new Date(benefitClaimUpdatedAt).getTime() + 1)
    );
    finalRefund.status = 'completed';
    finalRefund.completedAt =
      finalRefund.completedAt ?? completedAt.toISOString();
    finalRefund.failureReason = undefined;
    finalRefund.updatedAt = completedAt.toISOString();
    const completeResult = await this.orderModel.updateOne(
      {
        _id: order.id,
        status: {
          $in: [OrderStatus.refundRequested, OrderStatus.refunded],
        },
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.refundNo`]:
          finalRefund.refundNo,
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.status`]: {
          $in: ['benefits_processing'],
        },
        [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}.updatedAt`]:
          benefitClaimUpdatedAt,
      } as never,
      {
        $set: {
          status: OrderStatus.refunded,
          refundAmount: paidAmount,
          refundedAt: financialRefundedAt,
          [`snapshot.${VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY}`]:
            finalRefund,
          updatedAt: completedAt,
        },
      } as never
    );

    if (!this.didMongoUpdate(completeResult)) {
      const refreshed = await this.refreshOrderEntity(order);

      const refreshedFinalRefund =
        this.getVoiceMembershipFinalRefund(refreshed);

      if (
        refreshed.status === OrderStatus.refunded &&
        refreshedFinalRefund?.refundNo === finalRefund.refundNo &&
        refreshedFinalRefund.status === 'completed'
      ) {
        return;
      }

      throw new AppError(
        'ORDER_REFUND_STATE_CONFLICT',
        '退款已成功且会员权益已收回，但完成状态写入冲突，请刷新后重试',
        409
      );
    }

    order.status = OrderStatus.refunded;
    order.refundAmount = paidAmount;
    order.refundedAt = financialRefundedAt;
    order.updatedAt = completedAt;
    this.setVoiceMembershipFinalRefund(order, finalRefund);
  }

  private async revokeAdminManualPaidOrder(order: OrderEntity): Promise<void> {
    if (order.status === OrderStatus.closed) {
      return;
    }

    if (order.paymentProvider !== ADMIN_MANUAL_PAYMENT_PROVIDER) {
      throw new AppError(
        'ORDER_REVOKE_PROVIDER_UNSUPPORTED',
        'only admin manual order can be revoked',
        400
      );
    }

    if (!this.isRefundableOrderType(order.orderType)) {
      throw new AppError(
        'ORDER_REVOKE_TYPE_UNSUPPORTED',
        'order type cannot be revoked',
        400
      );
    }

    if (!this.isRefundableOrderStatus(order.status)) {
      throw new AppError('ORDER_NOT_REVOKABLE', 'order is not revocable', 400);
    }

    await this.assertRefundableOrderBenefits(order);

    const now = new Date();
    await this.revokeOrderBenefits(order, now);

    order.status = OrderStatus.closed;
    order.closedAt = now;
    order.updatedAt = now;
    await this.orderModel.save(order);
  }

  private async assertRefundableOrderBenefits(
    order: OrderEntity
  ): Promise<void> {
    if (order.orderType !== OrderType.voicePackage) {
      return;
    }

    const task = await this.findVoiceTrainingTaskByOrderId(order.id);

    if (task?.status === VoiceTrainingTaskStatus.completed) {
      throw new AppError(
        'VOICE_PACKAGE_ALREADY_COMPLETED',
        'completed voice package cannot be refunded',
        400
      );
    }
  }

  private async assertDowngradedMembershipStillOwnedByOrder(
    order: OrderEntity
  ): Promise<void> {
    const membership = await this.findActiveMembership(order.userId);

    if (
      membership &&
      this.stringifyObjectId(membership.sourceOrderId) !==
        this.stringifyObjectId(order.id)
    ) {
      throw new AppError(
        'ORDER_MEMBERSHIP_REPLACED_BY_NEWER_ORDER',
        '该用户已通过后续订单获得会员，当前订单可能已参与升级抵扣；请核对后续订单后处理，系统不会自动退款或收回新订单权益',
        409
      );
    }

    const laterVipOrders = await this.orderModel.find({
      where: {
        userId: order.userId,
        orderType: OrderType.vipPlan,
      },
      order: {
        createdAt: 'DESC',
      },
    });
    const hasLaterOrderUsingHistoricalPayment = laterVipOrders.some(item => {
      if (
        this.stringifyObjectId(item.id) === this.stringifyObjectId(order.id)
      ) {
        return false;
      }

      if (
        item.status === OrderStatus.closed ||
        item.status === OrderStatus.refunded
      ) {
        return false;
      }

      const itemCreatedAt = item.createdAt?.getTime?.() ?? 0;
      const refundedOrderCreatedAt = order.createdAt?.getTime?.() ?? 0;
      const upgradePricing = item.snapshot?.vipUpgrade;
      const deductedAmount =
        upgradePricing && typeof upgradePricing === 'object'
          ? Number(
              (upgradePricing as Record<string, unknown>).deductedAmount ?? 0
            )
          : 0;

      return (
        itemCreatedAt >= refundedOrderCreatedAt &&
        Number.isFinite(deductedAmount) &&
        deductedAmount > 0
      );
    });

    if (hasLaterOrderUsingHistoricalPayment) {
      throw new AppError(
        'ORDER_REFUND_USED_BY_NEWER_UPGRADE',
        '该订单金额已被后续会员订单用于升级抵扣；请先核对后续订单，系统不会重复退款',
        409
      );
    }
  }

  private async acquireMembershipFinancialOperationLock(
    userId: MongoObjectId,
    operation: 'voice_membership_final_refund'
  ): Promise<string> {
    const now = new Date();
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(
      now.getTime() + MEMBERSHIP_FINANCIAL_OPERATION_LOCK_TTL_MS
    );
    const result = await this.userModel.updateOne(
      {
        _id: userId,
        $or: [
          {
            [MEMBERSHIP_FINANCIAL_OPERATION_LOCK_KEY]: {
              $exists: false,
            },
          },
          {
            [`${MEMBERSHIP_FINANCIAL_OPERATION_LOCK_KEY}.expiresAt`]: {
              $lte: now,
            },
          },
        ],
      } as never,
      {
        $set: {
          [MEMBERSHIP_FINANCIAL_OPERATION_LOCK_KEY]: {
            token,
            operation,
            acquiredAt: now,
            expiresAt,
          },
        },
      } as never
    );

    if (!this.didMongoUpdate(result)) {
      throw new AppError(
        'MEMBERSHIP_FINANCIAL_OPERATION_BUSY',
        '该用户正在创建会员订单或处理会员退款，请稍后重试',
        409
      );
    }

    return token;
  }

  private async releaseMembershipFinancialOperationLock(
    userId: MongoObjectId,
    token: string
  ): Promise<void> {
    try {
      await this.userModel.updateOne(
        {
          _id: userId,
          [`${MEMBERSHIP_FINANCIAL_OPERATION_LOCK_KEY}.token`]: token,
        } as never,
        {
          $unset: {
            [MEMBERSHIP_FINANCIAL_OPERATION_LOCK_KEY]: '',
          },
        } as never
      );
    } catch (error) {
      this.logger.warn(
        `failed to release membership financial operation lock for user ${this.stringifyObjectId(
          userId
        )}: ${this.getOperationFailureReason(error)}`
      );
    }
  }

  /**
   * 退款失败告警。
   *
   * 同时走 logger 和 console：本项目的运维可见通道是容器 stdout（`docker logs`，
   * 现有巡检也扫它），Midway logger 在本部署里不落 stdout，只写 logger 等于没人看得到。
   */
  private alertRefundFailure(message: string, ...args: unknown[]): void {
    this.logger?.error?.(message, ...args);
    // eslint-disable-next-line no-console
    console.error(message, ...args);
  }

  /**
   * 退款被判定失败后，把提交退款时"乐观"写入的结果整体还原，使订单重新可退款。
   *
   * 提交退款时订单会被立即置为 refunded、累加 refundAmount 并撤销会员权益；
   * 既然这笔退款最终没成功，这些副作用都必须撤回——否则用户"没收到钱、还丢了会员"，
   * 运营在订单页也看不到退款按钮（refunded 不在可退状态里），根本没法补救。
   *
   * @returns 是否发生了完整还原（订单从 refunded 回到 completed）
   */
  private async restoreOrderRefundState(
    order: OrderEntity,
    refundAmount: number,
    reason: string
  ): Promise<boolean> {
    const now = new Date();
    const currentRefunded = Number(order.refundAmount ?? 0);
    const nextRefunded = Math.max(0, currentRefunded - refundAmount);
    const set: Record<string, unknown> = {
      refundAmount: nextRefunded,
      updatedAt: now,
    };
    const unset: Record<string, unknown> = {};
    let fullyRestored = false;

    if (nextRefunded === 0) {
      unset.refundedAt = '';
      if (order.status === OrderStatus.refunded) {
        set.status = OrderStatus.completed;
        fullyRestored = true;
      }
    }

    await this.orderModel.updateOne(
      { _id: order.id } as never,
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      } as never
    );

    if (fullyRestored) {
      // 权益是在这次（失败的）退款里被撤销的，一并恢复
      await this.userMembershipModel.updateOne(
        {
          sourceOrderId: order.id,
          status: UserMembershipStatus.refunded,
        } as never,
        {
          $set: { status: UserMembershipStatus.active, updatedAt: now },
        } as never
      );
      await this.agentEntitlementModel.updateMany(
        {
          sourceOrderId: order.id,
          status: AgentEntitlementStatus.refunded,
        } as never,
        {
          $set: { status: AgentEntitlementStatus.available, updatedAt: now },
        } as never
      );
      this.alertRefundFailure(
        '[refund-alert] order restored to refundable after refund failure: orderNo=%s refundAmount=%s reason=%s',
        order.orderNo,
        refundAmount,
        reason
      );
    }

    return fullyRestored;
  }

  /**
   * 回查确认微信是否真的创建了这笔虚拟支付退款。
   *
   * 接口返回 OK 只代表受理成功——实测存在「返回 OK + 退款单号，但微信侧从未创建退款单」的情况
   * （left_fee 不变、refund_info.refund_order 为空），因此必须查询订单的退款单列表确认。
   */
  private async confirmVirtualRefund(
    order: OrderEntity,
    refundWxOrderId: string | undefined,
    attempts = 5,
    intervalMs = 3000
  ): Promise<boolean> {
    if (!order.payerOpenid) return false;
    const env =
      order.virtualPaymentEnv ??
      this.adminWechatPayService.getVirtualPayEnv();

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
      try {
        const snapshot = await this.adminWechatPayService.queryVirtualOrder({
          openid: order.payerOpenid,
          orderNo: order.orderNo,
          env,
        });
        const refunds = snapshot?.refund_info?.refund_order;
        if (Array.isArray(refunds) && refunds.length > 0) {
          if (!refundWxOrderId) return true;
          return refunds.some(item =>
            JSON.stringify(item).includes(refundWxOrderId)
          );
        }
      } catch (err) {
        this.logger?.warn?.(
          '[refund] virtual refund confirm failed: orderNo=%s err=%s',
          order.orderNo,
          (err as Error).message
        );
      }
    }

    return false;
  }

  /**
   * 虚拟支付退款对账（定时任务）：把本地记为已退款/处理中的虚拟支付退款逐笔拿去微信核对。
   *
   * - 微信侧确认有退款单，且距提交已满 `VIRTUAL_REFUND_OBSERVATION_MS` → 收敛为 completed；
   * - 观察期内微信侧仍有退款单 → 保持 processing，计入 pending，不下成功结论；
   * - 微信侧无退款单且距提交已满 `VIRTUAL_REFUND_MISSING_GRACE_MS` → 标为 failed 并打
   *   `[refund-alert]` 错误日志，避免「系统显示已退款、用户没收到钱」长期无人发现；
   * - 其余保持处理中，等下一轮。
   */
  async reconcileVirtualRefunds(limit = 100): Promise<{
    scanned: number;
    confirmed: number;
    pending: number;
    failed: number;
    errors: string[];
  }> {
    const records = await this.orderRefundModel.find({
      where: {
        paymentProvider: WECHAT_VIRTUAL_PAY_PROVIDER,
        status: {
          $in: [OrderRefundStatus.completed, OrderRefundStatus.processing],
        },
      } as never,
      take: limit,
    } as never);

    const summary = {
      scanned: records.length,
      confirmed: 0,
      pending: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const record of records) {
      try {
        const order = await this.getOrderById(String(record.originalOrderId));
        if (!order?.payerOpenid) continue;
        const env =
          order.virtualPaymentEnv ??
          this.adminWechatPayService.getVirtualPayEnv();
        // 提交时点：观察期与缺失判定都从它起算。老记录可能没有 requestedAt，
        // 这种情况视为「早已过观察期」，避免历史遗留记录永远无法收敛。
        const submittedAt = record.requestedAt ?? record.createdAt;
        const submittedMs = submittedAt
          ? new Date(submittedAt).getTime()
          : Number.NaN;
        const elapsedMs = Number.isNaN(submittedMs)
          ? Number.POSITIVE_INFINITY
          : Date.now() - submittedMs;
        const snapshot = await this.adminWechatPayService.queryVirtualOrder({
          openid: order.payerOpenid,
          orderNo: order.orderNo,
          env,
        });
        if (!snapshot) continue;
        const refunds = snapshot.refund_info?.refund_order;
        const hasRefund = Array.isArray(refunds) && refunds.length > 0;
        const refundIdMatched =
          hasRefund &&
          (!record.paymentRefundId ||
            refunds.some(item =>
              JSON.stringify(item).includes(String(record.paymentRefundId))
            ));

        if (refundIdMatched) {
          if (record.status === OrderRefundStatus.completed) {
            summary.confirmed += 1;
            continue;
          }
          if (elapsedMs < VIRTUAL_REFUND_OBSERVATION_MS) {
            // 观察期未满：微信侧暂时还在，但还不能下「退款成功」的结论。
            summary.pending += 1;
            continue;
          }
          summary.confirmed += 1;
          await this.orderRefundModel.updateOne(
            { _id: record.id } as never,
            {
              $set: {
                status: OrderRefundStatus.completed,
                // 归集口径不变：用提交/首次确认时间，避免观察期把退款算到下一天。
                completedAt:
                  record.completedAt ?? record.requestedAt ?? new Date(),
                updatedAt: new Date(),
              },
            } as never
          );
          continue;
        }

        const paidFee = Number(snapshot.paid_fee ?? 0);
        const leftFee = Number(snapshot.left_fee ?? 0);
        if (!hasRefund) {
          if (elapsedMs < VIRTUAL_REFUND_MISSING_GRACE_MS) {
            // 刚提交的退款单可能还没落到 refund_info 里，先不下失败结论。
            summary.pending += 1;
            continue;
          }
          summary.failed += 1;
          const failedAt = new Date();
          await this.orderRefundModel.updateOne(
            { _id: record.id } as never,
            {
              $set: {
                status: OrderRefundStatus.failed,
                failureReason:
                  '自动对账：微信侧不存在该退款单（left_fee 未扣减、退款单列表为空），退款未成功，用户未收到款项',
                failedAt,
                updatedAt: failedAt,
              },
            } as never
          );
          await this.restoreOrderRefundState(
            order,
            Number(record.amount) || 0,
            'wechat has no refund order and left_fee unchanged'
          );
          this.alertRefundFailure(
            '[refund-alert] wechat has NO refund for a locally-recorded virtual refund: orderNo=%s refundNo=%s refundWxOrderId=%s amount=%s leftFee=%s paidFee=%s',
            order.orderNo,
            record.refundNo,
            record.paymentRefundId || '-',
            record.amount,
            leftFee,
            paidFee
          );
          continue;
        }

        // 微信侧有退款单，但不是这一笔（单号对不上）：留给下一轮继续核对。
        summary.pending += 1;
      } catch (err) {
        summary.errors.push(
          `${record.refundNo}: ${(err as Error).message}`
        );
      }
    }

    return summary;
  }

  private async refundVirtualPaymentOrder(
    order: OrderEntity,
    refundAmount: number,
    reason: string,
    refundNo?: string
  ): Promise<string | undefined> {
    if (!order.payerOpenid) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_OPENID_MISSING',
        'wechat virtual pay openid missing',
        500
      );
    }

    const response = await this.adminWechatPayService.refundVirtualOrder({
      openid: order.payerOpenid,
      orderNo: order.orderNo,
      refundNo: refundNo ?? this.generateRefundNo(order),
      leftFee: order.paidAmount ?? refundAmount,
      refundFee: refundAmount,
      reason,
      env:
        order.virtualPaymentEnv ??
        this.adminWechatPayService.getVirtualPayEnv(),
    });

    return response.refund_wx_order_id || response.refund_order_id;
  }

  private async submitVoiceMembershipDowngradeRefund(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot
  ): Promise<WechatRefundPayload> {
    if (order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER) {
      return this.refundVirtualMembershipPayment(
        order,
        downgrade.refundNo,
        downgrade.refundAmount,
        downgrade.refundAmount,
        VOICE_MEMBERSHIP_DOWNGRADE_REASON
      );
    }

    return this.adminWechatPayService.refundOrder({
      orderNo: order.orderNo,
      refundNo: downgrade.refundNo,
      reason: VOICE_MEMBERSHIP_DOWNGRADE_REASON,
      amount: downgrade.refundAmount,
      totalAmount: order.paidAmount ?? order.payableAmount,
    });
  }

  /**
   * 退款记录写入时的状态收敛：虚拟支付退款在观察期（`VIRTUAL_REFUND_OBSERVATION_MS`）内
   * 一律先记 `processing`，由定时对账在微信侧持续确认后再转 `completed`。
   * 普通微信支付（v3 同步返回退款状态）保持原语义，立即记成功。
   */
  private resolveRefundRecordStatus(
    order: OrderEntity,
    requestedAt: Date,
    desired: OrderRefundStatus
  ): OrderRefundStatus {
    if (desired !== OrderRefundStatus.completed) return desired;
    if (order.paymentProvider !== WECHAT_VIRTUAL_PAY_PROVIDER) return desired;

    const requestedMs = requestedAt.getTime();
    if (Number.isNaN(requestedMs)) return desired;

    return Date.now() - requestedMs < VIRTUAL_REFUND_OBSERVATION_MS
      ? OrderRefundStatus.processing
      : desired;
  }

  private async recordCompletedRefundOrder(
    order: OrderEntity,
    refundNo: string,
    refundType: OrderRefundType,
    amount: number,
    paymentRefundId: string | undefined,
    requestedAt: Date,
    completedAt: Date,
    status: OrderRefundStatus = OrderRefundStatus.completed
  ): Promise<void> {
    const normalizedRequestedAt = Number.isNaN(requestedAt.getTime())
      ? completedAt
      : requestedAt;
    // 只有熬过观察期的虚拟支付退款才算「已退款」，否则先记处理中。
    const effectiveStatus = this.resolveRefundRecordStatus(
      order,
      normalizedRequestedAt,
      status
    );

    await this.orderRefundModel.updateOne(
      { _id: this.buildRefundOrderId(refundNo), refundNo } as never,
      {
        $setOnInsert: {
          refundNo,
          originalOrderId: order.id,
          originalOrderNo: order.orderNo,
          userId: order.userId,
          orderType: order.orderType,
          targetCode: order.targetCode,
          refundType,
          amount,
          currency: order.currency || 'CNY',
          source: order.source,
          paymentProvider: order.paymentProvider,
          requestedAt: normalizedRequestedAt,
          createdAt: normalizedRequestedAt,
        },
        $set: {
          status: effectiveStatus,
          paymentRefundId,
          ...(effectiveStatus === OrderRefundStatus.completed
            ? { completedAt }
            : {}),
          updatedAt: completedAt,
        },
      } as never,
      { upsert: true }
    );
  }

  /**
   * 发起（或确认）虚拟支付会员退款。
   *
   * @param cumulativeRefundIncludingThis 这笔退款完成后的**累计已退金额**
   *        （含本次）。用它倒推微信侧「本次退款后应有的剩余可退金额」：
   *        `expectedLeftFee = 实付 - 累计已退`。
   *        例：实付 16900、本次退 9900 且此前未退过 → 传 9900；
   *            降级退 7000 且此前未退过 → 传 7000。
   *        该值只用于幂等判据，不会作为退款金额提交给微信（提交的是 refundAmount）。
   */
  private async refundVirtualMembershipPayment(
    order: OrderEntity,
    refundNo: string,
    refundAmount: number,
    cumulativeRefundIncludingThis: number,
    reason: string
  ): Promise<WechatRefundPayload> {
    if (!order.payerOpenid) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_OPENID_MISSING',
        'wechat virtual pay openid missing',
        500
      );
    }

    const paidAmount = order.paidAmount ?? order.payableAmount ?? 0;
    // 微信侧在本笔退款完成后应当剩余的可退金额；用于判断是否已经退过。
    const expectedLeftFee = Math.max(
      paidAmount - cumulativeRefundIncludingThis,
      0
    );
    const env =
      order.virtualPaymentEnv ?? this.adminWechatPayService.getVirtualPayEnv();
    const queryOrder = () =>
      this.adminWechatPayService.queryVirtualOrder({
        openid: order.payerOpenid as string,
        orderNo: order.orderNo,
        env,
      });
    /**
     * 幂等预检：这笔退款是不是「此前已经提交并落到微信」。
     *
     * 唯一可信判据是微信返回的剩余可退金额 left_fee——它已经不多于
     * 「本次退款完成后应有的余额」expectedLeftFee，说明退款已经落地，
     * 可以认定成功、不重复提交。
     *
     * 绝对不能看订单 status：微信在**部分退款**之后就会把 status 置为
     * 5/8，若据此判定「已全额退款」，剩下没退的金额会被静默跳过。
     * （2026-09-21 一笔 ¥99 最终退款就是这样被记为成功但从未提交微信，
     * 用户没有收到钱。）left_fee 缺失时同样不能当作已退款。
     */
    const buildConfirmedRefund = (
      virtualOrder: AdminWechatVirtualOrderPayload
    ): WechatRefundPayload | undefined => {
      const leftFee = Number(virtualOrder.left_fee);

      if (!Number.isFinite(leftFee) || leftFee > expectedLeftFee) {
        return undefined;
      }

      this.logger?.warn?.(
        '[order] virtual membership refund already settled on wechat, skip resubmit, orderNo=%s refundNo=%s leftFee=%s expectedLeftFee=%s',
        order.orderNo,
        refundNo,
        leftFee,
        expectedLeftFee
      );

      return {
        out_refund_no: refundNo,
        out_trade_no: order.orderNo,
        status: 'SUCCESS',
        amount: {
          total: paidAmount,
          refund: refundAmount,
          currency: order.currency || 'CNY',
        },
      };
    };

    const virtualOrder = await queryOrder();

    if (!virtualOrder) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_ORDER_NOT_FOUND',
        '未查询到微信虚拟支付订单，无法安全退款',
        404
      );
    }

    const alreadyConfirmed = buildConfirmedRefund(virtualOrder);

    if (alreadyConfirmed) {
      return alreadyConfirmed;
    }

    const leftFee = Number(virtualOrder.left_fee);

    if (!Number.isFinite(leftFee) || leftFee <= 0) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_LEFT_FEE_INVALID',
        '微信虚拟支付订单剩余可退金额异常，请刷新后重试',
        409
      );
    }

    if (refundAmount > leftFee) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_REFUND_AMOUNT_EXCEEDED',
        '微信虚拟支付订单剩余可退金额不足，请核对退款记录',
        409
      );
    }

    try {
      const response = await this.adminWechatPayService.refundVirtualOrder({
        openid: order.payerOpenid,
        orderNo: order.orderNo,
        refundNo,
        leftFee,
        refundFee: refundAmount,
        reason,
        env,
      });
      let confirmedAfterSubmit: WechatRefundPayload | undefined;

      try {
        const refreshed = await queryOrder();

        confirmedAfterSubmit = refreshed
          ? buildConfirmedRefund(refreshed)
          : undefined;
      } catch {
        // 微信已受理退款但查询可能短暂不可用；保持处理中，禁止提前撤权。
      }

      return {
        refund_id:
          response.refund_wx_order_id || response.refund_order_id || refundNo,
        out_refund_no: refundNo,
        out_trade_no: order.orderNo,
        status: confirmedAfterSubmit ? 'SUCCESS' : 'PROCESSING',
        amount: {
          total: paidAmount,
          refund: refundAmount,
          currency: order.currency || 'CNY',
        },
      };
    } catch (error) {
      const refreshed = await queryOrder();
      const confirmed = refreshed ? buildConfirmedRefund(refreshed) : undefined;

      if (confirmed) {
        return confirmed;
      }

      const response =
        error instanceof AppError
          ? (error.data as { errcode?: number } | undefined)
          : undefined;

      if (
        response?.errcode === 268490004 ||
        response?.errcode === 268490005 ||
        response?.errcode === 268490014 ||
        response?.errcode === 268490016
      ) {
        return {
          out_refund_no: refundNo,
          out_trade_no: order.orderNo,
          status: 'PROCESSING',
          amount: {
            total: paidAmount,
            refund: refundAmount,
            currency: order.currency || 'CNY',
          },
        };
      }

      throw error;
    }
  }

  private async revokeOrderBenefits(
    order: OrderEntity,
    now: Date
  ): Promise<void> {
    if (order.orderType === OrderType.vipPlan) {
      await this.revokeVipBenefits(order, now);
      return;
    }

    if (order.orderType === OrderType.voicePackage) {
      await this.revokeVoicePackageBenefits(order, now);
    }
  }

  private async revokeVipBenefits(
    order: OrderEntity,
    now: Date
  ): Promise<void> {
    await this.userMembershipModel.updateOne(
      {
        sourceOrderId: order.id,
        status: {
          $ne: UserMembershipStatus.refunded,
        },
      },
      {
        $set: {
          status: UserMembershipStatus.refunded,
          updatedAt: now,
        },
      } as never
    );

    const entitlements = await this.agentEntitlementModel.find({
      where: {
        sourceOrderId: order.id,
      },
    });

    for (const entitlement of entitlements) {
      if (entitlement.status === AgentEntitlementStatus.refunded) {
        continue;
      }

      await this.agentEntitlementModel.updateOne(
        {
          _id: entitlement.id,
          sourceOrderId: order.id,
          status: {
            $ne: AgentEntitlementStatus.refunded,
          },
        } as never,
        {
          $set: {
            status: AgentEntitlementStatus.refunded,
            updatedAt: now,
          },
        } as never
      );
    }
  }

  private async revokeVoicePackageBenefits(
    order: OrderEntity,
    now: Date
  ): Promise<void> {
    const task = await this.findVoiceTrainingTaskByOrderId(order.id);

    if (!task || task.status === VoiceTrainingTaskStatus.refunded) {
      return;
    }

    task.status = VoiceTrainingTaskStatus.refunded;
    task.updatedAt = now;
    await this.voiceTrainingTaskModel.save(task);
  }

  private async grantVipMembership(order: OrderEntity): Promise<void> {
    const snapshot = this.getVipPlanSnapshot(order);
    const now = order.paidAt ?? new Date();
    const existing = await this.findActiveMembership(order.userId);
    const membership = existing ?? new UserMembershipEntity();

    membership.userId = order.userId;
    membership.vipPlanId =
      order.targetId ?? this.parseObjectId(snapshot.id, 'INVALID_VIP_PLAN_ID');
    membership.vipPlanCode = order.targetCode || snapshot.code;
    membership.sourceOrderId = order.id;
    membership.status = UserMembershipStatus.active;
    membership.startedAt = existing?.startedAt ?? now;
    membership.lifetime = Boolean(snapshot.lifetime);
    membership.expiredAt = membership.lifetime
      ? undefined
      : this.calculateExpiredAt(
          existing?.expiredAt,
          now,
          snapshot.durationDays
        );
    membership.createdAt = existing?.createdAt ?? now;
    membership.updatedAt = new Date();

    await this.userMembershipModel.save(membership);
    await this.grantVipEntitlements(order, membership, snapshot, now);
  }

  private async grantVipEntitlements(
    order: OrderEntity,
    membership: UserMembershipEntity,
    snapshot: {
      entitlementGrants?: Array<{
        type: AgentEntitlementType;
        totalQuota: number;
        durationDays?: number;
      }>;
    },
    now: Date
  ): Promise<void> {
    const entitlementGrants = snapshot.entitlementGrants ?? [];

    for (const grant of entitlementGrants) {
      if (!grant.type || !grant.totalQuota || grant.totalQuota <= 0) {
        continue;
      }

      const existing = await this.agentEntitlementModel.findOne({
        where: {
          sourceOrderId: order.id,
          type: grant.type,
        },
      });

      if (existing) {
        continue;
      }

      const entitlement = new AgentEntitlementEntity();
      entitlement.userId = order.userId;
      entitlement.type = grant.type;
      entitlement.totalQuota = grant.totalQuota;
      entitlement.usedQuota = 0;
      entitlement.status = AgentEntitlementStatus.available;
      entitlement.sourceOrderId = order.id;
      entitlement.sourceVipPlanId = membership.vipPlanId;
      entitlement.activatedAt = now;
      entitlement.expiredAt = this.calculateEntitlementExpiredAt(
        now,
        grant.durationDays,
        membership
      );
      entitlement.createdAt = now;
      entitlement.updatedAt = new Date();

      await this.agentEntitlementModel.save(entitlement);
    }
  }

  private async createVoiceTrainingTask(order: OrderEntity): Promise<void> {
    const snapshot = this.getVoicePackageSnapshot(order);
    const existing = await this.findVoiceTrainingTaskByOrderId(order.id);

    if (existing) {
      return;
    }

    const now = order.paidAt ?? new Date();
    const task = new VoiceTrainingTaskEntity();
    task.userId = order.userId;
    task.agentId =
      order.agentId ?? this.parseObjectId(snapshot.agentId, 'INVALID_AGENT_ID');
    task.orderId = order.id;
    task.voicePackageId =
      order.targetId ??
      this.parseObjectId(snapshot.id, 'INVALID_VOICE_PACKAGE_ID');
    task.voicePackageCode = order.targetCode || snapshot.code;
    task.status = VoiceTrainingTaskStatus.paid;
    task.assigneeName = '';
    task.materialObjectKeys = [];
    task.trainingStrategy = VoiceTrainingTaskTrainingStrategy.shortSample;
    task.remark = '';
    task.paidAt = now;
    task.createdAt = now;
    task.updatedAt = new Date();

    await this.voiceTrainingTaskModel.save(task);
  }

  private async findActiveMembership(
    userId: MongoObjectId
  ): Promise<UserMembershipEntity | null> {
    const memberships = await this.userMembershipModel.find({
      where: {
        userId,
        status: UserMembershipStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
    const now = new Date();

    return (
      memberships.find(
        item => item.lifetime || Boolean(item.expiredAt && item.expiredAt > now)
      ) ?? null
    );
  }

  private async getActiveVipPlanById(planId: string): Promise<VipPlanEntity> {
    const objectId = this.parseObjectId(planId, 'INVALID_VIP_PLAN_ID');
    const plan =
      (await this.vipPlanModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.vipPlanModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!plan || plan.status !== VipPlanStatus.active) {
      throw new AppError('VIP_PLAN_NOT_FOUND', 'vip plan not found', 404);
    }

    return plan;
  }

  private async findVipPlanByObjectId(
    planId: MongoObjectId
  ): Promise<VipPlanEntity | null> {
    return (
      (await this.vipPlanModel.findOne({
        where: {
          id: planId,
        },
      })) ??
      (await this.vipPlanModel.findOne({
        where: {
          _id: planId,
        } as never,
      }))
    );
  }

  private async getActiveVoicePackageById(
    voicePackageId: string
  ): Promise<VoicePackageEntity> {
    const objectId = this.parseObjectId(
      voicePackageId,
      'INVALID_VOICE_PACKAGE_ID'
    );
    const voicePackage =
      (await this.voicePackageModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.voicePackageModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!voicePackage || voicePackage.status !== VoicePackageStatus.active) {
      throw new AppError(
        'VOICE_PACKAGE_NOT_FOUND',
        'voice package not found',
        404
      );
    }

    return voicePackage;
  }

  private async getUserAgentById(
    userId: MongoObjectId,
    agentId: string
  ): Promise<AgentEntity> {
    const objectId = this.parseObjectId(agentId, 'INVALID_AGENT_ID');
    const agent =
      (await this.agentModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.agentModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (
      !agent ||
      this.stringifyObjectId(agent.createdUserId) !== String(userId)
    ) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return agent;
  }

  private async findAgentByObjectId(
    agentId: MongoObjectId
  ): Promise<AgentEntity | null> {
    return (
      (await this.agentModel.findOne({
        where: {
          id: agentId,
        },
      })) ??
      (await this.agentModel.findOne({
        where: {
          _id: agentId,
        } as never,
      }))
    );
  }

  private async findActiveVoiceTrainingTasks(
    agentId: MongoObjectId,
    take?: number
  ): Promise<VoiceTrainingTaskEntity[]> {
    return this.voiceTrainingTaskModel.find({
      where: {
        agentId,
        status: {
          $in: ACTIVE_VOICE_TRAINING_TASK_STATUSES,
        },
      } as never,
      ...(take ? { take } : {}),
    });
  }

  private async replaceActiveVoiceTrainingTasks(
    tasks: VoiceTrainingTaskEntity[]
  ): Promise<void> {
    if (!tasks.length) {
      return;
    }

    const now = new Date();
    await Promise.all(
      tasks.map(task => {
        task.status = VoiceTrainingTaskStatus.failed;
        task.remark = this.appendTaskRemark(
          task.remark,
          VOICE_TRAINING_TASK_REPLACED_REMARK
        );
        task.updatedAt = now;

        return this.voiceTrainingTaskModel.save(task);
      })
    );
  }

  private appendTaskRemark(
    remark: string | undefined,
    nextRemark: string
  ): string {
    const current = remark?.trim();

    return current ? `${current}\n${nextRemark}` : nextRemark;
  }

  private async findUserIdsByKeyword(
    escapedKeyword: string
  ): Promise<MongoObjectId[]> {
    const [users, accounts] = await Promise.all([
      this.userModel.find({
        where: {
          $or: [
            { name: { $regex: escapedKeyword, $options: 'i' } },
            { phone: { $regex: escapedKeyword, $options: 'i' } },
          ],
        } as never,
        take: 200,
      }),
      this.userAccountModel.find({
        where: {
          account: { $regex: escapedKeyword, $options: 'i' },
        } as never,
        take: 200,
      }),
    ]);
    const userIds = [
      ...users.map(user => user.id),
      ...accounts.map(account => account.userId),
    ].filter(Boolean);
    const seen = new Set<string>();

    return userIds.filter(userId => {
      const id = this.stringifyObjectId(userId);

      if (seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });
  }

  private async findUserIdsByRegisteredMonth(
    month: string
  ): Promise<MongoObjectId[]> {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const start = new Date(Date.UTC(year, monthIndex, 1) - BEIJING_OFFSET_MS);
    const end = new Date(Date.UTC(year, monthIndex + 1, 1) - BEIJING_OFFSET_MS);
    const users = await this.userModel.find({
      where: { createdAt: { $gte: start, $lt: end } } as never,
    });

    return users.map(user => user.id).filter(Boolean);
  }

  private async getOrderUserMap(
    orders: OrderEntity[]
  ): Promise<Map<string, AdminOrderUserDTO>> {
    const userIds = orders.map(order => order.userId).filter(Boolean);

    if (userIds.length === 0) {
      return new Map();
    }

    const [users, accounts] = await Promise.all([
      this.userModel.find({
        where: {
          $or: [{ id: { $in: userIds } }, { _id: { $in: userIds } }],
        } as never,
      }),
      this.userAccountModel.find({
        where: {
          userId: { $in: userIds },
        } as never,
      }),
    ]);
    const accountMap = new Map(
      accounts.map(account => [
        this.stringifyObjectId(account.userId),
        account.account,
      ])
    );

    return new Map(
      users.map(user => {
        const id = this.stringifyObjectId(this.getEntityObjectId(user));

        return [
          id,
          {
            id,
            account: accountMap.get(id) ?? user.phone ?? '',
            name: user.name ?? '',
            phone: user.phone ?? accountMap.get(id) ?? '',
            registeredAt: this.formatDate(user.createdAt),
          },
        ];
      })
    );
  }

  private async resolveVoiceMembershipSourcePlan(
    order: OrderEntity
  ): Promise<VoiceMembershipDowngradePlanDTO | undefined> {
    if (order.orderType !== OrderType.vipPlan) {
      return undefined;
    }

    const rawSnapshot =
      order.snapshot?.vipPlan && typeof order.snapshot.vipPlan === 'object'
        ? (order.snapshot.vipPlan as Record<string, unknown>)
        : {};
    const storedPlan = order.targetId
      ? await this.findVipPlanByObjectId(order.targetId)
      : null;
    const planGroup = this.resolveVipPlanGroup(
      rawSnapshot,
      storedPlan,
      order.targetCode,
      order.title
    );

    return {
      id: String(
        rawSnapshot.id ??
          this.stringifyObjectId(storedPlan?.id ?? order.targetId) ??
          ''
      ),
      code: String(
        rawSnapshot.code ?? storedPlan?.code ?? order.targetCode ?? ''
      ),
      name: String(rawSnapshot.name ?? storedPlan?.name ?? order.title ?? ''),
      planGroup,
      priceAmount: this.normalizeSnapshotAmount(
        rawSnapshot.priceAmount,
        storedPlan?.priceAmount ?? order.paidAmount ?? order.payableAmount
      ),
      currency: String(
        rawSnapshot.currency ?? storedPlan?.currency ?? order.currency ?? 'CNY'
      ),
      durationDays: this.normalizeSnapshotOptionalNumber(
        rawSnapshot.durationDays,
        storedPlan?.durationDays
      ),
      lifetime:
        typeof rawSnapshot.lifetime === 'boolean'
          ? rawSnapshot.lifetime
          : Boolean(storedPlan?.lifetime),
    };
  }

  private async findVoiceMembershipDowngradeTargets(
    order: OrderEntity,
    sourcePlan: VoiceMembershipDowngradePlanDTO
  ): Promise<AdminVoiceMembershipDowngradeTargetDTO[]> {
    const plans = await this.vipPlanModel.find({
      where: {
        status: VipPlanStatus.active,
      },
      order: {
        sort: 'ASC',
        priceAmount: 'ASC',
      },
    });
    const paidAmount = order.paidAmount ?? order.payableAmount ?? 0;

    return plans
      .map(plan => {
        const planPriceDifference = Math.max(
          sourcePlan.priceAmount - plan.priceAmount,
          0
        );

        return {
          plan,
          refundAmount: Math.min(paidAmount, planPriceDifference),
        };
      })
      .filter(({ plan, refundAmount }) => {
        return (
          this.normalizePlanGroup(plan.planGroup) === VipPlanGroup.basic &&
          Boolean(plan.lifetime) === sourcePlan.lifetime &&
          (sourcePlan.lifetime ||
            plan.durationDays === sourcePlan.durationDays) &&
          (plan.currency || 'CNY') === sourcePlan.currency &&
          refundAmount > 0
        );
      })
      .map(({ plan, refundAmount }) => ({
        ...this.buildVoiceMembershipDowngradePlan(plan),
        refundAmount,
      }));
  }

  private getVoiceMembershipDowngradeUnavailableReason(
    order: OrderEntity,
    sourcePlan: VoiceMembershipDowngradePlanDTO | undefined,
    membership: UserMembershipEntity | null,
    targetPlans: AdminVoiceMembershipDowngradeTargetDTO[],
    existingDowngrade: VoiceMembershipDowngradeSnapshot | undefined
  ): string | undefined {
    if (order.orderType !== OrderType.vipPlan) {
      return '仅会员订单支持声音版降级';
    }

    if (sourcePlan?.planGroup !== VipPlanGroup.voice) {
      return '这不是声音版会员订单';
    }

    if (order.status !== OrderStatus.completed) {
      return '只有已完成的会员订单可以降级';
    }

    if (
      order.paymentProvider &&
      order.paymentProvider !== WECHAT_PAY_PROVIDER &&
      order.paymentProvider !== WECHAT_VIRTUAL_PAY_PROVIDER
    ) {
      return '这笔订单不是可部分退款的微信支付订单';
    }

    if ((order.paidAmount ?? order.payableAmount ?? 0) <= 0) {
      return '这笔订单没有可退的实付金额';
    }

    if ((order.refundAmount ?? 0) > 0) {
      return '这笔订单已有退款记录，不能再次自动降级';
    }

    if (existingDowngrade) {
      if (existingDowngrade.status === 'completed') {
        return '这笔订单已经降级为基础版会员';
      }

      if (existingDowngrade.status === 'benefits_failed') {
        return '退款已成功但权益处理未完成，请刷新降级状态';
      }

      if (existingDowngrade.status === 'processing') {
        return '降级退款正在处理中，请刷新降级状态';
      }

      return existingDowngrade.failureReason || '上次降级未完成，请先刷新状态';
    }

    if (!membership || membership.status !== UserMembershipStatus.active) {
      return '未找到这笔订单对应的有效会员';
    }

    if (targetPlans.length === 0) {
      return '没有找到周期一致且价格更低的基础版会员';
    }

    return undefined;
  }

  private buildVoiceMembershipDowngradePlan(
    plan: VipPlanEntity
  ): VoiceMembershipDowngradePlanDTO {
    return {
      id: this.stringifyObjectId(plan.id),
      code: plan.code,
      name: plan.name,
      planGroup: this.normalizePlanGroup(plan.planGroup),
      priceAmount: plan.priceAmount,
      currency: plan.currency || 'CNY',
      durationDays: plan.durationDays,
      lifetime: Boolean(plan.lifetime),
    };
  }

  private getVoiceMembershipDowngrade(
    order: OrderEntity
  ): VoiceMembershipDowngradeSnapshot | undefined {
    const value = order.snapshot?.[VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY];

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    return value as VoiceMembershipDowngradeSnapshot;
  }

  private setVoiceMembershipDowngrade(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot
  ): void {
    order.snapshot = {
      ...(order.snapshot ?? {}),
      [VOICE_MEMBERSHIP_DOWNGRADE_SNAPSHOT_KEY]: downgrade,
    };
  }

  private buildVoiceMembershipDowngradeRecord(
    downgrade: VoiceMembershipDowngradeSnapshot
  ): AdminVoiceMembershipDowngradeRecordDTO {
    return {
      status: downgrade.status,
      sourcePlan: downgrade.sourcePlan,
      targetPlan: downgrade.targetPlan,
      refundAmount: downgrade.refundAmount,
      refundNo: downgrade.refundNo,
      wechatRefundId: downgrade.wechatRefundId,
      wechatRefundStatus: downgrade.wechatRefundStatus,
      requestedAt: downgrade.requestedAt,
      completedAt: downgrade.completedAt,
      updatedAt: downgrade.updatedAt,
      operatorId: downgrade.operatorId,
      operatorAccount: downgrade.operatorAccount,
      failureReason: downgrade.failureReason,
    };
  }

  private getVoiceMembershipFinalRefund(
    order: OrderEntity
  ): VoiceMembershipFinalRefundSnapshot | undefined {
    const value = order.snapshot?.[VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY];

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    return value as VoiceMembershipFinalRefundSnapshot;
  }

  private setVoiceMembershipFinalRefund(
    order: OrderEntity,
    refund: VoiceMembershipFinalRefundSnapshot
  ): void {
    order.snapshot = {
      ...(order.snapshot ?? {}),
      [VOICE_MEMBERSHIP_FINAL_REFUND_SNAPSHOT_KEY]: refund,
    };
  }

  private buildVoiceMembershipFinalRefundRecord(
    refund: VoiceMembershipFinalRefundSnapshot
  ): AdminVoiceMembershipFinalRefundRecordDTO {
    return {
      status: refund.status,
      refundAmount: refund.refundAmount,
      refundNo: refund.refundNo,
      attempt: refund.attempt ?? 1,
      attemptRequestedAt: refund.attemptRequestedAt ?? refund.requestedAt,
      wechatRefundId: refund.wechatRefundId,
      wechatRefundStatus: refund.wechatRefundStatus,
      requestedAt: refund.requestedAt,
      completedAt: refund.completedAt,
      updatedAt: refund.updatedAt,
      failureReason: refund.failureReason,
    };
  }

  private resolveOrderVipPlanGroup(
    order: OrderEntity
  ): VipPlanGroup | undefined {
    if (order.orderType !== OrderType.vipPlan) {
      return undefined;
    }

    const rawSnapshot =
      order.snapshot?.vipPlan && typeof order.snapshot.vipPlan === 'object'
        ? (order.snapshot.vipPlan as Record<string, unknown>)
        : {};

    return this.resolveVipPlanGroup(
      rawSnapshot,
      undefined,
      order.targetCode,
      order.title
    );
  }

  private resolveVipPlanGroup(
    snapshot: Record<string, unknown>,
    storedPlan?: VipPlanEntity | null,
    code?: string,
    title?: string
  ): VipPlanGroup {
    if (
      snapshot.planGroup === VipPlanGroup.voice ||
      storedPlan?.planGroup === VipPlanGroup.voice ||
      Boolean(snapshot.voicePackageId) ||
      Boolean(snapshot.voicePackageCode) ||
      storedPlan?.voicePackageId ||
      storedPlan?.voicePackageCode ||
      this.parseEntitlementGrants(snapshot.entitlementGrants).some(
        item => item.type === AgentEntitlementType.voiceModel
      ) ||
      storedPlan?.entitlementGrants?.some(
        item => item.type === AgentEntitlementType.voiceModel
      ) ||
      this.hasLegacyVoicePlanMarker(
        String(snapshot.code ?? storedPlan?.code ?? code ?? ''),
        String(snapshot.name ?? storedPlan?.name ?? title ?? '')
      )
    ) {
      return VipPlanGroup.voice;
    }

    return VipPlanGroup.basic;
  }

  private hasLegacyVoicePlanMarker(code?: string, title?: string): boolean {
    const normalizedCode = String(code ?? '')
      .trim()
      .toLowerCase();

    if (/(^|[_-])voice([_-]|$)/.test(normalizedCode)) {
      return true;
    }

    const normalizedTitle = String(title ?? '').replace(/\s+/g, '');

    if (/不含声音|无声音/.test(normalizedTitle)) {
      return false;
    }

    return /声音版|含声音|声音会员|语音版|声音模型/.test(normalizedTitle);
  }

  private normalizePlanGroup(value?: string): VipPlanGroup {
    return value === VipPlanGroup.voice
      ? VipPlanGroup.voice
      : VipPlanGroup.basic;
  }

  private normalizeSnapshotAmount(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private normalizeSnapshotOptionalNumber(
    value: unknown,
    fallback?: number
  ): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private getOperationFailureReason(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      300
    );
  }

  private buildOrderRecord(
    order: OrderEntity,
    userMap: Map<string, AdminOrderUserDTO>,
    agentUserMessageCount?: number
  ): AdminOrderRecordDTO {
    const userId = this.stringifyObjectId(order.userId);
    // 显式标记行类型：退款行是 'refund'，其余一律 'order'（旧数据缺省时前端按购买处理）
    const voiceMembershipDowngrade = this.getVoiceMembershipDowngrade(order);
    const voiceMembershipFinalRefund =
      this.getVoiceMembershipFinalRefund(order);

    return {
      kind: 'order',
      id: this.stringifyObjectId(order.id),
      orderNo: order.orderNo,
      userId,
      user: userMap.get(userId),
      orderType: order.orderType,
      targetId: order.targetId
        ? this.stringifyObjectId(order.targetId)
        : undefined,
      targetCode: order.targetCode,
      agentId: order.agentId
        ? this.stringifyObjectId(order.agentId)
        : undefined,
      title: order.title,
      amount: order.amount ?? 0,
      discountAmount: order.discountAmount ?? 0,
      couponAmount: order.couponAmount ?? 0,
      payableAmount: order.payableAmount ?? 0,
      paidAmount: order.paidAmount,
      refundAmount: order.refundAmount,
      currency: order.currency || 'CNY',
      status: order.status,
      source: order.source,
      paymentProvider: order.paymentProvider,
      paymentTradeNo: order.paymentTradeNo,
      paymentNotifyAt: this.formatDate(order.paymentNotifyAt),
      virtualGoodsProvideStatus: order.virtualGoodsProvideStatus,
      virtualGoodsProvidedAt: this.formatDate(order.virtualGoodsProvidedAt),
      virtualGoodsProvideFailedAt: this.formatDate(
        order.virtualGoodsProvideFailedAt
      ),
      virtualGoodsProvideError: order.virtualGoodsProvideError,
      paymentExpiredAt: this.formatDate(order.paymentExpiredAt),
      createdAt: this.formatDate(order.createdAt),
      paidAt: this.formatDate(order.paidAt),
      closedAt: this.formatDate(order.closedAt),
      refundedAt: this.formatDate(order.refundedAt),
      refundRequestedAt: this.formatDate(order.refundRequestedAt),
      refundRejectedAt: this.formatDate(order.refundRejectedAt),
      refundRejection: this.getRefundRejection(order),
      agentUserMessageCount,
      vipPlanGroup: this.resolveOrderVipPlanGroup(order),
      vipUpgrade: this.isVipUpgradeOrder(order),
      voiceMembershipDowngrade: voiceMembershipDowngrade
        ? this.buildVoiceMembershipDowngradeRecord(voiceMembershipDowngrade)
        : undefined,
      voiceMembershipFinalRefund: voiceMembershipFinalRefund
        ? this.buildVoiceMembershipFinalRefundRecord(voiceMembershipFinalRefund)
        : undefined,
      updatedAt: this.formatDate(order.updatedAt),
    };
  }

  private getRefundRejection(
    order: OrderEntity
  ): AdminOrderRecordDTO['refundRejection'] {
    const rejection = order.snapshot?.refundRejection;

    if (!rejection || typeof rejection !== 'object') {
      return undefined;
    }

    const record = rejection as Record<string, unknown>;
    const action = record.action;

    if (action !== 'not_refund' && action !== 'rejected') {
      return undefined;
    }

    return {
      action,
      operatorId:
        typeof record.operatorId === 'string' ? record.operatorId : undefined,
      operatorAccount:
        typeof record.operatorAccount === 'string'
          ? record.operatorAccount
          : undefined,
      createdAt:
        typeof record.createdAt === 'string'
          ? record.createdAt
          : new Date().toISOString(),
    };
  }

  private async buildOrderRecordWithUsage(
    order: OrderEntity,
    userMap: Map<string, AdminOrderUserDTO>
  ): Promise<AdminOrderRecordDTO> {
    const agentUserMessageCount = await this.resolveOrderAgentUserMessageCount(
      order
    );

    return this.buildOrderRecord(order, userMap, agentUserMessageCount);
  }

  private async resolveAgentUserMessageCounts(
    orders: OrderEntity[]
  ): Promise<Map<string, number>> {
    const pairs = orders
      .map(order => ({
        userId: order.userId,
        agentId: order.agentId,
      }))
      .filter(item => Boolean(item.userId));

    if (pairs.length === 0) {
      return new Map();
    }

    const userIds = pairs.map(pair => pair.userId).filter(Boolean);
    const rows = (await this.messageModel
      .aggregate([
        {
          $match: {
            userId: { $in: userIds },
            role: MessageRole.user,
            status: MessageStatus.sent,
            quotaExempt: { $ne: true },
          },
        },
        {
          $group: {
            _id: {
              userId: '$userId',
              agentId: { $ifNull: ['$agentId', null] },
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray()) as Array<{
      _id: { userId: MongoObjectId | null; agentId: MongoObjectId | null };
      count: number;
    }>;

    const countMap = new Map<string, number>();

    for (const row of rows) {
      const userId = this.stringifyObjectId(row._id.userId);
      const agentId = this.stringifyObjectId(row._id.agentId);
      countMap.set(`${userId}:${agentId}`, Number(row.count) || 0);
    }

    return countMap;
  }

  private getAgentUserMessageCount(
    messageCountMap: Map<string, number>,
    order: OrderEntity
  ): number {
    const userId = this.stringifyObjectId(order.userId);
    const agentId = order.agentId ? this.stringifyObjectId(order.agentId) : '';

    if (order.agentId) {
      return messageCountMap.get(`${userId}:${agentId}`) ?? 0;
    }

    let total = 0;

    for (const [key, value] of messageCountMap) {
      if (key.startsWith(`${userId}:`)) {
        total += value;
      }
    }

    return total;
  }

  private async resolveOrderAgentUserMessageCount(
    order: OrderEntity
  ): Promise<number> {
    const countMap = await this.resolveAgentUserMessageCounts([order]);

    return this.getAgentUserMessageCount(countMap, order);
  }

  private async rejectRefundRequest(
    order: OrderEntity,
    action: 'not_refund' | 'rejected',
    operator: AdminAuthenticatedPayload
  ): Promise<void> {
    if (order.status !== OrderStatus.refundRequested) {
      throw new AppError(
        'ORDER_NOT_REFUND_REQUESTED',
        '订单当前不是退款申请状态，无法驳回',
        400
      );
    }

    if (order.paymentProvider === ADMIN_MANUAL_PAYMENT_PROVIDER) {
      throw new AppError(
        'ORDER_REFUND_REJECT_UNSUPPORTED',
        '管理端创建订单不支持驳回退款',
        400
      );
    }

    const finalRefund = this.getVoiceMembershipFinalRefund(order);
    const downgrade = this.getVoiceMembershipDowngrade(order);

    if (
      finalRefund?.wechatRefundStatus?.trim().toUpperCase() === 'SUCCESS' ||
      downgrade?.wechatRefundStatus?.trim().toUpperCase() === 'SUCCESS'
    ) {
      throw new AppError(
        'ORDER_REFUND_ALREADY_SUCCESS',
        '该订单微信退款已成功，不能驳回',
        409
      );
    }

    if (
      finalRefund?.status === 'processing' ||
      finalRefund?.status === 'benefits_processing'
    ) {
      throw new AppError(
        'ORDER_REFUND_IN_PROGRESS',
        '该订单微信退款正在处理中，无法驳回',
        409
      );
    }

    if (downgrade?.status === 'processing') {
      throw new AppError(
        'ORDER_REFUND_IN_PROGRESS',
        '该订单会员降级退款处理中，无法驳回',
        409
      );
    }

    const now = new Date();
    const result = await this.orderModel.updateOne(
      {
        _id: order.id,
        status: OrderStatus.refundRequested,
      } as never,
      {
        $set: {
          status: OrderStatus.completed,
          refundRejectedAt: now,
          'snapshot.refundRejection': {
            action,
            operatorId: operator?.sub,
            operatorAccount: operator?.account,
            createdAt: now.toISOString(),
          },
          updatedAt: now,
        },
      } as never
    );

    if (!this.didMongoUpdate(result)) {
      throw new AppError(
        'ORDER_REFUND_STATE_CONFLICT',
        '订单状态已变化，请刷新后重试',
        409
      );
    }

    order.status = OrderStatus.completed;
    order.refundRejectedAt = now;
    order.updatedAt = now;
    await this.refreshOrderEntity(order);
  }

  private async getOrderById(orderId: string): Promise<OrderEntity> {
    if (!MongoObjectId.isValid(orderId)) {
      throw new AppError('INVALID_ORDER_ID', 'order id is invalid', 400);
    }

    const objectId = new MongoObjectId(orderId);
    const order =
      (await this.orderModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.orderModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'order not found', 404);
    }

    return order;
  }

  private async refreshOrderEntity(order: OrderEntity): Promise<OrderEntity> {
    const refreshed = await this.getOrderById(this.stringifyObjectId(order.id));

    if (refreshed !== order) {
      Object.assign(order, refreshed);
    }

    return order;
  }

  private didMongoUpdate(result?: {
    matchedCount?: number;
    modifiedCount?: number;
  }): boolean {
    return Number(result?.matchedCount ?? result?.modifiedCount ?? 0) > 0;
  }

  private async getUserById(userId: string): Promise<UserEntity> {
    const objectId = this.parseObjectId(userId, 'INVALID_USER_ID');
    const user =
      (await this.userModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.userModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user not found', 404);
    }

    return user;
  }

  private isRefundableOrderStatus(status?: OrderStatus): boolean {
    return (
      status === OrderStatus.completed ||
      status === OrderStatus.paid ||
      status === OrderStatus.refundRequested ||
      status === OrderStatus.grantFailed
    );
  }

  private isVipUpgradeOrder(order: OrderEntity): boolean {
    const pricing = order.snapshot?.vipUpgrade;

    if (!pricing || typeof pricing !== 'object') {
      return false;
    }

    const deductedAmount = Number(
      (pricing as Record<string, unknown>).deductedAmount ?? 0
    );

    return Number.isFinite(deductedAmount) && deductedAmount > 0;
  }

  private isRefundableOrderType(orderType?: OrderType): boolean {
    return (
      orderType === OrderType.vipPlan || orderType === OrderType.voicePackage
    );
  }

  private async findVoiceTrainingTaskByOrderId(
    orderId: MongoObjectId
  ): Promise<VoiceTrainingTaskEntity | null> {
    return this.voiceTrainingTaskModel.findOne({
      where: {
        orderId,
      },
    });
  }

  private generateRefundNo(order: OrderEntity): string {
    return `R${order.orderNo}`;
  }

  /**
   * 普通退款单号：默认 `R<orderNo>`；**若该订单此前的退款已被判定失败，必须换新号**。
   *
   * 微信对同一个 refund_order_id 会幂等返回上次那个「受理了却没真正创建」的退款，
   * 沿用旧号会让重试永远无效（2026-10-05 实测：换号后立刻退成功，用旧号纹丝不动）。
   */
  private async buildRetryAwareRefundNo(order: OrderEntity): Promise<string> {
    const base = this.generateRefundNo(order);
    const previous = await this.orderRefundModel.findOne({
      where: {
        originalOrderId: order.id,
        refundType: OrderRefundType.orderRefund,
      } as never,
    } as never);

    if (!previous || previous.status !== OrderRefundStatus.failed) {
      return base;
    }

    return `${base}R${Date.now().toString(36)}`.slice(0, 64);
  }

  private buildRefundOrderId(refundNo: string): MongoObjectId {
    return new MongoObjectId(
      createHash('sha256').update(refundNo).digest('hex').slice(0, 24)
    );
  }

  private generateVoiceMembershipFinalRefundNo(
    order: OrderEntity,
    attempt: number
  ): string {
    const base = this.generateRefundNo(order);

    if (attempt <= 1) {
      return base.slice(0, 64);
    }

    const orderId = this.stringifyObjectId(order.id);

    return `RF${orderId}-${attempt.toString(36)}`;
  }

  private generateVoiceMembershipDowngradeRefundNo(order: OrderEntity): string {
    return `VD${order.orderNo}`;
  }

  private isPaymentSyncSkippedStatus(status?: OrderStatus): boolean {
    return (
      status === OrderStatus.completed ||
      status === OrderStatus.paid ||
      status === OrderStatus.granting ||
      status === OrderStatus.grantFailed ||
      status === OrderStatus.refundRequested ||
      status === OrderStatus.refunded
    );
  }

  private shouldSyncCompletedVirtualGoods(order: OrderEntity): boolean {
    return (
      order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER &&
      order.status === OrderStatus.completed &&
      !this.isVirtualGoodsProvided(order)
    );
  }

  private isVirtualGoodsProvided(order: OrderEntity): boolean {
    return (
      order.virtualGoodsProvideStatus === VirtualGoodsProvideStatus.provided ||
      (!order.virtualGoodsProvideStatus &&
        Boolean(order.virtualGoodsProvidedAt))
    );
  }

  private isWechatTradeClosed(tradeState?: string): boolean {
    return (
      tradeState === 'CLOSED' ||
      tradeState === 'REVOKED' ||
      tradeState === 'PAYERROR'
    );
  }

  private isVirtualPaymentPaid(status?: number): boolean {
    return status === 2 || status === 3 || status === 4;
  }

  private isVirtualPaymentDelivered(status?: number): boolean {
    return status === 4;
  }

  private isVirtualPaymentProvidePending(status?: number): boolean {
    return status === 2 || status === 3;
  }

  private isVirtualPaymentClosed(status?: number): boolean {
    return status === 5 || status === 6 || status === 8;
  }

  private isPaymentExpired(order: OrderEntity, now = new Date()): boolean {
    return Boolean(order.paymentExpiredAt && order.paymentExpiredAt <= now);
  }

  private async closeOrder(
    order: OrderEntity,
    now = new Date()
  ): Promise<void> {
    if (
      this.isPaymentSyncSkippedStatus(order.status) ||
      order.status === OrderStatus.closed
    ) {
      return;
    }

    order.status = OrderStatus.closed;
    order.closedAt = now;
    order.updatedAt = now;
    await this.orderModel.save(order);
  }

  private getVipPlanSnapshot(order: OrderEntity): {
    id: string;
    code: string;
    durationDays?: number;
    lifetime?: boolean;
    entitlementGrants?: Array<{
      type: AgentEntitlementType;
      totalQuota: number;
      durationDays?: number;
    }>;
  } {
    const snapshot = order.snapshot?.vipPlan;

    if (!snapshot || typeof snapshot !== 'object') {
      throw new AppError(
        'VIP_PLAN_SNAPSHOT_MISSING',
        'vip plan snapshot missing'
      );
    }

    const raw = snapshot as Record<string, unknown>;

    return {
      id: String(raw.id ?? ''),
      code: String(raw.code ?? order.targetCode ?? ''),
      durationDays:
        typeof raw.durationDays === 'number' ? raw.durationDays : undefined,
      lifetime: Boolean(raw.lifetime),
      entitlementGrants: this.parseEntitlementGrants(raw.entitlementGrants),
    };
  }

  private getVoicePackageSnapshot(order: OrderEntity): {
    id: string;
    code: string;
    agentId: string;
  } {
    const snapshot = order.snapshot?.voicePackage;

    if (!snapshot || typeof snapshot !== 'object') {
      throw new AppError(
        'VOICE_PACKAGE_SNAPSHOT_MISSING',
        'voice package snapshot missing'
      );
    }

    const raw = snapshot as Record<string, unknown>;
    const agentSnapshot = order.snapshot?.agent as
      | Record<string, unknown>
      | undefined;

    return {
      id: String(raw.id ?? ''),
      code: String(raw.code ?? order.targetCode ?? ''),
      agentId: String(agentSnapshot?.id ?? order.agentId ?? ''),
    };
  }

  private parseEntitlementGrants(value: unknown): Array<{
    type: AgentEntitlementType;
    totalQuota: number;
    durationDays?: number;
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(item => {
        const raw = item && typeof item === 'object' ? item : {};
        const record = raw as Record<string, unknown>;
        return {
          type: record.type as AgentEntitlementType,
          totalQuota:
            typeof record.totalQuota === 'number' ? record.totalQuota : 0,
          durationDays:
            typeof record.durationDays === 'number'
              ? record.durationDays
              : undefined,
        };
      })
      .filter(item => Boolean(item.type) && item.totalQuota > 0);
  }

  private buildVipPlanSnapshot(plan: VipPlanEntity): Record<string, unknown> {
    return {
      id: this.stringifyObjectId(plan.id),
      code: plan.code,
      name: plan.name,
      planGroup: this.normalizePlanGroup(plan.planGroup),
      priceAmount: plan.priceAmount,
      originalPriceAmount: plan.originalPriceAmount,
      currency: plan.currency || 'CNY',
      durationDays: plan.durationDays,
      lifetime: Boolean(plan.lifetime),
      benefits: plan.benefits ?? [],
      entitlementGrants: plan.entitlementGrants ?? [],
      couponGrantAmount: plan.couponGrantAmount,
      voicePackageId: plan.voicePackageId
        ? this.stringifyObjectId(plan.voicePackageId)
        : undefined,
      voicePackageCode: plan.voicePackageCode,
      voicePackageName: plan.voicePackageName,
      virtualPaymentProductId: plan.virtualPaymentProductId,
    };
  }

  private buildVoicePackageSnapshot(
    voicePackage: VoicePackageEntity
  ): Record<string, unknown> {
    return {
      id: this.stringifyObjectId(voicePackage.id),
      code: voicePackage.code,
      name: voicePackage.name,
      priceAmount: voicePackage.priceAmount,
      originalPriceAmount: voicePackage.originalPriceAmount,
      currency: voicePackage.currency || 'CNY',
      deliverables: voicePackage.deliverables ?? [],
      materialRequirement: voicePackage.materialRequirement ?? '',
      estimatedServiceDays: voicePackage.estimatedServiceDays,
      virtualPaymentProductId: voicePackage.virtualPaymentProductId,
    };
  }

  private buildAgentSnapshot(agent: AgentEntity): Record<string, unknown> {
    return {
      id: this.stringifyObjectId(agent.id),
      name: agent.name ?? '',
      avatar: agent.avatar ?? '',
    };
  }

  private calculateExpiredAt(
    currentExpiredAt: Date | undefined,
    paidAt: Date,
    durationDays?: number
  ): Date {
    if (!durationDays) {
      throw new AppError(
        'INVALID_VIP_PLAN_DURATION',
        'vip plan duration is required'
      );
    }

    const base =
      currentExpiredAt && currentExpiredAt > paidAt ? currentExpiredAt : paidAt;

    return new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
  }

  private calculateEntitlementExpiredAt(
    now: Date,
    durationDays: number | undefined,
    membership: UserMembershipEntity
  ): Date | undefined {
    if (durationDays && durationDays > 0) {
      return new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    return membership.lifetime ? undefined : membership.expiredAt;
  }

  private parseObjectId(
    value: string,
    code = 'INVALID_OBJECT_ID'
  ): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(code, 'object id is invalid', 400);
    }

    return new MongoObjectId(value);
  }

  private normalizeOptionalStatus(value?: string): OrderStatus | undefined {
    return Object.values(OrderStatus).includes(value as OrderStatus)
      ? (value as OrderStatus)
      : undefined;
  }

  private normalizeOptionalRefundStatus(
    value?: string
  ): OrderRefundStatus | undefined {
    return Object.values(OrderRefundStatus).includes(value as OrderRefundStatus)
      ? (value as OrderRefundStatus)
      : undefined;
  }

  private normalizeOptionalOrderType(value?: string): OrderType | undefined {
    return Object.values(OrderType).includes(value as OrderType)
      ? (value as OrderType)
      : undefined;
  }

  private normalizeOrderType(value?: string): OrderType {
    if (Object.values(OrderType).includes(value as OrderType)) {
      return value as OrderType;
    }

    throw new AppError('INVALID_ORDER_TYPE', 'order type is invalid', 400);
  }

  private normalizeOptionalSource(value?: string): OrderSource | undefined {
    return Object.values(OrderSource).includes(value as OrderSource)
      ? (value as OrderSource)
      : undefined;
  }

  private normalizeOptionalPaymentType(
    value?: string
  ): 'normal' | 'virtual' | undefined {
    return value === 'normal' || value === 'virtual' ? value : undefined;
  }

  private normalizeOptionalDate(value?: string): Date | undefined {
    const normalizedValue = value?.trim() ?? '';

    if (!normalizedValue) {
      return undefined;
    }

    const date = new Date(normalizedValue);

    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private normalizeOptionalObjectId(value?: string): MongoObjectId | undefined {
    const normalizedValue = value?.trim() ?? '';

    if (!MongoObjectId.isValid(normalizedValue)) {
      return undefined;
    }

    return new MongoObjectId(normalizedValue);
  }

  private normalizeBoolean(value: unknown): boolean {
    return value === true || value === 'true' || value === '1';
  }

  private normalizePositiveInteger(
    rawValue: string | number | undefined,
    fallback: number
  ): number {
    const value = Number(rawValue);

    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }

  private getEntityObjectId(entity: {
    id?: MongoObjectId;
    _id?: MongoObjectId;
  }): MongoObjectId | undefined {
    return entity.id ?? entity._id;
  }

  private generateOrderNo(prefix = 'VIP'): string {
    return `${prefix}${Date.now()}${randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;
  }

  private stringifyObjectId(value?: MongoObjectId | string | null): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    return value.toHexString?.() ?? String(value);
  }

  private formatDate(value?: Date): string | undefined {
    if (!value) {
      return undefined;
    }

    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
