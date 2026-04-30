import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum PostCommentType {
  user = 'user',
  agent = 'agent',
}

@Entity(TableName.post_comment)
export class PostCommentEntity extends BaseEntity {
  @Column()
  postId: MongoObjectId;

  @Column()
  userId?: MongoObjectId;

  @Column()
  agentId?: MongoObjectId;

  @Column()
  type: PostCommentType;

  @Column()
  content: string;

  @Column()
  parentCommentId?: MongoObjectId;

  @Column()
  replyToUserId?: MongoObjectId;

  @Column()
  replyToAgentId?: MongoObjectId;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
