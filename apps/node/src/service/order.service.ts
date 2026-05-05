import { AppError } from '../common/errors';
import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
import {
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
} from '@tzl/entities';
import type {
  CreateVipPlanOrderDTO,
  CreateVipPlanOrderResultDTO,
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

  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

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
      await this.grantVipMembership(order);
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

  private generateOrderNo(): string {
    return `VIP${Date.now()}${randomBytes(4).toString('hex').toUpperCase()}`;
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
