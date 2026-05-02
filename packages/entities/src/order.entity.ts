import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum OrderType {
  vipPlan = 'vip_plan',
}

export enum OrderStatus {
  pending = 'pending',
  paid = 'paid',
  granting = 'granting',
  completed = 'completed',
  closed = 'closed',
  refunded = 'refunded',
  grantFailed = 'grant_failed',
}

export enum OrderSource {
  app = 'app',
  weapp = 'weapp',
  admin = 'admin',
}

@Entity(TableName.order)
export class OrderEntity extends BaseEntity {
  @Column()
  orderNo: string;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId?: MongoObjectId;

  @Column()
  orderType: OrderType;

  @Column()
  targetId?: MongoObjectId;

  @Column()
  targetCode?: string;

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
  snapshot?: Record<string, unknown>;

  @Column()
  paidAt?: Date;

  @Column()
  closedAt?: Date;

  @Column()
  refundedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
