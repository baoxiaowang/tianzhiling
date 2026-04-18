import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Entity(TableName.post)
export class PostEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  content: string;

  // 图片
  @Column()
  images: string[];

  @Column()
  remindAgentIds: string[];

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
