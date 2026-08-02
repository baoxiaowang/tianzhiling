import { del, get, patch, post } from "../api/api-client";
import type {
  AcceptAgentShareInviteResultDTO,
  AgentCreateGuideDraftDTO,
  AgentCreateGuideField,
  AgentCreateGuideRequestDTO,
  AgentCreateGuideResultDTO,
  AgentProfileInterviewDraftDTO,
  AgentProfileInterviewRequestDTO,
  AgentProfileInterviewResultDTO,
  AgentProfileMessengerSpeechResultDTO,
  AgentProfileMemoryField,
  AgentShareAccessDTO,
  AgentShareInviteDTO,
  AgentShareInvitePreviewDTO,
  AgentShareQRCodeDTO,
  AgentProfileDTO,
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentDefaultDTO,
  UpdateAgentProfileDTO,
  UpdateAgentShareContextDTO,
} from "@tzl/shared";
import {
  invalidateConversationListCache,
  updateCachedConversationDefault,
} from "./conversation";

export interface AgentSummary {
  id: string;
  name: string;
  realName: string;
  avatar: string;
  sex: number;
  agentCallMe: string;
  iCallAgent: string;
  birthday: Date | null;
  deathDate: Date | null;
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
  voiceTimbreId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  accessRole: "owner" | "shared";
}

interface AgentListResponse {
  items?: unknown[];
}

type CreateAgentPayload = CreateAgentDTO;
type UpdateAgentProfilePayload = UpdateAgentProfileDTO;

