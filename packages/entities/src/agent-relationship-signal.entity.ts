import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum AgentRelationshipSignalType {
  concern = "concern",
}

export enum AgentRelationshipSignalTopic {
  agentPhysicalSuffering = "agent_physical_suffering",
}

export enum AgentRelationshipSignalSubject {
  agent = "agent",
}

export enum AgentRelationshipSignalStatus {
  active = "active",
  rejected = "rejected",
}

export enum AgentRelationshipSignalAssertionPolicy {
  userStateOnly = "user_state_only",
}

@Index(
  "uniq_user_agent_signal_topic",
  ["userId", "agentId", "signalType", "topic"],
  {
    unique: true,
    background: true,
  }
)
@Index(
  "idx_active_relationship_signals",
  ["userId", "agentId", "status", "lastSeenAt"],
  {
    background: true,
  }
)
@Entity(TableName.agent_relationship_signal)
export class AgentRelationshipSignalEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  signalType: AgentRelationshipSignalType;

  @Column()
  topic: AgentRelationshipSignalTopic;

  @Column()
  subject: AgentRelationshipSignalSubject;

  @Column()
  confidence: number;

  @Column()
  supportCount: number;

  @Column()
  sourceMessageIds: MongoObjectId[];

  @Column()
  status: AgentRelationshipSignalStatus;

  @Column()
  assertionPolicy: AgentRelationshipSignalAssertionPolicy;

  @Column()
  firstSeenAt: Date;

  @Column()
  lastSeenAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
