import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type {
  AdminOrderListDTO,
  AdminOrderRecordDTO,
  AdminOrderUserDTO,
} from '@tzl/shared';
import { AppError } from '@tzl/shared';
import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { ListAdminOrdersQueryDTO } from '../dto/admin-order.dto';
import { AdminWechatPayService } from './admin-wechat-pay.service';

type MongoWhere = Record<string, unknown>;

const WECHAT_VIRTUAL_PAY_PROVIDER = 'wechat_virtual_pay';

@Provide()
export class AdminOrderService {
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

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

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

  async refundOrder(orderId: string): Promise<AdminOrderRecordDTO> {
    const order = await this.getOrderById(orderId);

    await this.refundPaidOrder(order, '管理端退订退款');
    const userMap = await this.getOrderUserMap([order]);

    return this.buildOrderRecord(order, userMap);
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

    const refundAmount = order.paidAmount ?? order.payableAmount;

    if (!refundAmount || refundAmount <= 0) {
      throw new AppError(
        'ORDER_REFUND_AMOUNT_INVALID',
        'order refund amount is invalid',
        400
      );
    }

    await this.assertRefundableOrderBenefits(order);

    if (order.paymentProvider === WECHAT_VIRTUAL_PAY_PROVIDER) {
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

  private async buildSearchWhere(
    query: ListAdminOrdersQueryDTO
  ): Promise<MongoWhere> {
    const where: MongoWhere = {};
    const status = this.normalizeOptionalStatus(query?.status);
    const orderType = this.normalizeOptionalOrderType(query?.orderType);
    const source = this.normalizeOptionalSource(query?.source);
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

  private buildOrderRecord(
    order: OrderEntity,
    userMap: Map<string, AdminOrderUserDTO>
  ): AdminOrderRecordDTO {
    const userId = this.stringifyObjectId(order.userId);

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
      paymentExpiredAt: this.formatDate(order.paymentExpiredAt),
      createdAt: this.formatDate(order.createdAt),
      paidAt: this.formatDate(order.paidAt),
      closedAt: this.formatDate(order.closedAt),
      refundedAt: this.formatDate(order.refundedAt),
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

  private isRefundableOrderStatus(status?: OrderStatus): boolean {
    return (
      status === OrderStatus.completed ||
      status === OrderStatus.paid ||
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

  private normalizeOptionalSource(value?: string): OrderSource | undefined {
    return Object.values(OrderSource).includes(value as OrderSource)
      ? (value as OrderSource)
      : undefined;
  }

  private normalizeOptionalObjectId(value?: string): MongoObjectId | undefined {
    const normalizedValue = value?.trim() ?? '';

    if (!MongoObjectId.isValid(normalizedValue)) {
      return undefined;
    }

    return new MongoObjectId(normalizedValue);
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
