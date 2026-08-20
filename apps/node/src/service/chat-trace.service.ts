import { InjectEntityModel } from '@midwayjs/typeorm';
import { Config, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import {
  ChatSpanAttributeValue,
  ChatSpanEntity,
  ChatSpanStatus,
  ChatTraceEntity,
  ChatTraceStage,
  ChatTraceStatus,
} from '@tzl/entities';
import { createHash, randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { MongoRepository } from 'typeorm';

export enum ChatTraceArtifactKind {
  actualContext = 'actual_context',
  externalEvidence = 'external_evidence',
  mainModelDraft = 'main_model_draft',
  reviewCandidate = 'review_candidate',
  revisionDraft = 'revision_draft',
  finalBubbles = 'final_bubbles',
  deliveryResult = 'delivery_result',
}

const CHAT_SPAN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SPAN_ATTRIBUTES = 24;
const MAX_ATTRIBUTE_STRING_LENGTH = 160;
const MAX_ARTIFACT_BYTES = 256 * 1024;
// Large enough for all seven required 256 KiB artifacts, but still bounded
// when retries or extra diagnostics add more snapshots.
const MAX_TRACE_ARTIFACT_STORED_BYTES = 2 * 1024 * 1024;

function safeUtf16Prefix(value: string, length: number): string {
  let end = Math.max(0, Math.min(value.length, length));
  if (
    end > 0 &&
    end < value.length &&
    /[\uD800-\uDBFF]/.test(value.charAt(end - 1))
  ) {
    end -= 1;
  }
  return value.slice(0, end);
}

interface ChatTraceCollection {
  traceId: string;
  attempt?: number;
  spans: ChatSpanEntity[];
  artifactStoredBytes: number;
}

interface ActiveChatTraceContext {
  collection: ChatTraceCollection;
  parentSpanId?: string;
  stage?: ChatTraceStage;
}

export interface EnsureChatTraceOptions {
  traceId?: string;
  conversationId: string;
  userId: string;
  agentId?: string;
  triggerMessageIds?: string[];
  queueJobId?: string;
  acceptedAt?: Date;
  releaseVersion?: string;
}

export interface ChatTraceRunOptions {
  attempt?: number;
}

export interface ChatSpanOptions {
  attempt?: number;
  attributes?: Record<string, ChatSpanAttributeValue | undefined>;
}

export interface ChatTraceArtifactOptions {
  stage: ChatTraceStage;
  kind: ChatTraceArtifactKind;
  operation?: string;
  payload: unknown;
  attempt?: number;
  attributes?: Record<string, ChatSpanAttributeValue | undefined>;
}

export interface ChatSpanRecorder {
  setAttribute(key: string, value: ChatSpanAttributeValue | undefined): void;
  setModelUsage(usage: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }): void;
  setResultCode(resultCode?: string): void;
  markDiscarded(): void;
  markSkipped(): void;
}

export interface CompleteChatTraceOptions {
  responseCompletedAt?: Date;
  replyMessageIds?: string[];
  replyGroupId?: string;
  promptVersion?: string;
  strategyVersion?: string;
  acceptedAt?: Date;
}

@Provide()
export class ChatTraceService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ChatTraceEntity)
  traceModel: MongoRepository<ChatTraceEntity>;

  @InjectEntityModel(ChatSpanEntity)
  spanModel: MongoRepository<ChatSpanEntity>;

  @Config('chatTrace')
  chatTraceConfig?: { artifactSampleRate?: number };

  private readonly storage = new AsyncLocalStorage<ActiveChatTraceContext>();

  createTraceId(): string {
    return randomBytes(16).toString('hex');
  }

  createSpanId(): string {
    return randomBytes(8).toString('hex');
  }

  getCurrentTraceId(): string | undefined {
    return this.storage.getStore()?.collection.traceId;
  }

  getCurrentStage(): ChatTraceStage | undefined {
    return this.storage.getStore()?.stage;
  }

  async ensureTrace(options: EnsureChatTraceOptions): Promise<string> {
    const traceId =
      this.normalizeTraceId(options.traceId) || this.createTraceId();
    const now = new Date();
    const acceptedAt = this.normalizeDate(options.acceptedAt) || now;
    const triggerMessageIds = this.normalizeIds(options.triggerMessageIds);
    const queueJobIds = this.normalizeIds(
      options.queueJobId ? [options.queueJobId] : []
    );

    await this.safeTraceUpdate(
      { traceId },
      {
        $setOnInsert: {
          traceId,
          conversationId: options.conversationId,
          userId: options.userId,
          agentId: options.agentId,
          replyMessageIds: [],
          status: ChatTraceStatus.queued,
          attemptCount: 0,
          releaseVersion: options.releaseVersion,
          acceptedAt,
          totalModelCalls: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          tokensByStage: {},
          createdAt: now,
        },
        $set: {
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    if (triggerMessageIds.length || queueJobIds.length) {
      await this.safeTraceUpdate(
        { traceId },
        {
          $addToSet: {
            ...(triggerMessageIds.length
              ? { triggerMessageIds: { $each: triggerMessageIds } }
              : {}),
            ...(queueJobIds.length
              ? { queueJobIds: { $each: queueJobIds } }
              : {}),
          },
          $set: { updatedAt: now },
        }
      );
    }

    return traceId;
  }

  async runWithTrace<T>(
    traceId: string,
    task: () => Promise<T>,
    options: ChatTraceRunOptions = {}
  ): Promise<T> {
    const normalizedTraceId = this.normalizeTraceId(traceId);
    if (!normalizedTraceId) {
      return task();
    }

    const active = this.storage.getStore();
    if (active?.collection.traceId === normalizedTraceId) {
      return task();
    }

    return this.runDetachedWithTrace(normalizedTraceId, task, options);
  }

  async runDetachedWithTrace<T>(
    traceId: string,
    task: () => Promise<T>,
    options: ChatTraceRunOptions = {}
  ): Promise<T> {
    const normalizedTraceId = this.normalizeTraceId(traceId);
    if (!normalizedTraceId) {
      return task();
    }

    const collection: ChatTraceCollection = {
      traceId: normalizedTraceId,
      attempt: this.normalizeCount(options.attempt),
      spans: [],
      artifactStoredBytes: 0,
    };

    try {
      return await this.storage.run({ collection }, task);
    } finally {
      await this.flushSpans(collection);
    }
  }

  async withSpan<T>(
    stage: ChatTraceStage,
    operation: string,
    task: (recorder: ChatSpanRecorder) => Promise<T> | T,
    options: ChatSpanOptions = {}
  ): Promise<T> {
    const active = this.storage.getStore();
    if (!active) {
      return task(this.createNoopRecorder());
    }

    const startedAt = new Date();
    const span = new ChatSpanEntity();
    span.traceId = active.collection.traceId;
    span.spanId = this.createSpanId();
    span.parentSpanId = active.parentSpanId;
    span.stage = stage;
    span.operation = this.normalizeOperation(operation);
    span.attempt =
      this.normalizeCount(options.attempt) ?? active.collection.attempt;
    span.status = ChatSpanStatus.completed;
    span.startedAt = startedAt;
    span.attributes = this.normalizeAttributes(options.attributes);
    const recorder = this.createRecorder(span);

    try {
      return await this.storage.run(
        {
          collection: active.collection,
          parentSpanId: span.spanId,
          stage,
        },
        () => task(recorder)
      );
    } catch (error) {
      span.status = ChatSpanStatus.failed;
      span.errorCode = this.resolveErrorCode(error);
      throw error;
    } finally {
      span.completedAt = new Date();
      span.durationMs = Math.max(
        0,
        span.completedAt.getTime() - startedAt.getTime()
      );
      span.expiresAt = new Date(
        span.completedAt.getTime() + CHAT_SPAN_RETENTION_MS
      );
      active.collection.spans.push(span);
    }
  }

  recordCompletedSpan(options: {
    stage: ChatTraceStage;
    operation: string;
    startedAt: Date;
    completedAt?: Date;
    attempt?: number;
    status?: ChatSpanStatus;
    attributes?: Record<string, ChatSpanAttributeValue | undefined>;
  }): void {
    const active = this.storage.getStore();
    if (!active) {
      return;
    }

    const completedAt = options.completedAt || new Date();
    const span = new ChatSpanEntity();
    span.traceId = active.collection.traceId;
    span.spanId = this.createSpanId();
    span.parentSpanId = active.parentSpanId;
    span.stage = options.stage;
    span.operation = this.normalizeOperation(options.operation);
    span.attempt =
      this.normalizeCount(options.attempt) ?? active.collection.attempt;
    span.status = options.status || ChatSpanStatus.completed;
    span.startedAt = options.startedAt;
    span.completedAt = completedAt;
    span.durationMs = Math.max(
      0,
      completedAt.getTime() - options.startedAt.getTime()
    );
    span.attributes = this.normalizeAttributes(options.attributes);
    span.expiresAt = new Date(completedAt.getTime() + CHAT_SPAN_RETENTION_MS);
    active.collection.spans.push(span);
  }

  recordArtifact(options: ChatTraceArtifactOptions): void {
    const active = this.storage.getStore();
    if (!active || !this.shouldCaptureArtifacts(active.collection.traceId)) {
      return;
    }

    const remainingBytes =
      MAX_TRACE_ARTIFACT_STORED_BYTES - active.collection.artifactStoredBytes;
    if (remainingBytes < 256) {
      return;
    }

    const now = new Date();
    const serialized = this.serializeArtifact(
      options.payload,
      Math.min(MAX_ARTIFACT_BYTES, remainingBytes)
    );
    const span = new ChatSpanEntity();
    span.traceId = active.collection.traceId;
    span.spanId = this.createSpanId();
    span.parentSpanId = active.parentSpanId;
    span.stage = options.stage;
    span.operation = this.normalizeOperation(
      options.operation || `artifact.${options.kind}`
    );
    span.attempt =
      this.normalizeCount(options.attempt) ?? active.collection.attempt;
    span.status = ChatSpanStatus.completed;
    span.startedAt = now;
    span.completedAt = now;
    span.durationMs = 0;
    span.attributes = this.normalizeAttributes(options.attributes);
    const artifactSpan = span as ChatSpanEntity & {
      artifactKind?: ChatTraceArtifactKind;
      artifactPayload?: string;
      artifactHash?: string;
      artifactBytes?: number;
      artifactTruncated?: boolean;
    };
    artifactSpan.artifactKind = options.kind;
    artifactSpan.artifactPayload = serialized.payload;
    artifactSpan.artifactHash = serialized.hash;
    artifactSpan.artifactBytes = serialized.bytes;
    artifactSpan.artifactTruncated = serialized.truncated;
    span.expiresAt = new Date(now.getTime() + CHAT_SPAN_RETENTION_MS);
    active.collection.spans.push(span);
    active.collection.artifactStoredBytes += Buffer.byteLength(
      serialized.payload,
      'utf8'
    );
  }

  async markRunning(
    traceId: string,
    options: {
      workerStartedAt?: Date;
      attempt?: number;
      queueJobId?: string;
    } = {}
  ): Promise<void> {
    const now = options.workerStartedAt || new Date();
    const attempt = this.normalizeCount(options.attempt) || 1;
    await this.safeTraceUpdate(
      { traceId },
      {
        $set: {
          status: ChatTraceStatus.running,
          updatedAt: now,
        },
        $min: { workerStartedAt: now },
        $max: { attemptCount: attempt },
        ...(options.queueJobId
          ? { $addToSet: { queueJobIds: options.queueJobId } }
          : {}),
      }
    );
  }

  async markQueued(traceId: string): Promise<void> {
    const now = new Date();
    await this.safeTraceUpdate(
      { traceId },
      { $set: { status: ChatTraceStatus.queued, updatedAt: now } }
    );
  }

  async markCompleted(
    traceId: string,
    options: CompleteChatTraceOptions = {}
  ): Promise<void> {
    const completedAt = options.responseCompletedAt || new Date();
    const acceptedAt = this.normalizeDate(options.acceptedAt);
    await this.safeTraceUpdate(
      { traceId },
      {
        $set: {
          status: ChatTraceStatus.completed,
          responseCompletedAt: completedAt,
          ...(acceptedAt
            ? {
                visibleLatencyMs: Math.max(
                  0,
                  completedAt.getTime() - acceptedAt.getTime()
                ),
                totalLatencyMs: Math.max(
                  0,
                  completedAt.getTime() - acceptedAt.getTime()
                ),
              }
            : {}),
          ...(options.replyGroupId
            ? { replyGroupId: options.replyGroupId }
            : {}),
          ...(options.promptVersion
            ? { promptVersion: options.promptVersion }
            : {}),
          ...(options.strategyVersion
            ? { strategyVersion: options.strategyVersion }
            : {}),
          updatedAt: completedAt,
        },
        ...(options.replyMessageIds?.length
          ? {
              $addToSet: {
                replyMessageIds: {
                  $each: this.normalizeIds(options.replyMessageIds),
                },
              },
            }
          : {}),
      }
    );
  }

  async markBackgroundCompleted(
    traceId: string,
    completedAt = new Date(),
    acceptedAt?: Date
  ): Promise<void> {
    const normalizedAcceptedAt = this.normalizeDate(acceptedAt);
    await this.safeTraceUpdate(
      { traceId },
      {
        $max: {
          backgroundCompletedAt: completedAt,
          updatedAt: completedAt,
          ...(normalizedAcceptedAt
            ? {
                totalLatencyMs: Math.max(
                  0,
                  completedAt.getTime() - normalizedAcceptedAt.getTime()
                ),
              }
            : {}),
        },
      }
    );
  }

  async markFailed(
    traceId: string,
    error: unknown,
    failureStage?: ChatTraceStage
  ): Promise<void> {
    const now = new Date();
    await this.safeTraceUpdate(
      { traceId },
      {
        $set: {
          status: ChatTraceStatus.failed,
          failureStage,
          errorCode: this.resolveErrorCode(error),
          responseCompletedAt: now,
          updatedAt: now,
        },
      }
    );
  }

  async markSkipped(traceId: string, resultCode: string): Promise<void> {
    const now = new Date();
    await this.safeTraceUpdate(
      { traceId },
      {
        $set: {
          status: ChatTraceStatus.skipped,
          errorCode: resultCode.slice(0, 80),
          responseCompletedAt: now,
          updatedAt: now,
        },
      }
    );
  }

  private createRecorder(span: ChatSpanEntity): ChatSpanRecorder {
    return {
      setAttribute: (key, value) => {
        if (value === undefined) {
          return;
        }
        span.attributes = this.normalizeAttributes({
          ...(span.attributes || {}),
          [key]: value,
        });
      },
      setModelUsage: usage => {
        span.model = usage.model?.trim() || span.model;
        span.promptTokens = this.normalizeCount(usage.promptTokens);
        span.completionTokens = this.normalizeCount(usage.completionTokens);
        span.totalTokens =
          this.normalizeCount(usage.totalTokens) ??
          (span.promptTokens || 0) + (span.completionTokens || 0);
      },
      setResultCode: resultCode => {
        span.resultCode = resultCode?.trim().slice(0, 80) || undefined;
      },
      markDiscarded: () => {
        span.status = ChatSpanStatus.discarded;
      },
      markSkipped: () => {
        span.status = ChatSpanStatus.skipped;
      },
    };
  }

  private createNoopRecorder(): ChatSpanRecorder {
    return {
      setAttribute: () => undefined,
      setModelUsage: () => undefined,
      setResultCode: () => undefined,
      markDiscarded: () => undefined,
      markSkipped: () => undefined,
    };
  }

  private async flushSpans(collection: ChatTraceCollection): Promise<void> {
    if (!collection.spans.length) {
      return;
    }

    const spans = collection.spans.splice(0, collection.spans.length);
    try {
      if (this.spanModel?.save) {
        await this.spanModel.save(spans);
      }
    } catch (error) {
      this.warn('span batch persistence failed', error, collection.traceId);
      return;
    }

    const totalModelCalls = spans.filter(span => Boolean(span.model)).length;
    const promptTokens = spans.reduce(
      (total, span) => total + (span.promptTokens || 0),
      0
    );
    const completionTokens = spans.reduce(
      (total, span) => total + (span.completionTokens || 0),
      0
    );
    const totalTokens = spans.reduce(
      (total, span) => total + (span.totalTokens || 0),
      0
    );
    const stageTokens = spans.reduce<Record<string, number>>((result, span) => {
      if (span.totalTokens) {
        result[`tokensByStage.${span.stage}`] =
          (result[`tokensByStage.${span.stage}`] || 0) + span.totalTokens;
      }
      return result;
    }, {});

    await this.safeTraceUpdate(
      { traceId: collection.traceId },
      {
        $inc: {
          totalModelCalls,
          promptTokens,
          completionTokens,
          totalTokens,
          ...stageTokens,
        },
        $set: { updatedAt: new Date() },
      }
    );
  }

  private async safeTraceUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<void> {
    try {
      const repository = this.traceModel as unknown as {
        updateOne?: (
          filter: Record<string, unknown>,
          update: Record<string, unknown>,
          options?: Record<string, unknown>
        ) => Promise<unknown>;
      };
      if (repository?.updateOne) {
        await repository.updateOne(filter, update, options);
      }
    } catch (error) {
      this.warn(
        'trace persistence failed',
        error,
        String(filter.traceId || '')
      );
    }
  }

  private normalizeTraceId(value?: string): string {
    const normalized = value?.trim().toLowerCase() || '';
    return /^[a-f0-9]{32}$/.test(normalized) ? normalized : '';
  }

  private normalizeOperation(value: string): string {
    return (value?.trim() || 'unknown').slice(0, 80);
  }

  private normalizeIds(values?: string[]): string[] {
    return Array.from(
      new Set((values || []).map(value => value?.trim()).filter(Boolean))
    ).slice(0, 50);
  }

  private normalizeCount(value?: number): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : undefined;
  }

  private normalizeDate(value?: Date): Date | undefined {
    return value instanceof Date && Number.isFinite(value.getTime())
      ? value
      : undefined;
  }

  private normalizeAttributes(
    attributes?: Record<string, ChatSpanAttributeValue | undefined>
  ): Record<string, ChatSpanAttributeValue> | undefined {
    if (!attributes) {
      return undefined;
    }

    const entries = Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .slice(0, MAX_SPAN_ATTRIBUTES)
      .map(
        ([key, value]) =>
          [
            key.slice(0, 64),
            typeof value === 'string'
              ? value.slice(0, MAX_ATTRIBUTE_STRING_LENGTH)
              : value,
          ] as [string, ChatSpanAttributeValue]
      );

    if (!entries.length) {
      return undefined;
    }

    return entries.reduce<Record<string, ChatSpanAttributeValue>>(
      (result, [key, value]) => {
        result[key] = value;
        return result;
      },
      {}
    );
  }

  private serializeArtifact(
    payload: unknown,
    maxStoredBytes: number
  ): {
    payload: string;
    hash: string;
    bytes: number;
    truncated: boolean;
  } {
    let value: string;
    try {
      value = JSON.stringify(payload, (_key, item) =>
        typeof item === 'bigint' ? item.toString() : item
      );
    } catch {
      value = JSON.stringify({ serializationError: true });
    }
    if (typeof value !== 'string') {
      value = JSON.stringify({ value: String(payload) });
    }

    const bytes = Buffer.byteLength(value, 'utf8');
    const hash = createHash('sha256').update(value).digest('hex');
    if (bytes <= maxStoredBytes) {
      return { payload: value, hash, bytes, truncated: false };
    }

    const buildEnvelope = (preview: string) =>
      JSON.stringify({
        truncated: true,
        originalBytes: bytes,
        sha256: hash,
        preview,
      });
    let low = 0;
    let high = value.length;
    let preview = '';
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = safeUtf16Prefix(value, middle);
      if (
        Buffer.byteLength(buildEnvelope(candidate), 'utf8') <= maxStoredBytes
      ) {
        preview = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return {
      payload: buildEnvelope(preview),
      hash,
      bytes,
      truncated: true,
    };
  }

  private shouldCaptureArtifacts(traceId: string): boolean {
    const configured = this.chatTraceConfig?.artifactSampleRate;
    const rate =
      typeof configured === 'number' && Number.isFinite(configured)
        ? Math.max(0, Math.min(1, configured))
        : 0;
    if (rate <= 0) return false;
    if (rate >= 1) return true;

    const bucket = Number.parseInt(
      createHash('sha256').update(traceId).digest('hex').slice(0, 8),
      16
    );
    return bucket / 0xffffffff < rate;
  }

  private resolveErrorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const candidate = error as { code?: unknown; name?: unknown };
      if (typeof candidate.code === 'string' && candidate.code.trim()) {
        return candidate.code.trim().slice(0, 80);
      }
      if (typeof candidate.name === 'string' && candidate.name.trim()) {
        return candidate.name.trim().slice(0, 80);
      }
    }

    return typeof error === 'string' && error.trim()
      ? error.trim().slice(0, 80)
      : 'UNKNOWN';
  }

  private warn(message: string, error: unknown, traceId: string): void {
    this.logger?.warn?.(
      '[chat-trace] %s, traceId=%s, reason=%s',
      message,
      traceId || '-',
      error instanceof Error ? error.message : String(error)
    );
  }
}
