import { del, get, patch, post } from "../api/api-client";

export type ChatImportStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "recognizing"
  | "needs_review"
  | "importing"
  | "extracting_memory"
  | "needs_memory_review"
  | "completed"
  | "partial_failed"
  | "failed"
  | "canceled";

export type ChatImportSpeaker = "user" | "agent" | "unknown";
export type ChatImportSide = "left" | "right" | "center" | "unknown";
export type ChatImportTimePrecision = "minute" | "day" | "month" | "unknown";
export type ChatImportConfidence = "high" | "medium" | "low";

export interface ChatImportAsset {
  id: string;
  objectKey: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
  screenshotSequence: number;
  status: string;
  errorCode: string;
  errorDetail: string;
}

export interface ChatImportItem {
  id: string;
  screenshotId: string;
  screenshotSequence: number;
  bubbleSequence: number;
  side: ChatImportSide;
  speaker: ChatImportSpeaker;
  type: string;
  content: string;
  rawTimeText: string;
  occurredAt: Date | null;
  timePrecision: ChatImportTimePrecision;
  timeConfidence: ChatImportConfidence;
  textConfidence: number;
  speakerConfidence: number;
  recognitionConfidence: number;
  isDuplicate: boolean;
  isDeleted: boolean;
  isEdited: boolean;
  isConfirmed: boolean;
  messageId: string;
}

export interface ChatImportMemoryCandidate {
  id: string;
  type: string;
  value: string;
  priority: number;
  status: "pending" | "confirmed" | "rejected";
  sourceItemIds: string[];
  factId: string;
  updatedAt: Date | null;
}

export interface ChatImportBatch {
  id: string;
  conversationId: string;
  agentId: string;
  status: ChatImportStatus;
  assets: ChatImportAsset[];
  leftSpeaker: ChatImportSpeaker;
  rightSpeaker: ChatImportSpeaker;
  screenshotCount: number;
  recognizedCount: number;
  confirmedCount: number;
  failedCount: number;
  duplicateCount: number;
  memoryStatus: string;
  styleStatus: string;
  memoryCandidates: ChatImportMemoryCandidate[];
  earliestOccurredAt: Date | null;
  latestOccurredAt: Date | null;
  errorCode: string;
  errorDetail: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
}

