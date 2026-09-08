import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import {
  DataType,
  FunctionType,
  IndexType,
  MetricType,
  MilvusClient,
  RRFRanker,
} from '@zilliz/milvus2-sdk-node';
import { MessageRole, MessageType } from '@tzl/entities';
import { OpenAIService } from '../agents/openai';

export interface MilvusServiceConfig {
  enabled?: boolean;
  address?: string;
  token?: string;
  username?: string;
  password?: string;
  database?: string;
  collectionName?: string;
  maxTextLength?: number;
  topK?: number;
  searchEf?: number;
  minScore?: number;
  minPersonScore?: number;
  minRawScore?: number;
  timeoutMs?: number;
  schemaVersion?: string;
  analyzer?: string;
  writeEnabled?: boolean;
  retrievalMode?: 'off' | 'shadow' | 'active';
}

export interface IndexConversationMessageOptions {
  messageId: string;
  memoryId?: string;
  sourceMessageId?: string;
  userId: string;
  conversationId: string;
  agentId?: string;
  role: MessageRole;
  type: MessageType;
  searchableText: string;
  createdAt: Date;
  updatedAt?: Date;
  personId?: string;
  memoryKind?: string;
  sourceHash?: string;
}

export interface SearchConversationMemoriesOptions {
  query: string;
  queryEmbedding?: number[];
  userId: string;
  agentId?: string;
  personId?: string;
  personScope?: 'exact' | 'unscoped' | 'any';
  memoryKinds?: string[];
  excludeMessageIds?: string[];
  createdBeforeTs?: number;
  limit?: number;
}

export interface RetrievedConversationMemory {
  id: string;
  sourceMessageId: string;
  conversationId: string;
  userId: string;
  agentId?: string;
  role: MessageRole;
  type: MessageType;
  searchableText: string;
  createdAtTs: number;
  updatedAtTs: number;
  personId?: string;
  memoryKind: string;
  sourceHash?: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  score: number;
}

const DENSE_VECTOR_FIELD_NAME = 'vector';
const SPARSE_VECTOR_FIELD_NAME = 'sparseVector';
const TEXT_FIELD_NAME = 'searchableText';
const BM25_FUNCTION_NAME = 'searchableTextBm25';
const ACTIVE_MEMORY_STATUS = 'active';
const DEFAULT_SCHEMA_VERSION = 'conversation_message_memory_v2';

@Provide()
export class MilvusService {
  @Logger()
  logger: ILogger;

  @Config('milvus')
  milvusConfig: MilvusServiceConfig;

  @Config('openai')
  openAIConfig: {
    embeddingDimensions?: number;
    embeddingModel?: string;
  };

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  redisService: RedisService;

  private client: MilvusClient | null = null;
  private ensureCollectionPromise: Promise<void> | null = null;
  private collectionLoaded = false;
  private collectionVectorDim?: number;

  // ---- OOM / 连接可靠性保护（2026-08-30） ----
  // 背景：@zilliz/milvus2-sdk-node@2.6.13 在 gRPC 连接失败/超时且回调不触发时，
  // executeCall 创建的 Promise 永不结算，请求对象（含 protobuf 编解码对象）被永久持有；
  // 且 SDK retry 拦截器（默认 maxRetries=3）失败时创建重试定时器，进一步累积对象，
  // 最终击穿 Node V8 2GB 内存上限导致 OOM。
  // 本保护策略：连接失败熔断降级 + 应用层请求超时 + 并发上限 + 关闭 SDK 重试。
  private static readonly CIRCUIT_FAILURE_THRESHOLD = 5;
  private static readonly CIRCUIT_COOLDOWN_MS = 60_000;
  private static readonly MAX_CONCURRENT_CALLS = 8;

