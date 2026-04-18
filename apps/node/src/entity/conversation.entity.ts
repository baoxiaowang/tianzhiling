import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Entity(TableName.conversation)
export class ConversationEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  subAgentId?: MongoObjectId;

  @Column()
  userId: MongoObjectId; // 用户id

  @Column()
  createdAt: Date; // 创建时间

  @Column()
  updatedAt: Date; // 更新时间
}
