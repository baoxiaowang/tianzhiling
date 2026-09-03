export type OrderStatusDTO =
  | 'pending'
  | 'paid'
  | 'granting'
  | 'completed'
  | 'closed'
  | 'refund_requested'
  | 'refunded'
  | 'grant_failed';

export type OrderTypeDTO = 'vip_plan' | 'voice_package';

export interface WechatPaymentParamsDTO {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

export interface WechatVirtualPaymentParamsDTO {
  mode: 'short_series_goods';
  signData: string;
  paySig: string;
  signature: string;
}

export interface OrderRecordDTO {
  id: string;
  orderNo: string;
  orderType: OrderTypeDTO;
  targetId?: string;
  targetCode?: string;
  agentId?: string;
  title: string;
  payableAmount: number;
  currency: string;
  status: OrderStatusDTO;
  paymentProvider?: string;
  createdAt: string;
  paidAt?: string;
}

export interface UserOrderListDTO {
  items: OrderRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export type OrderSourceDTO = 'app' | 'weapp' | 'admin';

export type AdminOrderPaymentTypeDTO = 'normal' | 'virtual';

export type VirtualGoodsProvideStatusDTO =
  | 'pending'
  | 'provided'
  | 'failed';

export type VoiceMembershipDowngradeStatusDTO =
  | 'processing'
  | 'benefits_failed'
  | 'completed'
  | 'failed';

export interface VoiceMembershipDowngradePlanDTO {
  id: string;
  code: string;
  name: string;
  planGroup: 'basic' | 'voice';
  priceAmount: number;
  currency: string;
  durationDays?: number;
  lifetime: boolean;
}

export interface AdminVoiceMembershipDowngradeRecordDTO {
  status: VoiceMembershipDowngradeStatusDTO;
  sourcePlan: VoiceMembershipDowngradePlanDTO;
  targetPlan: VoiceMembershipDowngradePlanDTO;
  refundAmount: number;
  refundNo: string;
  wechatRefundId?: string;
  wechatRefundStatus?: string;
  requestedAt: string;
  completedAt?: string;
  updatedAt: string;
  operatorId?: string;
  operatorAccount?: string;
  failureReason?: string;
}

export type VoiceMembershipFinalRefundStatusDTO =
  | 'processing'
  | 'benefits_processing'
  | 'benefits_failed'
  | 'completed'
  | 'failed';

export interface AdminVoiceMembershipFinalRefundRecordDTO {
  status: VoiceMembershipFinalRefundStatusDTO;
  refundAmount: number;
  refundNo: string;
  attempt: number;
  attemptRequestedAt?: string;
  wechatRefundId?: string;
  wechatRefundStatus?: string;
  requestedAt: string;
  completedAt?: string;
  updatedAt: string;
  failureReason?: string;
}

export interface AdminVoiceMembershipDowngradeTargetDTO
  extends VoiceMembershipDowngradePlanDTO {
  refundAmount: number;
}

export interface AdminVoiceMembershipDowngradePreviewDTO {
  eligible: boolean;
  unavailableReason?: string;
  orderId: string;
  paidAmount: number;
  sourcePlan?: VoiceMembershipDowngradePlanDTO;
  membershipStartedAt?: string;
  membershipExpiredAt?: string;
  membershipLifetime?: boolean;
  targetPlans: AdminVoiceMembershipDowngradeTargetDTO[];
  existingDowngrade?: AdminVoiceMembershipDowngradeRecordDTO;
}

export interface VoiceMembershipDowngradeRequestDTO {
  targetVipPlanId: string;
}

export interface AdminOrderUserDTO {
  id: string;
  account: string;
  name: string;
  phone: string;
  registeredAt?: string;
}

export interface AdminOrderRecordDTO extends OrderRecordDTO {
  userId: string;
  user?: AdminOrderUserDTO;
  amount: number;
  discountAmount: number;
  couponAmount: number;
  paidAmount?: number;
  refundAmount?: number;
  source: OrderSourceDTO;
  paymentProvider?: string;
  paymentTradeNo?: string;
  paymentNotifyAt?: string;
  virtualGoodsProvideStatus?: VirtualGoodsProvideStatusDTO;
  virtualGoodsProvidedAt?: string;
  virtualGoodsProvideFailedAt?: string;
  virtualGoodsProvideError?: string;
  paymentExpiredAt?: string;
  closedAt?: string;
  refundedAt?: string;
  refundRequestedAt?: string;
  refundRejectedAt?: string;
  refundRejection?: {
    action: 'not_refund' | 'rejected';
    operatorId?: string;
    operatorAccount?: string;
    createdAt: string;
  };
  agentUserMessageCount?: number;
  vipPlanGroup?: 'basic' | 'voice';
  vipUpgrade?: boolean;
  voiceMembershipDowngrade?: AdminVoiceMembershipDowngradeRecordDTO;
  voiceMembershipFinalRefund?: AdminVoiceMembershipFinalRefundRecordDTO;
  updatedAt: string;
}

export interface AdminOrderListParamsDTO {
  keyword?: string;
  status?: OrderStatusDTO;
  orderType?: OrderTypeDTO;
  source?: OrderSourceDTO;
  paymentType?: AdminOrderPaymentTypeDTO;
  excludeAdminManual?: boolean;
  createdAtStart?: string;
  createdAtEnd?: string;
  registeredMonth?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminOrderListDTO {
  items: AdminOrderRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateAdminOrderDTO {
  orderType: OrderTypeDTO;
  userId: string;
  vipPlanId?: string;
  voicePackageId?: string;
  agentId?: string;
  replaceActiveVoiceTrainingTask?: boolean;
}

export interface CreateVipPlanOrderDTO {
  vipPlanId: string;
  jsCode: string;
  supportsZeroAmountOrder?: boolean;
}

export interface CreateVoicePackageOrderDTO {
  voicePackageId: string;
  agentId: string;
  jsCode: string;
  materialObjectKeys?: string[];
  materialDurationSeconds?: number;
}

export interface CreateVipPlanOrderResultDTO {
  order: OrderRecordDTO;
  payment?: WechatPaymentParamsDTO;
}

export interface CreateVoicePackageOrderResultDTO
  extends CreateVipPlanOrderResultDTO {
  payment: WechatPaymentParamsDTO;
}

export interface CreateVipPlanVirtualPaymentOrderResultDTO {
  order: OrderRecordDTO;
  virtualPayment?: WechatVirtualPaymentParamsDTO;
}

export interface CreateVoicePackageVirtualPaymentOrderResultDTO
  extends CreateVipPlanVirtualPaymentOrderResultDTO {
  virtualPayment: WechatVirtualPaymentParamsDTO;
}
