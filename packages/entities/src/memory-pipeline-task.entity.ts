import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const MEMORY_PIPELINE_TASK_VERSION = "memory_pipeline_task_v1" as const;

export enum MemoryPipelineTaskKind {
  structuredMemory = "structured_memory",
  semanticIndex = "semantic_index",
  /** Builds idempotent person-scoped Milvus units; raw message indexing stays separate. */
  personSemanticIndex = "person_semantic_index",
}

export enum MemoryPipelineTaskStatus {
  pending = "pending",
  processing = "processing",
  completed = "completed",
  failed = "failed",
  skipped = "skipped",
}

@Index(["messageId", "kind", "pipelineVersion"], {
  unique: true,
  background: true,
})
@Index(["status", "nextAttemptAt", "updatedAt"], { background: true })
@Index(["userId", "createdAt"], { background: true })
@Entity(TableName.memory_pipeline_task)
export class MemoryPipelineTaskEntity extends BaseEntity {
  @Column()
  schemaVersion: typeof MEMORY_PIPELINE_TASK_VERSION;

  @Column()
  pipelineVersion: string;

  @Column()
  kind: MemoryPipelineTaskKind;

  @Column()
  status: MemoryPipelineTaskStatus;

  @Column()
  messageId: MongoObjectId;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  sourceHash: string;

  @Column()
  attemptCount: number;

  @Column()
  nextAttemptAt: Date;

  @Column()
  processingStartedAt?: Date;

  @Column()
  completedAt?: Date;

  @Column()
  lastError?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
