import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

@Index(['account'], { unique: true, background: true })
@Index(['adminUserId'], { background: true })
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
