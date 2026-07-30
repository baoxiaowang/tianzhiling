import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum AgentSex {
  woman = 0,
  man = 1,
}

export interface AgentPersonaLanguageProfile {
  sentenceLength?: string;
  directness?: string;
  emotionalExpression?: string;
  addressStyle?: string;
  distinctiveRhythm?: string;
}

export interface AgentDepartedTransformation {
  released?: string[];
  strengthened?: string[];
  retainedEdges?: string[];
}

export interface AgentPersonaProfile {
  version?: string;
  demographics?: {
    relationshipType?: string;
    sex?: string;
    ageAtDeath?: number;
    ageBand?: string;
  };
  lifeTraits?: string[];
  coreValues?: string[];
  personalityContradictions?: string[];
  careStyle?: string;
  praiseStyle?: string;
  criticismStyle?: string;
  conflictStyle?: string;
  concealmentStyle?: string;
  questionStyle?: string;
  humorStyle?: string;
  languageProfile?: AgentPersonaLanguageProfile;
  departedTransformation?: AgentDepartedTransformation;
  highEqStrategies?: string[];
  evidenceSummary?: string[];
  uncertainties?: string[];
  confidence?: number;
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
  realName?: string;

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
  customContext?: string;

  /**
   * Optional chat-derived style profile. It guides expression only and never
   * overrides confirmed facts, capability boundaries, or released clients.
   */
  @Column()
  personaProfile?: AgentPersonaProfile;

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
