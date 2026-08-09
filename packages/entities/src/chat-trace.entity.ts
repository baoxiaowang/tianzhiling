import { Column, Entity, Index } from "typeorm";
import { BaseEntity, TableName } from "./base";

export enum ChatTraceStatus {
  queued = "queued",
  running = "running",
  completed = "completed",
  failed = "failed",
  skipped = "skipped",
}

export interface ChatTraceStageTokens {
  [stage: string]: number;
}

@Index(["traceId"], { unique: true, background: true })
@Index(["conversationId", "acceptedAt"], { background: true })
@Index(["status", "updatedAt"], { background: true })
@Entity(TableName.chat_trace)
export class ChatTraceEntity extends BaseEntity {
  @Column()
  traceId: string;

  @Column()
  conversationId: string;

  @Column()
  userId: string;

  @Column()
  agentId?: string;

  @Column()
  triggerMessageIds: string[];

  @Column()
  replyMessageIds?: string[];

  @Column()
  replyGroupId?: string;

  @Column()
  queueJobIds?: string[];

  @Column()
  status: ChatTraceStatus;

  @Column()
  attemptCount: number;

  @Column()
  releaseVersion?: string;

  @Column()
  promptVersion?: string;

  @Column()
  strategyVersion?: string;

  @Column()
  acceptedAt: Date;

  @Column()
  workerStartedAt?: Date;

  @Column()
  responseCompletedAt?: Date;

  @Column()
  backgroundCompletedAt?: Date;

  @Column()
  visibleLatencyMs?: number;

  @Column()
  totalLatencyMs?: number;

  @Column()
  totalModelCalls: number;

  @Column()
  promptTokens: number;

  @Column()
  completionTokens: number;

  @Column()
  totalTokens: number;

  @Column()
  tokensByStage: ChatTraceStageTokens;

  @Column()
  failureStage?: string;

  @Column()
  errorCode?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
