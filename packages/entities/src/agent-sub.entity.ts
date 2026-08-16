import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['agentId'], { background: true })
@Index(['agentId', 'kind'], { background: true })
@Entity(TableName.agent_sub)
export class AgentSubEntity extends BaseEntity {
  @Column()
  agentId: MongoObjectId;

  @Column()
  kind?: string;

  @Column()
  name?: string;

  @Column()
  avatar?: string;

  @Column()
  status?: number;

  @Column()
  agentCallMe?: string;

  @Column()
  iCallAgent?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
