import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';

export enum VoicePackageStatus {
  active = 'active',
  disabled = 'disabled',
}

export interface VoicePackageDeliverable {
  title: string;
  description?: string;
}

@Index(['code'], { unique: true, background: true })
@Index(['status', 'sort', 'priceAmount'], { background: true })
@Entity(TableName.voice_package)
export class VoicePackageEntity extends BaseEntity {
  @Column()
  code: string;

  @Column()
  name: string;

  @Column()
  description?: string;

  @Column()
  priceAmount: number;

  @Column()
  originalPriceAmount?: number;

  @Column()
  currency: string;

  @Column()
  deliverables: VoicePackageDeliverable[];

  @Column()
  materialRequirement?: string;

  @Column()
  estimatedServiceDays?: number;

  @Column()
  status: VoicePackageStatus;

  @Column()
  sort: number;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
