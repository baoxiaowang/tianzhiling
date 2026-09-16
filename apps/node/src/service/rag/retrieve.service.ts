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

// 候选：与请求条数一致的上限（原实现内部硬封顶 8，和请求 10 条不一致）。
export const MAX_SELECTED_MEMORIES = 10;

/**
 * 候选：同一来源优先保留原话，但**不把所有 raw 排到最前**——按分数走，避免
 * 人物精确命中（其它来源）在限额前被挤掉；同来源则用 raw 替换抽取条。
 */
export function mergeMemoriesPreferRaw<
  T extends { id?: unknown; sourceMessageId?: unknown; score?: number }
>(personSelected: T[], activeRawMemories: T[]): T[] {
  const rawBySource = new Map<string, T>();
  for (const memory of activeRawMemories) {
    rawBySource.set(String(memory.sourceMessageId || memory.id), memory);
  }
  const combined = [...personSelected, ...activeRawMemories].sort(
    (a, b) => (b.score || 0) - (a.score || 0)
  );
  const out: T[] = [];
  const seen = new Set<string>();
  for (const memory of combined) {
    const key = String(memory.sourceMessageId || memory.id);
    if (seen.has(key)) continue;
    const raw = rawBySource.get(key);
    if (raw) {
      out.push(raw);
    } else {
      out.push(memory);
    }
    seen.add(key);
  }
  return out;
}

/** 候选：按来源与文本去重后取前 N 条；上限与请求一致（默认 10）。 */
export function selectRelevantMemoriesPure<
  T extends { id?: unknown; sourceMessageId?: unknown; searchableText: string }
>(memories: T[], limit: number, maxSelected: number = MAX_SELECTED_MEMORIES): T[] {
  const selected: T[] = [];
  const seenMessages = new Set<string>();
  const seenTexts = new Set<string>();
  for (const memory of memories) {
    const normalizedText = memory.searchableText.replace(/\s+/g, '').toLowerCase();
    if (
      !normalizedText ||
      seenMessages.has(String(memory.sourceMessageId || memory.id)) ||
      seenTexts.has(normalizedText)
    ) {
      continue;
    }
    seenMessages.add(String(memory.sourceMessageId || memory.id));
    seenTexts.add(normalizedText);
    selected.push(memory);
    if (selected.length >= Math.max(1, Math.min(limit, maxSelected))) break;
  }
  return selected;
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

const DEFAULT_CANDIDATE_LIMIT = 40;
// 记忆方案 v3：第二层（原文检索）的目标是"宁多勿漏"——记忆的职责是把用户说过的
// 原话递到模型面前，漏掉比多给几条严重得多。因此候选与最终条数都放宽。
const DEFAULT_RESULT_LIMIT = 10;

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
      // 原文是第二层的主要来源，不能因为"人物范围内已经凑够条数"就跳过——
      // 过去凑够就跳过，等于把用户原话挡在外面（抽取结论优先于原话）。
      const rawCandidates = await this.milvusService.searchConversationMemories(
        {
          ...common,
          personScope: 'unscoped',
          memoryKinds: ['raw_episode'],
        }
      );
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

      // 原话优先于抽取结论：同一个来源消息既有原话又有抽取条时，保留原话。
      // 候选：同来源保留原话，但不把所有 raw 提前；其他来源的人物精确命中按分数保留。
      const relevantMemories = this.selectRelevantMemories(
        mergeMemoriesPreferRaw(personSelected, activeRawMemories),
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
    return selectRelevantMemoriesPure(memories, limit);
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
    // 必须用 _id：本项目的 TypeORM MongoDB 版本不会把 where.id 映射成 _id，
    // 写成 id:{$in} 会静默返回空数组，导致所有候选被当成已归档而丢掉
    // （线上表现：检索"成功"但 0 条，工具 22 万轮只命中过 11 条）。
    const messages = await this.messageModel.find({
      where: {
        _id: { $in: objectIds },
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
