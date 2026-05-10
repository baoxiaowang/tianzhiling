import { get, post } from '../api/api-client'

export interface ConversationSummary {
  id: string
  agentId: string
  agentName: string
  agentAvatar: string
  agentSex: number
  agentCallMe: string
  iCallAgent: string
  agentIsDefault: boolean
  preview: string
  createdAt: Date | null
  updatedAt: Date | null
}

interface ConversationListResponse {
  items: unknown[]
}

interface ConversationMessageListResponse {
  items: unknown[]
}

interface SendConversationMessageResponse {
  userMessage?: unknown
  assistantMessage?: unknown
}

export interface ConversationVoicePayload {
  objectKey?: string
  url?: string
  mimeType?: string
  durationMs?: number
  transcript?: string
}

export interface ConversationImagePayload {
  objectKey?: string
  url?: string
  mimeType?: string
  analysis?: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: string
  type: string
  content: string
  segments: string[]
  status: string
  voice?: ConversationVoicePayload
  image?: ConversationImagePayload
  createdAt: Date | null
  updatedAt: Date | null
}

export interface SendConversationMessageResult {
  userMessage: ConversationMessage
  assistantMessage?: ConversationMessage
}

interface VoiceTranscriptionResponse {
  transcript?: unknown
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
    agentIsDefault: Boolean(raw.agentIsDefault),
    preview: asString(raw.preview),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
  }
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => stripAssistantMarkup(asString(item)).trim())
    .filter(Boolean)
}

function stripAssistantMarkup(value: string) {
  return value
    .replace(/<\/?fenge\s*>/gi, ' ')
    .replace(/<\/?fense\s*>/gi, ' ')
    .replace(/<\/?[A-Za-z][A-Za-z0-9_-]*(?:\s+[^<>]*)?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSegments(value: unknown, content: string, type: string) {
  if (type !== 'text') {
    return []
  }

  const segments = asStringArray(value)
  if (segments.length) {
    return segments
  }

  const trimmedContent = content.trim()
  if (!trimmedContent) {
    return []
  }

  const legacySegments = trimmedContent
    .split('</fenge>')
    .map((item) => stripAssistantMarkup(item).trim())
    .filter(Boolean)

  if (legacySegments.length) {
    return legacySegments
  }

  return [stripAssistantMarkup(trimmedContent)]
}

function parseVoicePayload(value: unknown) {
  const raw = asRecord(value)
  const durationMs = asNumber(raw.durationMs)
  const normalizedDurationMs =
    durationMs > 0 && durationMs <= 10 * 60 * 1000 ? durationMs : 0

  if (
    !Object.keys(raw).length &&
    !normalizedDurationMs &&
    !asString(raw.objectKey) &&
    !asString(raw.url) &&
    !asString(raw.mimeType) &&
    !asString(raw.transcript)
  ) {
    return undefined
  }

  return {
    objectKey: asString(raw.objectKey) || undefined,
    url: asString(raw.url) || undefined,
    mimeType: asString(raw.mimeType) || undefined,
    durationMs: normalizedDurationMs || undefined,
    transcript: asString(raw.transcript) || undefined,
  } satisfies ConversationVoicePayload
}

function parseImagePayload(value: unknown) {
  const raw = asRecord(value)

  if (
    !Object.keys(raw).length &&
    !asString(raw.objectKey) &&
    !asString(raw.url) &&
    !asString(raw.mimeType) &&
    !asString(raw.analysis)
  ) {
    return undefined
  }

  return {
    objectKey: asString(raw.objectKey) || undefined,
    url: asString(raw.url) || undefined,
    mimeType: asString(raw.mimeType) || undefined,
    analysis: asString(raw.analysis) || undefined,
  } satisfies ConversationImagePayload
}

export function parseConversationMessage(value: unknown): ConversationMessage {
  const raw = asRecord(value)
  const type = asString(raw.type) || 'text'
  const content = stripAssistantMarkup(asString(raw.content))

  return {
    id: asString(raw.id),
    conversationId: asString(raw.conversationId),
    role: asString(raw.role) || 'assistant',
    type,
    content,
    segments: parseSegments(raw.segments, content, type),
    status: asString(raw.status) || 'sent',
    voice: parseVoicePayload(raw.voice),
    image: parseImagePayload(raw.image),
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

export async function getConversationMessages(conversationId: string) {
  const data = await get<ConversationMessageListResponse>(
    `/api/conversation/${conversationId}/messages`
  )

  return Array.isArray(data.items)
    ? data.items.map((item) => parseConversationMessage(item))
    : []
}

export async function sendConversationMessage(
  conversationId: string,
  payload: {
    content?: string
    type?: string
    mediaUrl?: string
    objectKey?: string
    mimeType?: string
    durationMs?: number
  }
): Promise<SendConversationMessageResult> {
  const body: Record<string, unknown> = {
    type: payload.type ?? 'text',
  }
  const content = payload.content?.trim()
  const mediaUrl = payload.mediaUrl?.trim()
  const objectKey = payload.objectKey?.trim()
  const mimeType = payload.mimeType?.trim()
  const durationMs = payload.durationMs

  if (content) {
    body.content = content
  }
  if (mediaUrl) {
    body.mediaUrl = mediaUrl
  }
  if (objectKey) {
    body.objectKey = objectKey
  }
  if (mimeType) {
    body.mimeType = mimeType
  }
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
    body.durationMs = Math.round(durationMs)
  }

  const data = await post<SendConversationMessageResponse>(
    `/api/conversation/${conversationId}/messages`,
    body
  )

  return {
    userMessage: parseConversationMessage(data.userMessage),
    assistantMessage: data.assistantMessage
      ? parseConversationMessage(data.assistantMessage)
      : undefined,
  }
}

export async function transcribeConversationVoice(
  conversationId: string,
  payload: {
    mediaUrl?: string
    objectKey?: string
    mimeType?: string
  }
) {
  const body: Record<string, unknown> = {}
  const mediaUrl = payload.mediaUrl?.trim()
  const objectKey = payload.objectKey?.trim()
  const mimeType = payload.mimeType?.trim()

  if (mediaUrl) {
    body.mediaUrl = mediaUrl
  }
  if (objectKey) {
    body.objectKey = objectKey
  }
  if (mimeType) {
    body.mimeType = mimeType
  }

  const data = await post<VoiceTranscriptionResponse>(
    `/api/conversation/${conversationId}/voice-transcription`,
    body
  )

  return asString(data.transcript).trim()
}
