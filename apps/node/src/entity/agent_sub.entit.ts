import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base'



@Entity(TableName.agent_sub)
export class AgentEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  // agent 称呼我为
  @Column()
  agentCallMe?: string;

  // 我称呼 agent 为
  @Column()
  iCallAgent?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
