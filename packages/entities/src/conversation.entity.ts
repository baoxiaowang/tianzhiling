import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export type ConversationRecognitionTaskId =
  | 'departure_interval'
  | 'family_status';

export type ConversationRecognitionTaskStatus =
  | 'pending'
  | 'asked'
  | 'completed'
  | 'skipped';

export interface ConversationRecognitionTaskState {
  id: ConversationRecognitionTaskId;
  status: ConversationRecognitionTaskStatus;
  askedAt?: Date;
  askedAssistantMessageId?: MongoObjectId;
  completedAt?: Date;
  answerMessageId?: MongoObjectId;
}

export interface ConversationRecognitionJourney {
  version: 'recognition_journey_v1';
  stage: 'pending' | 'active' | 'settled';
  tasks: ConversationRecognitionTaskState[];
  startedAt?: Date;
  settledAt?: Date;
}

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

  /**
   * A per-user, durable reunion journey. Tasks are suggestions for the model,
   * never a reply state machine. Once a task is visibly asked it remains in
   * the waiting state and must not be asked again.
   */
  @Column({ type: 'json', nullable: true })
  recognitionJourney?: ConversationRecognitionJourney;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
