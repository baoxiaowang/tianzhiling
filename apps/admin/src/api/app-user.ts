import axios from 'axios';
import type {
  AdminAgentListDTO,
  AdminAgentListParamsDTO,
  AdminAgentRecordDTO,
} from '@tzl/shared';

export type AppUserAgentRecord = AdminAgentRecordDTO;
export type AppUserAgentListRes = AdminAgentListDTO;
export type AppUserAgentListParams = Pick<
  AdminAgentListParamsDTO,
  'keyword' | 'page' | 'pageSize'
>;

export interface AppUserRecord {
  id: string;
  account: string;
  name: string;
  avatar: string;
  phone: string;
  phoneVerified: boolean;
  isVip: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppUserListParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AppUserListRes {
  items: AppUserRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAppUserData {
  name?: string;
  avatar?: string;
}

export function queryAppUserList(params: AppUserListParams) {
  return axios.get<AppUserListRes>('/admin_api/app-users', { params });
}

export function queryAppUserDetail(id: string) {
  return axios.get<AppUserRecord>(`/admin_api/app-users/${id}`);
}

export function queryAppUserAgents(id: string, params: AppUserAgentListParams) {
  return axios.get<AppUserAgentListRes>(`/admin_api/app-users/${id}/agents`, {
    params,
  });
}

export function updateAppUser(id: string, data: UpdateAppUserData) {
  return axios.put<AppUserRecord>(`/admin_api/app-users/${id}`, data);
}
