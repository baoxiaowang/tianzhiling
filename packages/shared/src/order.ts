export type OrderStatusDTO =
  | 'pending'
  | 'paid'
  | 'granting'
  | 'completed'
  | 'closed'
  | 'refunded'
  | 'grant_failed';

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
  orderType: 'vip_plan';
  targetId?: string;
  targetCode?: string;
  title: string;
  payableAmount: number;
  currency: string;
  status: OrderStatusDTO;
  createdAt: string;
  paidAt?: string;
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
  orderType?: 'vip_plan';
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

export interface CreateVipPlanOrderResultDTO {
  order: OrderRecordDTO;
  payment: WechatPaymentParamsDTO;
}
