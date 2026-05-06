import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, TableName } from './base';
import { AgentEntitlementType } from './agent-entitlement.entity';

export enum VipPlanStatus {
  active = 'active',
  disabled = 'disabled',
}

export interface VipPlanBenefit {
  title: string;
  description?: string;
}

export interface VipPlanEntitlementGrant {
  type: AgentEntitlementType;
  totalQuota: number;
  durationDays?: number;
}

@Index(['code'], { unique: true, background: true })
@Index(['status', 'sort', 'priceAmount'], { background: true })
@Entity(TableName.vip_plan)
export class VipPlanEntity extends BaseEntity {
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
  durationDays?: number;

  @Column()
  lifetime: boolean;

  @Column()
  benefits: VipPlanBenefit[];

  @Column()
  entitlementGrants?: VipPlanEntitlementGrant[];

  @Column()
  couponGrantAmount?: number;

  @Column()
  status: VipPlanStatus;

  @Column()
  sort: number;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
