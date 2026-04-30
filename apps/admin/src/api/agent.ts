import axios from 'axios';
import type {
  AdminAgentConversationListDTO,
  AdminAgentConversationListParamsDTO,
  AdminAgentConversationMessageListDTO,
  AdminAgentConversationMessageListParamsDTO,
  AdminAgentConversationMessageRecordDTO,
  AdminAgentConversationRecordDTO,
  AdminAgentListDTO,
  AdminAgentListParamsDTO,
  AdminAgentOwnerDTO,
  AdminAgentRecordDTO,
  UpdateAdminAgentDTO,
} from '@tzl/shared';

export type AgentOwner = AdminAgentOwnerDTO;
export type AgentRecord = AdminAgentRecordDTO;
export type AgentListParams = AdminAgentListParamsDTO;
export type AgentListRes = AdminAgentListDTO;
export type UpdateAgentData = UpdateAdminAgentDTO;
export type AgentConversationRecord = AdminAgentConversationRecordDTO;
export type AgentConversationListParams = AdminAgentConversationListParamsDTO;
export type AgentConversationListRes = AdminAgentConversationListDTO;
export type AgentConversationMessageRecord =
  AdminAgentConversationMessageRecordDTO;
export type AgentConversationMessageListParams =
  AdminAgentConversationMessageListParamsDTO;
export type AgentConversationMessageListRes =
  AdminAgentConversationMessageListDTO;

export function queryAgentList(params: AgentListParams) {
  return axios.get<AgentListRes>('/admin_api/agents', { params });
}

export function queryAgentDetail(id: string) {
  return axios.get<AgentRecord>(`/admin_api/agents/${id}`);
}

export function queryAgentConversations(
  id: string,
  params: AgentConversationListParams
) {
  return axios.get<AgentConversationListRes>(
    `/admin_api/agents/${id}/conversations`,
    { params }
  );
}

export function queryAgentConversationMessages(
  id: string,
  conversationId: string,
  params: AgentConversationMessageListParams
) {
  return axios.get<AgentConversationMessageListRes>(
    `/admin_api/agents/${id}/conversations/${conversationId}/messages`,
    { params }
  );
}

export function updateAgent(id: string, data: UpdateAgentData) {
  return axios.put<AgentRecord>(`/admin_api/agents/${id}`, data);
}
