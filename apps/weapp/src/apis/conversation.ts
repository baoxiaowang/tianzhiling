import { del, get, post } from '../api/api-client'
import {
  authSession,
  registerAuthSessionClearListener,
} from '../auth/session'

const CONVERSATION_LIST_CACHE_TTL = 30 * 1000

let conversationListCache:
  | {
      items: ConversationSummary[]
      expiresAt: number
      ownerId: string
    }
  | null = null
let conversationListPromise:
  | {
      ownerId: string
      promise: Promise<ConversationSummary[]>
    }
  | null = null
let conversationListCacheVersion = 0

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
  pageSize?: number
  hasMore?: boolean
}

interface SendConversationMessageResponse {
  userMessage?: unknown
  assistantMessage?: unknown
  assistantMessages?: unknown
  chatQuota?: unknown
  replyPending?: unknown
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

export interface ConversationQuotePayload {
  messageId?: string
  role?: string
  content?: string
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
  quote?: ConversationQuotePayload
  createdAt: Date | null
  updatedAt: Date | null
}

export interface SendConversationMessageResult {
  userMessage: ConversationMessage
  assistantMessage?: ConversationMessage
  assistantMessages?: ConversationMessage[]
  chatQuota?: ConversationChatQuotaSnapshot
  replyPending?: boolean
}

export interface GetConversationMessagesPageOptions {
  beforeCreatedAt?: Date | string | null
  pageSize?: number
  lightweight?: boolean
}

export interface ConversationMessageListResult {
  items: ConversationMessage[]
  pageSize: number
  hasMore: boolean
}

export interface ConversationChatQuotaSnapshot {
  isVip: boolean
  policy?: string
  limit?: number
  usedCount?: number
  remainingCount?: number
  trialDays?: number
}

export type ConversationMessageFeedbackType =
  | 'accurate'
  | 'unlike'
  | 'wrong_fact'
  | 'fabricated'
  | 'uncomfortable'
  | 'other'

interface VoiceTranscriptionResponse {
  transcript?: unknown
}

const SEGMENT_MARKUP_PATTERN =
  /<\/?\s*f[e\u00e8\u00e9\u00ea\u0113\u011b]n?g[e\u00e8\u00e9\u00ea\u0113\u011b]\s*(?:>|\])?|\[\/?\s*f[e\u00e8\u00e9\u00ea\u0113\u011b]n?g[e\u00e8\u00e9\u00ea\u0113\u011b]\s*\]?/gi

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
    .replace(SEGMENT_MARKUP_PATTERN, ' ')
    .replace(/<\/?fense\s*>/gi, ' ')
    .replace(/<\/?fense(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/gi, ' ')
    .replace(/<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?:\s+[^<>]*)?>/g, ' ')
    .replace(/<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/g, ' ')
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
    .split(SEGMENT_MARKUP_PATTERN)
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

function parseQuotePayload(value: unknown) {
  const raw = asRecord(value)

  if (
    !Object.keys(raw).length &&
    !asString(raw.messageId) &&
    !asString(raw.role) &&
    !asString(raw.content)
  ) {
    return undefined
  }

  return {
    messageId: asString(raw.messageId) || undefined,
    role: asString(raw.role) || undefined,
    content: asString(raw.content) || undefined,
  } satisfies ConversationQuotePayload
}

export function parseConversationMessage(value: unknown): ConversationMessage {
  const raw = asRecord(value)
  const type = asString(raw.type) || 'text'
  const rawContent = asString(raw.content)
  const content = stripAssistantMarkup(rawContent)

  return {
    id: asString(raw.id),
    conversationId: asString(raw.conversationId),
    role: asString(raw.role) || 'assistant',
    type,
    content,
    segments: parseSegments(raw.segments, rawContent, type),
    status: asString(raw.status) || 'sent',
    voice: parseVoicePayload(raw.voice),
    image: parseImagePayload(raw.image),
    quote: parseQuotePayload(raw.quote),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
  }
}

