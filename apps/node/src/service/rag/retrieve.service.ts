import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import type { RetrievedContextSnippet } from '../agents/agent.context';
import { OpenAIService } from '../agents/openai';
import { MilvusService } from './milvus.service';

export interface RetrieveConversationMemoriesOptions {
  query: string;
  userId: string;
  conversationId?: string;
  agentId?: string;
  excludeMessageIds?: string[];
  createdBeforeTs?: number;
  limit?: number;
}

@Provide()
export class RetrieveService {
  @Logger()
  logger: ILogger;

  @Inject()
  milvusService: MilvusService;

  @Inject()
  openAIService: OpenAIService;

  async retrieveConversationMemories(
    options: RetrieveConversationMemoriesOptions
  ): Promise<RetrievedContextSnippet[]> {
    const query = options.query?.trim();

    if (!query) {
      return [];
    }

    try {
      const queryEmbedding = await this.createQueryEmbedding(query);
      const memories = await this.milvusService.searchConversationMemories({
        query,
        queryEmbedding,
        userId: options.userId,
        agentId: options.agentId?.trim() || undefined,
        excludeMessageIds: options.excludeMessageIds,
        createdBeforeTs: options.createdBeforeTs,
        limit: options.limit,
      });

      return memories.map(memory => ({
        content: memory.searchableText,
        createdAt: this.formatMemoryDate(memory.createdAtTs),
        score: memory.score,
      }));
    } catch (error) {
      this.logger.warn(
        '[retrieve] memory retrieval failed, conversationId=%s, userId=%s, reason=%s',
        options.conversationId || '',
        options.userId,
        this.describeError(error)
      );
      return [];
    }
  }

  private async createQueryEmbedding(
    query: string
  ): Promise<number[] | undefined> {
    if (!this.openAIService.hasEmbeddingConfig()) {
      return undefined;
    }

    return this.openAIService.createEmbedding({
      input: query,
    });
  }

  private formatMemoryDate(value: number): string | undefined {
    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return new Date(value).toISOString().slice(0, 10);
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
