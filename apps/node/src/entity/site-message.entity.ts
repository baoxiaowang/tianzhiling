import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId } from '@tzl/entities';

export enum SiteMessageStatus {
  pending = 'pending',
  published = 'published',
  rejected = 'rejected',
  deleted = 'deleted',
}

@Index(['status', 'createdAt'], { background: true })
@Index(['ipHash', 'createdAt'], { sparse: true, background: true })
@Entity('site_message')
export class SiteMessageEntity extends BaseEntity {
  /** 预留给后续登录用户；当前游客留言为空。 */
  @Column()
  userId?: MongoObjectId;

  @Column()
  authorName: string;

  @Column()
  content: string;

  /** 仅审核端可见，不公开返回。 */
  @Column()
  contact?: string;

  @Column()
  status: SiteMessageStatus;

  @Column()
  moderationReason?: string;

  @Column()
  adminReply?: string;

  @Column()
  adminReplyAt?: Date;

  /** 仅保存哈希，不保存原始 IP。 */
  @Column()
  ipHash?: string;

  @Column()
  userAgent?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;

  @Column()
  publishedAt?: Date;

  @Column()
  reviewedAt?: Date;
}
