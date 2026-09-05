import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  AgentProfileFactConfidence,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MemoryPipelineTaskKind,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { RetrieveService } from '../rag/retrieve.service';
import { MemoryPipelineTaskService } from '../memory-pipeline-task.service';
import {
  AgentProfileFactService,
  AgentProfileFactSummary,
} from './agent-profile-fact.service';
import {
  AGENT_CHAT_TOOL_VERSION,
  AgentChatToolEvidenceItem,
  AgentChatToolName,
  AgentChatToolResult,
  AgentChatToolDiagnostics,
  normalizeAgentChatToolArguments,
} from './agent-chat-tools';
import { UserIdentityMemoryService } from './user-identity-memory.service';

export interface AgentChatToolExecutionContext {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  conversationId: MongoObjectId;
  currentMessage: MessageEntity;
  currentQuery: string;
  previousAssistantContent?: string;
  agent: AgentEntity | null;
}

@Provide()
export class AgentChatToolService {
  @Inject()
  retrieveService: RetrieveService;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  @Inject()
  userIdentityMemoryService: UserIdentityMemoryService;

  @Inject()
  memoryPipelineTaskService: MemoryPipelineTaskService;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async execute(
    name: AgentChatToolName,
    rawArguments: unknown,
    context: AgentChatToolExecutionContext
  ): Promise<AgentChatToolResult> {
    const args = normalizeAgentChatToolArguments(name, rawArguments);

    if (!args) {
      return this.result(name, 'invalid_arguments');
    }

    try {
      return await this.lookupChatEvidence(args, context);
    } catch {
      return this.result(name, 'error', [], 'tool_execution_failed');
    }
  }

