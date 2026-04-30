import { Entity, Column } from 'typeorm';
import { BaseEntity, TableName } from './base';

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
