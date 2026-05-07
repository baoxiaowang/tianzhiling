import { AppError } from '../common/errors';
import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
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
  UserMembershipEntity,
  UserMembershipStatus,
  VipPlanEntity,
  VipPlanStatus,
  VoicePackageEntity,
  VoicePackageStatus,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import type {
  CreateVipPlanOrderDTO,
  CreateVipPlanOrderResultDTO,
  CreateVoicePackageOrderDTO,
  CreateVoicePackageOrderResultDTO,
  OrderRecordDTO,
  UserOrderListDTO,
} from '@tzl/shared';
import { randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import { AuthenticatedUserPayload } from '../interface';
import {
  WechatPayService,
  WechatTransactionPayload,
} from './wechat-pay.service';

const WECHAT_PAY_PROVIDER = 'wechat_pay';
export const ORDER_PAYMENT_EXPIRE_QUEUE = 'order-payment-expire';

export interface OrderPaymentExpireJobData {
  orderId: string;
  orderNo: string;
}

@Provide()
export class OrderService {
  @Logger()
  logger: ILogger;

  @Inject()
  wechatPayService: WechatPayService;

  @Inject()
  bullmqFramework: bullmq.Framework;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @InjectEntityModel(VoicePackageEntity)
  voicePackageModel: MongoRepository<VoicePackageEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

  async createVipPlanOrder(
    auth: AuthenticatedUserPayload,
    payload: CreateVipPlanOrderDTO
  ): Promise<CreateVipPlanOrderResultDTO> {
    const userId = this.parseObjectId(auth.sub);
    const plan = await this.getActiveVipPlanById(payload.vipPlanId);
    const openid = await this.wechatPayService.getOpenidByJsCode(
      payload.jsCode
    );
    const now = new Date();
    const expireAt = new Date(now.getTime() + 30 * 60 * 1000);
    const order = new OrderEntity();

    Object.assign(order, {
      orderNo: this.generateOrderNo(),
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
      currency: plan.currency || 'CNY',
      status: OrderStatus.pending,
      source: OrderSource.weapp,
      paymentProvider: WECHAT_PAY_PROVIDER,
      paymentExpiredAt: expireAt,
      payerOpenid: openid,
      snapshot: {
        vipPlan: this.buildVipPlanSnapshot(plan),
      },
      createdAt: now,
      updatedAt: now,
    });

    const savedOrder = await this.orderModel.save(order);
    const { prepayId, payment } =
      await this.wechatPayService.createVipPlanPrepay({
        orderNo: savedOrder.orderNo,
        title: savedOrder.title,
        amount: savedOrder.payableAmount,
        openid,
        expireAt,
      });

    savedOrder.paymentPrepayId = prepayId;
    savedOrder.updatedAt = new Date();
    const prepayOrder = await this.orderModel.save(savedOrder);
    await this.enqueueOrderPaymentExpireJob(prepayOrder);

    return {
      order: this.buildOrderRecord(prepayOrder),
      payment,
    };
  }

  async createVoicePackageOrder(
    auth: AuthenticatedUserPayload,
    payload: CreateVoicePackageOrderDTO
  ): Promise<CreateVoicePackageOrderResultDTO> {
    const userId = this.parseObjectId(auth.sub);
    const [voicePackage, agent] = await Promise.all([
      this.getActiveVoicePackageById(payload.voicePackageId),
      this.getUserAgentById(userId, payload.agentId),
    ]);
    await this.assertAgentCanBuyVoicePackage(agent.id);

    const openid = await this.wechatPayService.getOpenidByJsCode(
      payload.jsCode
    );
    const now = new Date();
    const expireAt = new Date(now.getTime() + 30 * 60 * 1000);
    const order = new OrderEntity();

    Object.assign(order, {
      orderNo: this.generateOrderNo('VOICE'),
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
      currency: voicePackage.currency || 'CNY',
      status: OrderStatus.pending,
      source: OrderSource.weapp,
      paymentProvider: WECHAT_PAY_PROVIDER,
      paymentExpiredAt: expireAt,
      payerOpenid: openid,
      snapshot: {
        voicePackage: this.buildVoicePackageSnapshot(voicePackage),
        agent: this.buildAgentSnapshot(agent),
      },
      createdAt: now,
      updatedAt: now,
    });

    const savedOrder = await this.orderModel.save(order);
    const { prepayId, payment } =
      await this.wechatPayService.createVipPlanPrepay({
        orderNo: savedOrder.orderNo,
        title: savedOrder.title,
        amount: savedOrder.payableAmount,
        openid,
        expireAt,
      });

    savedOrder.paymentPrepayId = prepayId;
    savedOrder.updatedAt = new Date();
    const prepayOrder = await this.orderModel.save(savedOrder);
    await this.enqueueOrderPaymentExpireJob(prepayOrder);

    return {
      order: this.buildOrderRecord(prepayOrder),
      payment,
    };
  }

  async listUserOrders(
    auth: AuthenticatedUserPayload
  ): Promise<UserOrderListDTO> {
    const userId = this.parseObjectId(auth.sub);
    const orders = await this.orderModel.find({
      where: {
        userId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    return {
      items: orders.map(order => this.buildOrderRecord(order)),
      total: orders.length,
      page: 1,
      pageSize: orders.length,
    };
  }

  async getUserOrder(
    auth: AuthenticatedUserPayload,
    orderId: string
  ): Promise<OrderRecordDTO> {
    const userId = this.parseObjectId(auth.sub);
    const objectId = this.parseObjectId(orderId, 'INVALID_ORDER_ID');
    const order = await this.findOrderById(objectId);

    if (!order || this.stringifyObjectId(order.userId) !== String(userId)) {
      throw new AppError('ORDER_NOT_FOUND', 'order not found', 404);
    }

    return this.buildOrderRecord(order);
  }

  async syncUserOrderPayment(
    auth: AuthenticatedUserPayload,
    orderId: string
  ): Promise<OrderRecordDTO> {
    const userId = this.parseObjectId(auth.sub);
    const objectId = this.parseObjectId(orderId, 'INVALID_ORDER_ID');
    const order = await this.findOrderById(objectId);

    if (!order || this.stringifyObjectId(order.userId) !== String(userId)) {
      throw new AppError('ORDER_NOT_FOUND', 'order not found', 404);
    }

    if (
      order.status === OrderStatus.completed ||
      order.status === OrderStatus.paid ||
      order.status === OrderStatus.granting ||
      order.status === OrderStatus.grantFailed ||
      order.status === OrderStatus.refunded ||
      order.status === OrderStatus.closed
    ) {
      return this.buildOrderRecord(order);
    }

    const transaction = await this.wechatPayService.queryTransactionByOrderNo(
      order.orderNo
    );

    if (!transaction) {
      if (this.isPaymentExpired(order)) {
        await this.closeOrder(order);
      }

      return this.buildOrderRecord(order);
    }

    if (transaction.trade_state === 'SUCCESS') {
      await this.handleWechatPaymentSuccess(transaction);
      const syncedOrder = await this.findOrderById(objectId);

      return this.buildOrderRecord(syncedOrder ?? order);
    }

    if (
      this.isWechatTradeClosed(transaction.trade_state) ||
      this.isPaymentExpired(order)
    ) {
      await this.closeOrder(order);
    }

    return this.buildOrderRecord(order);
  }

  async processPaymentExpireJob(
    data: OrderPaymentExpireJobData
  ): Promise<void> {
    if (!data?.orderId) {
      return;
    }

    await this.closeExpiredWechatOrder(data.orderId);
  }

  async closeExpiredWechatOrder(
    orderId: string
  ): Promise<OrderRecordDTO | null> {
    const objectId = this.parseObjectId(orderId, 'INVALID_ORDER_ID');
    const order = await this.findOrderById(objectId);

    if (!order) {
      this.logger?.warn?.(
        '[order-payment-expire] order not found, orderId=%s',
        orderId
      );
      return null;
    }

    if (this.isFinalOrderStatus(order.status)) {
      return this.buildOrderRecord(order);
    }

    const transaction = await this.wechatPayService.queryTransactionByOrderNo(
      order.orderNo
    );

    if (transaction?.trade_state === 'SUCCESS') {
      await this.handleWechatPaymentSuccess(transaction);
      const syncedOrder = await this.findOrderById(objectId);

      return syncedOrder ? this.buildOrderRecord(syncedOrder) : null;
    }

    const now = new Date();

    if (
      this.isWechatTradeClosed(transaction?.trade_state) ||
      this.isPaymentExpired(order, now)
    ) {
      await this.closeOrder(order, now);
    }

    return this.buildOrderRecord(order);
  }

  async handleWechatPaymentSuccess(
    transaction: WechatTransactionPayload
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
      order.status === OrderStatus.granting
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
      transaction.amount?.payer_total ?? transaction.amount?.total;

    if (!paidAmount || paidAmount !== order.payableAmount) {
      throw new AppError('WECHAT_AMOUNT_MISMATCH', 'wechat amount mismatch');
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

  private async grantVipMembership(order: OrderEntity): Promise<void> {
    const plan = order.targetId
      ? await this.findVipPlanById(order.targetId)
      : null;
    const snapshot = this.getVipPlanSnapshot(order);
    const lifetime = plan?.lifetime ?? Boolean(snapshot.lifetime);
    const durationDays = plan?.durationDays ?? snapshot.durationDays;
    const now = order.paidAt ?? new Date();
    const existing = await this.findActiveMembership(order.userId);
    const membership = existing ?? new UserMembershipEntity();

    membership.userId = order.userId;
    membership.vipPlanId = order.targetId ?? this.parseObjectId(snapshot.id);
    membership.vipPlanCode = order.targetCode || snapshot.code;
    membership.sourceOrderId = order.id;
    membership.status = UserMembershipStatus.active;
    membership.startedAt = existing?.startedAt ?? now;
    membership.lifetime = lifetime;
    membership.expiredAt = lifetime
      ? undefined
      : this.calculateExpiredAt(existing?.expiredAt, now, durationDays);
    membership.createdAt = existing?.createdAt ?? now;
    membership.updatedAt = new Date();

    await this.userMembershipModel.save(membership);
    await this.grantVipEntitlements(order, membership, plan, snapshot, now);
  }

  private async grantVipEntitlements(
    order: OrderEntity,
    membership: UserMembershipEntity,
    plan: VipPlanEntity | null,
    snapshot: {
      entitlementGrants?: Array<{
        type: AgentEntitlementType;
        totalQuota: number;
        durationDays?: number;
      }>;
    },
    now: Date
  ): Promise<void> {
    const entitlementGrants =
      plan?.entitlementGrants ?? snapshot.entitlementGrants ?? [];

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
    const voicePackageId =
      order.targetId ?? this.parseObjectId(snapshot.id, 'INVALID_VOICE_PACKAGE_ID');
    const agentId =
      order.agentId ?? this.parseObjectId(snapshot.agentId, 'INVALID_AGENT_ID');
    const existing = await this.voiceTrainingTaskModel.findOne({
      where: {
        orderId: order.id,
      },
    });

    if (existing) {
      return;
    }

    const now = order.paidAt ?? new Date();
    const task = new VoiceTrainingTaskEntity();
    task.userId = order.userId;
    task.agentId = agentId;
    task.orderId = order.id;
    task.voicePackageId = voicePackageId;
    task.voicePackageCode = order.targetCode || snapshot.code;
    task.status = VoiceTrainingTaskStatus.paid;
    task.assigneeName = '';
    task.materialObjectKeys = [];
    task.remark = '';
    task.paidAt = now;
    task.createdAt = now;
    task.updatedAt = new Date();

    await this.voiceTrainingTaskModel.save(task);
  }

  private isWechatTradeClosed(tradeState?: string): boolean {
    return (
      tradeState === 'CLOSED' ||
      tradeState === 'REVOKED' ||
      tradeState === 'PAYERROR'
    );
  }

  private isFinalOrderStatus(status?: OrderStatus): boolean {
    return (
      status === OrderStatus.completed ||
      status === OrderStatus.paid ||
      status === OrderStatus.granting ||
      status === OrderStatus.grantFailed ||
      status === OrderStatus.refunded ||
      status === OrderStatus.closed
    );
  }

  private isPaymentExpired(order: OrderEntity, now = new Date()): boolean {
    return Boolean(order.paymentExpiredAt && order.paymentExpiredAt <= now);
  }

  private async closeOrder(
    order: OrderEntity,
    now = new Date()
  ): Promise<void> {
    if (this.isFinalOrderStatus(order.status)) {
      return;
    }

    order.status = OrderStatus.closed;
    order.closedAt = now;
    order.updatedAt = now;
    await this.orderModel.save(order);
  }

  private async enqueueOrderPaymentExpireJob(
    order: OrderEntity
  ): Promise<void> {
    if (!order.paymentExpiredAt) {
      return;
    }

    const queue = this.bullmqFramework?.getQueue(ORDER_PAYMENT_EXPIRE_QUEUE);
    const orderId = this.stringifyObjectId(order.id);

    if (!queue) {
      this.logger?.warn?.(
        '[order-payment-expire] queue not found, skip enqueue, orderId=%s',
        orderId
      );
      return;
    }

    try {
      await queue.addJobToQueue(
        {
          orderId,
          orderNo: order.orderNo,
        },
        {
          jobId: `order-payment-expire:${orderId}`,
          delay: Math.max(order.paymentExpiredAt.getTime() - Date.now(), 0),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      );
    } catch (error) {
      this.logger?.warn?.(
        '[order-payment-expire] enqueue failed, orderId=%s, error=%s',
        orderId,
        error instanceof Error ? error.message : String(error)
      );
    }
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
    const plan = await this.findVipPlanById(objectId);

    if (!plan || plan.status !== VipPlanStatus.active) {
      throw new AppError('VIP_PLAN_NOT_FOUND', 'vip plan not found', 404);
    }

    return plan;
  }

  private async getActiveVoicePackageById(
    voicePackageId: string
  ): Promise<VoicePackageEntity> {
    const objectId = this.parseObjectId(
      voicePackageId,
      'INVALID_VOICE_PACKAGE_ID'
    );
    const voicePackage = await this.findVoicePackageById(objectId);

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

  private async assertAgentCanBuyVoicePackage(
    agentId: MongoObjectId
  ): Promise<void> {
    const tasks = await this.voiceTrainingTaskModel.find({
      where: {
        agentId,
        status: {
          $in: [
            VoiceTrainingTaskStatus.paid,
            VoiceTrainingTaskStatus.awaitingMaterial,
            VoiceTrainingTaskStatus.processing,
            VoiceTrainingTaskStatus.training,
          ],
        },
      } as never,
      take: 1,
    });

    if (tasks.length > 0) {
      throw new AppError(
        'VOICE_TRAINING_TASK_EXISTS',
        'voice training task already exists',
        400
      );
    }
  }

  private async findVipPlanById(
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

  private async findVoicePackageById(
    voicePackageId: MongoObjectId
  ): Promise<VoicePackageEntity | null> {
    return (
      (await this.voicePackageModel.findOne({
        where: {
          id: voicePackageId,
        },
      })) ??
      (await this.voicePackageModel.findOne({
        where: {
          _id: voicePackageId,
        } as never,
      }))
    );
  }

  private async findOrderById(
    orderId: MongoObjectId
  ): Promise<OrderEntity | null> {
    return (
      (await this.orderModel.findOne({
        where: {
          id: orderId,
        },
      })) ??
      (await this.orderModel.findOne({
        where: {
          _id: orderId,
        } as never,
      }))
    );
  }

  private buildOrderRecord(order: OrderEntity): OrderRecordDTO {
    return {
      id: this.stringifyObjectId(order.id),
      orderNo: order.orderNo,
      orderType: order.orderType,
      targetId: order.targetId
        ? this.stringifyObjectId(order.targetId)
        : undefined,
      targetCode: order.targetCode,
      agentId: order.agentId ? this.stringifyObjectId(order.agentId) : undefined,
      title: order.title,
      payableAmount: order.payableAmount,
      currency: order.currency || 'CNY',
      status: order.status,
      createdAt: this.formatDate(order.createdAt),
      paidAt: order.paidAt ? this.formatDate(order.paidAt) : undefined,
    };
  }

  private buildVipPlanSnapshot(plan: VipPlanEntity): Record<string, unknown> {
    return {
      id: this.stringifyObjectId(plan.id),
      code: plan.code,
      name: plan.name,
      priceAmount: plan.priceAmount,
      originalPriceAmount: plan.originalPriceAmount,
      currency: plan.currency || 'CNY',
      durationDays: plan.durationDays,
      lifetime: Boolean(plan.lifetime),
      benefits: plan.benefits ?? [],
      entitlementGrants: plan.entitlementGrants ?? [],
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
    };
  }

  private buildAgentSnapshot(agent: AgentEntity): Record<string, unknown> {
    return {
      id: this.stringifyObjectId(agent.id),
      name: agent.name ?? '',
      avatar: agent.avatar ?? '',
    };
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

  private generateOrderNo(prefix = 'VIP'): string {
    return `${prefix}${Date.now()}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private parseObjectId(value: string, code = 'INVALID_TOKEN'): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(
        code,
        'object id is invalid',
        code === 'INVALID_TOKEN' ? 401 : 400
      );
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private formatDate(value: Date): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
