import { del, get, patch, post } from '../api/api-client'
import type {
  AgentProfileDTO,
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentProfileDTO,
} from '@tzl/shared'

export interface AgentSummary {
  id: string
  name: string
  avatar: string
  sex: number
  agentCallMe: string
  iCallAgent: string
  birthday: Date | null
  deathDate: Date | null
  description: string
  lifeExperience: string
  personalityTraits: string
  languageHabits: string
  hobbies: string
  sharedMemories: string
  status: number
  voiceTimbreId: string
  createdAt: Date | null
  updatedAt: Date | null
}

interface AgentListResponse {
  items?: unknown[]
}

type CreateAgentPayload = CreateAgentDTO
type UpdateAgentProfilePayload = UpdateAgentProfileDTO

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function asDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseAgentSummary(value: unknown): AgentSummary {
  const raw = asRecord(value)

  return {
    id: asString(raw.id),
    name: asString(raw.name),
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
    status: asNumber(raw.status),
    voiceTimbreId: asString(raw.voiceTimbreId),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
  }
}

export async function createAgent(payload: CreateAgentPayload) {
  const data = await post<AgentProfileDTO>('/api/agent', {
    name: payload.name,
    sex: payload.sex,
    iCallAgent: payload.iCallAgent,
    agentCallMe: payload.agentCallMe,
  })

  return parseAgentSummary(data)
}

export async function getAgents() {
  const data = await get<AgentListResponse>('/api/agent')

  return Array.isArray(data.items)
    ? data.items.map((item) => parseAgentSummary(item))
    : []
}

export async function updateAgentAvatar(agentId: string, avatar: string) {
  const data = await patch<AgentProfileDTO>(
    `/api/agent/${agentId}/avatar`,
    { avatar } satisfies UpdateAgentAvatarDTO,
  )

  return parseAgentSummary(data)
}

export async function updateAgentProfile(
  agentId: string,
  payload: UpdateAgentProfilePayload,
) {
  const data = await patch<AgentProfileDTO>(`/api/agent/${agentId}`, payload)

  return parseAgentSummary(data)
}

export async function getAgentDetail(agentId: string) {
  const data = await get<AgentProfileDTO>(`/api/agent/${agentId}`)

  return parseAgentSummary(data)
}

export async function deleteAgent(agentId: string) {
  await del<{ deleted?: boolean }>(`/api/agent/${agentId}`)
}
