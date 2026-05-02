export interface AgentProfileDTO {
  id: string;
  name: string;
  avatar: string;
  sex: number;
  agentCallMe: string;
  iCallAgent: string;
  birthday: string;
  deathDate: string;
  description: string;
  status: number;
  isVip: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentListDTO {
  items: AgentProfileDTO[];
}

export interface CreateAgentDTO {
  name: string;
  sex: number;
  iCallAgent: string;
  agentCallMe: string;
}

export interface UpdateAgentAvatarDTO {
  avatar: string;
}

export interface UpdateAgentProfileDTO {
  name?: string;
  sex?: number;
  iCallAgent?: string;
  agentCallMe?: string;
  birthday?: string;
  deathDate?: string;
  description?: string;
}

export interface AdminAgentOwnerDTO {
  id: string;
  account: string;
  name: string;
  avatar: string;
  phone: string;
}

export interface AdminAgentRecordDTO extends AgentProfileDTO {
  createdUserId: string;
  createdUser: AdminAgentOwnerDTO | null;
}

export interface AdminAgentListParamsDTO {
  keyword?: string;
  sex?: number;
  status?: number;
  page?: number;
  pageSize?: number;
}

export interface AdminAgentListDTO {
  items: AdminAgentRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminAgentConversationUserDTO = AdminAgentOwnerDTO;

export interface AdminAgentConversationLatestMessageDTO {
  id: string;
  role: string;
  type: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface AdminAgentConversationRecordDTO {
  id: string;
  agentId: string;
  userId: string;
  user: AdminAgentConversationUserDTO | null;
  latestMessage: AdminAgentConversationLatestMessageDTO | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAgentConversationListParamsDTO {
  page?: number;
  pageSize?: number;
}

export interface AdminAgentConversationListDTO {
  items: AdminAgentConversationRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminAgentConversationMessageRecordDTO {
  id: string;
  conversationId: string;
  role: string;
  type: string;
  content: string;
  status: string;
  mediaUrl: string;
  mediaMimeType: string;
  mediaTranscript: string;
  mediaDurationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAgentConversationMessageListParamsDTO {
  page?: number;
  pageSize?: number;
}

export interface AdminAgentConversationMessageListDTO {
  items: AdminAgentConversationMessageRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAdminAgentDTO extends UpdateAgentProfileDTO {
  avatar?: string;
  status?: number;
}
