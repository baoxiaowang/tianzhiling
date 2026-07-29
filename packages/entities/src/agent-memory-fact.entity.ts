import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum AgentMemoryFactType {
  profile = "profile",
  relationship = "relationship",
  identity = "identity",
  family = "family",
  preference = "preference",
  sharedMemory = "shared_memory",
  correction = "correction",
  promise = "promise",
  keepsake = "keepsake",
  griefTrigger = "grief_trigger",
  safetySignal = "safety_signal",
  style = "style",
}

export enum AgentMemoryFactPolarity {
  positive = "positive",
  negative = "negative",
}

@Index(["userId", "agentId", "key"], { unique: true, background: true })
@Index(["userId", "agentId", "priority", "updatedAt"], { background: true })
@Entity(TableName.agent_memory_fact)
export class AgentMemoryFactEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  type: AgentMemoryFactType;

  @Column()
  key: string;

  @Column()
  value: string;

  @Column()
  polarity: AgentMemoryFactPolarity;

  @Column()
  priority: number;

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  isArchived?: boolean;

  @Column()
  archivedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
