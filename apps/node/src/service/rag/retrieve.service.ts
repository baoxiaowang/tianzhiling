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

// RRF 分数区分度阈值：top1 跟第 3 名的差距低于此值视为噪声
const MIN_RRF_GAP = 0.0006;

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

    if (
      typeof this.milvusService?.isEnabled === 'function' &&
      !this.milvusService.isEnabled()
    ) {
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

      const activeUserMemories = await this.filterArchivedMemories(
        memories.filter(memory => memory.role === MessageRole.user)
      );

      const relevantMemories = this.filterByScoreGap(activeUserMemories);
      const freshMemories = this.applyMemoryTimeDecay(relevantMemories);

      return freshMemories.map(memory => ({
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

  // 时间衰减：超过 90 天的记忆不注入，30-90 天降权
  private applyMemoryTimeDecay(
    memories: RetrievedConversationMemory[]
  ): RetrievedConversationMemory[] {
    if (!memories.length) return [];

    const now = Date.now();
    const DAY_MS = 86400000;

    return memories.filter(m => {
      const ageDays = (now - (m.createdAtTs || 0)) / DAY_MS;
      return ageDays <= 90; // 超过 90 天直接丢弃
    });
  }

  // RRF 分数区分度门控：top1 跟第 3 名的差距太小说明没有真正命中
  private filterByScoreGap(
    memories: RetrievedConversationMemory[]
  ): RetrievedConversationMemory[] {
    if (memories.length < 3) {
      return memories.slice(0, 2);
    }

    const scores = memories.map(m => m.score || 0);
    const top1 = scores[0];
    const top3 = scores[2];

    // 区分度不足 → 噪声，不注入
    if (top1 - top3 < MIN_RRF_GAP) {
      return [];
    }

    // 有区分度：取明显高于中位数的
    const median = scores[Math.floor(scores.length / 2)];
    const relevant = memories.filter(
      m => (m.score || 0) - median >= MIN_RRF_GAP / 2
    );

    return relevant.slice(0, 2);
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
