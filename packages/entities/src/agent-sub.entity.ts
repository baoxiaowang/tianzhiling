import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['agentId'], { background: true })
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
