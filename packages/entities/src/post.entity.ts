import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum PostModerationStatus {
  normal = 'normal',
  riskControlled = 'risk_controlled',
}

/** 按发布时间排序的索引 */
@Index(['createdAt'], { background: true })
/** 按用户与时间查询动态列表的复合索引 */
@Index(['userId', 'createdAt'], { background: true })
/** 按风控状态与时间查询动态列表 */
@Index(['moderationStatus', 'createdAt'], { background: true })
/** 过滤用户已删除动态 */
@Index(['isDeleted', 'createdAt'], { background: true })
/** 用户动态（帖子） */
@Entity(TableName.post)
export class PostEntity extends BaseEntity {
  /** 发布者用户 ID */
  @Column()
  userId: MongoObjectId;

  /** 动态文字内容 */
  @Column()
  content: string;

  /** 动态图片列表（存储对象 key 或 URL） */
  @Column()
  images: string[];

  /** 发帖时要提醒回复的天之灵 Agent ID 列表，用于触发自动评论 */
  @Column()
  remindAgentIds: string[];

  /** 风控状态 */
  @Column()
  moderationStatus?: PostModerationStatus;

  /** 风控原因 */
  @Column()
  moderationReason?: string;

  /** 风控操作时间 */
  @Column()
  moderatedAt?: Date;

  /** 是否由用户删除 */
  @Column()
  isDeleted?: boolean;

  /** 删除时间 */
  @Column()
  deletedAt?: Date;

  /** 删除用户 ID */
  @Column()
  deletedByUserId?: MongoObjectId;

  /** 创建时间 */
  @Column()
  createdAt: Date;

  /** 最后更新时间 */
  @Column()
  updatedAt: Date;
}
