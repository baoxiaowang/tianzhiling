import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const USER_RELATIVE_PROFILE_VERSION =
  "user_relative_profile_v1" as const;

export enum UserRelativeProfileStatus {
  active = "active",
  archived = "archived",
}

export type UserRelativeLifeStage =
  | "unknown"
  | "newborn"
  | "infant"
  | "toddler"
  | "preschool"
  | "school_age"
  | "adolescent"
  | "adult"
  | "older_adult";

export type UserRelativeSex = "male" | "female" | "unknown";

export interface UserRelativeAgentRelationship {
  agentId: MongoObjectId;
  relationToAgent?: string;
  personCallsAgent?: string;
  sourceMessageId?: MongoObjectId;
  updatedAt: Date;
}

@Index(["userId", "status"], { background: true })
@Index(["userId", "personId"], { unique: true, background: true })
@Entity(TableName.user_relative_profile)
export class UserRelativeProfileEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  /** References the account-level UserKnownPersonEntity. */
  @Column()
  personId: MongoObjectId;

  @Column()
  status: UserRelativeProfileStatus;

  @Column()
  lifeStage: UserRelativeLifeStage;

  @Column()
  sex?: UserRelativeSex;

  @Column()
  birthDate?: Date;

  @Column()
  birthYear?: number;

  @Column()
  relationshipsToAgents?: UserRelativeAgentRelationship[];

  @Column()
  version: typeof USER_RELATIVE_PROFILE_VERSION;

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  sourceText?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
