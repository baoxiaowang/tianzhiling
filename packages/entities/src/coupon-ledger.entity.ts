import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum CouponLedgerType {
  grant = 'grant',
  consume = 'consume',
  refund = 'refund',
  adjust = 'adjust',
}

export enum CouponLedgerStatus {
  effective = 'effective',
  voided = 'voided',
}

@Index(['userId', 'occurredAt'], { background: true })
@Index(['relatedOrderId'], { sparse: true, background: true })
@Index(['sourceOrderId'], { sparse: true, background: true })
@Entity(TableName.coupon_ledger)
export class CouponLedgerEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  type: CouponLedgerType;

  @Column()
  amount: number;

  @Column()
  balanceAfter?: number;

  @Column()
  relatedOrderId?: MongoObjectId;

  @Column()
  sourceOrderId?: MongoObjectId;

  @Column()
  description?: string;

  @Column()
  status: CouponLedgerStatus;

  @Column()
  occurredAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
