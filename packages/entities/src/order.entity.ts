import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum OrderType {
  vipPlan = 'vip_plan',
  voicePackage = 'voice_package',
}

export enum OrderStatus {
  pending = 'pending',
  paid = 'paid',
  granting = 'granting',
  completed = 'completed',
  closed = 'closed',
  refundRequested = 'refund_requested',
  refunded = 'refunded',
  grantFailed = 'grant_failed',
}

export enum OrderSource {
  app = 'app',
  weapp = 'weapp',
  admin = 'admin',
}

export enum VirtualGoodsProvideStatus {
  pending = 'pending',
  provided = 'provided',
  failed = 'failed',
}

@Index(['orderNo'], { unique: true, background: true })
@Index(['userId', 'createdAt'], { background: true })
@Index(['status', 'paymentExpiredAt'], { background: true })
@Index(['paymentTradeNo'], { unique: true, sparse: true, background: true })
@Entity(TableName.order)
export class OrderEntity extends BaseEntity {
  @Column()
  orderNo: string;

  @Column()
  userId: MongoObjectId;

  @Column()
  orderType: OrderType;

  @Column()
  targetId?: MongoObjectId;

  @Column()
  targetCode?: string;

  @Column()
  agentId?: MongoObjectId;

  @Column()
  title: string;

  @Column()
  amount: number;

  @Column()
  discountAmount: number;

  @Column()
  couponAmount: number;

  @Column()
  payableAmount: number;

  @Column()
  paidAmount?: number;

  @Column()
  refundAmount?: number;

  @Column()
  currency: string;

  @Column()
  status: OrderStatus;

  @Column()
  source: OrderSource;

  @Column()
  paymentProvider?: string;

  /**
   * 是否计入财务统计（收入 / 净收入 / 推广报表）。
   * 后台手动创建的补单默认不计（避免把人工补单当真实流水），运营勾选后按正常订单计入。
   */
  @Column()
  includeInFinance?: boolean;

  @Column()
  paymentPrepayId?: string;

  @Column()
  paymentExpiredAt?: Date;

  @Column()
  payerOpenid?: string;

  @Column()
  paymentTradeNo?: string;

  @Column()
  paymentNotifyAt?: Date;

  @Column()
  virtualPaymentProductId?: string;

  @Column()
  virtualPaymentEnv?: number;

  @Column()
  virtualGoodsProvideStatus?: VirtualGoodsProvideStatus;

  @Column()
  virtualGoodsProvidedAt?: Date;

  @Column()
  virtualGoodsProvideFailedAt?: Date;

  @Column()
  virtualGoodsProvideError?: string;

  @Column()
  snapshot?: Record<string, unknown>;

  @Column()
  paidAt?: Date;

  /** 付款时快照的用户与逝去亲人关系（如"父女"/"母子"/"夫妻"），识别后稳定不变 */
  @Column()
  relationship?: string;

  @Column()
  closedAt?: Date;

  @Column()
  refundedAt?: Date;

  @Column()
  refundRequestedAt?: Date;

  @Column()
  refundRejectedAt?: Date;

  /** 管理端确认开始提供声音服务的时间；未确认时保持待服务。 */
  @Column()
  voiceServiceStartedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
