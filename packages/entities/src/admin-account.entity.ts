import { Column, Entity } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Entity(TableName.admin_account)
export class AdminAccountEntity extends BaseEntity {
  @Column()
  adminUserId: MongoObjectId;

  @Column()
  account: string;

  @Column()
  password: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
