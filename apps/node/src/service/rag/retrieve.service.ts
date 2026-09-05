import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MessageEntity, MessageRole, MongoObjectId } from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import type { RetrievedContextSnippet } from '../agents/agent.context';
import { OpenAIService } from '../agents/openai';
import { MilvusService, RetrievedConversationMemory } from './milvus.service';

export interface RetrieveConversationMemoriesOptions {
  query: string;
  userId: string;
  conversationId?: string;
  agentId?: string;
  excludeMessageIds?: string[];
  createdBeforeTs?: number;
  limit?: number;
}

const DEFAULT_CANDIDATE_LIMIT = 20;
const DEFAULT_RESULT_LIMIT = 5;

@Provide()
export class RetrieveService {
  @Logger()
  logger: ILogger;

  @Inject()
  milvusService: MilvusService;

  @Inject()
  openAIService: OpenAIService;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async retrieveConversationMemories(
    options: RetrieveConversationMemoriesOptions
  ): Promise<RetrievedContextSnippet[]> {
    const query = options.query?.trim();

    if (!query) {
      return [];
    }

    const retrievalEnabled =
      typeof this.milvusService?.isRetrievalEnabled === 'function'
        ? this.milvusService.isRetrievalEnabled()
        : typeof this.milvusService?.isEnabled === 'function'
        ? this.milvusService.isEnabled()
        : true;
    if (!retrievalEnabled) {
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
        limit: Math.max(DEFAULT_CANDIDATE_LIMIT, options.limit || 0),
      });

      const activeUserMemories = await this.filterArchivedMemories(
        memories.filter(memory => memory.role === MessageRole.user)
      );

      const relevantMemories = this.selectRelevantMemories(
        activeUserMemories,
        options.limit || DEFAULT_RESULT_LIMIT
      );

      if (this.milvusService.getRetrievalMode?.() === 'shadow') {
        this.logger.info?.(
          '[retrieve] shadow result, conversationId=%s, userId=%s, candidates=%s, selected=%s',
          options.conversationId || '',
          options.userId,
          activeUserMemories.length,
          relevantMemories.length
        );
        return [];
      }

      return relevantMemories.map(memory => ({
        id: memory.id,
        content: memory.searchableText,
        role: memory.role,
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

  private selectRelevantMemories(
    memories: RetrievedConversationMemory[],
    limit: number
  ): RetrievedConversationMemory[] {
    const selected: RetrievedConversationMemory[] = [];
    const seenMessages = new Set<string>();
    const seenTexts = new Set<string>();

    for (const memory of memories) {
      const normalizedText = memory.searchableText
        .replace(/\s+/g, '')
        .toLowerCase();
      if (
        !normalizedText ||
        seenMessages.has(memory.id) ||
        seenTexts.has(normalizedText)
      ) {
        continue;
      }
      seenMessages.add(memory.id);
      seenTexts.add(normalizedText);
      selected.push(memory);
      if (selected.length >= Math.max(1, Math.min(limit, 8))) break;
    }

    return selected;
  }


  private async filterArchivedMemories(
    memories: RetrievedConversationMemory[]
  ): Promise<RetrievedConversationMemory[]> {
    if (!memories.length) {
      return [];
    }

    const ids = memories
      .map(memory => memory.id?.trim())
      .filter((id): id is string => Boolean(id && MongoObjectId.isValid(id)));

    if (!ids.length) {
      return [];
    }

    const objectIds = ids.map(id => new MongoObjectId(id));
    const messages = await this.messageModel.find({
      where: {
        id: { $in: objectIds },
        isArchived: { $ne: true },
      } as never,
    });
    const activeIds = new Set(
      messages.map(message => this.stringifyObjectId(message.id))
    );

    return memories.filter(memory => activeIds.has(memory.id));
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

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }
}