function parseChatQuota(value: unknown) {
  const raw = asRecord(value)

  if (!Object.keys(raw).length) {
    return undefined
  }

  return {
    isVip: Boolean(raw.isVip),
    policy: asString(raw.policy) || undefined,
    limit: asNumber(raw.limit) || undefined,
    usedCount: asNumber(raw.usedCount) || undefined,
    remainingCount:
      typeof raw.remainingCount === 'number' || typeof raw.remainingCount === 'string'
        ? asNumber(raw.remainingCount)
        : undefined,
    trialDays: asNumber(raw.trialDays) || undefined,
  } satisfies ConversationChatQuotaSnapshot
}

export async function getConversations(options: { force?: boolean } = {}) {
  if (options.force) {
    invalidateConversationListCache()
  }

  const ownerId = getConversationCacheOwnerId()

  if (
    conversationListCache &&
    conversationListCache.ownerId === ownerId &&
    conversationListCache.expiresAt > Date.now()
  ) {
    return conversationListCache.items
  }

  if (
    conversationListPromise &&
    conversationListPromise.ownerId === ownerId
  ) {
    return conversationListPromise.promise
  }

  const requestVersion = conversationListCacheVersion
  const promise = fetchConversations(ownerId, requestVersion).finally(() => {
    if (conversationListPromise?.promise === promise) {
      conversationListPromise = null
    }
  })
  conversationListPromise = { ownerId, promise }

  return promise
}

export function getCachedConversations() {
  const ownerId = getConversationCacheOwnerId()

  if (
    conversationListCache &&
    conversationListCache.ownerId === ownerId &&
    conversationListCache.expiresAt > Date.now()
  ) {
    return conversationListCache.items
  }

  return []
}

export function preloadConversations() {
  void getConversations().catch(() => undefined)
}

export function invalidateConversationListCache() {
  conversationListCacheVersion += 1
  conversationListCache = null
  conversationListPromise = null
}

function getConversationCacheOwnerId() {
  return authSession.value?.user.id.trim() || ''
}

async function fetchConversations(ownerId: string, requestVersion: number) {
  const data = await get<ConversationListResponse>('/api/conversation')

  const items = Array.isArray(data.items)
    ? data.items.map((item) => parseConversationSummary(item))
    : []

  if (
    requestVersion === conversationListCacheVersion &&
    ownerId === getConversationCacheOwnerId()
  ) {
    conversationListCache = {
      items,
      expiresAt: Date.now() + CONVERSATION_LIST_CACHE_TTL,
      ownerId,
    }
  }

  return items
}

registerAuthSessionClearListener(invalidateConversationListCache)

export async function getConversationMessages(conversationId: string) {
  const data = await get<ConversationMessageListResponse>(
    `/api/conversation/${conversationId}/messages`
  )

  return Array.isArray(data.items)
    ? data.items.map((item) => parseConversationMessage(item))
    : []
}

