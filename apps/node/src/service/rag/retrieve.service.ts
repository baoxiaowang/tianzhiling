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
  personId?: string;
  excludeMessageIds?: string[];
  createdBeforeTs?: number;
  limit?: number;
}

export interface RetrieveConversationMemoriesResult {
  items: RetrievedContextSnippet[];
  diagnostics: {
    policyVersion: 'person_first_v1';
    candidateCount: number;
    selectedCount: number;
    personScopedCount: number;
    rawFallbackCount: number;
    retrievalFailureCount: number;
    errorCode?: string;
    maxScore?: number;
    minScore?: number;
    scoreGap?: number;
  };
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
    return (await this.retrieveConversationMemoriesDetailed(options)).items;
  }

  async retrieveConversationMemoriesDetailed(
    options: RetrieveConversationMemoriesOptions
  ): Promise<RetrieveConversationMemoriesResult> {
    const query = options.query?.trim();
    const empty = this.emptyResult();

    if (!query) {
      return empty;
    }

    const retrievalEnabled =
      typeof this.milvusService?.isRetrievalEnabled === 'function'
        ? this.milvusService.isRetrievalEnabled()
        : typeof this.milvusService?.isEnabled === 'function'
        ? this.milvusService.isEnabled()
        : true;
    if (!retrievalEnabled) {
      return empty;
    }

    try {
      const queryEmbedding = await this.createQueryEmbedding(query);
      const common = {
        query,
        queryEmbedding,
        userId: options.userId,
        agentId: options.agentId?.trim() || undefined,
        excludeMessageIds: options.excludeMessageIds,
        createdBeforeTs: options.createdBeforeTs,
        limit: Math.max(DEFAULT_CANDIDATE_LIMIT, options.limit || 0),
      };
      const relevancePolicy = this.milvusService.getRelevancePolicy?.() || {};
      const personCandidates = options.personId
        ? await this.milvusService.searchConversationMemories({
            ...common,
            personId: options.personId,
            personScope: 'exact',
          })
        : [];
      const activePersonMemories = this.filterByScore(
        await this.filterArchivedMemories(
          personCandidates.filter(memory => memory.role === MessageRole.user)
        ),
        relevancePolicy.personMinScore
      );
      const resultLimit = options.limit || DEFAULT_RESULT_LIMIT;
      const personSelected = this.selectRelevantMemories(
        activePersonMemories,
        resultLimit
      );
      const rawCandidates =
        personSelected.length >= resultLimit
          ? []
          : await this.milvusService.searchConversationMemories({
              ...common,
              personScope: 'unscoped',
              memoryKinds: ['raw_episode'],
            });
      const activeRawMemories = this.filterByScore(
        await this.filterArchivedMemories(
          rawCandidates.filter(memory => memory.role === MessageRole.user)
        ),
        relevancePolicy.rawMinScore
      );
      const activeUserMemories = [
        ...activePersonMemories,
        ...activeRawMemories,
      ];

      const relevantMemories = this.selectRelevantMemories(
        [...personSelected, ...activeRawMemories],
        resultLimit
      );
      const diagnostics = this.buildDiagnostics(
        activeUserMemories,
        relevantMemories
      );

      if (this.milvusService.getRetrievalMode?.() === 'shadow') {
        this.logger.info?.(
          '[retrieve] shadow result, conversationId=%s, userId=%s, candidates=%s, selected=%s',
          options.conversationId || '',
          options.userId,
          activeUserMemories.length,
          relevantMemories.length
        );
        return { ...empty, diagnostics };
      }

      return {
        items: relevantMemories.map((memory, index) => ({
          id: memory.id,
          sourceMessageId: memory.sourceMessageId,
          content: memory.searchableText,
          role: memory.role,
          createdAt: this.formatMemoryDate(memory.createdAtTs),
          score: memory.score,
          personId: memory.personId,
          memoryKind: memory.memoryKind,
          rank: index + 1,
        })),
        diagnostics,
      };
    } catch (error) {
      this.logger.warn(
        '[retrieve] memory retrieval failed, conversationId=%s, userId=%s, reason=%s',
        options.conversationId || '',
        options.userId,
        this.describeError(error)
      );
      return this.emptyResult('retrieval_failed');
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
        seenMessages.has(memory.sourceMessageId || memory.id) ||
        seenTexts.has(normalizedText)
      ) {
        continue;
      }
      seenMessages.add(memory.sourceMessageId || memory.id);
      seenTexts.add(normalizedText);
      selected.push(memory);
      if (selected.length >= Math.max(1, Math.min(limit, 8))) break;
    }

    return selected;
  }

  private filterByScore(
    memories: RetrievedConversationMemory[],
    minScore?: number
  ): RetrievedConversationMemory[] {
    if (typeof minScore !== 'number' || !Number.isFinite(minScore)) {
      return memories;
    }
    return memories.filter(memory => memory.score >= minScore);
  }

  private async filterArchivedMemories(
    memories: RetrievedConversationMemory[]
  ): Promise<RetrievedConversationMemory[]> {
    if (!memories.length) {
      return [];
    }

    const ids = memories
      .map(memory => (memory.sourceMessageId || memory.id)?.trim())
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

    return memories.filter(memory =>
      activeIds.has(memory.sourceMessageId || memory.id)
    );
  }

  private buildDiagnostics(
    candidates: RetrievedConversationMemory[],
    selected: RetrievedConversationMemory[]
  ): RetrieveConversationMemoriesResult['diagnostics'] {
    const scores = selected
      .map(item => item.score)
      .filter(Number.isFinite)
      .sort((left, right) => right - left);
    return {
      policyVersion: 'person_first_v1',
      candidateCount: candidates.length,
      selectedCount: selected.length,
      personScopedCount: selected.filter(item => Boolean(item.personId)).length,
      rawFallbackCount: selected.filter(item => !item.personId).length,
      retrievalFailureCount: 0,
      ...(scores.length
        ? {
            maxScore: Math.max(...scores),
            minScore: Math.min(...scores),
          }
        : {}),
      ...(scores.length > 1 ? { scoreGap: scores[0] - scores[1] } : {}),
    };
  }

  private emptyResult(errorCode?: string): RetrieveConversationMemoriesResult {
    return {
      items: [],
      diagnostics: {
        policyVersion: 'person_first_v1',
        candidateCount: 0,
        selectedCount: 0,
        personScopedCount: 0,
        rawFallbackCount: 0,
        retrievalFailureCount: errorCode ? 1 : 0,
        ...(errorCode ? { errorCode } : {}),
      },
    };
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
