import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { MessageRole } from '@tzl/entities';
import { RetrieveService } from '../rag/retrieve.service';
import { buildMemoryRetrievalQuery } from './memory-retrieval-keys';
import type {
  MemoryCapabilities,
  MemoryEvidence,
  MemoryIngestResult,
  MemoryMaintenanceResult,
  MemoryModule,
  MemoryOpenItemsResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryUpdateOpenItemResult,
} from './memory-module.types';

export const LEGACY_MEMORY_ENGINE = 'legacy_v1' as const;

/**
 * 现有向量检索的适配器：把"用户说过的原话"按检索键捞回来。
 * 写入由现有记忆管线负责，这里不做任何事；没有事件组合与清单（能力声明里如实标注）。
 */
@Provide()
export class MemoryLegacyEngine implements MemoryModule {
  @Logger()
  logger: ILogger;

  @Inject()
  retrieveService: RetrieveService;

  capabilities(): MemoryCapabilities {
    return {
      engine: LEGACY_MEMORY_ENGINE,
      supports: {
        events: false,
        openItems: false,
        timeIntervals: false,
        shadowRecord: true,
        rebuild: false,
        audit: true,
      },
      limits: {
        maxEvidencePerRecall: 10,
        maxGroupMembers: 0,
        recallBudgetMs: 2500,
      },
    };
  }

  async ingest(): Promise<MemoryIngestResult> {
    // 旧引擎的原话索引由现有记忆管线维护，这里不重复写入。
    return { status: 'skipped', reason: 'legacy_pipeline_owns_indexing' };
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    const startedAt = Date.now();
    const query = buildMemoryRetrievalQuery(request.currentUserText || '');
    if (!query || !this.retrieveService?.retrieveConversationMemoriesDetailed) {
      return {
        evidence: [],
        status: 'skipped',
        diagnostics: {
          engine: LEGACY_MEMORY_ENGINE,
          mode: 'active',
          candidateCount: 0,
          selectedCount: 0,
          skipReason: query ? 'retrieval_unavailable' : 'no_retrieval_key',
          elapsedMs: Date.now() - startedAt,
        },
      };
    }

    const retrieved =
      await this.retrieveService.retrieveConversationMemoriesDetailed({
        query,
        userId: request.userId,
        conversationId: request.conversationId,
        agentId: request.agentId,
        excludeMessageIds: request.currentTurnMessageIds || [],
        limit: request.limit,
      });

    const evidence: MemoryEvidence[] = (retrieved.items || [])
      .filter(
        item => item.role === MessageRole.user && (item.content || '').trim()
      )
      .map(item => ({
        id: item.id || item.sourceMessageId || item.content.slice(0, 24),
        kind: 'utterance' as const,
        text: (item.content || '').trim(),
        role: 'user' as const,
        ...(item.createdAt ? { occurredAt: item.createdAt } : {}),
        sourceMessageIds: item.sourceMessageId ? [item.sourceMessageId] : [],
        ...(item.personId ? { personRef: item.personId } : {}),
        ...(typeof item.score === 'number' ? { score: item.score } : {}),
        assertPolicy: 'quote' as const,
        engine: LEGACY_MEMORY_ENGINE,
      }));

    return {
      evidence,
      status: evidence.length ? 'ok' : 'empty',
      diagnostics: {
        engine: LEGACY_MEMORY_ENGINE,
        mode: 'active',
        candidateCount: retrieved.diagnostics?.candidateCount || 0,
        selectedCount: evidence.length,
        elapsedMs: Date.now() - startedAt,
      },
    };
  }

  async listOpenItems(): Promise<MemoryOpenItemsResult> {
    return {
      items: [],
      status: 'empty',
      diagnostics: { engine: LEGACY_MEMORY_ENGINE, total: 0 },
    };
  }

  async updateOpenItem(): Promise<MemoryUpdateOpenItemResult> {
    return { status: 'not_found' };
  }

  async maintain(): Promise<MemoryMaintenanceResult> {
    return { status: 'failed', detail: { reason: 'legacy_engine_read_only' } };
  }
}