export async function getConversationMessagesPage(
  conversationId: string,
  options: GetConversationMessagesPageOptions = {}
): Promise<ConversationMessageListResult> {
  const queryParts: string[] = []

  if (options.pageSize) {
    queryParts.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`)
  }

  if (options.lightweight) {
    queryParts.push('lightweight=true')
  }

  if (options.beforeCreatedAt) {
    const beforeCreatedAt = options.beforeCreatedAt instanceof Date
      ? options.beforeCreatedAt.toISOString()
      : String(options.beforeCreatedAt)

    if (beforeCreatedAt.trim()) {
      queryParts.push(`beforeCreatedAt=${encodeURIComponent(beforeCreatedAt)}`)
    }
  }

  const query = queryParts.length ? `?${queryParts.join('&')}` : ''
  const data = await get<ConversationMessageListResponse>(
    `/api/conversation/${conversationId}/messages${query}`
  )

  return {
    items: Array.isArray(data.items)
      ? data.items.map((item) => parseConversationMessage(item))
      : [],
    pageSize: data.pageSize ?? options.pageSize ?? 0,
    hasMore: data.hasMore === true,
  }
}

export async function deleteConversationMessage(
  conversationId: string,
  messageId: string
) {
  await del(
    `/api/conversation/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`
  )
  invalidateConversationListCache()
}

export async function markConversationMessageMemory(
  conversationId: string,
  messageId: string
) {
  await post(
    `/api/conversation/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/memory`,
    {}
  )
}

export async function getConversationChatQuota(conversationId: string) {
  const data = await get<unknown>(`/api/conversation/${conversationId}/chat-quota`)

  return parseChatQuota(data)
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
    quotedMessageId?: string
    clientRequestId?: string
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
  const quotedMessageId = payload.quotedMessageId?.trim()
  const clientRequestId = payload.clientRequestId?.trim()

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
  if (quotedMessageId) {
    body.quotedMessageId = quotedMessageId
  }
  const data = await post<SendConversationMessageResponse>(
    `/api/conversation/${conversationId}/messages`,
    body,
    {
      headers: clientRequestId
        ? { 'X-Client-Request-Id': clientRequestId }
        : undefined,
    },
  )
  invalidateConversationListCache()

  return {
    userMessage: parseConversationMessage(data.userMessage),
    assistantMessage: data.assistantMessage
      ? parseConversationMessage(data.assistantMessage)
      : undefined,
    assistantMessages: Array.isArray(data.assistantMessages)
      ? data.assistantMessages.map((item) => parseConversationMessage(item))
      : undefined,
    chatQuota: parseChatQuota(data.chatQuota),
    replyPending: Boolean(data.replyPending),
  }
}

export async function sendConversationMessageAsync(
  conversationId: string,
  payload: {
    content?: string
    type?: string
    mediaUrl?: string
    objectKey?: string
    mimeType?: string
    durationMs?: number
    quotedMessageId?: string
    clientRequestId?: string
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
  const quotedMessageId = payload.quotedMessageId?.trim()
  const clientRequestId = payload.clientRequestId?.trim()

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
  if (quotedMessageId) {
    body.quotedMessageId = quotedMessageId
  }
  const data = await post<SendConversationMessageResponse>(
    `/api/conversation/${conversationId}/messages/async`,
    body,
    {
      headers: clientRequestId
        ? { 'X-Client-Request-Id': clientRequestId }
        : undefined,
    },
  )
  invalidateConversationListCache()

  return {
    userMessage: parseConversationMessage(data.userMessage),
    assistantMessage: data.assistantMessage
      ? parseConversationMessage(data.assistantMessage)
      : undefined,
    assistantMessages: Array.isArray(data.assistantMessages)
      ? data.assistantMessages.map((item) => parseConversationMessage(item))
      : undefined,
    chatQuota: parseChatQuota(data.chatQuota),
    replyPending: Boolean(data.replyPending),
  }
}

export async function generateConversationMessageVoice(
  conversationId: string,
  messageId: string
) {
  const data = await post<unknown>(
    `/api/conversation/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/voice`
  )

  return parseConversationMessage(data)
}

export async function submitConversationMessageFeedback(
  conversationId: string,
  messageId: string,
  payload: {
    type: ConversationMessageFeedbackType
    content?: string
  },
) {
  const body: Record<string, unknown> = {
    type: payload.type,
  }
  const content = payload.content?.trim()

  if (content) {
    body.content = content
  }

  await post(
    `/api/conversation/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`,
    body,
  )
}

export async function generateConversationMemorialPhoto(
  conversationId: string,
  payload: {
    agentPhotoObjectKeys: string[]
    userPhotoObjectKey: string
    customPrompt?: string
  },
) {
  const customPrompt = payload.customPrompt?.trim()
  const body: Record<string, unknown> = {
    agentPhotoObjectKeys: payload.agentPhotoObjectKeys,
    userPhotoObjectKey: payload.userPhotoObjectKey,
  }

  if (customPrompt) {
    body.customPrompt = customPrompt
  }

  const data = await post<unknown>(
    `/api/conversation/${encodeURIComponent(conversationId)}/memorial-photo`,
    body,
  )

  return parseConversationMessage(data)
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
