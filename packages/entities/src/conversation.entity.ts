import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['userId', 'updatedAt'], { background: true })
@Index(['agentId', 'userId'], { background: true })
@Index(['subAgentId'], { sparse: true, background: true })
@Entity(TableName.conversation)
export class ConversationEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  subAgentId?: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  accessRole?: 'owner' | 'shared';

  @Column()
  agentCallsUser?: string;

  @Column()
  userCallsAgent?: string;

  @Column()
  continuitySummary?: string;

  @Column()
  continuitySummaryCoveredMessageId?: MongoObjectId;

  @Column()
  continuitySummaryEvidenceMessageIds?: MongoObjectId[];

  @Column()
  continuitySummaryVersion?: string;

  @Column()
  continuitySummaryUpdatedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
