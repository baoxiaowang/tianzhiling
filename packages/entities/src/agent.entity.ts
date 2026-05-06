import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentSex {
  woman = 0,
  man = 1,
}

@Index(['createdUserId', 'updatedAt'], { background: true })
@Index(['createdUserId', 'isDefault'], { background: true })
@Index(['voiceTimbreId'], { sparse: true, background: true })
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
  lifeExperience?: string;

  @Column()
  personalityTraits?: string;

  @Column()
  languageHabits?: string;

  @Column()
  hobbies?: string;

  @Column()
  sharedMemories?: string;

  @Column()
  status: number;

  @Column()
  isDefault?: boolean;

  @Column()
  voiceTimbreId?: MongoObjectId;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
