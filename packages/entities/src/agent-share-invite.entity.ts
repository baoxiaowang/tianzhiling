import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentShareInviteStatus {
  active = 'active',
  revoked = 'revoked',
}

@Index(['tokenHash'], { unique: true, background: true })
@Index(['agentId', 'status', 'expiresAt'], { background: true })
@Index(['createdByUserId', 'updatedAt'], { background: true })
@Entity(TableName.agent_share_invite)
export class AgentShareInviteEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  ownerUserId: MongoObjectId;

  @Column()
  createdByUserId: MongoObjectId;

  @Column()
  tokenHash: string;

  @Column()
  status: AgentShareInviteStatus;

  @Column()
  expiresAt: Date;

  @Column()
  acceptedCount?: number;

  @Column()
  lastAcceptedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
