import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';
import { PostCommentType } from './post-comment.entity';

@Index(['userId', 'isRead', 'createdAt'], { background: true })
@Index(['userId', 'postId', 'isRead'], { background: true })
@Index(['postId', 'createdAt'], { background: true })
@Index(['commentId'], { background: true })
@Entity(TableName.post_comment_notification)
export class PostCommentNotificationEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  postId: MongoObjectId;

  @Column()
  commentId: MongoObjectId;

  @Column()
  commentType: PostCommentType;

  @Column()
  actorUserId?: MongoObjectId;

  @Column()
  actorAgentId?: MongoObjectId;

  @Column()
  actorName: string;

  @Column()
  actorAvatar: string;

  @Column()
  commentPreview: string;

  @Column()
  isRead: boolean;

  @Column()
  readAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
