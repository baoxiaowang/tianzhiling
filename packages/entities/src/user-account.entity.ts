import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum UserLoginAccountStatus {
  active = 'active',
  canceled = 'canceled',
  /** 违规封禁：登录账号（微信 openId / 手机号）维度永久拒绝登录。 */
  banned = 'banned',
}

@Index(['account'], { background: true })
@Index(['openId'], { sparse: true, background: true })
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
  openId?: string;

  /** Missing on historical rows means active for backward compatibility. */
  @Column()
  status?: UserLoginAccountStatus;

  @Column()
  canceledAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
