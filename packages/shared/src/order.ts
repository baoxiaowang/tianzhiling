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

export interface CreateVipPlanOrderDTO {
  vipPlanId: string;
  jsCode: string;
}

export interface CreateVipPlanOrderResultDTO {
  order: OrderRecordDTO;
  payment: WechatPaymentParamsDTO;
}