  private async lookupChatEvidence(
    args: Record<string, unknown>,
    context: AgentChatToolExecutionContext
  ): Promise<AgentChatToolResult> {
    const requests = args.requests as Array<{
      subjectRef: string;
      need: string;
      sources: string[];
    }>;
    const needsProfile = requests.some(request =>
      request.sources.some(source =>
        ['agent_profile', 'family_facts', 'confirmed_history'].includes(source)
      )
    );
    const factsPromise = needsProfile
      ? this.agentProfileFactService.listFactsForPrompt({
          userId: context.userId,
          agentId: context.agentId,
          limit: 48,
        })
      : Promise.resolve([]);
    const personResolutions = await Promise.all(
      requests.map(async request => {
        if (!this.userIdentityMemoryService?.resolveKnownPersonMention) {
          return null;
        }
        return this.userIdentityMemoryService.resolveKnownPersonMention({
          userId: context.userId,
          mention: request.subjectRef,
        });
      })
    );
    const memoryResultsPromise = Promise.all(
      requests.map((request, requestIndex) => {
        if (
          !request.sources.includes('relationship_memory') &&
          !request.sources.includes('confirmed_history')
        ) {
          return Promise.resolve(null);
        }

        const retrievalOptions = {
          query: [request.subjectRef, request.need].filter(Boolean).join(' '),
          userId: this.stringifyObjectId(context.userId),
          agentId: this.stringifyObjectId(context.agentId),
          conversationId: this.stringifyObjectId(context.conversationId),
          excludeMessageIds: [
            this.stringifyObjectId(context.currentMessage.id),
          ],
          createdBeforeTs: context.currentMessage.createdAt?.getTime?.(),
          personId: personResolutions[requestIndex]?.id.toString(),
          limit: 4,
        };
        if (this.retrieveService.retrieveConversationMemoriesDetailed) {
          return this.retrieveService.retrieveConversationMemoriesDetailed(
            retrievalOptions
          );
        }
        return this.retrieveService
          .retrieveConversationMemories(retrievalOptions)
          .then(items => ({
            items,
            diagnostics: {
              policyVersion: 'person_first_v1' as const,
              candidateCount: items.length,
              selectedCount: items.length,
              personScopedCount: items.filter(item => Boolean(item.personId))
                .length,
              rawFallbackCount: items.filter(item => !item.personId).length,
              retrievalFailureCount: 0,
            },
          }));
      })
    );
    const [facts, memoryResults] = await Promise.all([
      factsPromise,
      memoryResultsPromise,
    ]);
    const items: AgentChatToolEvidenceItem[] = [];

    for (const [requestIndex, request] of requests.entries()) {
      const subjectRefs = request.subjectRef ? [request.subjectRef] : [];
      const wantsFamily = request.sources.includes('family_facts');
      const wantsProfile = request.sources.includes('agent_profile');
      const wantsConfirmed = request.sources.includes('confirmed_history');

      if (wantsFamily || wantsProfile || wantsConfirmed) {
        const selectedFacts = facts
          .filter(fact => fact.status === AgentProfileFactStatus.active)
          .filter(fact => this.matchesAnySubject(fact, subjectRefs))
          .filter(fact => {
            if (
              wantsFamily &&
              [
                AgentProfileFactType.family,
                AgentProfileFactType.relationship,
              ].includes(fact.type)
            ) {
              return true;
            }
            if (
              wantsProfile &&
              [
                AgentProfileFactType.identity,
                AgentProfileFactType.preference,
                AgentProfileFactType.style,
              ].includes(fact.type)
            ) {
              return true;
            }
            return (
              wantsConfirmed &&
              fact.confidence !== AgentProfileFactConfidence.extracted
            );
          })
          .slice(0, 4)
          .map(fact => ({
            ...this.profileFactToEvidence(fact),
            ...(request.subjectRef ? { subjectRef: request.subjectRef } : {}),
          }));
        items.push(...selectedFacts);
      }

      if (
        request.sources.includes('relationship_memory') ||
        request.sources.includes('confirmed_history')
      ) {
        const memories = memoryResults[requestIndex]?.items || [];
        items.push(
          ...memories.slice(0, 4).map(
            (memory, index): AgentChatToolEvidenceItem => ({
              id:
                memory.id?.trim() ||
                `relationship_memory_${requestIndex + 1}_${index + 1}`,
              source: 'conversation_memory',
              sourceAt: memory.createdAt || '',
              // RRF is retrieval relevance, not factual certainty. Raw user
              // utterances remain attributed evidence until separately confirmed.
              confidence: 0.65,
              relevanceScore: this.normalizeScore(memory.score, 0),
              sourceMessageId: memory.sourceMessageId,
              personId: memory.personId,
              memoryKind: memory.memoryKind,
              rank: memory.rank,
              conflictStatus: 'unknown',
              ...(request.subjectRef ? { subjectRef: request.subjectRef } : {}),
              value: this.clean(memory.content, 260),
            })
          )
        );
      }
    }

    const uniqueItems = Array.from(
      new Map(items.map(item => [item.id, item])).values()
    );
    const diagnostics = this.buildDiagnostics(
      requests.length,
      personResolutions,
      memoryResults
    );
    diagnostics.lazyBackfillQueued = await this.queueLazyBackfill(
      context,
      personResolutions,
      memoryResults
    );
    return this.result(
      'lookup_chat_evidence',
      uniqueItems.length ? 'ok' : 'empty',
      uniqueItems,
      undefined,
      uniqueItems.length > 8,
      diagnostics
    );
  }

  private matchesAnySubject(
    fact: AgentProfileFactSummary,
    subjectRefs: string[]
  ): boolean {
    if (!subjectRefs.length) {
      return true;
    }

    const comparable = this.normalizeComparable(`${fact.key} ${fact.value}`);
    return subjectRefs.some(subject =>
      comparable.includes(this.normalizeComparable(subject))
    );
  }

  private profileFactToEvidence(
    fact: AgentProfileFactSummary
  ): AgentChatToolEvidenceItem {
    return {
      id: fact.id || fact.sourceMessageId || fact.key,
      source: 'agent_profile_fact',
      sourceAt: fact.updatedAt?.toISOString?.() || '',
      confidence: this.mapProfileConfidence(fact.confidence),
      conflictStatus:
        fact.status === AgentProfileFactStatus.conflicted ||
        (fact.conflictingValues?.length || 0) > 0
          ? 'conflicted'
          : 'none',
      factKey: fact.key,
      value: this.clean(fact.value, 260),
    };
  }

  private mapProfileConfidence(value: AgentProfileFactConfidence): number {
    const values: Record<AgentProfileFactConfidence, number> = {
      [AgentProfileFactConfidence.extracted]: 0.68,
      [AgentProfileFactConfidence.confirmed]: 0.92,
      [AgentProfileFactConfidence.userCorrected]: 0.98,
      [AgentProfileFactConfidence.feedback]: 0.88,
    };
    return values[value] ?? 0.6;
  }

