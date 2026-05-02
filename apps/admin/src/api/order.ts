import axios from 'axios';
import type {
  AdminOrderListDTO,
  AdminOrderListParamsDTO,
  AdminOrderRecordDTO,
} from '@tzl/shared';

export type OrderRecord = AdminOrderRecordDTO;
export type OrderListParams = AdminOrderListParamsDTO;
export type OrderListRes = AdminOrderListDTO;

export function queryOrderList(params: OrderListParams) {
  return axios.get<OrderListRes>('/admin_api/orders', { params });
}
