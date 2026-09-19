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
  selfFacts: Array<{
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

/** 后台“可检索原话”：已进检索索引、且来源仍有效的聊天证据。 */
export interface AppUserIndexedEvidenceItem {
  id: string;
  sourceMessageId: string;
  conversationId: string;
  role: string;
  text: string;
  createdAt: string;
  sourceValid: boolean;
  sourceContent: string;
  sourceCreatedAt: string;
}

export interface AppUserIndexedEvidenceListRes {
  /** 索引是否可用；false 时前端显示“暂不可用”，不能显示“没有记忆”。 */
  available: boolean;
  unavailableReason: string;
  items: AppUserIndexedEvidenceItem[];
  /** 索引内匹配总条数（全量口径，含来源后续失效的行）。 */
  total: number;
  /** 本页索引行数（来源校验前）。 */
  pageIndexRows: number;
  /** 本页有效来源条数。 */
  pageValidCount: number;
  /** 本页来源失效条数。 */
  pageInvalidCount: number;
  page: number;
  pageSize: number;
}

export function queryAppUserIndexedEvidence(
  userId: string,
  agentId: string,
  params?: { page?: number; pageSize?: number }
) {
  return axios.get<AppUserIndexedEvidenceListRes>(
    `/admin_api/app-users/${userId}/agents/${agentId}/indexed-evidence`,
    { params }
  );
}

/** 后台「核心信息」只读视图：当前采用值 + 来源 + 未采用原因。 */
export type CoreSourceKind =
  | 'user_explicit'
  | 'user_correction'
  | 'profile_field'
  | 'import_style'
  | 'product_derived'
  | 'summary';

export interface CoreSourceView {
  kind: CoreSourceKind;
  label: string;
  messageId: string;
  conversationId: string;
  batchId: string;
  field: string;
  at: string;
}

export type CoreEntryStatus = 'adopted' | 'pending' | 'rejected';

export interface CoreEntryView {
  value: string;
  status: CoreEntryStatus;
  subject: string;
  source: CoreSourceView | null;
  derivedFrom: CoreSourceView | null;
  updatedAt: string;
  reason: string;
}

export interface CoreAddressSection {
  userCallsAgent: CoreEntryView | null;
  agentCallsUser: CoreEntryView | null;
  agentAliases: string[];
  userAliases: string[];
  candidates: CoreEntryView[];
  note: string;
}

export interface CoreDateItem {
  eventType: string;
  eventLabel: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  year: number | null;
  monthDay: string;
  exactDate: string;
  calendar: string;
  precision: string;
  resolutionCertainty: string;
  conflictStatus: string;
  status: CoreEntryStatus;
  reason: string;
  source: CoreSourceView | null;
  updatedAt: string;
  note: string;
}

export interface CoreDateSection {
  items: CoreDateItem[];
  projections: Array<{
    field: string;
    label: string;
    value: string;
    note: string;
  }>;
  note: string;
}

export interface CoreImportDimension {
  key: string;
  label: string;
  value: string;
  batchId: string;
  confidence: number | null;
  source: CoreSourceView | null;
  updatedAt: string;
}

export interface CoreLanguageSection {
  hometown: {
    province: string;
    value: string;
    source: CoreSourceView | null;
    updatedAt: string;
  } | null;
  adopted: CoreEntryView | null;
  superseded: CoreEntryView[];
  explicitPreference: CoreEntryView | null;
  profileLanguageHabits: string;
  importDimensions: CoreImportDimension[];
  notes: string[];
}

export interface CorePersonalitySection {
  traits: Array<{ value: string; source: CoreSourceView | null }>;
  note: string;
}

export interface CoreFamilyItem {
  key: string;
  value: string;
  personLabel: string;
  status: string;
  learnedAt: string;
  updatedAt: string;
  stability: 'stable' | 'possibly_changing' | 'unknown';
  stabilityLabel: string;
  entryStatus: CoreEntryStatus;
  reason: string;
  source: CoreSourceView | null;
}

export interface CoreFamilySection {
  items: CoreFamilyItem[];
  note: string;
}

export interface AppUserAgentCoreInfoRes {
  userId: string;
  agentId: string;
  agentName: string;
  generatedAt: string;
  addresses: CoreAddressSection;
  dates: CoreDateSection;
  language: CoreLanguageSection;
  personality: CorePersonalitySection;
  family: CoreFamilySection;
  limitations: string[];
}

/** 只读：按用户 + 聊天对象读取核心信息（当前采用值、来源与未采用原因）。 */
export function queryAppUserAgentCoreInfo(userId: string, agentId: string) {
  return axios.get<AppUserAgentCoreInfoRes>(
    `/admin_api/app-users/${userId}/agents/${agentId}/core-info`
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
