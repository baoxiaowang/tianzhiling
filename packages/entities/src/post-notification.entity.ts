import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';
import { PostCommentType } from './post-comment.entity';

export enum PostNotificationType {
  comment = 'comment',
  like = 'like',
}

@Index(['userId', 'isRead', 'createdAt'], { background: true })
@Index(['userId', 'postId', 'isRead'], { background: true })
@Index(['postId', 'createdAt'], { background: true })
@Index(['type', 'postId', 'actorUserId'], { sparse: true, background: true })
@Index(['commentId'], { sparse: true, background: true })
@Entity(TableName.post_notification)
export class PostNotificationEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  postId: MongoObjectId;

  @Column()
  type: PostNotificationType;

  @Column()
  commentId?: MongoObjectId;

  @Column()
  commentType?: PostCommentType;

  @Column()
  actorUserId?: MongoObjectId;

  @Column()
  actorAgentId?: MongoObjectId;

  @Column()
  actorName: string;

  @Column()
  actorAvatar: string;

  @Column()
  contentPreview: string;

  @Column()
  replyToUserName?: string;

  @Column()
  postThumbnail?: string;

  @Column()
  isRead: boolean;

  @Column()
  readAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
