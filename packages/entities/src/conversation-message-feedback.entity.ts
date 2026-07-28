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

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
