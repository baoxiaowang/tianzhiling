import { Entity, Column, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';

export interface UserPreferences {
  contactsCoverImage?: string;
}

export type UserGender = 'male' | 'female' | 'unknown';

export enum UserAccountStatus {
  active = 'active',
  canceled = 'canceled',
}

export enum UserAccountCancellationStatus {
  processing = 'processing',
  completed = 'completed',
  partialFailed = 'partial_failed',
}

export interface UserAccountCancellationSummary {
  deletedRecordCount: number;
  deletedAssetCount: number;
  deletedVoiceObjectCount: number;
  deletedVoiceModelCount: number;
  deactivatedMembershipCount: number;
  expiredEntitlementCount: number;
  failureStages?: string[];
}

export interface UserRegion {
  countryCode: 'CN';
  countryName: '中国';
  provinceCode: string;
  provinceName: string;
  cityCode: string;
  cityName: string;
}

@Index(['phone'], { sparse: true, background: true })
@Index(['accountStatus', 'updatedAt'], { sparse: true, background: true })
@Index(['riskControlUntilAt'], { sparse: true, background: true })
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
  gender?: UserGender;

  @Column()
  region?: UserRegion | null;

  @Column()
  preferences?: UserPreferences;

  @Column()
  riskControlUntilAt?: Date;

  @Column()
  postNotificationSeenAt?: Date;

  /** Missing on historical rows means active for backward compatibility. */
  @Column()
  accountStatus?: UserAccountStatus;

  @Column()
  accountCancellationStatus?: UserAccountCancellationStatus;

  @Column()
  accountCancellationRequestedAt?: Date;

  @Column()
  canceledAt?: Date;

  @Column()
  accountCancellationCompletedAt?: Date;

  @Column()
  accountCancellationFailureReason?: string;

  @Column()
  accountCancellationSummary?: UserAccountCancellationSummary;

  /** Internal retry targets; never include these object keys in API responses. */
  @Column()
  accountCancellationPendingAssetKeys?: string[];

  @Column()
  createdAt?: Date;

  @Column()
  updatedAt?: Date;
}
