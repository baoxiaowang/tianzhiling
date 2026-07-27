import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum MessageRole {
  user = 'user',
  assistant = 'assistant',
  system = 'system',
}

export enum MessageStatus {
  sent = 'sent',
  failed = 'failed',
}

export enum MessageType {
  text = 'text',
  voice = 'voice',
  image = 'image',
}

@Index(['conversationId', 'createdAt'], { background: true })
@Index(['userId', 'createdAt'], { background: true })
@Index(['agentId', 'userId', 'createdAt'], { background: true })
@Index(['conversationId', 'isArchived', 'createdAt'], { background: true })
@Index(['conversationId', 'replyGroupId', 'replySegmentIndex'], {
  background: true,
})
@Entity(TableName.message)
export class MessageEntity extends BaseEntity {
  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  role: MessageRole;

  @Column()
  type: MessageType;

  @Column()
  content: string;

  @Column()
  status: MessageStatus;

  @Column()
  isArchived?: boolean;

  @Column()
  archivedAt?: Date;

  @Column()
  replyGroupId?: string;

  @Column()
  replySegmentIndex?: number;

  @Column()
  quotedMessageId?: MongoObjectId;

  @Column()
  quotedMessageRole?: MessageRole;

  @Column()
  quotedMessageContent?: string;

  @Column()
  mediaObjectKey?: string;

  @Column()
  mediaUrl?: string;

  @Column()
  mediaMimeType?: string;

  @Column()
  mediaAnalysis?: string;

  @Column()
  mediaTranscript?: string;

  @Column()
  mediaDurationMs?: number;

  @Column()
  model?: string;

  @Column()
  promptTokens?: number;

  @Column()
  completionTokens?: number;

  @Column()
  totalTokens?: number;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
