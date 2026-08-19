import Taro from "@tarojs/taro";
import { isLocalApiEnvironment } from "../api/api-config";
import { del, get, getWithOptions, post } from "../api/api-client";
import { authSession, registerAuthSessionClearListener } from "../auth/session";

const CONVERSATION_LIST_CACHE_TTL = 30 * 1000;
const CHAT_MESSAGE_CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_ENVIRONMENT_SUFFIX = isLocalApiEnvironment() ? "_local" : "";
const CHAT_MESSAGE_CACHE_KEY_PREFIX = `tzl_chat_messages${CACHE_ENVIRONMENT_SUFFIX}_v1`;
const CHAT_MESSAGE_CACHE_INDEX_KEY = `tzl_chat_messages_index${CACHE_ENVIRONMENT_SUFFIX}_v1`;
const CHAT_MESSAGE_CACHE_LIMIT = 3;

let conversationListCache: {
  items: ConversationSummary[];
  expiresAt: number;
  ownerId: string;
} | null = null;
let conversationListPromise: {
  ownerId: string;
  promise: Promise<ConversationSummary[]>;
} | null = null;
let conversationListCacheVersion = 0;

export interface ConversationSummary {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  agentSex: number;
  agentCallMe: string;
  iCallAgent: string;
  agentIsDefault: boolean;
  agentAccessRole: "owner" | "shared";
  preview: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface ConversationListResponse {
  items: unknown[];
  entryItem?: unknown;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
}

interface EntryConversationResponse {
  item?: unknown;
}

interface ConversationMessageListResponse {
  items: unknown[];
  pageSize?: number;
  hasMore?: boolean;
}

interface ConversationChatBootstrapResponse
  extends ConversationMessageListResponse {
  agent?: unknown;
  chatQuota?: unknown;
  messengerTaskPlan?: unknown;
}

interface SendConversationMessageResponse {
  userMessage?: unknown;
  assistantMessage?: unknown;
  assistantMessages?: unknown;
  chatQuota?: unknown;
  messengerTaskPlan?: unknown;
  replyPending?: unknown;
}

export interface ConversationVoicePayload {
  objectKey?: string;
  url?: string;
  mimeType?: string;
  durationMs?: number;
  transcript?: string;
}

export interface ConversationImagePayload {
  objectKey?: string;
  url?: string;
  mimeType?: string;
  analysis?: string;
}

export interface ConversationQuotePayload {
  messageId?: string;
  role?: string;
  content?: string;
}

export interface ConversationImportPayload {
  batchId?: string;
  itemId?: string;
  importedAt?: Date | null;
  occurredAt?: Date | null;
  rawTimeText?: string;
  timePrecision?: string;
  timeConfidence?: string;
  screenshotId?: string;
  sequence?: number;
  recognitionConfidence?: number;
  quotaExempt?: boolean;
  replyTrigger?: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: string;
  type: string;
  content: string;
  segments: string[];
  status: string;
  source?: string;
  import?: ConversationImportPayload;
  voice?: ConversationVoicePayload;
  image?: ConversationImagePayload;
  quote?: ConversationQuotePayload;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SendConversationMessageResult {
  userMessage: ConversationMessage;
  assistantMessage?: ConversationMessage;
  assistantMessages?: ConversationMessage[];
  chatQuota?: ConversationChatQuotaSnapshot;
  messengerTaskPlan?: MessengerMemoryTaskPlan;
  replyPending?: boolean;
}

export interface GetConversationMessagesPageOptions {
  beforeCreatedAt?: Date | string | null;
  pageSize?: number;
  lightweight?: boolean;
}

export interface ConversationMessageListResult {
  items: ConversationMessage[];
  pageSize: number;
  hasMore: boolean;
}

export interface ConversationPageResult {
  items: ConversationSummary[];
  entryItem?: ConversationSummary;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ConversationBootstrapAgent {
  id: string;
  name: string;
  avatar: string;
  sex: number;
  agentCallMe: string;
  iCallAgent: string;
  hasUnreadAgentHomeGuide: boolean;
  hasUnreadAgentProfileGuide: boolean;
  isDefault: boolean;
}

export type MessengerMemoryTaskKey =
  | "personalityTraits"
  | "lifeExperience"
  | "hobbies"
  | "languageHabits"
  | "sharedMemories";

export interface MessengerMemoryTaskItem {
  key: MessengerMemoryTaskKey;
  title: string;
  description: string;
  status: "pending" | "completed";
}

export interface MessengerMemoryTaskPlan {
  parentAgentId: string;
  parentName: string;
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  currentTaskKey?: MessengerMemoryTaskKey;
  currentTaskTitle?: string;
  tasks: MessengerMemoryTaskItem[];
}

export interface ConversationChatBootstrapResult
  extends ConversationMessageListResult {
  agent?: ConversationBootstrapAgent;
  chatQuota?: ConversationChatQuotaSnapshot;
  messengerTaskPlan?: MessengerMemoryTaskPlan;
}

export interface ConversationChatQuotaSnapshot {
  isVip: boolean;
  policy?: string;
  limit?: number;
  usedCount?: number;
  remainingCount?: number;
  trialDays?: number;
}

export type ConversationMessageFeedbackType =
  | "accurate"
  | "unlike"
  | "wrong_fact"
  | "fabricated"
  | "uncomfortable"
  | "other";

interface VoiceTranscriptionResponse {
  transcript?: unknown;
}

const SEGMENT_MARKUP_PATTERN =
  /<\/?\s*f[e\u00e8\u00e9\u00ea\u0113\u011b]n?g[e\u00e8\u00e9\u00ea\u0113\u011b]\s*(?:>|\])?|\[\/?\s*f[e\u00e8\u00e9\u00ea\u0113\u011b]n?g[e\u00e8\u00e9\u00ea\u0113\u011b]\s*\]?/gi;

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

export function parseConversationSummary(value: unknown): ConversationSummary {
  const raw = asRecord(value);

  return {
    id: asString(raw.id),
    agentId: asString(raw.agentId),
    agentName: asString(raw.agentName),
    agentAvatar: asString(raw.agentAvatar),
    agentSex: asNumber(raw.agentSex),
    agentCallMe: asString(raw.agentCallMe),
    iCallAgent: asString(raw.iCallAgent),
    agentIsDefault: Boolean(raw.agentIsDefault),
    agentAccessRole:
      asString(raw.agentAccessRole) === "shared" ? "shared" : "owner",
    preview: asString(raw.preview),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
  };
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => stripAssistantMarkup(asString(item)).trim())
    .filter(Boolean);
}

function stripAssistantMarkup(value: string) {
  return value
    .replace(SEGMENT_MARKUP_PATTERN, " ")
    .replace(/<\/?fense\s*>/gi, " ")
    .replace(/<\/?fense(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/gi, " ")
    .replace(
      /<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?:\s+[^<>]*)?>/g,
      " "
    )
    .replace(
      /<\/?[A-Za-z\u00c0-\u017f][A-Za-z0-9\u00c0-\u017f_-]*(?=$|[\s\u3400-\u9FFF，。！？、；：,.!?;:])/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseSegments(value: unknown, content: string, type: string) {
  if (type !== "text") {
    return [];
  }

  const segments = asStringArray(value);
  if (segments.length) {
    return segments;
  }

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return [];
  }

  const legacySegments = trimmedContent
    .split(SEGMENT_MARKUP_PATTERN)
    .map((item) => stripAssistantMarkup(item).trim())
    .filter(Boolean);

  if (legacySegments.length) {
    return legacySegments;
  }

  return [stripAssistantMarkup(trimmedContent)];
}

function parseVoicePayload(value: unknown) {
  const raw = asRecord(value);
  const durationMs = asNumber(raw.durationMs);
  const normalizedDurationMs =
    durationMs > 0 && durationMs <= 10 * 60 * 1000 ? durationMs : 0;

  if (
    !Object.keys(raw).length &&
    !normalizedDurationMs &&
    !asString(raw.objectKey) &&
    !asString(raw.url) &&
    !asString(raw.mimeType) &&
    !asString(raw.transcript)
  ) {
    return undefined;
  }

  return {
    objectKey: asString(raw.objectKey) || undefined,
    url: asString(raw.url) || undefined,
    mimeType: asString(raw.mimeType) || undefined,
    durationMs: normalizedDurationMs || undefined,
    transcript: asString(raw.transcript) || undefined,
  } satisfies ConversationVoicePayload;
}

function parseImagePayload(value: unknown) {
  const raw = asRecord(value);

  if (
    !Object.keys(raw).length &&
    !asString(raw.objectKey) &&
    !asString(raw.url) &&
    !asString(raw.mimeType) &&
    !asString(raw.analysis)
  ) {
    return undefined;
  }

  return {
    objectKey: asString(raw.objectKey) || undefined,
    url: asString(raw.url) || undefined,
    mimeType: asString(raw.mimeType) || undefined,
    analysis: asString(raw.analysis) || undefined,
  } satisfies ConversationImagePayload;
}

function parseQuotePayload(value: unknown) {
  const raw = asRecord(value);

  if (
    !Object.keys(raw).length &&
    !asString(raw.messageId) &&
    !asString(raw.role) &&
    !asString(raw.content)
  ) {
    return undefined;
  }

  return {
    messageId: asString(raw.messageId) || undefined,
    role: asString(raw.role) || undefined,
    content: asString(raw.content) || undefined,
  } satisfies ConversationQuotePayload;
}

function parseImportPayload(value: unknown) {
  const raw = asRecord(value);
  if (!Object.keys(raw).length) {
    return undefined;
  }

  return {
    batchId: asString(raw.batchId) || undefined,
    itemId: asString(raw.itemId) || undefined,
    importedAt: asDate(raw.importedAt),
    occurredAt: asDate(raw.occurredAt),
    rawTimeText: asString(raw.rawTimeText) || undefined,
    timePrecision: asString(raw.timePrecision) || undefined,
    timeConfidence: asString(raw.timeConfidence) || undefined,
    screenshotId: asString(raw.screenshotId) || undefined,
    sequence: asNumber(raw.sequence),
    recognitionConfidence: asNumber(raw.recognitionConfidence),
    quotaExempt: raw.quotaExempt === true,
    replyTrigger: raw.replyTrigger !== false,
  } satisfies ConversationImportPayload;
}

export function parseConversationMessage(value: unknown): ConversationMessage {
  const raw = asRecord(value);
  const type = asString(raw.type) || "text";
  const rawContent = asString(raw.content);
  const content = stripAssistantMarkup(rawContent);

  return {
    id: asString(raw.id),
    conversationId: asString(raw.conversationId),
    role: asString(raw.role) || "assistant",
    type,
    content,
    segments: parseSegments(raw.segments, rawContent, type),
    status: asString(raw.status) || "sent",
    source: asString(raw.source) || undefined,
    import: parseImportPayload(raw.import),
    voice: parseVoicePayload(raw.voice),
    image: parseImagePayload(raw.image),
    quote: parseQuotePayload(raw.quote),
    createdAt: asDate(raw.createdAt),
    updatedAt: asDate(raw.updatedAt),
  };
}

function parseChatQuota(value: unknown) {
  const raw = asRecord(value);

  if (!Object.keys(raw).length) {
    return undefined;
  }

  return {
    isVip: Boolean(raw.isVip),
    policy: asString(raw.policy) || undefined,
    limit: asNumber(raw.limit) || undefined,
    usedCount: asNumber(raw.usedCount) || undefined,
    remainingCount:
      typeof raw.remainingCount === "number" ||
      typeof raw.remainingCount === "string"
        ? asNumber(raw.remainingCount)
        : undefined,
    trialDays: asNumber(raw.trialDays) || undefined,
  } satisfies ConversationChatQuotaSnapshot;
}

export async function getConversations(
  options: { force?: boolean; timeout?: number } = {}
) {
  if (options.force) {
    invalidateConversationListCache();
  }

  const ownerId = getConversationCacheOwnerId();

  if (
    conversationListCache &&
    conversationListCache.ownerId === ownerId &&
    conversationListCache.expiresAt > Date.now()
  ) {
    return conversationListCache.items;
  }

  if (conversationListPromise && conversationListPromise.ownerId === ownerId) {
    return conversationListPromise.promise;
  }

  const requestVersion = conversationListCacheVersion;
  const promise = fetchConversations(
    ownerId,
    requestVersion,
    options.timeout
  ).finally(() => {
    if (conversationListPromise?.promise === promise) {
      conversationListPromise = null;
    }
  });
  conversationListPromise = { ownerId, promise };

  return promise;
}

export async function getConversationPage(
  options: {
    page?: number;
    pageSize?: number;
    timeout?: number;
  } = {}
): Promise<ConversationPageResult> {
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.pageSize && options.pageSize > 0 ? options.pageSize : 40;
  const path = `/api/conversation?page=${encodeURIComponent(
    String(page)
  )}&pageSize=${encodeURIComponent(String(pageSize))}`;
  const data = options.timeout
    ? await getWithOptions<ConversationListResponse>(path, {
        timeout: options.timeout,
      })
    : await get<ConversationListResponse>(path);
  const items = Array.isArray(data.items)
    ? data.items.map((item) => parseConversationSummary(item))
    : [];

  const entryItem = data.entryItem
    ? parseConversationSummary(data.entryItem)
    : undefined;

  return {
    items,
    ...(entryItem?.id && entryItem.agentId ? { entryItem } : {}),
    page: data.page ?? page,
    pageSize: data.pageSize ?? pageSize,
    hasMore: data.hasMore === true,
  };
}

export async function getEntryConversation(
  options: {
    timeout?: number;
  } = {}
) {
  const data = options.timeout
    ? await getWithOptions<EntryConversationResponse>(
        "/api/conversation/entry",
        {
          timeout: options.timeout,
        }
      )
    : await get<EntryConversationResponse>("/api/conversation/entry");

  if (!data.item) {
    return undefined;
  }

  const conversation = parseConversationSummary(data.item);
  return conversation.id && conversation.agentId ? conversation : undefined;
}

export function getCachedConversations() {
  const ownerId = getConversationCacheOwnerId();

  if (
    conversationListCache &&
    conversationListCache.ownerId === ownerId &&
    conversationListCache.expiresAt > Date.now()
  ) {
    return conversationListCache.items;
  }

  return [];
}

export function preloadConversations() {
  void getConversations().catch(() => undefined);
}

export function invalidateConversationListCache() {
  conversationListCacheVersion += 1;
  conversationListCache = null;
  conversationListPromise = null;
}

export function updateCachedConversationDefault(
  agentId: string,
  isDefault: boolean
) {
  const ownerId = getConversationCacheOwnerId();

  if (!conversationListCache || conversationListCache.ownerId !== ownerId) {
    return;
  }

  conversationListCache = {
    ...conversationListCache,
    items: conversationListCache.items.map((item) => {
      if (item.agentId === agentId) {
        return { ...item, agentIsDefault: isDefault };
      }

      return isDefault ? { ...item, agentIsDefault: false } : item;
    }),
  };
}

function getConversationCacheOwnerId() {
  return authSession.value?.user.id.trim() || "";
}

async function fetchConversations(
  ownerId: string,
  requestVersion: number,
  timeout?: number
) {
  const data = timeout
    ? await getWithOptions<ConversationListResponse>("/api/conversation", {
        timeout,
      })
    : await get<ConversationListResponse>("/api/conversation");

  const items = Array.isArray(data.items)
    ? data.items.map((item) => parseConversationSummary(item))
    : [];

  if (
    requestVersion === conversationListCacheVersion &&
    ownerId === getConversationCacheOwnerId()
  ) {
    conversationListCache = {
      items,
      expiresAt: Date.now() + CONVERSATION_LIST_CACHE_TTL,
      ownerId,
    };
  }

  return items;
}

registerAuthSessionClearListener(() => {
  invalidateConversationListCache();
  clearChatMessageCache();
});

export async function getConversationMessages(conversationId: string) {
  const data = await get<ConversationMessageListResponse>(
    `/api/conversation/${conversationId}/messages`
  );

  return Array.isArray(data.items)
    ? data.items.map((item) => parseConversationMessage(item))
    : [];
}

export async function getConversationMessagesPage(
  conversationId: string,
  options: GetConversationMessagesPageOptions = {}
): Promise<ConversationMessageListResult> {
  const queryParts: string[] = [];

  if (options.pageSize) {
    queryParts.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`);
  }

  if (options.lightweight) {
    queryParts.push("lightweight=true");
  }

  if (options.beforeCreatedAt) {
    const beforeCreatedAt =
      options.beforeCreatedAt instanceof Date
        ? options.beforeCreatedAt.toISOString()
        : String(options.beforeCreatedAt);

    if (beforeCreatedAt.trim()) {
      queryParts.push(`beforeCreatedAt=${encodeURIComponent(beforeCreatedAt)}`);
    }
  }

  const query = queryParts.length ? `?${queryParts.join("&")}` : "";
  const data = await get<ConversationMessageListResponse>(
    `/api/conversation/${conversationId}/messages${query}`
  );

  const result = {
    items: Array.isArray(data.items)
      ? data.items.map((item) => parseConversationMessage(item))
      : [],
    pageSize: data.pageSize ?? options.pageSize ?? 0,
    hasMore: data.hasMore === true,
  };

  if (!options.beforeCreatedAt) {
    saveCachedConversationMessages(conversationId, result);
  }

  return result;
}

export async function getConversationChatBootstrap(
  conversationId: string,
  options: { pageSize?: number; lightweight?: boolean } = {}
): Promise<ConversationChatBootstrapResult> {
  const queryParts: string[] = [];

  if (options.pageSize) {
    queryParts.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`);
  }

  if (options.lightweight !== false) {
    queryParts.push("lightweight=true");
  }

  const query = queryParts.length ? `?${queryParts.join("&")}` : "";
  const data = await get<ConversationChatBootstrapResponse>(
    `/api/conversation/${conversationId}/bootstrap${query}`
  );
  const result: ConversationChatBootstrapResult = {
    items: Array.isArray(data.items)
      ? data.items.map((item) => parseConversationMessage(item))
      : [],
    pageSize: data.pageSize ?? options.pageSize ?? 0,
    hasMore: data.hasMore === true,
    agent: parseConversationBootstrapAgent(data.agent),
    chatQuota: parseChatQuota(data.chatQuota),
    messengerTaskPlan: parseMessengerMemoryTaskPlan(data.messengerTaskPlan),
  };

  saveCachedConversationMessages(conversationId, result);
  return result;
}

export function getCachedConversationMessages(
  conversationId: string
): ConversationMessageListResult | undefined {
  const ownerId = getConversationCacheOwnerId();

  if (!ownerId || !conversationId.trim()) {
    return undefined;
  }

  try {
    const raw = Taro.getStorageSync<string>(
      buildChatMessageCacheKey(ownerId, conversationId)
    );
    const stored = raw
      ? (JSON.parse(raw) as {
          ownerId?: string;
          expiresAt?: number;
          items?: unknown[];
          pageSize?: number;
          hasMore?: boolean;
        })
      : undefined;

    if (
      stored?.ownerId !== ownerId ||
      !stored.expiresAt ||
      stored.expiresAt <= Date.now() ||
      !Array.isArray(stored.items)
    ) {
      return undefined;
    }

    return {
      items: stored.items.map((item) => parseConversationMessage(item)),
      pageSize: stored.pageSize ?? 0,
      hasMore: stored.hasMore === true,
    };
  } catch {
    return undefined;
  }
}

function saveCachedConversationMessages(
  conversationId: string,
  result: ConversationMessageListResult
) {
  const ownerId = getConversationCacheOwnerId();

  if (!ownerId || !conversationId.trim()) {
    return;
  }

  const cacheKey = buildChatMessageCacheKey(ownerId, conversationId);

  try {
    Taro.setStorageSync(
      cacheKey,
      JSON.stringify({
        ownerId,
        expiresAt: Date.now() + CHAT_MESSAGE_CACHE_TTL,
        items: result.items,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
      })
    );
    const existingIndex = readChatMessageCacheIndex().filter(
      (key) => key !== cacheKey
    );
    const nextIndex = [...existingIndex, cacheKey];
    const expiredKeys = nextIndex.slice(
      0,
      Math.max(0, nextIndex.length - CHAT_MESSAGE_CACHE_LIMIT)
    );

    for (const key of expiredKeys) {
      Taro.removeStorageSync(key);
    }

    Taro.setStorageSync(
      CHAT_MESSAGE_CACHE_INDEX_KEY,
      JSON.stringify(nextIndex.slice(-CHAT_MESSAGE_CACHE_LIMIT))
    );
  } catch {
    // Local cache failure must not block chat loading.
  }
}

function buildChatMessageCacheKey(ownerId: string, conversationId: string) {
  return `${CHAT_MESSAGE_CACHE_KEY_PREFIX}:${ownerId}:${conversationId.trim()}`;
}

function readChatMessageCacheIndex(): string[] {
  try {
    const raw = Taro.getStorageSync<string>(CHAT_MESSAGE_CACHE_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function clearChatMessageCache() {
  for (const key of readChatMessageCacheIndex()) {
    try {
      Taro.removeStorageSync(key);
    } catch {}
  }

  try {
    Taro.removeStorageSync(CHAT_MESSAGE_CACHE_INDEX_KEY);
  } catch {
    // Cache cleanup is best effort during logout.
  }
}

function invalidateCachedConversationMessages(conversationId: string) {
  const ownerId = getConversationCacheOwnerId();

  if (!ownerId || !conversationId.trim()) {
    return;
  }

  const cacheKey = buildChatMessageCacheKey(ownerId, conversationId);

  try {
    Taro.removeStorageSync(cacheKey);
    Taro.setStorageSync(
      CHAT_MESSAGE_CACHE_INDEX_KEY,
      JSON.stringify(
        readChatMessageCacheIndex().filter((key) => key !== cacheKey)
      )
    );
  } catch {
    // Cache invalidation is best effort after a successful mutation.
  }
}

const MESSENGER_MEMORY_TASK_KEYS: MessengerMemoryTaskKey[] = [
  "personalityTraits",
  "lifeExperience",
  "hobbies",
  "languageHabits",
  "sharedMemories",
];

function parseMessengerMemoryTaskKey(
  value: unknown
): MessengerMemoryTaskKey | undefined {
  const key = asString(value) as MessengerMemoryTaskKey;
  return MESSENGER_MEMORY_TASK_KEYS.includes(key) ? key : undefined;
}

function parseMessengerMemoryTaskPlan(
  value: unknown
): MessengerMemoryTaskPlan | undefined {
  const raw = asRecord(value);
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
        .map((item): MessengerMemoryTaskItem | undefined => {
          const task = asRecord(item);
          const key = parseMessengerMemoryTaskKey(task.key);
          const title = asString(task.title).trim();

          if (!key || !title) {
            return undefined;
          }

          return {
            key,
            title,
            description: asString(task.description).trim(),
            status:
              asString(task.status) === "completed" ? "completed" : "pending",
          };
        })
        .filter((item): item is MessengerMemoryTaskItem => Boolean(item))
    : [];

  if (!tasks.length) {
    return undefined;
  }

  const completedCount = tasks.filter(
    (task) => task.status === "completed"
  ).length;
  const currentTaskKey = parseMessengerMemoryTaskKey(raw.currentTaskKey);

  return {
    parentAgentId: asString(raw.parentAgentId),
    parentName: asString(raw.parentName).trim() || "TA",
    completedCount,
    totalCount: tasks.length,
    isComplete: completedCount === tasks.length,
    currentTaskKey,
    currentTaskTitle: asString(raw.currentTaskTitle).trim() || undefined,
    tasks,
  };
}

function parseConversationBootstrapAgent(
  value: unknown
): ConversationBootstrapAgent | undefined {
  const raw = asRecord(value);
  const id = asString(raw.id);

  if (!id) {
    return undefined;
  }

  return {
    id,
    name: asString(raw.name),
    avatar: asString(raw.avatar),
    sex: asNumber(raw.sex),
    agentCallMe: asString(raw.agentCallMe),
    iCallAgent: asString(raw.iCallAgent),
    hasUnreadAgentHomeGuide: Boolean(raw.hasUnreadAgentHomeGuide),
    hasUnreadAgentProfileGuide: Boolean(raw.hasUnreadAgentProfileGuide),
    isDefault: Boolean(raw.isDefault),
  };
}

export async function deleteConversationMessage(
  conversationId: string,
  messageId: string,
  options: { deleteImportedMemory?: boolean } = {}
) {
  const query = options.deleteImportedMemory ? "?deleteImportedMemory=1" : "";
  await del(
    `/api/conversation/${encodeURIComponent(
      conversationId
    )}/messages/${encodeURIComponent(messageId)}${query}`
  );
  invalidateConversationListCache();
  invalidateCachedConversationMessages(conversationId);
}

export async function markConversationMessageMemory(
  conversationId: string,
  messageId: string
) {
  await post(
    `/api/conversation/${encodeURIComponent(
      conversationId
    )}/messages/${encodeURIComponent(messageId)}/memory`,
    {}
  );
}

export async function getConversationChatQuota(conversationId: string) {
  const data = await get<unknown>(
    `/api/conversation/${conversationId}/chat-quota`
  );

  return parseChatQuota(data);
}

export async function sendConversationMessage(
  conversationId: string,
  payload: {
    content?: string;
    type?: string;
    mediaUrl?: string;
    objectKey?: string;
    mimeType?: string;
    durationMs?: number;
    quotedMessageId?: string;
    clientRequestId?: string;
  }
): Promise<SendConversationMessageResult> {
  const body: Record<string, unknown> = {
    type: payload.type ?? "text",
  };
  const content = payload.content?.trim();
  const mediaUrl = payload.mediaUrl?.trim();
  const objectKey = payload.objectKey?.trim();
  const mimeType = payload.mimeType?.trim();
  const durationMs = payload.durationMs;
  const quotedMessageId = payload.quotedMessageId?.trim();
  const clientRequestId = payload.clientRequestId?.trim();

  if (content) {
    body.content = content;
  }
  if (mediaUrl) {
    body.mediaUrl = mediaUrl;
  }
  if (objectKey) {
    body.objectKey = objectKey;
  }
  if (mimeType) {
    body.mimeType = mimeType;
  }
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    body.durationMs = Math.round(durationMs);
  }
  if (quotedMessageId) {
    body.quotedMessageId = quotedMessageId;
  }
  const data = await post<SendConversationMessageResponse>(
    `/api/conversation/${conversationId}/messages`,
    body,
    {
      headers: clientRequestId
        ? { "X-Client-Request-Id": clientRequestId }
        : undefined,
    }
  );
  invalidateConversationListCache();
  invalidateCachedConversationMessages(conversationId);

  return {
    userMessage: parseConversationMessage(data.userMessage),
    assistantMessage: data.assistantMessage
      ? parseConversationMessage(data.assistantMessage)
      : undefined,
    assistantMessages: Array.isArray(data.assistantMessages)
      ? data.assistantMessages.map((item) => parseConversationMessage(item))
      : undefined,
    chatQuota: parseChatQuota(data.chatQuota),
    messengerTaskPlan: parseMessengerMemoryTaskPlan(data.messengerTaskPlan),
    replyPending: Boolean(data.replyPending),
  };
}

export async function sendConversationMessageAsync(
  conversationId: string,
  payload: {
    content?: string;
    type?: string;
    mediaUrl?: string;
    objectKey?: string;
    mimeType?: string;
    durationMs?: number;
    quotedMessageId?: string;
    clientRequestId?: string;
  }
): Promise<SendConversationMessageResult> {
  const body: Record<string, unknown> = {
    type: payload.type ?? "text",
  };
  const content = payload.content?.trim();
  const mediaUrl = payload.mediaUrl?.trim();
  const objectKey = payload.objectKey?.trim();
  const mimeType = payload.mimeType?.trim();
  const durationMs = payload.durationMs;
  const quotedMessageId = payload.quotedMessageId?.trim();
  const clientRequestId = payload.clientRequestId?.trim();

  if (content) {
    body.content = content;
  }
  if (mediaUrl) {
    body.mediaUrl = mediaUrl;
  }
  if (objectKey) {
    body.objectKey = objectKey;
  }
  if (mimeType) {
    body.mimeType = mimeType;
  }
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    body.durationMs = Math.round(durationMs);
  }
  if (quotedMessageId) {
    body.quotedMessageId = quotedMessageId;
  }
  const data = await post<SendConversationMessageResponse>(
    `/api/conversation/${conversationId}/messages/async`,
    body,
    {
      headers: clientRequestId
        ? { "X-Client-Request-Id": clientRequestId }
        : undefined,
    }
  );
  invalidateConversationListCache();
  invalidateCachedConversationMessages(conversationId);

  return {
    userMessage: parseConversationMessage(data.userMessage),
    assistantMessage: data.assistantMessage
      ? parseConversationMessage(data.assistantMessage)
      : undefined,
    assistantMessages: Array.isArray(data.assistantMessages)
      ? data.assistantMessages.map((item) => parseConversationMessage(item))
      : undefined,
    chatQuota: parseChatQuota(data.chatQuota),
    messengerTaskPlan: parseMessengerMemoryTaskPlan(data.messengerTaskPlan),
    replyPending: Boolean(data.replyPending),
  };
}

export async function generateConversationMessageVoice(
  conversationId: string,
  messageId: string
) {
  const data = await post<unknown>(
    `/api/conversation/${encodeURIComponent(
      conversationId
    )}/messages/${encodeURIComponent(messageId)}/voice`
  );

  return parseConversationMessage(data);
}

export async function convertConversationMessageVoiceToText(
  conversationId: string,
  messageId: string
) {
  const data = await post<unknown>(
    `/api/conversation/${encodeURIComponent(
      conversationId
    )}/messages/${encodeURIComponent(messageId)}/text`
  );

  return parseConversationMessage(data);
}

export async function submitConversationMessageFeedback(
  conversationId: string,
  messageId: string,
  payload: {
    type: ConversationMessageFeedbackType;
    content?: string;
  }
) {
  const body: Record<string, unknown> = {
    type: payload.type,
  };
  const content = payload.content?.trim();

  if (content) {
    body.content = content;
  }

  await post(
    `/api/conversation/${encodeURIComponent(
      conversationId
    )}/messages/${encodeURIComponent(messageId)}/feedback`,
    body
  );
}

export async function generateConversationMemorialPhoto(
  conversationId: string,
  payload: {
    agentPhotoObjectKeys: string[];
    userPhotoObjectKey: string;
    customPrompt?: string;
    clientRequestId?: string;
  }
) {
  const customPrompt = payload.customPrompt?.trim();
  const clientRequestId = payload.clientRequestId?.trim();
  const body: Record<string, unknown> = {
    agentPhotoObjectKeys: payload.agentPhotoObjectKeys,
    userPhotoObjectKey: payload.userPhotoObjectKey,
  };

  if (customPrompt) {
    body.customPrompt = customPrompt;
  }
  if (clientRequestId) {
    body.clientRequestId = clientRequestId;
  }

  const data = await post<unknown>(
    `/api/conversation/${encodeURIComponent(conversationId)}/memorial-photo`,
    body
  );

  return parseConversationMessage(data);
}

export async function transcribeConversationVoice(
  conversationId: string,
  payload: {
    mediaUrl?: string;
    objectKey?: string;
    mimeType?: string;
  }
) {
  const body: Record<string, unknown> = {};
  const mediaUrl = payload.mediaUrl?.trim();
  const objectKey = payload.objectKey?.trim();
  const mimeType = payload.mimeType?.trim();

  if (mediaUrl) {
    body.mediaUrl = mediaUrl;
  }
  if (objectKey) {
    body.objectKey = objectKey;
  }
  if (mimeType) {
    body.mimeType = mimeType;
  }

  const data = await post<VoiceTranscriptionResponse>(
    `/api/conversation/${conversationId}/voice-transcription`,
    body
  );

  return asString(data.transcript).trim();
}
