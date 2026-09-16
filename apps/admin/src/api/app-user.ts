import axios from 'axios';
import type {
  AdminAgentListDTO,
  AdminAgentListParamsDTO,
  AdminAgentRecordDTO,
  AdminAppUserMessengerMessageDTO,
  AdminAppUserMessengerMessageListDTO,
  AdminPostListDTO,
  AdminPostListParamsDTO,
  SendAdminAppUserMessengerMessageRequestDTO,
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

export interface AppUserAccountMemory {
  identity: {
    realName: string;
    formerNames: string[];
    aliases: string[];
    source: string;
    sourceText: string;
    updatedAt: string;
  } | null;
  people: Array<{
    id: string;
    realName: string;
    preferredName: string;
    aliases: string[];
    relationToUser: string;
    sourceText: string;
    updatedAt: string;
    profile: {
      lifeStage: string;
      sex: string;
      birthDate: string;
      birthYear?: number;
      relationshipsToAgents: Array<{
        agentId: string;
        relationToAgent: string;
        personCallsAgent: string;
      }>;
    } | null;
    facts: Array<{
      id: string;
      domain: string;
      key: string;
      value: string;
      status: string;
      confidence: string;
      supportCount: number;
      sourceText: string;
      updatedAt: string;
    }>;
  }>;
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

export function queryAppUserAccountMemory(id: string) {
  return axios.get<AppUserAccountMemory>(
    `/admin_api/app-users/${id}/account-memory`
  );
}

export function queryAppUserMessengerMessages(
  userId: string,
  agentId: string,
  params?: { before?: string; pageSize?: number }
) {
  return axios.get<AdminAppUserMessengerMessageListDTO>(
    `/admin_api/app-users/${userId}/agents/${agentId}/messenger-messages`,
    { params }
  );
}

/** 只读：按用户 + 聊天对象读取聊天记录（含非小使者的角色智能体）。 */
export function queryAppUserAgentMessages(
  userId: string,
  agentId: string,
  params?: { before?: string; pageSize?: number }
) {
  return axios.get<AdminAppUserMessengerMessageListDTO>(
    `/admin_api/app-users/${userId}/agents/${agentId}/messages`,
    { params }
  );
}

export interface AppUserAgentMemoryItem {
  id: string;
  scope: 'agent';
  type: string;
  key: string;
  value: string;
  polarity: string;
  status: string;
  confidence: string;
  assertionPolicy: string;
  priority: number;
  sourceMessageId: string;
  sourceMessageIds: string[];
  sourceConversationId: string;
  sourceText: string;
  retention: string;
  certainty: string;
  timeKind: string;
  validUntil: string;
  sourceOccurredAt: string;
  recordedAt: string;
  updatedAt: string;
}

export interface AppUserAccountSharedMemoryItem {
  id: string;
  scope: 'account';
  type: string;
  key: string;
  value: string;
  status: string;
  confidence: string;
  sourceText: string;
  updatedAt: string;
}

export interface AppUserAgentMemoryListRes {
  items: AppUserAgentMemoryItem[];
  total: number;
  page: number;
  pageSize: number;
  accountSharedItems: AppUserAccountSharedMemoryItem[];
  accountSharedTotal: number;
}

/** 只读：按用户 + 聊天对象分页读取已留存记忆。 */
export function queryAppUserAgentMemories(
  userId: string,
  agentId: string,
  params?: { page?: number; pageSize?: number }
) {
  return axios.get<AppUserAgentMemoryListRes>(
    `/admin_api/app-users/${userId}/agents/${agentId}/memories`,
    { params }
  );
}

export function sendAppUserMessengerMessage(
  userId: string,
  agentId: string,
  data: SendAdminAppUserMessengerMessageRequestDTO
) {
  return axios.post<AdminAppUserMessengerMessageDTO>(
    `/admin_api/app-users/${userId}/agents/${agentId}/messenger-messages`,
    data
  );
}

export function queryAppUserPosts(id: string, params: AppUserPostListParams) {
  return axios.get<AppUserPostListRes>(`/admin_api/app-users/${id}/posts`, {
    params,
  });
}

export function updateAppUser(id: string, data: UpdateAppUserData) {
  return axios.put<AppUserRecord>(`/admin_api/app-users/${id}`, data);
}
