import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum UserEntitlementType {
  voiceModel = 'voice_model',
  chatImport = 'chat_import',
  interview = 'interview',
  familySeat = 'family_seat',
}

export enum UserEntitlementStatus {
  available = 'available',
  used = 'used',
  expired = 'expired',
  refunded = 'refunded',
}

@Entity(TableName.user_entitlement)
export class UserEntitlementEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId?: MongoObjectId;

  @Column()
  type: UserEntitlementType;

  @Column()
  totalQuota: number;

  @Column()
  usedQuota: number;

  @Column()
  status: UserEntitlementStatus;

  @Column()
  sourceOrderId?: MongoObjectId;

  @Column()
  sourceVipPlanId?: MongoObjectId;

  @Column()
  activatedAt?: Date;

  @Column()
  expiredAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