  private circuitOpen = false;
  private circuitOpenSince = 0;
  private consecutiveFailures = 0;
  private inflightCalls = 0;
  private endpointReachable: boolean | undefined;
  private endpointRetryAt = 0;
  private endpointCheckPromise: Promise<boolean> | null = null;
  private runtimeDisabledReason = '';
  private sharedCircuitOpen = false;
  private sharedCircuitCheckedAt = 0;

  isEnabled(): boolean {
    return (
      this.milvusConfig?.enabled !== false &&
      Boolean(this.milvusConfig?.address?.trim()) &&
      !this.runtimeDisabledReason
    );
  }

  isIndexingEnabled(): boolean {
    return this.isEnabled() && this.milvusConfig?.writeEnabled !== false;
  }

  isRetrievalEnabled(): boolean {
    return this.isEnabled() && this.getRetrievalMode() !== 'off';
  }

  getRetrievalMode(): 'off' | 'shadow' | 'active' {
    const mode = this.milvusConfig?.retrievalMode;
    return mode === 'shadow' || mode === 'active' ? mode : 'off';
  }

  getRuntimeStatus(): Record<string, unknown> {
    return {
      enabled: this.isEnabled(),
      indexingEnabled: this.isIndexingEnabled(),
      retrievalMode: this.getRetrievalMode(),
      collectionName: this.getCollectionName(),
      schemaVersion: this.resolveSchemaVersion(),
      analyzer: this.resolveAnalyzer(),
      circuitOpen: this.circuitOpen || this.sharedCircuitOpen,
      consecutiveFailures: this.consecutiveFailures,
      inflightCalls: this.inflightCalls,
      endpointReachable: this.endpointReachable,
      relevancePolicy: this.getRelevancePolicy(),
    };
  }

  getRelevancePolicy(): {
    personMinScore?: number;
    rawMinScore?: number;
  } {
    const legacy = this.resolveMinScore();
    return {
      personMinScore: this.resolveOptionalScore(
        this.milvusConfig?.minPersonScore,
        legacy
      ),
      rawMinScore: this.resolveOptionalScore(
        this.milvusConfig?.minRawScore,
        legacy
      ),
    };
  }

