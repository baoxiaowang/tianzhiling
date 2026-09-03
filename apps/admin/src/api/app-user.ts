import axios from 'axios';
import type {
  AdminAgentListDTO,
  AdminAgentListParamsDTO,
  AdminAgentRecordDTO,
  AdminPostListDTO,
  AdminPostListParamsDTO,
} from '@tzl/shared';

export type AppUserAgentRecord = AdminAgentRecordDTO;
export type AppUserAgentListRes = AdminAgentListDTO;
export type AppUserAgentListParams = Pick<
  AdminAgentListParamsDTO,
  'keyword' | 'page' | 'pageSize'
>;
export type AppUserPostListRes = AdminPostListDTO;
export type AppUserPostListParams = Pick<
  AdminPostListParamsDTO,
  'keyword' | 'moderationStatus' | 'page' | 'pageSize'
>;

export interface AppUserRecord {
  id: string;
  account: string;
  name: string;
  avatar: string;
  phone: string;
  phoneVerified: boolean;
  isVip: boolean;
  isRiskControlled: boolean;
  riskControlUntilAt: string;
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

export type AppUserMembershipType = 'one_year' | 'three_year' | 'lifetime';

export interface AppUserMemberRecord extends AppUserRecord {
  membershipType: AppUserMembershipType;
  membershipStartedAt: string;
  membershipExpiredAt: string;
}

export interface AppUserMemberListParams extends AppUserListParams {
  membershipType?: AppUserMembershipType;
}

export interface AppUserVoiceServiceRecord extends AppUserRecord {
  serviceStatus: 'pending' | 'servicing' | 'refunded';
  purchasedAmounts: number[];
  latestPurchasedAt: string;
}

export interface AppUserVoiceServiceListParams extends AppUserListParams {
  serviceStatus?: 'pending' | 'servicing' | 'refunded';
}

export interface UpdateAppUserData {
  name?: string;
  avatar?: string;
  riskControlUntilAt?: string;
}

export function queryAppUserList(params: AppUserListParams) {
  return axios.get<AppUserListRes>('/admin_api/app-users', { params });
}

export function queryAppUserMembers(params: AppUserMemberListParams) {
  return axios.get<
    Omit<AppUserListRes, 'items'> & { items: AppUserMemberRecord[] }
  >('/admin_api/app-users/members', { params });
}

export function queryAppUserVoiceServices(
  params: AppUserVoiceServiceListParams
) {
  return axios.get<
    Omit<AppUserListRes, 'items'> & { items: AppUserVoiceServiceRecord[] }
  >('/admin_api/app-users/voice-services', { params });
}

export function startAppUserVoiceService(userId: string) {
  return axios.post<{
    userId: string;
    serviceStatus: 'servicing';
    startedAt: string;
  }>(`/admin_api/app-users/${userId}/voice-service/start`);
}

export function queryAppUserDetail(id: string) {
  return axios.get<AppUserRecord>(`/admin_api/app-users/${id}`);
}

export function queryAppUserAgents(id: string, params: AppUserAgentListParams) {
  return axios.get<AppUserAgentListRes>(`/admin_api/app-users/${id}/agents`, {
    params,
  });
}

export function queryAppUserPosts(id: string, params: AppUserPostListParams) {
  return axios.get<AppUserPostListRes>(`/admin_api/app-users/${id}/posts`, {
    params,
  });
}

export function updateAppUser(id: string, data: UpdateAppUserData) {
  return axios.put<AppUserRecord>(`/admin_api/app-users/${id}`, data);
}
