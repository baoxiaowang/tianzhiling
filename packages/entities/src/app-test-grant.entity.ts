import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';

export type AppTestGrantState = 'issued' | 'redeemed' | 'revoked';

/** One-use admin-approved test session grant for ASR integration testing. */
@Index(['codeHash'], { unique: true, background: true })
@Entity(TableName.app_test_grant)
export class AppTestGrantEntity extends BaseEntity {
  @Column()
  codeHash: string;

  @Column()
  targetUserId: string;

  @Column()
  state: AppTestGrantState;

  @Column()
  createdAt: Date;

  @Column()
  expiresAt: Date;

  @Column()
  issuedByAdminId: string;

  @Column()
  redeemedAt?: Date;

  @Column()
  redeemedIp?: string;
}
