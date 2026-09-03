import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";
import { OrderSource, OrderType } from "./order.entity";

export enum OrderRefundType {
  orderRefund = "order_refund",
  voiceMembershipDowngrade = "voice_membership_downgrade",
  voiceMembershipFinalRefund = "voice_membership_final_refund",
}

export enum OrderRefundStatus {
  processing = "processing",
  completed = "completed",
  failed = "failed",
}

@Index(["refundNo"], { unique: true, background: true })
@Index(["originalOrderId", "completedAt"], { background: true })
@Index(["userId", "completedAt"], { background: true })
@Index(["status", "completedAt"], { background: true })
@Entity(TableName.order_refund)
export class OrderRefundEntity extends BaseEntity {
  @Column()
  refundNo: string;

  @Column()
  originalOrderId: MongoObjectId;

  @Column()
  originalOrderNo: string;

  @Column()
  userId: MongoObjectId;

  @Column()
  orderType: OrderType;

  @Column()
  targetCode?: string;

  @Column()
  refundType: OrderRefundType;

  @Column()
  amount: number;

  @Column()
  currency: string;

  @Column()
  status: OrderRefundStatus;

  @Column()
  source: OrderSource;

  @Column()
  paymentProvider?: string;

  @Column()
  paymentRefundId?: string;

  @Column()
  requestedAt: Date;

  @Column()
  completedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