  async deleteUserMemories(userId: string): Promise<boolean> {
    const normalizedUserId = userId?.trim();
    if (!normalizedUserId || !this.milvusConfig?.address?.trim()) return true;
    try {
      const client = this.getClient();
      await this.withMilvusTimeout(client.connectPromise, 'connectForDelete');
      const hasCollection = await this.withMilvusTimeout(
        client.hasCollection({
          collection_name: this.getCollectionName(),
          timeout: this.resolveTimeoutMs(),
        }),
        'hasCollectionForDelete'
      );
      if (!hasCollection?.value) return true;
      await this.withMilvusTimeout(
        client.delete({
          collection_name: this.getCollectionName(),
          filter: `userId == "${this.escapeFilterValue(normalizedUserId)}"`,
        }),
        'deleteUserMemories'
      );
      this.recordMilvusSuccess();
      return true;
    } catch (error) {
      this.recordMilvusFailure('delete_user_memories', error);
      this.logger.error(
        '[milvus] user memory deletion failed, userId=%s reason=%s',
        normalizedUserId,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  async indexConversationMessage(
    options: IndexConversationMessageOptions
  ): Promise<boolean> {
    if (!this.isIndexingEnabled() || !this.openAIService.hasEmbeddingConfig()) {
      return false;
    }

    const searchableText = this.normalizeSearchableText(options.searchableText);

    if (!searchableText) {
      return false;
    }

    if (!(await this.ensureEndpointReachable())) {
      return false;
    }

    if (this.isCircuitOpen()) {
      this.logger.warn('[milvus] index skipped, circuit is open');
      return false;
    }

    if (this.inflightCalls >= MilvusService.MAX_CONCURRENT_CALLS) {
      this.logger.warn(
        '[milvus] index skipped, too many inflight calls (%s)',
        this.inflightCalls
      );
      return false;
    }
    this.inflightCalls += 1;

    try {
      const vector = await this.openAIService.createEmbedding({
        input: searchableText,
        dimensions: this.openAIConfig?.embeddingDimensions,
      });
      await this.withMilvusTimeout(
        this.ensureCollection(vector.length),
        'ensureCollection'
      );
      await this.withMilvusTimeout(
        this.getClient().upsert({
          collection_name: this.getCollectionName(),
          timeout: this.resolveTimeoutMs(),
          data: [
            {
              id: options.memoryId?.trim() || options.messageId,
              sourceMessageId:
                options.sourceMessageId?.trim() || options.messageId,
              userId: options.userId,
              conversationId: options.conversationId,
              agentId: options.agentId?.trim() || '',
              role: options.role,
              type: options.type,
              personId: options.personId?.trim() || '',
              memoryKind: options.memoryKind?.trim() || 'raw_episode',
              status: ACTIVE_MEMORY_STATUS,
              schemaVersion: this.resolveSchemaVersion(),
              embeddingModel: this.openAIConfig?.embeddingModel?.trim() || '',
              embeddingVersion: this.resolveEmbeddingVersion(),
              sourceHash: options.sourceHash?.trim() || '',
              [TEXT_FIELD_NAME]: this.truncateText(searchableText),
              createdAtTs: this.normalizeCreatedAtTs(options.createdAt),
              updatedAtTs: this.normalizeCreatedAtTs(
                options.updatedAt || options.createdAt
              ),
              [DENSE_VECTOR_FIELD_NAME]: vector,
            },
          ],
        }),
        'upsert'
      );
      this.recordMilvusSuccess();
      return true;
    } catch (error) {
      this.recordMilvusFailure('index', error);
      throw error;
    } finally {
      this.inflightCalls -= 1;
    }
  }

  async searchConversationMemories(
    options: SearchConversationMemoriesOptions
  ): Promise<RetrievedConversationMemory[]> {
    if (
      !this.isRetrievalEnabled() ||
      !this.openAIService.hasEmbeddingConfig()
    ) {
      return [];
    }

    const query = this.normalizeSearchableText(options.query);

    if (!query) {
      return [];
    }

    if (!(await this.ensureEndpointReachable())) {
      return [];
    }

    if (this.isCircuitOpen()) {
      this.logger.warn('[milvus] search skipped, circuit is open');
      return [];
    }

    try {
      const client = this.getClient();
      const hasCollection = await this.withMilvusTimeout(
        client.hasCollection({
          collection_name: this.getCollectionName(),
          timeout: this.resolveTimeoutMs(),
        }),
        'hasCollection'
      );

      if (!hasCollection?.value) {
        return [];
      }

      await this.withMilvusTimeout(
        this.ensureCollection(this.collectionVectorDim),
        'ensureCollection'
      );

      const vector = this.resolveQueryEmbedding(options.queryEmbedding);

      if (!vector?.length) {
        return [];
      }

      const results = await this.withMilvusTimeout(
        client.hybridSearch({
          collection_name: this.getCollectionName(),
          timeout: this.resolveTimeoutMs(),
          data: [
            {
              anns_field: DENSE_VECTOR_FIELD_NAME,
              data: [vector],
              params: {
                ef: this.resolveSearchEf(),
              },
            },
            {
              anns_field: SPARSE_VECTOR_FIELD_NAME,
              data: query,
              params: {
                drop_ratio_search: 0.2,
              },
            },
          ],
          limit: this.resolveLimit(options.limit),
          filter: this.buildSearchFilter(options),
          output_fields: [
            'id',
            'sourceMessageId',
            'userId',
            'conversationId',
            'agentId',
            'role',
            'type',
            'personId',
            'memoryKind',
            'sourceHash',
            'embeddingModel',
            'embeddingVersion',
            TEXT_FIELD_NAME,
            'createdAtTs',
            'updatedAtTs',
          ],
          rerank: RRFRanker(60),
        }),
        'hybridSearch'
      );

      this.recordMilvusSuccess();

      const minScore = this.resolveMinScore();

      return (results.results || [])
        .map(item => this.buildRetrievedConversationMemory(item))
        .filter(
          item =>
            Boolean(item.id) &&
            item.searchableText &&
            (typeof minScore !== 'number' || item.score >= minScore)
        );
    } catch (error) {
      this.recordMilvusFailure('search', error);
      this.logger.error(
        '[milvus] search degraded, userId=%s, reason=%s',
        options.userId,
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  private resolveQueryEmbedding(value?: number[]): number[] | null {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    const vector = value.filter(
      item => typeof item === 'number' && Number.isFinite(item)
    );

    return vector.length ? vector : null;
  }

  private isCircuitOpen(): boolean {
    if (!this.circuitOpen) {
      return false;
    }

    if (
      Date.now() - this.circuitOpenSince >=
      MilvusService.CIRCUIT_COOLDOWN_MS
    ) {
      this.circuitOpen = false;
      this.consecutiveFailures = 0;
      this.logger.info('[milvus] circuit half-open, allowing probe request');
      return false;
    }

    return true;
  }

  private recordMilvusFailure(context: string, error?: unknown): void {
    this.consecutiveFailures += 1;

    if (this.isUnrecoverableEndpointFailure(error)) {
      this.disableForProcess(context, error);
      return;
    }

    if (this.consecutiveFailures >= MilvusService.CIRCUIT_FAILURE_THRESHOLD) {
      if (!this.circuitOpen) {
        this.circuitOpen = true;
        this.circuitOpenSince = Date.now();
        this.logger.error(
          '[milvus] circuit opened after %s consecutive failures (context=%s), pausing milvus calls for %sms',
          this.consecutiveFailures,
          context,
          MilvusService.CIRCUIT_COOLDOWN_MS
        );
        this.openSharedCircuit();
      }
    }
  }

  private recordMilvusSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.logger.info('[milvus] call succeeded, resetting failure counter');
    }

    this.consecutiveFailures = 0;
    this.sharedCircuitOpen = false;
    this.sharedCircuitCheckedAt = Date.now();
    if (this.redisService) {
      void this.redisService
        .del(this.sharedCircuitKey())
        .catch(() => undefined);
    }
  }

  private async isSharedCircuitUnavailable(): Promise<boolean> {
    if (!this.redisService) return false;
    if (Date.now() - this.sharedCircuitCheckedAt < 1000) {
      return this.sharedCircuitOpen;
    }
    this.sharedCircuitCheckedAt = Date.now();
    try {
      this.sharedCircuitOpen = Boolean(
        await this.redisService.get(this.sharedCircuitKey())
      );
    } catch {
      this.sharedCircuitOpen = false;
    }
    return this.sharedCircuitOpen;
  }

  private openSharedCircuit(): void {
    this.sharedCircuitOpen = true;
    this.sharedCircuitCheckedAt = Date.now();
    if (this.redisService) {
      void this.redisService
        .set(
          this.sharedCircuitKey(),
          String(Date.now()),
          'PX',
          MilvusService.CIRCUIT_COOLDOWN_MS
        )
        .catch(() => undefined);
    }
  }

  private sharedCircuitKey(): string {
    return `milvus:circuit:${this.milvusConfig?.address?.trim() || 'unknown'}`;
  }

  private withMilvusTimeout<T>(
    promise: Promise<T>,
    context: string
  ): Promise<T> {
    const timeoutMs = this.resolveTimeoutMs();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`milvus ${context} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private async ensureEndpointReachable(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    if (await this.isSharedCircuitUnavailable()) return false;
    if (this.endpointReachable === true) {
      return true;
    }
    if (this.endpointReachable === false) {
      if (Date.now() < this.endpointRetryAt) return false;
      this.endpointReachable = undefined;
    }
    if (this.endpointCheckPromise) {
      return this.endpointCheckPromise;
    }

    this.endpointCheckPromise = this.checkEndpointHostname();
    try {
      return await this.endpointCheckPromise;
    } finally {
      this.endpointCheckPromise = null;
    }
  }

  private async checkEndpointHostname(): Promise<boolean> {
    const hostname = this.resolveEndpointHostname();
    if (!hostname) {
      this.disableForProcess(
        'endpoint_preflight',
        new Error('invalid address')
      );
      return false;
    }
    if (hostname === 'localhost' || isIP(hostname)) {
      this.endpointReachable = true;
      return true;
    }

    try {
      await dns.lookup(hostname);
      this.endpointReachable = true;
      return true;
    } catch (error) {
      this.endpointReachable = false;
      this.endpointRetryAt = Date.now() + 30_000;
      this.recordMilvusFailure('endpoint_preflight', error);
      return false;
    }
  }

  private resolveEndpointHostname(): string {
    const address = this.milvusConfig?.address?.trim() || '';
    if (!address) return '';
    try {
      return new URL(address.includes('://') ? address : `tcp://${address}`)
        .hostname;
    } catch {
      return '';
    }
  }

  private isUnrecoverableEndpointFailure(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error || '');
    return /invalid address/iu.test(message);
  }

  private disableForProcess(context: string, error: unknown): void {
    if (this.runtimeDisabledReason) return;
    const reason = error instanceof Error ? error.message : String(error || '');
    this.runtimeDisabledReason = `${context}:${reason}`;
    this.endpointReachable = false;
    this.circuitOpen = true;
    this.circuitOpenSince = Date.now();
    this.logger.error(
      '[milvus] disabled for current process, context=%s, reason=%s',
      context,
      reason
    );

    const client = this.client;
    this.client = null;
    this.ensureCollectionPromise = null;
    if (client) {
      void client.closeConnection().catch(closeError => {
        this.logger.warn(
          '[milvus] failed to close disabled client, reason=%s',
          closeError instanceof Error ? closeError.message : String(closeError)
        );
      });
    }
  }

  private getClient(): MilvusClient {
    if (this.client) {
      return this.client;
    }

    this.client = new MilvusClient({
      address: this.milvusConfig?.address?.trim() || '127.0.0.1:19530',
      token: this.milvusConfig?.token?.trim() || undefined,
      username: this.milvusConfig?.username?.trim() || undefined,
      password: this.milvusConfig?.password?.trim() || undefined,
      database: this.milvusConfig?.database?.trim() || undefined,
      timeout: this.resolveTimeoutMs(),
      // 关闭 SDK 层重试（默认 maxRetries=3），避免失败时创建重试定时器与对象堆积
      maxRetries: 0,
    });

    return this.client;
  }

  private async ensureCollection(vectorDim?: number): Promise<void> {
    if (this.collectionLoaded && !vectorDim) {
      return;
    }

    if (
      this.collectionLoaded &&
      typeof vectorDim === 'number' &&
      this.collectionVectorDim === vectorDim
    ) {
      return;
    }

    if (this.ensureCollectionPromise) {
      await this.ensureCollectionPromise;
      return;
    }

    this.ensureCollectionPromise = this.doEnsureCollection(vectorDim);

    try {
      await this.ensureCollectionPromise;
    } finally {
      this.ensureCollectionPromise = null;
    }
  }

  private async doEnsureCollection(vectorDim?: number): Promise<void> {
    const client = this.getClient();
    await client.connectPromise;

    const collectionName = this.getCollectionName();
    const hasCollection = await client.hasCollection({
      collection_name: collectionName,
      timeout: this.resolveTimeoutMs(),
    });

    if (!hasCollection?.value) {
      if (typeof vectorDim !== 'number' || vectorDim <= 0) {
        return;
      }

      await client.createCollection({
        collection_name: collectionName,
        timeout: this.resolveTimeoutMs(),
        fields: [
          {
            name: 'id',
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 64,
          },
          {
            name: 'userId',
            data_type: DataType.VarChar,
            max_length: 64,
            is_partition_key: true,
          },
          {
            name: 'sourceMessageId',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: 'conversationId',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: 'agentId',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: 'role',
            data_type: DataType.VarChar,
            max_length: 16,
          },
          {
            name: 'type',
            data_type: DataType.VarChar,
            max_length: 16,
          },
          {
            name: 'personId',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: 'memoryKind',
            data_type: DataType.VarChar,
            max_length: 32,
          },
          {
            name: 'status',
            data_type: DataType.VarChar,
            max_length: 16,
          },
          {
            name: 'schemaVersion',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: 'embeddingModel',
            data_type: DataType.VarChar,
            max_length: 128,
          },
          {
            name: 'embeddingVersion',
            data_type: DataType.VarChar,
            max_length: 160,
          },
          {
            name: 'sourceHash',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: TEXT_FIELD_NAME,
            data_type: DataType.VarChar,
            max_length: this.resolveMaxTextLength(),
            enable_analyzer: true,
            enable_match: true,
            analyzer_params: { type: this.resolveAnalyzer() },
          },
          {
            name: 'createdAtTs',
            data_type: DataType.Int64,
          },
          {
            name: 'updatedAtTs',
            data_type: DataType.Int64,
          },
          {
            name: DENSE_VECTOR_FIELD_NAME,
            data_type: DataType.FloatVector,
            dim: vectorDim,
          },
          {
            name: SPARSE_VECTOR_FIELD_NAME,
            data_type: DataType.SparseFloatVector,
            is_function_output: true,
          },
        ],
        functions: [
          {
            name: BM25_FUNCTION_NAME,
            type: FunctionType.BM25,
            input_field_names: [TEXT_FIELD_NAME],
            output_field_names: [SPARSE_VECTOR_FIELD_NAME],
            params: {},
          },
        ],
        index_params: [
          {
            field_name: DENSE_VECTOR_FIELD_NAME,
            index_type: IndexType.HNSW,
            metric_type: MetricType.COSINE,
            params: {
              M: 16,
              efConstruction: 256,
            },
          },
          {
            field_name: SPARSE_VECTOR_FIELD_NAME,
            index_type: IndexType.SPARSE_INVERTED_INDEX,
            metric_type: MetricType.BM25,
            params: {
              inverted_index_algo: 'DAAT_MAXSCORE',
            },
          },
        ],
        enable_dynamic_field: false,
      });

      this.collectionVectorDim = vectorDim;
      this.logger.info(
        '[milvus] created hybrid collection=%s, vectorDim=%s',
        collectionName,
        vectorDim
      );
    } else {
      const description = await client.describeCollection({
        collection_name: collectionName,
        timeout: this.resolveTimeoutMs(),
      });
      this.assertHybridCollectionSchema(description);
      const vectorField = description?.schema?.fields?.find(
        field => field.name === DENSE_VECTOR_FIELD_NAME
      );
      const existingDim =
        typeof vectorField?.dim === 'number'
          ? vectorField.dim
          : Number(vectorField?.dim || 0);

      if (
        existingDim > 0 &&
        typeof vectorDim === 'number' &&
        vectorDim > 0 &&
        existingDim !== vectorDim
      ) {
        throw new Error(
          `milvus collection vector dim mismatch: expected ${vectorDim}, got ${existingDim}`
        );
      }

      this.collectionVectorDim = existingDim > 0 ? existingDim : vectorDim;
    }

    await client.loadCollection({
      collection_name: collectionName,
      timeout: this.resolveTimeoutMs(),
    });

    this.collectionLoaded = true;
  }

  private buildSearchFilter(
    options: SearchConversationMemoriesOptions
  ): string {
    const filters = [
      `userId == "${this.escapeFilterValue(options.userId)}"`,
      `status == "${ACTIVE_MEMORY_STATUS}"`,
    ];

    if (options.agentId?.trim()) {
      filters.push(`agentId == "${this.escapeFilterValue(options.agentId)}"`);
    }

    if (options.personScope === 'exact' && options.personId?.trim()) {
      filters.push(
        `personId == "${this.escapeFilterValue(options.personId.trim())}"`
      );
    } else if (options.personScope === 'unscoped') {
      filters.push('personId == ""');
    }

    const memoryKinds = (options.memoryKinds || [])
      .map(value => value?.trim())
      .filter(Boolean);
    if (memoryKinds.length) {
      filters.push(
        `memoryKind in [${memoryKinds
          .map(value => `"${this.escapeFilterValue(value)}"`)
          .join(',')}]`
      );
    }

    if (
      typeof options.createdBeforeTs === 'number' &&
      Number.isFinite(options.createdBeforeTs) &&
      options.createdBeforeTs > 0
    ) {
      filters.push(`createdAtTs < ${Math.floor(options.createdBeforeTs)}`);
    }

    for (const messageId of options.excludeMessageIds || []) {
      const normalized = messageId?.trim();

      if (!normalized) {
        continue;
      }

      filters.push(
        `sourceMessageId != "${this.escapeFilterValue(normalized)}"`
      );
    }

    return filters.join(' and ');
  }

  private buildRetrievedConversationMemory(result: {
    id?: unknown;
    sourceMessageId?: unknown;
    conversationId?: unknown;
    userId?: unknown;
    agentId?: unknown;
    role?: unknown;
    type?: unknown;
    searchableText?: unknown;
    createdAtTs?: unknown;
    updatedAtTs?: unknown;
    personId?: unknown;
    memoryKind?: unknown;
    sourceHash?: unknown;
    embeddingModel?: unknown;
    embeddingVersion?: unknown;
    score?: unknown;
  }): RetrievedConversationMemory {
    return {
      id: this.normalizeString(result.id),
      sourceMessageId:
        this.normalizeString(result.sourceMessageId) ||
        this.normalizeString(result.id),
      conversationId: this.normalizeString(result.conversationId),
      userId: this.normalizeString(result.userId),
      agentId: this.normalizeString(result.agentId) || undefined,
      role: this.normalizeMessageRole(result.role),
      type: this.normalizeMessageType(result.type),
      searchableText: this.normalizeString(result[TEXT_FIELD_NAME]),
      createdAtTs: this.normalizeNumber(result.createdAtTs),
      updatedAtTs: this.normalizeNumber(result.updatedAtTs),
      personId: this.normalizeString(result.personId) || undefined,
      memoryKind: this.normalizeString(result.memoryKind) || 'raw_episode',
      sourceHash: this.normalizeString(result.sourceHash) || undefined,
      embeddingModel: this.normalizeString(result.embeddingModel) || undefined,
      embeddingVersion:
        this.normalizeString(result.embeddingVersion) || undefined,
      score: this.normalizeNumber(result.score),
    };
  }

  private assertHybridCollectionSchema(description: {
    schema?: {
      fields?: Array<{
        name?: string;
        dim?: unknown;
      }>;
      functions?: Array<{
        name?: string;
      }>;
    };
  }): void {
    const fields = description?.schema?.fields || [];
    const fieldNames = new Set(
      fields.map(field => field.name?.trim()).filter(Boolean)
    );
    const functionNames = new Set(
      (description?.schema?.functions || [])
        .map(func => func.name?.trim())
        .filter(Boolean)
    );
    const requiredFields = [
      'id',
      'sourceMessageId',
      'userId',
      'conversationId',
      'agentId',
      'role',
      'type',
      'personId',
      'memoryKind',
      'status',
      'schemaVersion',
      'embeddingModel',
      'embeddingVersion',
      'sourceHash',
      TEXT_FIELD_NAME,
      'createdAtTs',
      'updatedAtTs',
      DENSE_VECTOR_FIELD_NAME,
      SPARSE_VECTOR_FIELD_NAME,
    ];

    for (const fieldName of requiredFields) {
      if (!fieldNames.has(fieldName)) {
        throw new Error(
          `milvus collection "${this.getCollectionName()}" is missing field "${fieldName}". Drop and recreate the collection, or use a new MILVUS_COLLECTION_NAME.`
        );
      }
    }

    if (!functionNames.has(BM25_FUNCTION_NAME)) {
      throw new Error(
        `milvus collection "${this.getCollectionName()}" is missing function "${BM25_FUNCTION_NAME}". Drop and recreate the collection, or use a new MILVUS_COLLECTION_NAME.`
      );
    }
  }

  private normalizeSearchableText(value?: string): string {
    return value?.replace(/\s+/g, ' ').trim() || '';
  }

  private truncateText(value?: string): string {
    const text = value?.trim() || '';

    if (!text) {
      return '';
    }

    return text.slice(0, this.resolveMaxTextLength());
  }

  private normalizeCreatedAtTs(value?: Date): number {
    const timestamp = value instanceof Date ? value.getTime() : NaN;

    return Number.isFinite(timestamp) && timestamp > 0
      ? Math.floor(timestamp)
      : Date.now();
  }

  private normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  private normalizeMessageRole(value: unknown): MessageRole {
    return value === MessageRole.assistant ||
      value === MessageRole.system ||
      value === MessageRole.user
      ? value
      : MessageRole.user;
  }

  private normalizeMessageType(value: unknown): MessageType {
    return value === MessageType.voice || value === MessageType.image
      ? value
      : MessageType.text;
  }

  private getCollectionName(): string {
    return (
      this.milvusConfig?.collectionName?.trim() ||
      'conversation_message_memory_v2'
    );
  }

  private resolveSchemaVersion(): string {
    return this.milvusConfig?.schemaVersion?.trim() || DEFAULT_SCHEMA_VERSION;
  }

  private resolveAnalyzer(): string {
    return this.milvusConfig?.analyzer?.trim() || 'chinese';
  }

  private resolveEmbeddingVersion(): string {
    const model = this.openAIConfig?.embeddingModel?.trim() || 'unknown';
    const dimensions = this.openAIConfig?.embeddingDimensions || 'default';
    return `${model}:${dimensions}`.slice(0, 160);
  }

  private resolveMaxTextLength(): number {
    const maxTextLength = this.milvusConfig?.maxTextLength;

    if (
      typeof maxTextLength !== 'number' ||
      !Number.isFinite(maxTextLength) ||
      maxTextLength < 256
    ) {
      return 4096;
    }

    return Math.floor(maxTextLength);
  }

  private resolveLimit(value?: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }

    const topK = this.milvusConfig?.topK;
    return typeof topK === 'number' && Number.isFinite(topK) && topK > 0
      ? Math.floor(topK)
      : 6;
  }

  private resolveSearchEf(): number {
    const searchEf = this.milvusConfig?.searchEf;
    return typeof searchEf === 'number' &&
      Number.isFinite(searchEf) &&
      searchEf > 0
      ? Math.floor(searchEf)
      : 64;
  }

  private resolveMinScore(): number | undefined {
    const minScore = this.milvusConfig?.minScore;

    if (typeof minScore !== 'number' || !Number.isFinite(minScore)) {
      return undefined;
    }

    return minScore;
  }

  private resolveOptionalScore(
    value: number | undefined,
    fallback?: number
  ): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private resolveTimeoutMs(): number {
    const timeoutMs = this.milvusConfig?.timeoutMs;
    return typeof timeoutMs === 'number' &&
      Number.isFinite(timeoutMs) &&
      timeoutMs > 0
      ? Math.floor(timeoutMs)
      : 10000;
  }

  private escapeFilterValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
