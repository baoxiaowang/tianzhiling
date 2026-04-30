import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Entity(TableName.conversation)
export class ConversationEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  subAgentId?: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
