import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum UserKnownPersonStatus {
  active = "active",
  archived = "archived",
}

@Index(["userId", "status"], { background: true })
@Index(["userId", "identityKey"], { unique: true, background: true })
@Entity(TableName.user_known_person)
export class UserKnownPersonEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  /** Stable normalized key; display names alone never merge people. */
  @Column()
  identityKey: string;

  @Column()
  realName?: string;

  /** Name currently preferred in conversation; it need not be a formal name. */
  @Column()
  preferredName?: string;

  @Column()
  aliases?: string[];

  @Column()
  relationToUser?: string;

  /**
   * Name this other person uses when addressing the user (e.g. 爸爸叫我湾呐).
   * It is scoped to this person only: it is never the current AI role's own
   * address for the user, and it must not overwrite agentCallMe / the
   * relationship.preferred_* facts of the current role.
   */
  @Column()
  personCallsUser?: string;

  /** Message that declared personCallsUser; used only for idempotent updates. */
  @Column()
  personCallsUserSourceMessageId?: MongoObjectId;

  /** The same real person represented by one of this account's AI agents. */
  @Column()
  linkedAgentId?: MongoObjectId;

  @Column()
  status: UserKnownPersonStatus;

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