export interface ChatImportResult {
  batch: ChatImportBatch | null;
  items: ChatImportItem[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDate(value: unknown): Date | null {
  const text = asString(value).trim();
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseSpeaker(value: unknown): ChatImportSpeaker {
  const text = asString(value);
  return text === "user" || text === "agent" ? text : "unknown";
}

function parseResult(value: unknown): ChatImportResult {
  const raw = asRecord(value);
  const batchRaw = asRecord(raw.batch);
  const batchId = asString(batchRaw.id);

  return {
    batch: batchId
      ? {
          id: batchId,
          conversationId: asString(batchRaw.conversationId),
          agentId: asString(batchRaw.agentId),
          status: (asString(batchRaw.status) || "draft") as ChatImportStatus,
          assets: Array.isArray(batchRaw.assets)
            ? batchRaw.assets.map((assetValue) => {
                const asset = asRecord(assetValue);
                return {
                  id: asString(asset.id),
                  objectKey: asString(asset.objectKey),
                  publicUrl: asString(asset.publicUrl),
                  fileName: asString(asset.fileName),
                  mimeType: asString(asset.mimeType),
                  screenshotSequence: asNumber(asset.screenshotSequence),
                  status: asString(asset.status),
                  errorCode: asString(asset.errorCode),
                  errorDetail: asString(asset.errorDetail),
                };
              })
            : [],
          leftSpeaker: parseSpeaker(batchRaw.leftSpeaker),
          rightSpeaker: parseSpeaker(batchRaw.rightSpeaker),
          screenshotCount: asNumber(batchRaw.screenshotCount),
          recognizedCount: asNumber(batchRaw.recognizedCount),
          confirmedCount: asNumber(batchRaw.confirmedCount),
          failedCount: asNumber(batchRaw.failedCount),
          duplicateCount: asNumber(batchRaw.duplicateCount),
          memoryStatus: asString(batchRaw.memoryStatus),
          styleStatus: asString(batchRaw.styleStatus),
          memoryCandidates: Array.isArray(batchRaw.memoryCandidates)
            ? batchRaw.memoryCandidates.map((memoryValue) => {
                const memory = asRecord(memoryValue);
                return {
                  id: asString(memory.id),
                  type: asString(memory.type),
                  value: asString(memory.value),
                  priority: asNumber(memory.priority),
                  status: (asString(memory.status) ||
                    "pending") as ChatImportMemoryCandidate["status"],
                  sourceItemIds: Array.isArray(memory.sourceItemIds)
                    ? memory.sourceItemIds.map(asString).filter(Boolean)
                    : [],
                  factId: asString(memory.factId),
                  updatedAt: asDate(memory.updatedAt),
                };
              })
            : [],
          earliestOccurredAt: asDate(batchRaw.earliestOccurredAt),
          latestOccurredAt: asDate(batchRaw.latestOccurredAt),
          errorCode: asString(batchRaw.errorCode),
          errorDetail: asString(batchRaw.errorDetail),
          createdAt: asDate(batchRaw.createdAt),
          updatedAt: asDate(batchRaw.updatedAt),
          completedAt: asDate(batchRaw.completedAt),
        }
      : null,
    items: Array.isArray(raw.items)
      ? raw.items.map((itemValue) => {
          const item = asRecord(itemValue);
          return {
            id: asString(item.id),
            screenshotId: asString(item.screenshotId),
            screenshotSequence: asNumber(item.screenshotSequence),
            bubbleSequence: asNumber(item.bubbleSequence),
            side: (asString(item.side) || "unknown") as ChatImportSide,
            speaker: parseSpeaker(item.speaker),
            type: asString(item.type) || "text",
            content: asString(item.content),
            rawTimeText: asString(item.rawTimeText),
            occurredAt: asDate(item.occurredAt),
            timePrecision: (asString(item.timePrecision) ||
              "unknown") as ChatImportTimePrecision,
            timeConfidence: (asString(item.timeConfidence) ||
              "low") as ChatImportConfidence,
            textConfidence: asNumber(item.textConfidence),
            speakerConfidence: asNumber(item.speakerConfidence),
            recognitionConfidence: asNumber(item.recognitionConfidence),
            isDuplicate: item.isDuplicate === true,
            isDeleted: item.isDeleted === true,
            isEdited: item.isEdited === true,
            isConfirmed: item.isConfirmed === true,
            messageId: asString(item.messageId),
          } satisfies ChatImportItem;
        })
      : [],
  };
}

export async function createChatImport(
  conversationId: string,
  payload: {
    clientRequestId?: string;
    timezoneOffsetMinutes?: number;
    deleteAssetsAfterImport?: boolean;
  } = {}
) {
  return parseResult(
    await post(`/api/conversation/${conversationId}/chat-imports`, payload)
  );
}

export async function getActiveChatImport(conversationId: string) {
  return parseResult(
    await get(`/api/conversation/${conversationId}/chat-imports/active`)
  );
}

export async function getChatImport(conversationId: string, batchId: string) {
  return parseResult(
    await get(`/api/conversation/${conversationId}/chat-imports/${batchId}`)
  );
}

export async function addChatImportAsset(
  conversationId: string,
  batchId: string,
  payload: {
    objectKey: string;
    publicUrl?: string;
    fileName?: string;
    mimeType?: string;
    screenshotSequence: number;
  }
) {
  return parseResult(
    await post(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/assets`,
      payload
    )
  );
}

export async function recognizeChatImport(
  conversationId: string,
  batchId: string,
  payload: { leftSpeaker: ChatImportSpeaker; rightSpeaker: ChatImportSpeaker }
) {
  return parseResult(
    await post(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/recognize`,
      payload
    )
  );
}

export async function updateChatImportIdentity(
  conversationId: string,
  batchId: string,
  payload: { leftSpeaker: ChatImportSpeaker; rightSpeaker: ChatImportSpeaker }
) {
  return parseResult(
    await patch(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/identity`,
      payload
    )
  );
}

export async function updateChatImportItem(
  conversationId: string,
  batchId: string,
  itemId: string,
  payload: {
    content?: string;
    speaker?: ChatImportSpeaker;
    rawTimeText?: string;
    occurredAt?: string;
    timePrecision?: ChatImportTimePrecision;
    timeConfidence?: ChatImportConfidence;
    isDeleted?: boolean;
  }
) {
  return parseResult(
    await patch(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/items/${itemId}`,
      payload
    )
  );
}

export async function confirmChatImport(
  conversationId: string,
  batchId: string
) {
  return parseResult(
    await post(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/confirm`,
      {}
    )
  );
}

export async function updateChatImportMemory(
  conversationId: string,
  batchId: string,
  memoryId: string,
  payload: { value?: string; isDeleted?: boolean }
) {
  return parseResult(
    await patch(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/memories/${memoryId}`,
      payload
    )
  );
}

export async function confirmChatImportMemories(
  conversationId: string,
  batchId: string
) {
  return parseResult(
    await post(
      `/api/conversation/${conversationId}/chat-imports/${batchId}/memories/confirm`,
      {}
    )
  );
}

export async function cancelChatImport(
  conversationId: string,
  batchId: string
) {
  await del(`/api/conversation/${conversationId}/chat-imports/${batchId}`);
}
