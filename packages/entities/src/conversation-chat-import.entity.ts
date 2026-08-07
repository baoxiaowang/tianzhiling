import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum ConversationChatImportStatus {
  draft = "draft",
  uploading = "uploading",
  queued = "queued",
  recognizing = "recognizing",
  needsReview = "needs_review",
  importing = "importing",
  extractingMemory = "extracting_memory",
  needsMemoryReview = "needs_memory_review",
  completed = "completed",
  partialFailed = "partial_failed",
  failed = "failed",
  canceled = "canceled",
}

export enum ConversationChatImportSpeaker {
  user = "user",
  agent = "agent",
  unknown = "unknown",
}

export enum ConversationChatImportSide {
  left = "left",
  right = "right",
  center = "center",
  unknown = "unknown",
}

export enum ConversationChatImportItemType {
  text = "text",
  image = "image",
  voice = "voice",
  system = "system",
  recalled = "recalled",
}

export enum ConversationChatImportTimePrecision {
  minute = "minute",
  day = "day",
  month = "month",
  unknown = "unknown",
}

export enum ConversationChatImportConfidence {
  high = "high",
  medium = "medium",
  low = "low",
}

export interface ConversationChatImportAsset {
  id: string;
  objectKey: string;
  publicUrl?: string;
  fileName?: string;
  mimeType?: string;
  screenshotSequence: number;
  imageHash?: string;
  status?: "uploaded" | "recognized" | "failed";
  errorCode?: string;
  errorDetail?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ConversationChatImportMemoryStatus =
  | "pending"
  | "confirmed"
  | "rejected";

export interface ConversationChatImportMemoryCandidate {
  id: string;
  type: string;
  key: string;
  value: string;
  priority: number;
  status: ConversationChatImportMemoryStatus;
  sourceItemIds: string[];
  sourceMessageIds: string[];
  factId?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Index(["userId", "conversationId", "updatedAt"], { background: true })
@Index(["userId", "clientRequestId"], {
  unique: true,
  sparse: true,
  background: true,
})
@Index(["status", "updatedAt"], { background: true })
@Entity(TableName.conversation_chat_import_batch)
export class ConversationChatImportBatchEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  clientRequestId?: string;

  @Column()
  status: ConversationChatImportStatus;

  @Column()
  assets?: ConversationChatImportAsset[];

  @Column()
  leftSpeaker: ConversationChatImportSpeaker;

  @Column()
  rightSpeaker: ConversationChatImportSpeaker;

  @Column()
  screenshotCount?: number;

  @Column()
  recognizedCount?: number;

  @Column()
  confirmedCount?: number;

  @Column()
  failedCount?: number;

  @Column()
  duplicateCount?: number;

  @Column()
  timezoneOffsetMinutes?: number;

  @Column()
  recognitionModel?: string;

  @Column()
  recognitionPromptVersion?: string;

  @Column()
  memoryStatus?: string;

  @Column()
  styleStatus?: string;

  @Column()
  memoryCandidates?: ConversationChatImportMemoryCandidate[];

  @Column()
  deleteAssetsAfterImport?: boolean;

  @Column()
  errorCode?: string;

  @Column()
  errorDetail?: string;

  @Column()
  retryCount?: number;

  @Column()
  earliestOccurredAt?: Date;

  @Column()
  latestOccurredAt?: Date;

  @Column()
  submittedAt?: Date;

  @Column()
  recognizedAt?: Date;

  @Column()
  confirmedAt?: Date;

  @Column()
  completedAt?: Date;

  @Column()
  memoryReviewCompletedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}

@Index(["batchId", "screenshotSequence", "bubbleSequence"], {
  background: true,
})
@Index(["conversationId", "messageId"], {
  sparse: true,
  background: true,
})
@Entity(TableName.conversation_chat_import_item)
export class ConversationChatImportItemEntity extends BaseEntity {
  @Column()
  batchId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  screenshotId: string;

  @Column()
  screenshotSequence: number;

  @Column()
  bubbleSequence: number;

  @Column()
  side: ConversationChatImportSide;

  @Column()
  speaker: ConversationChatImportSpeaker;

  @Column()
  type: ConversationChatImportItemType;

  @Column()
  content: string;

  @Column()
  rawContent?: string;

  @Column()
  rawTimeText?: string;

  @Column()
  occurredAt?: Date;

  @Column()
  timePrecision: ConversationChatImportTimePrecision;

  @Column()
  timeConfidence: ConversationChatImportConfidence;

  @Column()
  textConfidence: number;

  @Column()
  speakerConfidence: number;

  @Column()
  recognitionConfidence: number;

  @Column()
  recognitionAttempt?: number;

  @Column()
  isSuperseded?: boolean;

  @Column()
  fingerprint?: string;

  @Column()
  isDuplicate?: boolean;

  @Column()
  isDeleted?: boolean;

  @Column()
  isEdited?: boolean;

  @Column()
  isConfirmed?: boolean;

  @Column()
  messageId?: MongoObjectId;

  @Column()
  memoryFactIds?: MongoObjectId[];

  @Column()
  styleEvidenceIds?: MongoObjectId[];

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
