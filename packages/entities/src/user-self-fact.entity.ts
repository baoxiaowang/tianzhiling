import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const USER_SELF_FACT_VERSION = "user_self_fact_v1" as const;

export enum UserSelfFactDomain {
  situation = "situation",
  work = "work",
  finance = "finance",
  family = "family",
  health = "health",
  emotion = "emotion",
  preference = "preference",
  plan = "plan",
  other = "other",
}

export enum UserSelfFactStatus {
  current = "current",
  resolved = "resolved",
  historical = "historical",
  uncertain = "uncertain",
}

export enum UserSelfFactConfidence {
  extracted = "extracted",
  confirmed = "confirmed",
  userCorrected = "user_corrected",
}

export interface UserSelfFactSource {
  messageId: MongoObjectId;
  agentId?: MongoObjectId;
  sourceText?: string;
  observedAt: Date;
}

/**
 * 用户本人近况：只存用户自己说出的当前处境/稳定偏好/打算，不存 AI 亲人或
 * 其他家人的事实（那些走 agent_profile_fact / user_relative_fact）。
 */
@Index(["userId", "status", "updatedAt"], { background: true })
@Index(["userId", "domain", "key", "status"], { background: true })
@Entity(TableName.user_self_fact)
export class UserSelfFactEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  domain: UserSelfFactDomain;

  /** Stable semantic key inside the user's own profile, for example work.pressure. */
  @Column()
  key: string;

  @Column()
  value: string;

  @Column()
  status: UserSelfFactStatus;

  @Column()
  confidence: UserSelfFactConfidence;

  @Column()
  supportCount: number;

  @Column()
  sources?: UserSelfFactSource[];

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
