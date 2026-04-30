import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum UserMembershipStatus {
  active = 'active',
  expired = 'expired',
  canceled = 'canceled',
  refunded = 'refunded',
}

@Entity(TableName.user_membership)
export class UserMembershipEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  vipPlanId: MongoObjectId;

  @Column()
  vipPlanCode: string;

  @Column()
  sourceOrderId: MongoObjectId;

  @Column()
  status: UserMembershipStatus;

  @Column()
  startedAt: Date;

  @Column()
  expiredAt?: Date;

  @Column()
  lifetime: boolean;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
