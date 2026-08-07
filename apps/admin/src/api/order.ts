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

export function syncVoiceMembershipDowngrade(id: string) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/voice-membership-downgrade/sync`,
    undefined,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}
