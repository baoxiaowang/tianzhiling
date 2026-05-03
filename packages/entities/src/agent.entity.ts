import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentSex {
  woman = 0,
  man = 1,
}

@Entity(TableName.agent)
export class AgentEntity extends BaseEntity {
  @Column()
  createdUserId: MongoObjectId;

  @Column()
  name: string;

  @Column()
  avatar: string;

  @Column()
  sex: AgentSex;

  @Column()
  agentCallMe?: string;

  @Column()
  iCallAgent?: string;

  @Column()
  birthday?: Date;

  @Column()
  deathDate?: Date;

  @Column()
  description: string;

  @Column()
  status: number;

  @Column()
  voiceTimbreId?: MongoObjectId;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