export interface AcceptedAgentShareInvite {
  agent: AgentSummary;
  conversationId: string;
  share: AgentShareAccessDTO;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const PROFILE_MEMORY_FIELDS: AgentProfileMemoryField[] = [
  "lifeExperience",
  "personalityTraits",
  "languageHabits",
  "hobbies",
  "sharedMemories",
];

function parseAgentProfileDraft(value: unknown): AgentProfileInterviewDraftDTO {
  const raw = asRecord(value);

  return PROFILE_MEMORY_FIELDS.reduce((draft, field) => {
    draft[field] = asString(raw[field]);
    return draft;
  }, {} as AgentProfileInterviewDraftDTO);
}

function parseAgentProfileMemoryField(
  value: unknown
): AgentProfileMemoryField | "" {
  return typeof value === "string" &&
    PROFILE_MEMORY_FIELDS.includes(value as AgentProfileMemoryField)
    ? (value as AgentProfileMemoryField)
    : "";
}

const CREATE_GUIDE_FIELDS: AgentCreateGuideField[] = [
  "relationToThem",
  "agentName",
  "relationToMe",
];

function parseAgentCreateGuideField(
  value: unknown
): AgentCreateGuideField | "" {
  return typeof value === "string" &&
    CREATE_GUIDE_FIELDS.includes(value as AgentCreateGuideField)
    ? (value as AgentCreateGuideField)
    : "";
}

function parseAgentCreateGuideDraft(value: unknown): AgentCreateGuideDraftDTO {
  const raw = asRecord(value);
  const rawGender = asString(raw.gender);

  return {
    relationToThem: asString(raw.relationToThem),
    realName: asString(raw.realName),
    agentName: asString(raw.agentName),
    gender: rawGender === "male" || rawGender === "female" ? rawGender : "",
    relationToMe: asString(raw.relationToMe),
  };
}

export function parseAgentSummary(value: unknown): AgentSummary {
  const raw = asRecord(value);

  return {
    id: asString(raw.id),
    name: asString(raw.name),
    realName: asString(raw.realName),
    avatar: asString(raw.avatar),
    sex: asNumber(raw.sex),
    agentCallMe: asString(raw.agentCallMe),
    iCallAgent: asString(raw.iCallAgent),
    birthday: asDate(raw.birthday),
    deathDate: asDate(raw.deathDate),
    description: asString(raw.description),
    lifeExperience: asString(raw.lifeExperience),
    personalityTraits: asString(raw.personalityTraits),
    languageHabits: asString(raw.languageHabits),
    hobbies: asString(raw.hobbies),
    sharedMemories: asString(raw.sharedMemories),
    hasUnreadAgentHomeGuide: Boolean(raw.hasUnreadAgentHomeGuide),
    hasUnreadAgentProfileGuide: Boolean(raw.hasUnreadAgentProfileGuide),
    status: asNumber(raw.status),
    isDefault: Boolean(raw.isDefault),
    voiceTimbreId: asString(raw.voiceTimbreId),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
    accessRole: asString(raw.accessRole) === "shared" ? "shared" : "owner",
  };
}

export async function createAgent(payload: CreateAgentPayload) {
  const data = await post<AgentProfileDTO>("/api/agent", {
    name: payload.name,
    realName: payload.realName,
    sex: payload.sex,
    iCallAgent: payload.iCallAgent,
    agentCallMe: payload.agentCallMe,
  });
  invalidateConversationListCache();

  return parseAgentSummary(data);
}

export async function interviewAgentCreation(
  payload: AgentCreateGuideRequestDTO
): Promise<AgentCreateGuideResultDTO> {
  const data = await post<AgentCreateGuideResultDTO>(
    "/api/agent/create-interview",
    payload
  );
  const raw = asRecord(data);
  const draft = parseAgentCreateGuideDraft(raw.draft);
  const coveredFields = Array.isArray(raw.coveredFields)
    ? raw.coveredFields
        .map(parseAgentCreateGuideField)
        .filter((field): field is AgentCreateGuideField => Boolean(field))
    : [];

  return {
    reply: asString(raw.reply),
    draft,
    coveredFields,
    nextFocusField: parseAgentCreateGuideField(raw.nextFocusField),
    isComplete: Boolean(raw.isComplete),
  };
}

export async function createAgentCreationMessengerSpeech(text: string) {
  const data = await post<AgentProfileMessengerSpeechResultDTO>(
    "/api/agent/create-messenger-speech",
    { text },
    { timeout: 10000 }
  );
  const raw = asRecord(data);

  return {
    url: asString(raw.url),
    voice: asString(raw.voice),
  };
}

export async function getAgents() {
  const data = await get<AgentListResponse>("/api/agent/accessible");

  return Array.isArray(data.items)
    ? data.items.map((item) => parseAgentSummary(item))
    : [];
}

export async function updateAgentAvatar(agentId: string, avatar: string) {
  const data = await patch<AgentProfileDTO>(`/api/agent/${agentId}/avatar`, {
    avatar,
  } satisfies UpdateAgentAvatarDTO);
  invalidateConversationListCache();

  return parseAgentSummary(data);
}

export async function updateAgentProfile(
  agentId: string,
  payload: UpdateAgentProfilePayload
) {
  const data = await patch<AgentProfileDTO>(`/api/agent/${agentId}`, payload);
  invalidateConversationListCache();

  return parseAgentSummary(data);
}

export async function updateAgentDefault(
  agentId: string,
  payload: UpdateAgentDefaultDTO
) {
  const data = await patch<AgentProfileDTO>(
    `/api/agent/${agentId}/default`,
    payload
  );
  const agent = parseAgentSummary(data);
  updateCachedConversationDefault(agent.id, agent.isDefault);

  return agent;
}

export async function getAgentDetail(agentId: string) {
  const data = await get<AgentProfileDTO>(`/api/agent/${agentId}`);

  return parseAgentSummary(data);
}

export async function createAgentShareInvite(
  agentId: string
): Promise<AgentShareInviteDTO> {
  const data = await post<AgentShareInviteDTO>(
    `/api/agent/${agentId}/share-invites`,
    {}
  );
  const raw = asRecord(data);

  return {
    token: asString(raw.token),
    agentId: asString(raw.agentId),
    ownerUserId: asString(raw.ownerUserId),
    createdByUserId: asString(raw.createdByUserId),
    expiresAt: asString(raw.expiresAt),
  };
}

export async function getAgentShareInvitePreview(
  token: string
): Promise<AgentShareInvitePreviewDTO> {
  const data = await get<AgentShareInvitePreviewDTO>(
    `/api/agent-share/${encodeURIComponent(token)}/preview`
  );
  const raw = asRecord(data);
  const rawInviter = asRecord(raw.inviter);
  const rawAgent = asRecord(raw.agent);

  return {
    inviter: {
      name: asString(rawInviter.name),
      avatar: asString(rawInviter.avatar),
    },
    agent: {
      name: asString(rawAgent.name),
      realName: asString(rawAgent.realName),
      avatar: asString(rawAgent.avatar),
      sex: asNumber(rawAgent.sex),
      description: asString(rawAgent.description),
    },
    expiresAt: asString(raw.expiresAt),
  };
}

export async function createAgentShareQRCode(
  token: string
): Promise<AgentShareQRCodeDTO> {
  const data = await post<AgentShareQRCodeDTO>(
    "/api/agent/share-invites/qrcode",
    { token }
  );
  const raw = asRecord(data);

  return {
    imageBase64: asString(raw.imageBase64),
    mimeType: "image/png",
    expiresAt: asString(raw.expiresAt),
  };
}

export async function acceptAgentShareInvite(
  token: string
): Promise<AcceptedAgentShareInvite> {
  const data = await post<AcceptAgentShareInviteResultDTO>(
    "/api/agent/share-invites/accept",
    { token }
  );
  const raw = asRecord(data);
  const rawShare = asRecord(raw.share);

  const status = asString(rawShare.status);

  invalidateConversationListCache();

  return {
    agent: parseAgentSummary(raw.agent),
    conversationId: asString(raw.conversationId),
    share: {
      agentId: asString(rawShare.agentId),
      ownerUserId: asString(rawShare.ownerUserId),
      userId: asString(rawShare.userId),
      status: status === "owner" ? "owner" : "active",
      acceptedAt: asString(rawShare.acceptedAt),
    },
  };
}

export async function updateAgentShareContext(
  agentId: string,
  payload: UpdateAgentShareContextDTO
) {
  const data = await patch<AgentProfileDTO>(
    `/api/agent/${agentId}/share-context`,
    payload
  );

  invalidateConversationListCache();
  return parseAgentSummary(data);
}

export async function markAgentGuideSeen(
  agentId: string,
  target: "agent-home" | "agent-profile"
) {
  const data = await post<AgentProfileDTO>(
    `/api/agent/${agentId}/guide-seen/${target}`,
    {}
  );

  return parseAgentSummary(data);
}

export async function getAgentMemoryProfile(agentId: string) {
  const data = await post<AgentProfileDTO>(
    `/api/agent/${agentId}/memory-profile`,
    {}
  );

  return parseAgentSummary(data);
}

export async function interviewAgentProfile(
  agentId: string,
  payload: AgentProfileInterviewRequestDTO
): Promise<AgentProfileInterviewResultDTO> {
  const data = await post<AgentProfileInterviewResultDTO>(
    `/api/agent/${agentId}/profile-interview`,
    payload
  );
  const raw = asRecord(data);
  const parsedDraft = parseAgentProfileDraft(raw.draft);
  const requestDraft = payload.draft ?? {};
  const mergedDraft = PROFILE_MEMORY_FIELDS.reduce((draft, field) => {
    draft[field] = parsedDraft[field] || asString(requestDraft[field]);
    return draft;
  }, {} as AgentProfileInterviewDraftDTO);
  const coveredFields = Array.isArray(raw.coveredFields)
    ? raw.coveredFields
        .map(parseAgentProfileMemoryField)
        .filter((field): field is AgentProfileMemoryField => Boolean(field))
    : [];

  return {
    reply: asString(raw.reply),
    draft: mergedDraft,
    coveredFields,
    nextFocusField: parseAgentProfileMemoryField(raw.nextFocusField),
    isComplete: Boolean(raw.isComplete),
  };
}

export async function createAgentProfileMessengerSpeech(
  agentId: string,
  text: string
): Promise<AgentProfileMessengerSpeechResultDTO> {
  const data = await post<AgentProfileMessengerSpeechResultDTO>(
    `/api/agent/${agentId}/profile-messenger-speech`,
    { text }
  );
  const raw = asRecord(data);

  return {
    url: asString(raw.url),
    voice: asString(raw.voice),
  };
}

export async function deleteAgent(agentId: string) {
  await del<{ deleted?: boolean }>(`/api/agent/${agentId}`);
  invalidateConversationListCache();
}
