import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type {
  AdminOrderListDTO,
  AdminOrderListParamsDTO,
  AdminOrderRecordDTO,
  CreateAdminOrderDTO,
} from '@tzl/shared';

interface TzlAxiosRequestConfig extends AxiosRequestConfig {
  hideErrorMessage?: boolean;
}

export type OrderRecord = AdminOrderRecordDTO;
export type OrderListParams = AdminOrderListParamsDTO;
export type OrderListRes = AdminOrderListDTO;
export type CreateAdminOrderData = CreateAdminOrderDTO;

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

export function syncOrderPaymentStatus(id: string) {
  return axios.post<OrderRecord>(
    `/admin_api/orders/${id}/sync-payment`,
    undefined,
    {
      hideErrorMessage: true,
    } as TzlAxiosRequestConfig
  );
}
