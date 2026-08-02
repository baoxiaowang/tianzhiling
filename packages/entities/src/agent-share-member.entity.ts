import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentShareMemberStatus {
  active = 'active',
  revoked = 'revoked',
}

@Index(['agentId', 'userId'], { unique: true, background: true })
@Index(['userId', 'status', 'updatedAt'], { background: true })
@Index(['ownerUserId', 'agentId', 'status'], { background: true })
@Entity(TableName.agent_share_member)
export class AgentShareMemberEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  ownerUserId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  status: AgentShareMemberStatus;

  @Column()
  acceptedInviteId?: MongoObjectId;

  @Column()
  agentCallsUser?: string;

  @Column()
  userCallsAgent?: string;

  @Column()
  acceptedAt: Date;

  @Column()
  revokedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
