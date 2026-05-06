import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['createdAt'], { background: true })
@Index(['userId', 'createdAt'], { background: true })
@Entity(TableName.post)
export class PostEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  content: string;

  @Column()
  images: string[];

  @Column()
  remindAgentIds: string[];

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
