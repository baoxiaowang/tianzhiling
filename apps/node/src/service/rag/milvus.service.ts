import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
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
  timeoutMs?: number;
}

export interface IndexConversationMessageOptions {
  messageId: string;
  userId: string;
  conversationId: string;
  agentId?: string;
  role: MessageRole;
  type: MessageType;
  searchableText: string;
  createdAt: Date;
}

export interface SearchConversationMemoriesOptions {
  query: string;
  queryEmbedding?: number[];
  userId: string;
  agentId?: string;
  excludeMessageIds?: string[];
  createdBeforeTs?: number;
  limit?: number;
}

export interface RetrievedConversationMemory {
  id: string;
  conversationId: string;
  userId: string;
  agentId?: string;
  role: MessageRole;
  type: MessageType;
  searchableText: string;
  createdAtTs: number;
  score: number;
}

const DENSE_VECTOR_FIELD_NAME = 'vector';
const SPARSE_VECTOR_FIELD_NAME = 'sparseVector';
const TEXT_FIELD_NAME = 'searchableText';
const BM25_FUNCTION_NAME = 'searchableTextBm25';

@Provide()
export class MilvusService {
  @Logger()
  logger: ILogger;

  @Config('milvus')
  milvusConfig: MilvusServiceConfig;

  @Config('openai')
  openAIConfig: {
    embeddingDimensions?: number;
  };

  @Inject()
  openAIService: OpenAIService;

  private client: MilvusClient | null = null;
  private ensureCollectionPromise: Promise<void> | null = null;
  private collectionLoaded = false;
  private collectionVectorDim?: number;

  isEnabled(): boolean {
    return (
      this.milvusConfig?.enabled !== false &&
      Boolean(this.milvusConfig?.address?.trim())
    );
  }

  async indexConversationMessage(
    options: IndexConversationMessageOptions
  ): Promise<void> {
    if (!this.isEnabled() || !this.openAIService.hasEmbeddingConfig()) {
      return;
    }

    const searchableText = this.normalizeSearchableText(options.searchableText);

    if (!searchableText) {
      return;
    }

    const vector = await this.openAIService.createEmbedding({
      input: searchableText,
      dimensions: this.openAIConfig?.embeddingDimensions,
    });

    await this.ensureCollection(vector.length);
    await this.getClient().upsert({
      collection_name: this.getCollectionName(),
      data: [
        {
          id: options.messageId,
          userId: options.userId,
          conversationId: options.conversationId,
          agentId: options.agentId?.trim() || '',
          role: options.role,
          type: options.type,
          [TEXT_FIELD_NAME]: this.truncateText(searchableText),
          createdAtTs: this.normalizeCreatedAtTs(options.createdAt),
          [DENSE_VECTOR_FIELD_NAME]: vector,
        },
      ],
    });
  }

  async searchConversationMemories(
    options: SearchConversationMemoriesOptions
  ): Promise<RetrievedConversationMemory[]> {
    if (!this.isEnabled() || !this.openAIService.hasEmbeddingConfig()) {
      return [];
    }

    const query = this.normalizeSearchableText(options.query);

    if (!query) {
      return [];
    }

    const client = this.getClient();
    const hasCollection = await client.hasCollection({
      collection_name: this.getCollectionName(),
    });

    if (!hasCollection?.value) {
      return [];
    }

    await this.ensureCollection(this.collectionVectorDim);

    const vector = this.resolveQueryEmbedding(options.queryEmbedding);

    if (!vector?.length) {
      return [];
    }

    const results = await client.hybridSearch({
      collection_name: this.getCollectionName(),
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
        'userId',
        'conversationId',
        'agentId',
        'role',
        'type',
        TEXT_FIELD_NAME,
        'createdAtTs',
      ],
      rerank: RRFRanker(60),
    });

    const minScore = this.resolveMinScore();

    return (results.results || [])
      .map(item => this.buildRetrievedConversationMemory(item))
      .filter(
        item =>
          Boolean(item.id) &&
          item.searchableText &&
          (typeof minScore !== 'number' || item.score >= minScore)
      );
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
    });

    if (!hasCollection?.value) {
      if (typeof vectorDim !== 'number' || vectorDim <= 0) {
        return;
      }

      await client.createCollection({
        collection_name: collectionName,
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
            name: TEXT_FIELD_NAME,
            data_type: DataType.VarChar,
            max_length: this.resolveMaxTextLength(),
            enable_analyzer: true,
            enable_match: true,
          },
          {
            name: 'createdAtTs',
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
    });

    this.collectionLoaded = true;
  }

  private buildSearchFilter(
    options: SearchConversationMemoriesOptions
  ): string {
    const filters = [`userId == "${this.escapeFilterValue(options.userId)}"`];

    if (options.agentId?.trim()) {
      filters.push(`agentId == "${this.escapeFilterValue(options.agentId)}"`);
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

      filters.push(`id != "${this.escapeFilterValue(normalized)}"`);
    }

    return filters.join(' and ');
  }

  private buildRetrievedConversationMemory(result: {
    id?: unknown;
    conversationId?: unknown;
    userId?: unknown;
    agentId?: unknown;
    role?: unknown;
    type?: unknown;
    searchableText?: unknown;
    createdAtTs?: unknown;
    score?: unknown;
  }): RetrievedConversationMemory {
    return {
      id: this.normalizeString(result.id),
      conversationId: this.normalizeString(result.conversationId),
      userId: this.normalizeString(result.userId),
      agentId: this.normalizeString(result.agentId) || undefined,
      role: this.normalizeMessageRole(result.role),
      type: this.normalizeMessageType(result.type),
      searchableText: this.normalizeString(result[TEXT_FIELD_NAME]),
      createdAtTs: this.normalizeNumber(result.createdAtTs),
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
      'userId',
      'conversationId',
      'agentId',
      'role',
      'type',
      TEXT_FIELD_NAME,
      'createdAtTs',
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
      this.milvusConfig?.collectionName?.trim() || 'conversation_message_memory'
    );
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
