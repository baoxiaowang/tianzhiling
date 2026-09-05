import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const USER_IDENTITY_PROFILE_VERSION = "user_identity_v1" as const;

export type UserIdentityNameSource =
  | "settings"
  | "explicit_chat_statement"
  | "explicit_chat_correction"
  | "historical_backfill";

export interface UserIdentityFormerName {
  value: string;
  supersededAt: Date;
  sourceMessageId?: MongoObjectId;
}

@Index(["userId"], { unique: true, background: true })
@Entity(TableName.user_identity_profile)
export class UserIdentityProfileEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  realName?: string;

  @Column()
  formerNames?: UserIdentityFormerName[];

  @Column()
  aliases?: string[];

  @Column()
  version: typeof USER_IDENTITY_PROFILE_VERSION;

  @Column()
  source?: UserIdentityNameSource;

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
