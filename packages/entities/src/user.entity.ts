import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';

@Index(['phone'], { sparse: true, background: true })
@Index(['createdAt'], { background: true })
@Entity(TableName.user)
export class UserEntity extends BaseEntity {
  @Column()
  name: string;

  @Column()
  avatar: string;

  @Column()
  phone?: string;

  @Column()
  phoneVerified?: boolean;

  @Column()
  createdAt?: Date;

  @Column()
  updatedAt?: Date;
}
