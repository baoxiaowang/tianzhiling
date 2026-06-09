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
      'conversation_message_memory'
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
