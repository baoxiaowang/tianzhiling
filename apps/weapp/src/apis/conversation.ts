import { get } from '../api/api-client'

export interface ConversationSummary {
  id: string
  agentId: string
  agentName: string
  agentAvatar: string
  agentSex: number
  agentCallMe: string
  iCallAgent: string
  preview: string
  createdAt: Date | null
  updatedAt: Date | null
}

interface ConversationListResponse {
  items: unknown[]
}

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

export function parseConversationSummary(value: unknown): ConversationSummary {
  const raw = asRecord(value)

  return {
    id: asString(raw.id),
    agentId: asString(raw.agentId),
    agentName: asString(raw.agentName),
    agentAvatar: asString(raw.agentAvatar),
    agentSex: asNumber(raw.agentSex),
    agentCallMe: asString(raw.agentCallMe),
    iCallAgent: asString(raw.iCallAgent),
    preview: asString(raw.preview),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
  }
}

export async function getConversations() {
  const data = await get<ConversationListResponse>('/api/conversation')

  return Array.isArray(data.items)
    ? data.items.map((item) => parseConversationSummary(item))
    : []
}
