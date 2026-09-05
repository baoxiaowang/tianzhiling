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
