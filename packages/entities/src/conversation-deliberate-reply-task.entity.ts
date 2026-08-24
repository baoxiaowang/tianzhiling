import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export type ConversationDeliberateReplyTaskStatus =
  | "pending"
  | "generating"
  | "delivered"
  | "cancelled"
  | "failed";

@Index(["conversationId", "status", "scheduledAt"], { background: true })
@Index(["userId", "scheduledAt"], { background: true })
@Index(["taskKey"], { unique: true, background: true })
@Entity(TableName.conversation_deliberate_reply_task)
export class ConversationDeliberateReplyTaskEntity extends BaseEntity {
  @Column()
  schemaVersion: "deliberate_long_reply_task_v2";

  @Column()
  taskKey: string;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  status: ConversationDeliberateReplyTaskStatus;

  @Column()
  sourceMessageIds: string[];

  @Column()
  acknowledgementMessageIds: string[];

  @Column()
  sourceText: string;

  @Column()
  sourceVisibleCharacters: number;

  @Column()
  focus: string[];

  @Column()
  decisionReason: string;

  @Column()
  scheduledAt: Date;

  @Column()
  deliveryWindowEndAt: Date;

  @Column()
  sourceOccurredAt: Date;

  @Column()
  queueJobId?: string;

  @Column()
  queuedAt?: Date;

  @Column()
  generationStartedAt?: Date;

  @Column()
  runtimeContextMessageIds?: string[];

  @Column()
  runtimeContextReadAt?: Date;

  @Column()
  deliveredAt?: Date;

  @Column()
  cancelledAt?: Date;

  @Column()
  failedAt?: Date;

  @Column()
  cancellationReason?: string;

  @Column()
  lastError?: string;

  @Column()
  attemptCount: number;

  @Column()
  deliveredMessageIds: string[];

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
