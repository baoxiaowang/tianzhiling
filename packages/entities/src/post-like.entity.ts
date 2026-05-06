import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['postId', 'userId'], { unique: true, background: true })
@Index(['postId', 'createdAt'], { background: true })
@Index(['userId', 'createdAt'], { background: true })
@Entity(TableName.post_like)
export class PostLikeEntity extends BaseEntity {
  @Column()
  postId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
