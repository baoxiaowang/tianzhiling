import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum MessengerCallStatus {
  completed = "completed",
  skipped = "skipped",
  failed = "failed",
}

@Index(["createdAt"], { background: true })
@Index(["userId", "createdAt"], { background: true })
@Index(["messengerAgentId", "createdAt"], { background: true })
@Index(["conversationId", "createdAt"], { background: true })
@Index(["status", "createdAt"], { background: true })
@Entity(TableName.messenger_call_event)
export class MessengerCallEventEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  messengerAgentId: MongoObjectId;

  @Column()
  parentAgentId: MongoObjectId;

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  status: MessengerCallStatus;

  @Column()
  skipReason?: string;

  @Column()
  modelCalled: boolean;

  @Column()
  modelSucceeded: boolean;

  @Column()
  fallbackUsed: boolean;

  @Column()
  model?: string;

  @Column()
  promptTokens?: number;

  @Column()
  completionTokens?: number;

  @Column()
  totalTokens?: number;

  @Column()
  durationMs: number;

  @Column()
  profileSaved: boolean;

  @Column()
  changedProfileFields: string[];

  @Column()
  releaseVersion?: string;

  @Column()
  errorCode?: string;

  @Column()
  errorMessage?: string;

  @Column()
  createdAt: Date;
}
