import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentEntitlementType {
  voiceModel = 'voice_model',
  chatImport = 'chat_import',
  interview = 'interview',
  familySeat = 'family_seat',
}

export enum AgentEntitlementStatus {
  available = 'available',
  used = 'used',
  expired = 'expired',
  refunded = 'refunded',
}

@Entity(TableName.agent_entitlement)
export class AgentEntitlementEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId?: MongoObjectId;

  @Column()
  type: AgentEntitlementType;

  @Column()
  totalQuota: number;

  @Column()
  usedQuota: number;

  @Column()
  status: AgentEntitlementStatus;

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
