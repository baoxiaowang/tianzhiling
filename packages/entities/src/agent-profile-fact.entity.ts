import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum AgentProfileFactType {
  identity = "identity",
  relationship = "relationship",
  age = "age",
  occupation = "occupation",
  family = "family",
  preference = "preference",
  correction = "correction",
  promise = "promise",
  keepsake = "keepsake",
  griefTrigger = "grief_trigger",
  safetySignal = "safety_signal",
  style = "style",
  memory = "memory",
  taboo = "taboo",
}

export enum AgentProfileFactPolarity {
  positive = "positive",
  negative = "negative",
}

export enum AgentProfileFactConfidence {
  extracted = "extracted",
  confirmed = "confirmed",
  userCorrected = "user_corrected",
  feedback = "feedback",
}

export enum AgentProfileFactStatus {
  active = "active",
  candidate = "candidate",
  conflicted = "conflicted",
  pending = "pending",
  rejected = "rejected",
  archived = "archived",
}

export enum AgentProfileFactAssertionPolicy {
  canAssert = "can_assert",
  contextOnly = "context_only",
}

@Index(["userId", "agentId", "key"], { unique: true, background: true })
@Index(["userId", "agentId", "status", "priority", "updatedAt"], {
  background: true,
})
@Entity(TableName.agent_profile_fact)
export class AgentProfileFactEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  type: AgentProfileFactType;

  @Column()
  key: string;

  @Column()
  value: string;

  @Column()
  polarity: AgentProfileFactPolarity;

  @Column()
  confidence: AgentProfileFactConfidence;

  @Column()
  status: AgentProfileFactStatus;

  @Column()
  priority: number;

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  sourceMessageIds?: MongoObjectId[];

  @Column()
  sourceFeedbackId?: MongoObjectId;

  @Column()
  sourceText?: string;

  @Column()
  supportCount?: number;

  @Column()
  conflictingValues?: string[];

  @Column()
  assertionPolicy?: AgentProfileFactAssertionPolicy;

  @Column()
  lastUsedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
