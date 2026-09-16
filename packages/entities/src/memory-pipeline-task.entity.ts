import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const MEMORY_PIPELINE_TASK_VERSION = "memory_pipeline_task_v1" as const;

export enum MemoryPipelineTaskKind {
  structuredMemory = "structured_memory",
  semanticIndex = "semantic_index",
  /** Builds idempotent person-scoped Milvus units; raw message indexing stays separate. */
  personSemanticIndex = "person_semantic_index",
  /** 每用户每天一次：离线模型判定"待跟进的事"与"日子"。 */
  openItemExtraction = "open_item_extraction",
}

export enum MemoryPipelineTaskStatus {
  pending = "pending",
  processing = "processing",
  completed = "completed",
  failed = "failed",
  skipped = "skipped",
}

/**
 * 调度类别（与任务种类 kind 正交）：
 * - realtime：新消息路径与其重试、攒批 flush，全天优先、不受后台额度限制；
 * - background：显式补处理批次，全天低优先级、受后台准入额度限制；
 * - 缺省：legacy，保留旧行为（低优先级重排、暂不纳入后台额度）。
 */
export enum MemoryPipelineTaskScheduleClass {
  realtime = "realtime",
  background = "background",
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

  /** 批量任务：合并多条消息为一个任务，messageId 为第一条消息的 ID */
  @Column()
  messageIds?: MongoObjectId[];

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

  /** 调度类别；旧数据缺省表示 legacy。 */
  @Column()
  scheduleClass?: MemoryPipelineTaskScheduleClass;

  /** 显式补处理批次的来源标识（仅 background 有）。 */
  @Column()
  backgroundBatchId?: string;

  /** 调度延期次数（与业务失败 attemptCount 分开）。 */
  @Column()
  deferCount?: number;

  /** 最近一次延期原因（额度不足/后台暂停/资源守卫/队列不可用）。 */
  @Column()
  lastDeferReason?: string;

  @Column()
  lastDeferredAt?: Date;

  /** 下一次最早可执行时间（延期结果，供观测与协调）。 */
  @Column()
  nextEligibleAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
