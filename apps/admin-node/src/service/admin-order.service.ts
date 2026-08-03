import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { randomBytes } from 'crypto';
import type {
  AdminAuthenticatedPayload,
  AdminOrderListDTO,
  AdminOrderRecordDTO,
  AdminOrderUserDTO,
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
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
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

const WECHAT_PAY_PROVIDER = 'wechat_pay';
const WECHAT_VIRTUAL_PAY_PROVIDER = 'wechat_virtual_pay';
const ADMIN_MANUAL_PAYMENT_PROVIDER = 'admin_manual';
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
}

@Provide()
export class AdminOrderService {
  @Logger()
  logger: ILogger;

  @Inject()
  adminWechatPayService: AdminWechatPayService;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

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

  async listOrders(query: ListAdminOrdersQueryDTO): Promise<AdminOrderListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const where = await this.buildSearchWhere(query);
    const [total, orders] = await Promise.all([
      this.orderModel.count(where),
      this.orderModel.find({
        where: where as never,
        order: {
          createdAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const userMap = await this.getOrderUserMap(orders);

    return {
      items: orders.map(order => this.buildOrderRecord(order, userMap)),
      total,
      page,
      pageSize,
    };
  }

  async createOrder(payload: CreateAdminOrderDTO): Promise<AdminOrderRecordDTO> {
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

    return this.buildOrderRecord(order, userMap);
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

    const targetEntity = await this.getActiveVipPlanById(targetPlan.id);
    const now = new Date();
    const downgrade: VoiceMembershipDowngradeSnapshot = {
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

    this.setVoiceMembershipDowngrade(order, downgrade);
    order.updatedAt = now;
    await this.orderModel.save(order);

    try {
      const refund = await this.adminWechatPayService.refundOrder({
        orderNo: order.orderNo,
        refundNo: downgrade.refundNo,
        reason: VOICE_MEMBERSHIP_DOWNGRADE_REASON,
        amount: downgrade.refundAmount,
        totalAmount: order.paidAmount ?? order.payableAmount,
      });

      await this.applyVoiceMembershipDowngradeRefundStatus(
        order,
        downgrade,
        refund
      );
    } catch (error) {
      downgrade.status = downgrade.refundRecordedAt
        ? 'benefits_failed'
        : 'failed';
      downgrade.failureReason = this.getOperationFailureReason(error);
      downgrade.updatedAt = new Date().toISOString();
      this.setVoiceMembershipDowngrade(order, downgrade);
      order.updatedAt = new Date();
      await this.orderModel.save(order);
    }

    const userMap = await this.getOrderUserMap([order]);

    return this.buildOrderRecord(order, userMap);
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

    if (downgrade.status !== 'completed') {
      const refund = await this.adminWechatPayService.queryRefundByRefundNo(
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

    const userMap = await this.getOrderUserMap([order]);

    return this.buildOrderRecord(order, userMap);
  }

  private async applyVoiceMembershipDowngradeRefundStatus(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    refund: WechatRefundPayload
  ): Promise<void> {
    const status = refund.status?.trim().toUpperCase() || 'PROCESSING';
    const now = new Date();

    downgrade.wechatRefundId = refund.refund_id || downgrade.wechatRefundId;
    downgrade.wechatRefundStatus = status;
    downgrade.failureReason = undefined;
    downgrade.updatedAt = now.toISOString();

    if (status === 'SUCCESS') {
      await this.completeVoiceMembershipDowngrade(order, downgrade);
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

    this.setVoiceMembershipDowngrade(order, downgrade);
    order.updatedAt = now;
    await this.orderModel.save(order);
  }

  private async completeVoiceMembershipDowngrade(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot
  ): Promise<void> {
    const now = new Date();

    if (!downgrade.refundRecordedAt) {
      order.refundAmount =
        (order.refundAmount ?? 0) + downgrade.refundAmount;
      downgrade.refundRecordedAt = now.toISOString();
      downgrade.updatedAt = now.toISOString();
      this.setVoiceMembershipDowngrade(order, downgrade);
      order.updatedAt = now;
      await this.orderModel.save(order);
    }

    try {
      await this.applyVoiceMembershipDowngradeBenefits(order, downgrade, now);
    } catch (error) {
      downgrade.status = 'benefits_failed';
      downgrade.failureReason = this.getOperationFailureReason(error);
      downgrade.updatedAt = new Date().toISOString();
      this.setVoiceMembershipDowngrade(order, downgrade);
      order.updatedAt = new Date();
      await this.orderModel.save(order);
      return;
    }

    downgrade.status = 'completed';
    downgrade.completedAt = now.toISOString();
    downgrade.failureReason = undefined;
    downgrade.updatedAt = now.toISOString();
    this.setVoiceMembershipDowngrade(order, downgrade);
    order.updatedAt = now;
    await this.orderModel.save(order);
  }

  private async applyVoiceMembershipDowngradeBenefits(
    order: OrderEntity,
    downgrade: VoiceMembershipDowngradeSnapshot,
    now: Date
  ): Promise<void> {
    const membership = await this.userMembershipModel.findOne({
      where: {
        sourceOrderId: order.id,
      },
    });

    if (!membership) {
      throw new AppError(
        'VOICE_MEMBERSHIP_DOWNGRADE_MEMBERSHIP_NOT_FOUND',
        '未找到这笔订单对应的会员记录',
        409
      );
    }

    const targetPlanId = this.parseObjectId(
      downgrade.targetPlan.id,
      'INVALID_VIP_PLAN_ID'
    );
    membership.vipPlanId = targetPlanId;
    membership.vipPlanCode = downgrade.targetPlan.code;
    membership.status = UserMembershipStatus.active;
    membership.updatedAt = now;
    await this.userMembershipModel.save(membership);

    await this.reconcileDowngradedMembershipEntitlements(
      order,
      membership,
      downgrade.targetPlanSnapshot,
      now
    );
    await this.revokeDowngradedMembershipVoiceBindings(
      order,
      membership,
      now
    );
  }

  private async reconcileDowngradedMembershipEntitlements(
    order: OrderEntity,
    membership: UserMembershipEntity,
    targetPlanSnapshot: Record<string, unknown>,
    now: Date
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
      entitlement.expiredAt = this.calculateEntitlementExpiredAt(
        order.paidAt ?? membership.startedAt,
        grant.durationDays,
        membership
      );
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
    membership: UserMembershipEntity,
    now: Date
  ): Promise<void> {
    const orderId = this.stringifyObjectId(order.id);
    const membershipId = this.stringifyObjectId(membership.id);
    const entitlements = await this.agentEntitlementModel.find({
      where: {
        sourceOrderId: order.id,
      },
    });
    const accessReferenceIds = new Set([
      orderId,
      membershipId,
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

    return this.buildOrderRecord(order, userMap);
  }

  async syncPaymentStatus(orderId: string): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);

    if (
      this.isPaymentSyncSkippedStatus(order.status) &&
      !this.shouldSyncCompletedVirtualGoods(order)
    ) {
      const userMap = await this.getOrderUserMap([order]);

      return this.buildOrderRecord(order, userMap);
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

    return this.buildOrderRecord(syncedOrder, userMap);
  }

  private async syncWechatPaymentOrder(order: OrderEntity): Promise<void> {
    const transaction = await this.adminWechatPayService.queryTransactionByOrderNo(
      order.orderNo
    );

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

    if (this.isVirtualPaymentClosed(virtualOrder.status)) {
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
    if (order.status === OrderStatus.refunded) {
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

    const voiceMembershipDowngrade = this.getVoiceMembershipDowngrade(order);

    if (voiceMembershipDowngrade) {
      throw new AppError(
        'ORDER_HAS_VOICE_MEMBERSHIP_DOWNGRADE',
        '这笔订单已有声音版降级退款，不能再按整单金额退款',
        400
      );
    }

    const refundAmount = order.paidAmount ?? order.payableAmount;

    if (!refundAmount || refundAmount <= 0) {
      throw new AppError(
        'ORDER_REFUND_AMOUNT_INVALID',
        'order refund amount is invalid',
        400
      );
    }

    await this.assertRefundableOrderBenefits(order);

    if (order.paymentProvider === ADMIN_MANUAL_PAYMENT_PROVIDER) {
      throw new AppError(
        'ORDER_REFUND_PROVIDER_UNSUPPORTED',
        'admin manual order cannot be refunded',
        400
      );
    } else if (order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER) {
      await this.refundVirtualPaymentOrder(order, refundAmount, reason);
    } else {
      await this.adminWechatPayService.refundOrder({
        orderNo: order.orderNo,
        refundNo: this.generateRefundNo(order),
        reason,
        amount: refundAmount,
        totalAmount: order.paidAmount ?? order.payableAmount,
      });
    }

    const now = new Date();
    await this.revokeOrderBenefits(order, now);

    order.status = OrderStatus.refunded;
    order.refundAmount = refundAmount;
    order.refundedAt = now;
    order.updatedAt = now;
    await this.orderModel.save(order);
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

  private async refundVirtualPaymentOrder(
    order: OrderEntity,
    refundAmount: number,
    reason: string
  ): Promise<void> {
    if (!order.payerOpenid) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_OPENID_MISSING',
        'wechat virtual pay openid missing',
        500
      );
    }

    await this.adminWechatPayService.refundVirtualOrder({
      openid: order.payerOpenid,
      orderNo: order.orderNo,
      refundNo: this.generateRefundNo(order),
      leftFee: order.paidAmount ?? refundAmount,
      refundFee: refundAmount,
      reason,
      env:
        order.virtualPaymentEnv ??
        this.adminWechatPayService.getVirtualPayEnv(),
    });
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
    const membership = await this.userMembershipModel.findOne({
      where: {
        sourceOrderId: order.id,
      },
    });

    if (membership && membership.status !== UserMembershipStatus.refunded) {
      membership.status = UserMembershipStatus.refunded;
      membership.updatedAt = now;
      await this.userMembershipModel.save(membership);
    }

    const entitlements = await this.agentEntitlementModel.find({
      where: {
        sourceOrderId: order.id,
      },
    });

    for (const entitlement of entitlements) {
      if (entitlement.status === AgentEntitlementStatus.refunded) {
        continue;
      }

      entitlement.status = AgentEntitlementStatus.refunded;
      entitlement.updatedAt = now;
      await this.agentEntitlementModel.save(entitlement);
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
      : this.calculateExpiredAt(existing?.expiredAt, now, snapshot.durationDays);
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

    if (!agent || this.stringifyObjectId(agent.createdUserId) !== String(userId)) {
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

  private appendTaskRemark(remark: string | undefined, nextRemark: string): string {
    const current = remark?.trim();

    return current ? `${current}\n${nextRemark}` : nextRemark;
  }

  private async buildSearchWhere(
    query: ListAdminOrdersQueryDTO
  ): Promise<MongoWhere> {
    const where: MongoWhere = {};
    const status = this.normalizeOptionalStatus(query?.status);
    const orderType = this.normalizeOptionalOrderType(query?.orderType);
    const source = this.normalizeOptionalSource(query?.source);
    const paymentType = this.normalizeOptionalPaymentType(query?.paymentType);
    const excludeAdminManual = this.normalizeBoolean(query?.excludeAdminManual);
    const createdAtStart = this.normalizeOptionalDate(query?.createdAtStart);
    const createdAtEnd = this.normalizeOptionalDate(query?.createdAtEnd);
    const userId = this.normalizeOptionalObjectId(query?.userId);
    const keyword = query?.keyword?.trim() ?? '';

    if (status) {
      where.status = status;
    }

    if (orderType) {
      where.orderType = orderType;
    }

    if (source) {
      where.source = source;
    }

    if (paymentType === 'virtual') {
      where.paymentProvider = WECHAT_VIRTUAL_PAY_PROVIDER;
    } else if (paymentType === 'normal') {
      where.paymentProvider = excludeAdminManual
        ? {
            $nin: [WECHAT_VIRTUAL_PAY_PROVIDER, ADMIN_MANUAL_PAYMENT_PROVIDER],
          }
        : { $ne: WECHAT_VIRTUAL_PAY_PROVIDER };
    } else if (excludeAdminManual) {
      where.paymentProvider = { $ne: ADMIN_MANUAL_PAYMENT_PROVIDER };
    }

    if (createdAtStart || createdAtEnd) {
      const createdAtQuery: Record<string, Date> = {};

      if (createdAtStart) {
        createdAtQuery.$gte = createdAtStart;
      }

      if (createdAtEnd) {
        createdAtQuery.$lte = createdAtEnd;
      }

      where.createdAt = createdAtQuery;
    }

    if (userId) {
      where.userId = userId;
    }

    if (!keyword) {
      return where;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const keywordFilters: MongoWhere[] = [
      { orderNo: { $regex: escapedKeyword, $options: 'i' } },
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

      keywordFilters.push({ id: objectId });
      keywordFilters.push({ _id: objectId });
      keywordFilters.push({ userId: objectId });
      keywordFilters.push({ targetId: objectId });
    }

    if (Object.keys(where).length === 0) {
      return {
        $or: keywordFilters,
      };
    }

    return {
      $and: [where, { $or: keywordFilters }],
    };
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
      code: String(rawSnapshot.code ?? storedPlan?.code ?? order.targetCode ?? ''),
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
      order.paymentProvider !== WECHAT_PAY_PROVIDER
    ) {
      return order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER
        ? '微信虚拟支付订单暂不支持部分退款降级'
        : '这笔订单不是可部分退款的微信支付订单';
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

    return /声音版|含声音|声音会员|语音版/.test(normalizedTitle);
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
    return (error instanceof Error ? error.message : String(error)).slice(0, 300);
  }

  private buildOrderRecord(
    order: OrderEntity,
    userMap: Map<string, AdminOrderUserDTO>
  ): AdminOrderRecordDTO {
    const userId = this.stringifyObjectId(order.userId);
    const voiceMembershipDowngrade = this.getVoiceMembershipDowngrade(order);

    return {
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
      vipPlanGroup: this.resolveOrderVipPlanGroup(order),
      voiceMembershipDowngrade: voiceMembershipDowngrade
        ? this.buildVoiceMembershipDowngradeRecord(voiceMembershipDowngrade)
        : undefined,
      updatedAt: this.formatDate(order.updatedAt),
    };
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

  private generateVoiceMembershipDowngradeRefundNo(
    order: OrderEntity
  ): string {
    return `VD${order.orderNo}`;
  }

  private isPaymentSyncSkippedStatus(status?: OrderStatus): boolean {
    return (
      status === OrderStatus.completed ||
      status === OrderStatus.paid ||
      status === OrderStatus.granting ||
      status === OrderStatus.grantFailed ||
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
      (!order.virtualGoodsProvideStatus && Boolean(order.virtualGoodsProvidedAt))
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

  private parseObjectId(value: string, code = 'INVALID_OBJECT_ID'): MongoObjectId {
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
