import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum ConversationMessageFeedbackType {
  accurate = 'accurate',
  unlike = 'unlike',
  wrongFact = 'wrong_fact',
  fabricated = 'fabricated',
  uncomfortable = 'uncomfortable',
  other = 'other',
}

export enum ConversationMessageFeedbackHandlingStatus {
  pending = 'pending',
  processing = 'processing',
  resolved = 'resolved',
  ignored = 'ignored',
}

@Index(['userId', 'agentId', 'createdAt'], { background: true })
@Index(['conversationId', 'messageId', 'createdAt'], { background: true })
@Entity(TableName.conversation_message_feedback)
export class ConversationMessageFeedbackEntity extends BaseEntity {
  @Column()
  conversationId: MongoObjectId;

  @Column()
  messageId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  type: ConversationMessageFeedbackType;

  @Column()
  content?: string;

  @Column()
  assistantContent?: string;

  /** Historical rows without this field are treated as pending. */
  @Column()
  handlingStatus?: ConversationMessageFeedbackHandlingStatus;

  @Column()
  handlingNote?: string;

  @Column()
  handledBy?: string;

  @Column()
  handledAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
