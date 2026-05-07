import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum VoiceTrainingTaskStatus {
  paid = 'paid',
  awaitingMaterial = 'awaiting_material',
  processing = 'processing',
  training = 'training',
  completed = 'completed',
  failed = 'failed',
  refunded = 'refunded',
}

@Index(['orderId'], { unique: true, background: true })
@Index(['agentId', 'status', 'updatedAt'], { background: true })
@Index(['userId', 'updatedAt'], { background: true })
@Index(['status', 'updatedAt'], { background: true })
@Entity(TableName.voice_training_task)
export class VoiceTrainingTaskEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  orderId: MongoObjectId;

  @Column()
  voicePackageId: MongoObjectId;

  @Column()
  voicePackageCode: string;

  @Column()
  status: VoiceTrainingTaskStatus;

  @Column()
  assigneeName?: string;

  @Column()
  materialObjectKeys?: string[];

  @Column()
  voiceTimbreId?: MongoObjectId;

  @Column()
  remark?: string;

  @Column()
  paidAt?: Date;

  @Column()
  completedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
