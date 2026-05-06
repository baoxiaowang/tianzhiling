import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum UserMembershipStatus {
  active = 'active',
  expired = 'expired',
  canceled = 'canceled',
  refunded = 'refunded',
}

@Index(['userId', 'status', 'updatedAt'], { background: true })
@Index(['userId', 'status', 'expiredAt'], { background: true })
@Index(['sourceOrderId'], { background: true })
@Index(['vipPlanId'], { background: true })
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
