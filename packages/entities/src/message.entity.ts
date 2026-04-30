import { Column, Entity } from 'typeorm';
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

@Entity(TableName.message)
export class MessageEntity extends BaseEntity {
  @Column()
  conversationId: MongoObjectId;

  @Column()
  role: MessageRole;

  @Column()
  type: MessageType;

  @Column()
  content: string;

  @Column()
  status: MessageStatus;

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
