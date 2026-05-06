import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['account'], { unique: true, background: true })
@Index(['userId'], { background: true })
@Entity(TableName.user_account)
export class UserAccountEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  account: string;

  @Column()
  password: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
