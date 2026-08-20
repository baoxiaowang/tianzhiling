import { Column, Entity, Index } from "typeorm";
import { BaseEntity, TableName } from "./base";

export enum ChatTraceStage {
  queueWait = "queue_wait",
  contextLoad = "context_load",
  plan = "plan",
  memoryRetrieve = "memory_retrieve",
  promptBuild = "prompt_build",
  generate = "generate",
  review = "review",
  revise = "revise",
  persistReply = "persist_reply",
  asyncWrite = "async_write",
}

export enum ChatSpanStatus {
  completed = "completed",
  failed = "failed",
  discarded = "discarded",
  skipped = "skipped",
}

export type ChatSpanAttributeValue = string | number | boolean;

@Index(["traceId", "startedAt"], { background: true })
@Index(["stage", "startedAt"], { background: true })
@Index(["expiresAt"], {
  background: true,
  expireAfterSeconds: 0,
} as any)
@Entity(TableName.chat_span)
export class ChatSpanEntity extends BaseEntity {
  @Column()
  traceId: string;

  @Column()
  spanId: string;

  @Column()
  parentSpanId?: string;

  @Column()
  stage: ChatTraceStage;

  @Column()
  operation: string;

  @Column()
  attempt?: number;

  @Column()
  status: ChatSpanStatus;

  @Column()
  startedAt: Date;

  @Column()
  completedAt: Date;

  @Column()
  durationMs: number;

  @Column()
  model?: string;

  @Column()
  promptTokens?: number;

  @Column()
  completionTokens?: number;

  @Column()
  totalTokens?: number;

  @Column()
  resultCode?: string;

  @Column()
  errorCode?: string;

  @Column()
  attributes?: Record<string, ChatSpanAttributeValue>;

  @Column()
  expiresAt: Date;
}
