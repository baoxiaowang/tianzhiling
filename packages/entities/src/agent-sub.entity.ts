import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Entity(TableName.agent_sub)
export class AgentSubEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  agentCallMe?: string;

  @Column()
  iCallAgent?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
