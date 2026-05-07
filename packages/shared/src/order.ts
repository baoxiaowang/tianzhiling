export type OrderStatusDTO =
  | 'pending'
  | 'paid'
  | 'granting'
  | 'completed'
  | 'closed'
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

export interface AdminOrderUserDTO {
  id: string;
  account: string;
  name: string;
  phone: string;
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
  paymentExpiredAt?: string;
  closedAt?: string;
  refundedAt?: string;
  updatedAt: string;
}

export interface AdminOrderListParamsDTO {
  keyword?: string;
  status?: OrderStatusDTO;
  orderType?: OrderTypeDTO;
  source?: OrderSourceDTO;
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

export interface CreateVipPlanOrderDTO {
  vipPlanId: string;
  jsCode: string;
}

export interface CreateVoicePackageOrderDTO {
  voicePackageId: string;
  agentId: string;
  jsCode: string;
}

export interface CreateVipPlanOrderResultDTO {
  order: OrderRecordDTO;
  payment: WechatPaymentParamsDTO;
}

export type CreateVoicePackageOrderResultDTO = CreateVipPlanOrderResultDTO;
