import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

/** 按发布时间排序的索引 */
@Index(['createdAt'], { background: true })
/** 按用户与时间查询动态列表的复合索引 */
@Index(['userId', 'createdAt'], { background: true })
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

  /** 创建时间 */
  @Column()
  createdAt: Date;

  /** 最后更新时间 */
  @Column()
  updatedAt: Date;
}