  private normalizeScore(value: number | undefined, fallback: number): number {
    return Number.isFinite(value)
      ? Math.max(0, Math.min(1, Number(value)))
      : fallback;
  }

  private result(
    tool: AgentChatToolName,
    status: AgentChatToolResult['status'],
    items: AgentChatToolEvidenceItem[] = [],
    errorCode?: string,
    truncated = false,
    diagnostics?: AgentChatToolDiagnostics
  ): AgentChatToolResult {
    return {
      version: AGENT_CHAT_TOOL_VERSION,
      tool,
      status,
      items: items.filter(item => Boolean(item.value)).slice(0, 8),
      truncated,
      ...(errorCode ? { errorCode } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    };
  }

  private buildDiagnostics(
    requestCount: number,
    resolutions: Array<{ id: MongoObjectId } | null>,
    results: Array<Awaited<
      ReturnType<RetrieveService['retrieveConversationMemoriesDetailed']>
    > | null>
  ): AgentChatToolDiagnostics {
    const values = results.filter(Boolean).map(result => result!.diagnostics);
    const maxScores = values
      .map(value => value.maxScore)
      .filter((value): value is number => Number.isFinite(value));
    const minScores = values
      .map(value => value.minScore)
      .filter((value): value is number => Number.isFinite(value));
    const scoreGaps = values
      .map(value => value.scoreGap)
      .filter((value): value is number => Number.isFinite(value));
    const resolved = resolutions.filter(Boolean).length;
    return {
      policyVersion: 'person_first_v1',
      requestCount,
      candidateCount: values.reduce(
        (sum, value) => sum + value.candidateCount,
        0
      ),
      selectedCount: values.reduce(
        (sum, value) => sum + value.selectedCount,
        0
      ),
      personResolvedCount: resolved,
      personUnresolvedCount: requestCount - resolved,
      wrongPersonCount: results.reduce((sum, result, index) => {
        const expected = resolutions[index]?.id.toString();
        if (!expected) return sum;
        return (
          sum +
          (result?.items || []).filter(
            item => Boolean(item.personId) && item.personId !== expected
          ).length
        );
      }, 0),
      personScopedCount: values.reduce(
        (sum, value) => sum + value.personScopedCount,
        0
      ),
      rawFallbackCount: values.reduce(
        (sum, value) => sum + value.rawFallbackCount,
        0
      ),
      retrievalFailureCount: values.reduce(
        (sum, value) => sum + value.retrievalFailureCount,
        0
      ),
      lazyBackfillQueued: 0,
      ...(maxScores.length ? { maxScore: Math.max(...maxScores) } : {}),
      ...(minScores.length ? { minScore: Math.min(...minScores) } : {}),
      ...(scoreGaps.length ? { scoreGap: Math.min(...scoreGaps) } : {}),
    };
  }

  private async queueLazyBackfill(
    context: AgentChatToolExecutionContext,
    resolutions: Array<{ id: MongoObjectId } | null>,
    results: Array<Awaited<
      ReturnType<RetrieveService['retrieveConversationMemoriesDetailed']>
    > | null>
  ): Promise<number> {
    if (!this.messageModel?.findOne || !this.memoryPipelineTaskService) {
      return 0;
    }
    const ids = new Set<string>();
    results.forEach((result, index) => {
      if (!resolutions[index]) return;
      for (const item of result?.items || []) {
        if (!item.personId && item.sourceMessageId)
          ids.add(item.sourceMessageId);
      }
    });
    let queued = 0;
    for (const id of ids) {
      if (!MongoObjectId.isValid(id)) continue;
      const message = await this.messageModel.findOne({
        where: {
          _id: new MongoObjectId(id),
          userId: context.userId,
        } as never,
      });
      if (!message?.content?.trim()) continue;
      await this.memoryPipelineTaskService.enqueueForMessage(
        message,
        message.content,
        [MemoryPipelineTaskKind.personSemanticIndex]
      );
      queued += 1;
    }
    return queued;
  }

  private clean(value: string, maxLength: number): string {
    return (value || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private normalizeComparable(value: string): string {
    return (value || '').toLowerCase().replace(/[^\u4e00-\u9fffa-z0-9]/g, '');
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value || '');
  }
}
