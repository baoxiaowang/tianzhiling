import axios from 'axios';
import type {
  AdminVipPlanListDTO,
  AdminVipPlanListParamsDTO,
  AdminVipPlanRecordDTO,
  SaveAdminVipPlanDTO,
  VipPlanGroupDTO,
} from '@tzl/shared';

export type VipPlanRecord = AdminVipPlanRecordDTO;
export type VipPlanGroup = VipPlanGroupDTO;
export type VipPlanListParams = AdminVipPlanListParamsDTO;
export type VipPlanListRes = AdminVipPlanListDTO;
export type SaveVipPlanData = SaveAdminVipPlanDTO;

export function queryVipPlanList(params: VipPlanListParams) {
  return axios.get<VipPlanListRes>('/admin_api/vip-plans', { params });
}

export function createVipPlan(data: SaveVipPlanData) {
  return axios.post<VipPlanRecord>('/admin_api/vip-plans', data);
}

export function updateVipPlan(id: string, data: SaveVipPlanData) {
  return axios.put<VipPlanRecord>(`/admin_api/vip-plans/${id}`, data);
}
