import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

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
