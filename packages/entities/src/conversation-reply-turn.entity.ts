import { Column, Entity } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export type ConversationReplyTurnStatus =
  | "collecting"
  | "generating"
  | "delivering"
  | "answered"
  | "cancelled";

export type ConversationReplyTurnMode = "normal" | "listening";

export type ConversationTurnBoundaryHint =
  | "continue_likely"
  | "complete_likely"
  | "uncertain";

// Production indexes for this collection are owned by
// apps/node/scripts/ensure-conversation-reply-turn-indexes.js. Keeping the
// same indexes in TypeORM metadata would give synchronize a second owner and
// can make worker restarts fail when names or key directions differ.
@Entity(TableName.conversation_reply_turn)
export class ConversationReplyTurnEntity extends BaseEntity {
  @Column()
  schemaVersion: "conversation_reply_turn_v1";

  @Column()
  turnId: string;

  /** Present only while this is the single active reply turn. */
  @Column()
  activeKey?: string;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  status: ConversationReplyTurnStatus;

  @Column()
  mode: ConversationReplyTurnMode;

  @Column()
  sourceMessageIds: string[];

  @Column()
  sourceVisibleCharacters: number;

  @Column()
  inputEpoch: number;

  /** The latest input epoch already covered by a visible acknowledgement. */
  @Column()
  acknowledgedEpoch: number;

  @Column()
  acknowledgementMessageIds: string[];

  @Column()
  replyMessageIds: string[];

  @Column()
  firstInputAt: Date;

  @Column()
  latestInputAt: Date;

  @Column()
  collectNotBeforeAt: Date;

  @Column()
  absoluteReplyAt: Date;

  @Column()
  expiresAt: Date;

  @Column()
  generationEpoch?: number;

  @Column()
  generationStartedAt?: Date;

  @Column()
  deliveryStartedAt?: Date;

  @Column()
  answeredAt?: Date;

  @Column()
  cancelledAt?: Date;

  @Column()
  cancellationReason?: string;

  @Column()
  boundaryCheckCount: number;

  @Column()
  lastBoundaryHint?: ConversationTurnBoundaryHint;

  @Column()
  lastBoundaryCheckedAt?: Date;

  @Column()
  acknowledgementCount: number;

  @Column()
  recoveryCount: number;

  @Column()
  recoveryQueuedAt?: Date;

  @Column()
  lastError?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
