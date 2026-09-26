import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';

export type AppPreviewGrantState = 'issued' | 'redeemed';

/** One-use admin-approved device grant. No bearer token is persisted here. */
@Index(['codeHash'], { unique: true, background: true })
@Entity(TableName.app_preview_grant)
export class AppPreviewGrantEntity extends BaseEntity {
  @Column()
  codeHash: string;

  @Column()
  targetUserId: string;

  @Column()
  state: AppPreviewGrantState;

  @Column()
  createdAt: Date;

  @Column()
  expiresAt: Date;

  @Column()
  issuedByAdminId: string;

  @Column()
  redeemedAt?: Date;
}
