import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum PresencePhysicalExpectation {
  none = "none",
  imaginal = "imaginal",
  literal = "literal",
  reject = "reject",
}

export enum PresenceContactChannel {
  chat = "chat",
  dream = "dream",
  ritual = "ritual",
  symbolic = "symbolic",
  mixed = "mixed",
}

export enum PresenceInitiation {
  quiet = "quiet",
  onDemand = "on_demand",
  proactive = "proactive",
}

export enum PresenceRealityFraming {
  symbolic = "symbolic",
  meta = "meta",
  literal = "literal",
}

export interface PresenceEvidence {
  dimension: string;
  value: string;
  strength: "strong" | "medium" | "weak";
  signal: string;
  sourceMessageId?: string;
  occurredAt: Date;
}

@Index(["userId", "agentId"], { unique: true, background: true })
@Index(["expiresAt"], { background: true })
@Entity(TableName.presence_state)
export class PresenceStateEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  physicalExpectation: PresencePhysicalExpectation;

  @Column()
  contactChannel: PresenceContactChannel;

  @Column()
  initiation: PresenceInitiation;

  @Column()
  realityFraming: PresenceRealityFraming;

  @Column()
  confidence: number;

  @Column()
  evidence: PresenceEvidence[];

  @Column()
  lastSignalAt?: Date;

  @Column()
  expiresAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
