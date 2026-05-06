import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';

@Index(['createdAt'], { background: true })
@Entity(TableName.admin_user)
export class AdminUserEntity extends BaseEntity {
  @Column()
  name: string;

  @Column()
  avatar: string;

  @Column()
  roles: string[];

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
