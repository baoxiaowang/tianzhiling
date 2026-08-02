export const AGENT_PROFILE_RETURNING_GREETING =
  "你好，又见面了。我还记得你之前讲过的那些事。今天想从哪里继续，都可以。";

export const AGENT_CREATE_MESSENGER_GREETING =
  "你好，我是天之灵小使者。先告诉我，你想唤醒谁的天之灵？";
export const AGENT_CREATE_NAME_QUESTION =
  "你希望他在聊天列表里叫什么？建议用微信昵称或备注名，也可以使用你对他的称呼或真实姓名。";
export const AGENT_CREATE_GENDER_QUESTION =
  "谢谢，我记住了。他是男性还是女性？";
export const AGENT_CREATE_USER_CALL_QUESTION =
  "还差一个称呼。他平时会怎么叫你？";
export const AGENT_CREATE_AVATAR_QUESTION =
  "基本信息都记好了。为他选张头像吧，也可以稍后再补。";

export type AgentCreateGuideField =
  | "relationToThem"
  | "agentName"
  | "relationToMe";

export type AgentCreateGuideGender = "male" | "female" | "";

export interface AgentCreateGuideDraftDTO {
  relationToThem: string;
  realName: string;
  agentName: string;
  gender: AgentCreateGuideGender;
  relationToMe: string;
}

export interface AgentCreateGuideRequestDTO {
  input: string;
  draft?: Partial<AgentCreateGuideDraftDTO>;
  focusField?: AgentCreateGuideField | "";
  turnCount?: number;
}

export interface AgentCreateGuideResultDTO {
  reply: string;
  draft: AgentCreateGuideDraftDTO;
  coveredFields: AgentCreateGuideField[];
  nextFocusField: AgentCreateGuideField | "";
  isComplete: boolean;
}

export interface AgentProfileDTO {
  id: string;
  name: string;
  realName?: string;
  avatar: string;
  sex: number;
  agentCallMe: string;
  iCallAgent: string;
  birthday: string;
  deathDate: string;
  description: string;
  lifeExperience: string;
  personalityTraits: string;
  languageHabits: string;
  hobbies: string;
  sharedMemories: string;
  hasUnreadAgentHomeGuide: boolean;
  hasUnreadAgentProfileGuide: boolean;
  status: number;
  isDefault: boolean;
  voiceTimbreId?: string;
  createdAt: string;
  updatedAt: string;
  accessRole?: "owner" | "shared";
}

export interface AgentListDTO {
  items: AgentProfileDTO[];
}

export interface AgentShareInviteDTO {
  token: string;
  agentId: string;
  ownerUserId: string;
  createdByUserId: string;
  expiresAt: string;
}

export interface AgentShareInvitePreviewDTO {
  inviter: {
    name: string;
    avatar: string;
  };
  agent: {
    name: string;
    realName: string;
    avatar: string;
    sex: number;
    description: string;
  };
  expiresAt: string;
}

export interface AgentShareQRCodeRequestDTO {
  token: string;
}

export interface AgentShareQRCodeDTO {
  imageBase64: string;
  mimeType: "image/png";
  expiresAt: string;
}

export interface AcceptAgentShareInviteRequestDTO {
  token: string;
}

export type AgentShareAccessStatus = "owner" | "active";

export interface AgentShareAccessDTO {
  agentId: string;
  ownerUserId: string;
  userId: string;
  status: AgentShareAccessStatus;
  acceptedAt: string;
}

export interface AcceptAgentShareInviteResultDTO {
  agent: AgentProfileDTO;
  conversationId: string;
  share: AgentShareAccessDTO;
}

export interface UpdateAgentShareContextDTO {
  agentCallsUser?: string;
  userCallsAgent?: string;
}

export interface CreateAgentDTO {
  name: string;
  realName?: string;
  sex: number;
  iCallAgent: string;
  agentCallMe: string;
}

export interface UpdateAgentAvatarDTO {
  avatar: string;
}

export interface UpdateAgentDefaultDTO {
  isDefault: boolean;
}

export interface UpdateAgentProfileDTO {
  name?: string;
  realName?: string;
  sex?: number;
  iCallAgent?: string;
  agentCallMe?: string;
  birthday?: string;
  deathDate?: string;
  description?: string;
  lifeExperience?: string;
  personalityTraits?: string;
  languageHabits?: string;
  hobbies?: string;
  sharedMemories?: string;
}

export type AgentProfileMemoryField =
  | "lifeExperience"
  | "personalityTraits"
  | "languageHabits"
  | "hobbies"
  | "sharedMemories";

export type AgentProfileInterviewDraftDTO = Record<
  AgentProfileMemoryField,
  string
>;

export interface AgentProfileInterviewRequestDTO {
  input: string;
  draft?: Partial<AgentProfileInterviewDraftDTO>;
  focusField?: AgentProfileMemoryField | "";
  turnCount?: number;
}

export interface AgentProfileInterviewResultDTO {
  reply: string;
  draft: AgentProfileInterviewDraftDTO;
  coveredFields: AgentProfileMemoryField[];
  nextFocusField: AgentProfileMemoryField | "";
  isComplete: boolean;
}

export interface AgentProfileMessengerSpeechRequestDTO {
  text: string;
}

export interface AgentProfileMessengerSpeechResultDTO {
  url: string;
  voice: string;
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
  customContext: string;
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
  isArchived?: boolean;
  archivedAt?: string;
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
  isArchived?: boolean;
  archivedAt?: string;
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
  voiceTimbreId?: string;
  customContext?: string;
}
