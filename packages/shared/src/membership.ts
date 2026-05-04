export type VipPlanStatusDTO = 'active' | 'disabled';

export interface VipPlanBenefitDTO {
  title: string;
  description?: string;
}

export interface VipPlanEntitlementGrantDTO {
  type: 'voice_model' | 'chat_import' | 'interview' | 'family_seat';
  totalQuota: number;
  durationDays?: number;
}

export type AgentEntitlementTypeDTO = VipPlanEntitlementGrantDTO['type'];

export interface AgentEntitlementSummaryDTO {
  type: AgentEntitlementTypeDTO;
  totalQuota: number;
  usedQuota: number;
  availableQuota: number;
  expiredAt?: string;
}

export interface AdminVipPlanRecordDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency: string;
  durationDays?: number;
  lifetime: boolean;
  benefits: VipPlanBenefitDTO[];
  entitlementGrants: VipPlanEntitlementGrantDTO[];
  couponGrantAmount?: number;
  status: VipPlanStatusDTO;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVipPlanListParamsDTO {
  keyword?: string;
  status?: VipPlanStatusDTO;
  page?: number;
  pageSize?: number;
}

export interface AdminVipPlanListDTO {
  items: AdminVipPlanRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VipPlanRecordDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency: string;
  durationDays?: number;
  lifetime: boolean;
  benefits: VipPlanBenefitDTO[];
  couponGrantAmount?: number;
}

export type UserMembershipStatusDTO =
  | 'active'
  | 'expired'
  | 'canceled'
  | 'refunded';

export interface UserMembershipRecordDTO {
  id: string;
  vipPlanId: string;
  vipPlanCode: string;
  status: UserMembershipStatusDTO;
  startedAt: string;
  expiredAt?: string;
  lifetime: boolean;
  plan?: VipPlanRecordDTO;
}

export interface UserMembershipCenterDTO {
  isVip: boolean;
  membership?: UserMembershipRecordDTO;
  plans: VipPlanRecordDTO[];
}

export interface UserMembershipStatusSnapshotDTO {
  isVip: boolean;
  membership?: UserMembershipRecordDTO;
  entitlements: AgentEntitlementSummaryDTO[];
  serverTime: string;
}

export interface SaveAdminVipPlanDTO {
  code: string;
  name: string;
  description?: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency?: string;
  durationDays?: number;
  lifetime?: boolean;
  benefits?: VipPlanBenefitDTO[];
  entitlementGrants?: VipPlanEntitlementGrantDTO[];
  couponGrantAmount?: number;
  status?: VipPlanStatusDTO;
  sort?: number;
}
