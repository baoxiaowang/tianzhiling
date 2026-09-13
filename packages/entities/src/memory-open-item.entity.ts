import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const MEMORY_OPEN_ITEM_VERSION = "memory_open_item_v1" as const;

export type MemoryOpenItemState =
  | "reported"
  | "awaiting_result"
  | "action_committed"
  | "resolved"
  | "dismissed"
  | "expired";

/** 状态变更只追加，永不覆盖：谁改的、依据哪句话、什么时候，都要能回答。 */
export interface MemoryOpenItemStateEvent {
  state: MemoryOpenItemState;
  changedAt: Date;
  evidenceMessageId?: MongoObjectId;
  source: "offline_extraction" | "online_raise" | "user_request";
}

@Index(["userId", "engine", "state"], { background: true })
@Index(["userId", "engine", "dueAt"], { background: true })
@Index(["fingerprint", "engine"], { unique: true, background: true })
@Entity(TableName.memory_open_item)
export class MemoryOpenItemEntity extends BaseEntity {
  @Column()
  schemaVersion: typeof MEMORY_OPEN_ITEM_VERSION;

  @Column()
  engine: string;

  @Column()
  userId: MongoObjectId;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  /** 挂在哪件事上（引擎支持组合时给出）。 */
  @Column()
  groupId?: MongoObjectId;

  @Column()
  topicKey: string;

  @Column()
  subjectRef?: string;

  /** 一句话说清这件没完的事，必须来自原话。 */
  @Column()
  summary: string;

  @Column()
  state: MemoryOpenItemState;

  @Column()
  stateHistory: MemoryOpenItemStateEvent[];

  @Column()
  importance: number;

  @Column()
  dueAt?: Date;

  /** 上次提起是什么时候。防重复追问靠它，由回复链路记账写入。 */
  @Column()
  lastRaisedAt?: Date;

  @Column()
  raisedCount: number;

  @Column()
  sourceMessageIds: MongoObjectId[];

  /** 稳定指纹：同一用户 + 同一话题 + 同一主体 + 同一生命周期，避免重复建条目。 */
  @Column()
  fingerprint: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
