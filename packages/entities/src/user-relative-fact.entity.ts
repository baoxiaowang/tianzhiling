import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum UserRelativeFactDomain {
  health = "health",
  growth = "growth",
  education = "education",
  work = "work",
  care = "care",
  relationship = "relationship",
  life_event = "life_event",
  preference = "preference",
  routine = "routine",
  other = "other",
}

export enum UserRelativeFactStatus {
  current = "current",
  resolved = "resolved",
  historical = "historical",
  uncertain = "uncertain",
}

export enum UserRelativeFactConfidence {
  extracted = "extracted",
  confirmed = "confirmed",
  userCorrected = "user_corrected",
}

export interface UserRelativeFactSource {
  messageId: MongoObjectId;
  agentId?: MongoObjectId;
  sourceText?: string;
  observedAt: Date;
}

@Index(["userId", "personId", "status", "updatedAt"], {
  background: true,
})
@Index(["userId", "personId", "domain", "key", "status"], {
  background: true,
})
@Entity(TableName.user_relative_fact)
export class UserRelativeFactEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  personId: MongoObjectId;

  @Column()
  domain: UserRelativeFactDomain;

  /** Stable semantic key inside one relative's profile, for example health.fever. */
  @Column()
  key: string;

  @Column()
  value: string;

  @Column()
  status: UserRelativeFactStatus;

  @Column()
  confidence: UserRelativeFactConfidence;

  @Column()
  supportCount: number;

  @Column()
  sources?: UserRelativeFactSource[];

  @Column()
  effectiveAt?: Date;

  @Column()
  validUntil?: Date;

  @Column()
  occurredAt?: Date;

  @Column()
  resolvedAt?: Date;

  @Column()
  sourceAgentId?: MongoObjectId;

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  sourceText?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
