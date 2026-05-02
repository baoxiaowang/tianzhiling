import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentMembershipStatus {
  active = 'active',
  expired = 'expired',
  canceled = 'canceled',
  refunded = 'refunded',
}

@Entity(TableName.agent_membership)
export class AgentMembershipEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  vipPlanId: MongoObjectId;

  @Column()
  vipPlanCode: string;

  @Column()
  sourceOrderId: MongoObjectId;

  @Column()
  status: AgentMembershipStatus;

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
