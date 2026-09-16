import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

export interface AdminMilvusServiceConfig {
  enabled?: boolean;
  address?: string;
  token?: string;
  username?: string;
  password?: string;
  database?: string;
  collectionName?: string;
  timeoutMs?: number;
}

/** 后台只读展示“已入索引的原话”，只取标量字段，绝不返回向量。 */
export interface AdminIndexedEvidenceRow {
  id: string;
  sourceMessageId: string;
  conversationId: string;
  agentId: string;
  role: string;
  memoryKind: string;
  text: string;
  createdAt: string;
}

export type AdminIndexedEvidenceUnavailableReason =
  | ''
  | 'disabled'
  | 'collection_missing'
  | 'query_failed';

export interface AdminIndexedEvidenceListResult {
  /** 索引查询是否真实成功执行。false 表示索引不可用，不能当作“没有可检索原话”。 */
  available: boolean;
  unavailableReason: AdminIndexedEvidenceUnavailableReason;
  /** 该用户+对象在索引中的匹配总条数（全量口径，含来源后续失效的行）。 */
  total: number;
  /** 本页从索引取到的行数（校验来源前的口径）。 */
  pageIndexRows: number;
  items: AdminIndexedEvidenceRow[];
}

export interface ListAdminIndexedEvidenceOptions {
  userId: string;
  agentId?: string;
  limit?: number;
  offset?: number;
}

@Provide()
export class AdminMilvusService {
  @Logger()
  logger: ILogger;

  @Config('milvus')
  milvusConfig: AdminMilvusServiceConfig;

  private client: MilvusClient | null = null;

  isEnabled(): boolean {
    return (
      this.milvusConfig?.enabled !== false &&
      Boolean(this.milvusConfig?.address?.trim())
    );
  }

  async deleteConversationMessage(messageId: string): Promise<void> {
    const normalizedMessageId = messageId?.trim();

    if (!normalizedMessageId || !this.isEnabled()) {
      return;
    }

    const client = this.getClient();
    const collectionName = this.getCollectionName();
    const hasCollection = await client.hasCollection({
      collection_name: collectionName,
    });

    if (!hasCollection?.value) {
      return;
    }

    await client.delete({
      collection_name: collectionName,
      ids: [normalizedMessageId],
    });
  }

  /**
   * 只读分页读取“已入索引的原话证据”（memoryKind=raw_episode、status=active）。
   * 只返回标量字段（正文、来源、角色、时间），不返回向量数值。
   * 注意：这里只代表“已进入检索索引”，不代表模型在某轮对话里实际使用过。
   */
  async listConversationMessageMemories(
    options: ListAdminIndexedEvidenceOptions
  ): Promise<AdminIndexedEvidenceListResult> {
    const unavailable = (
      reason: AdminIndexedEvidenceUnavailableReason
    ): AdminIndexedEvidenceListResult => ({
      available: false,
      unavailableReason: reason,
      total: 0,
      pageIndexRows: 0,
      items: [],
    });

    if (!this.isEnabled()) {
      return unavailable('disabled');
    }
    if (!options?.userId?.trim()) {
      return unavailable('query_failed');
    }

    const client = this.getClient();
    const collectionName = this.getCollectionName();

    try {
      const hasCollection = await client.hasCollection({
        collection_name: collectionName,
      });

      if (!hasCollection?.value) {
        return unavailable('collection_missing');
      }

      const limit = Math.min(
        Math.max(Math.floor(options.limit ?? 20) || 20, 1),
        100
      );
      const offset = Math.max(Math.floor(options.offset ?? 0) || 0, 0);
      const filter = this.buildRawEvidenceFilter(options);

      const [countResult, queryResult] = await Promise.all([
        client.query({
          collection_name: collectionName,
          filter,
          output_fields: ['count(*)'],
        }),
        client.query({
          collection_name: collectionName,
          filter,
          output_fields: [
            'id',
            'sourceMessageId',
            'conversationId',
            'agentId',
            'role',
            'memoryKind',
            'searchableText',
            'createdAtTs',
          ],
          limit,
          offset,
        }),
      ]);

      const rawCount = (
        countResult as { data?: Array<Record<string, unknown>> }
      )?.data?.[0];
      const total = Number(rawCount?.['count(*)'] ?? rawCount?.count ?? 0);
      const rows = (
        (queryResult as { data?: Array<Record<string, unknown>> })?.data || []
      ).map(row => ({
        id: this.stringValue(row.id),
        sourceMessageId: this.stringValue(row.sourceMessageId),
        conversationId: this.stringValue(row.conversationId),
        agentId: this.stringValue(row.agentId),
        role: this.stringValue(row.role),
        memoryKind: this.stringValue(row.memoryKind),
        text: this.stringValue(row.searchableText),
        createdAt: this.formatTs(row.createdAtTs),
      }));

      return {
        available: true,
        unavailableReason: '',
        total: Number.isFinite(total) ? total : 0,
        pageIndexRows: rows.length,
        items: rows,
      };
    } catch (error) {
      this.logger?.warn?.(
        '[admin-milvus] indexed evidence query failed, userId=%s agentId=%s reason=%s',
        options.userId,
        options.agentId || '-',
        error instanceof Error ? error.message : String(error)
      );
      return unavailable('query_failed');
    }
  }

  private buildRawEvidenceFilter(
    options: ListAdminIndexedEvidenceOptions
  ): string {
    const parts = [
      `userId == "${this.escapeFilterValue(options.userId)}"`,
      'status == "active"',
      'memoryKind == "raw_episode"',
    ];
    const agentId = options.agentId?.trim();
    if (agentId) {
      parts.push(`agentId == "${this.escapeFilterValue(agentId)}"`);
    }
    return parts.join(' && ');
  }

  private escapeFilterValue(value: string): string {
    return value.replace(/["\\]/g, '');
  }

  private stringValue(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  private formatTs(value: unknown): string {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) {
      return '';
    }
    return new Date(ts).toISOString();
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

  private getCollectionName(): string {
    return (
      this.milvusConfig?.collectionName?.trim() ||
      'conversation_message_memory_v2'
    );
  }

  private resolveTimeoutMs(): number {
    const timeoutMs = this.milvusConfig?.timeoutMs;
    return typeof timeoutMs === 'number' &&
      Number.isFinite(timeoutMs) &&
      timeoutMs > 0
      ? Math.floor(timeoutMs)
      : 10000;
  }
}
