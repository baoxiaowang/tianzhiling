import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type {
  AdminOrderListDTO,
  AdminOrderListParamsDTO,
  AdminOrderRecordDTO,
  AdminVoiceMembershipDowngradePreviewDTO,
  CreateAdminOrderDTO,
  VoiceMembershipDowngradeRequestDTO,
} from '@tzl/shared';

interface TzlAxiosRequestConfig extends AxiosRequestConfig {
  hideErrorMessage?: boolean;
}

export type OrderRecord = AdminOrderRecordDTO;
export type OrderListParams = AdminOrderListParamsDTO;
export type OrderListRes = AdminOrderListDTO;
export type CreateAdminOrderData = CreateAdminOrderDTO;
export type VoiceMembershipDowngradePreview =
  AdminVoiceMembershipDowngradePreviewDTO;

export function queryOrderList(params: OrderListParams) {
  return axios.get<OrderListRes>('/admin_api/orders', { params });
}

export function createAdminOrder(data: CreateAdminOrderData) {
  return axios.post<OrderRecord>('/admin_api/orders', data, {
    hideErrorMessage: true,
  } as TzlAxiosRequestConfig);
}

export function refundOrder(id: string) {
  return axios.post<OrderRecord>(`/admin_api/orders/${id}/refund`, undefined, {
    hideErrorMessage: true,
  } as TzlAxiosRequestConfig);
}

export function rejectRefundOrder(
  id: string,
  action: 'not_refund' | 'rejected'
) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/reject-refund`,
    { action },
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}

export function revokeAdminManualOrder(id: string) {
  return axios.post<OrderRecord>(`/admin_api/orders/${id}/revoke`, undefined, {
    hideErrorMessage: true,
  } as TzlAxiosRequestConfig);
}

export function syncOrderPaymentStatus(id: string) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/sync-payment`,
    undefined,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}

export function getVoiceMembershipDowngradePreview(id: string) {
  return axios.get<VoiceMembershipDowngradePreview>(
    `/admin_api/orders/${id}/voice-membership-downgrade`,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}

export function downgradeVoiceMembership(
  id: string,
  data: VoiceMembershipDowngradeRequestDTO
) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/voice-membership-downgrade`,
    data,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}

/**
 * 在原订单上重新发起「失败的降级退款」。
 * 后端会换用新的微信退款单号并回查确认；当前不是失败状态时返回 409。
 */
export function retryVoiceMembershipDowngradeRefund(id: string) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/voice-membership-downgrade/retry-refund`,
    undefined,
    {
      timeout: 60000,
    }
  );
}

export function syncVoiceMembershipDowngrade(id: string) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/voice-membership-downgrade/sync`,
    undefined,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}

export function withdrawVoiceMembershipDowngrade(id: string) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/voice-membership-downgrade/withdraw`,
    undefined,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}
