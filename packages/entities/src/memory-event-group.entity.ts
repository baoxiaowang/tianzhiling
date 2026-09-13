import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const MEMORY_EVENT_GROUP_VERSION = "memory_event_group_v1" as const;

export enum MemoryEventGroupStatus {
  active = "active",
  /** 被后续组合取代（同一件事重新开始），保留历史。 */
  superseded = "superseded",
  deleted = "deleted",
}

/** 组合里的成员原话。原话正文不在这里，只在 message 集合；这里只留定位与展示用片段。 */
export interface MemoryEventGroupMember {
  messageId: MongoObjectId;
  occurredAt: Date;
  /** 原话指纹，用于幂等与审计，不参与生成。 */
  textHash: string;
  /** 仅用于运维查看的短片段，任何可断言内容都必须回原话。 */
  preview: string;
}

@Index(["userId", "engine", "topicKey", "status"], { background: true })
@Index(["userId", "engine", "spanTo"], { background: true })
@Index(["conversationId", "updatedAt"], { background: true })
@Entity(TableName.memory_event_group)
export class MemoryEventGroupEntity extends BaseEntity {
  @Column()
  schemaVersion: typeof MEMORY_EVENT_GROUP_VERSION;

  /** 哪套引擎产生的，切换与重建用。 */
  @Column()
  engine: string;

  @Column()
  userId: MongoObjectId;

  @Column()
  conversationId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  /** 话题键（聚类依据之一），例如抽烟 / 复查 / 生日。 */
  @Column()
  topicKey: string;

  /** 这件事说的是谁（上层传入的人物引用，可为空）。 */
  @Column()
  subjectRef?: string;

  /** 组合标题：只能当背景，不可作为事实断言。 */
  @Column()
  title: string;

  @Column()
  status: MemoryEventGroupStatus;

  @Column()
  members: MemoryEventGroupMember[];

  @Column()
  spanFrom: Date;

  @Column()
  spanTo: Date;

  /** 事件去重的稳定键：同一主体 + 同一话题 + 同一生命周期。 */
  @Column()
  groupKey: string;

  /** 运维纠正过的分组：重建时必须尊重，避免把错误分组重新算出来。 */
  @Column()
  corrected?: boolean;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
