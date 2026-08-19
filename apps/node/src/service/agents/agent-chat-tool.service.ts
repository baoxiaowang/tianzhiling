import { Inject, Provide } from '@midwayjs/core';
import {
  AgentEntity,
  AgentProfileFactConfidence,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { RetrieveService } from '../rag/retrieve.service';
import {
  AgentProfileFactService,
  AgentProfileFactSummary,
} from './agent-profile-fact.service';
import {
  AGENT_CHAT_TOOL_VERSION,
  AgentChatToolEvidenceItem,
  AgentChatToolName,
  AgentChatToolResult,
  normalizeAgentChatToolArguments,
} from './agent-chat-tools';

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
    const memoryResultsPromise = Promise.all(
      requests.map(request => {
        if (
          !request.sources.includes('relationship_memory') &&
          !request.sources.includes('confirmed_history')
        ) {
          return Promise.resolve([]);
        }

        return this.retrieveService.retrieveConversationMemories({
          query: [request.subjectRef, request.need].filter(Boolean).join(' '),
          userId: this.stringifyObjectId(context.userId),
          agentId: this.stringifyObjectId(context.agentId),
          conversationId: this.stringifyObjectId(context.conversationId),
          excludeMessageIds: [
            this.stringifyObjectId(context.currentMessage.id),
          ],
          createdBeforeTs: context.currentMessage.createdAt?.getTime?.(),
          limit: 4,
        });
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
        const memories = memoryResults[requestIndex] || [];
        items.push(
          ...memories.slice(0, 4).map(
            (memory, index): AgentChatToolEvidenceItem => ({
              id:
                memory.id?.trim() ||
                `relationship_memory_${requestIndex + 1}_${index + 1}`,
              source: 'conversation_memory',
              sourceAt: memory.createdAt || '',
              confidence: this.normalizeScore(memory.score, 0.65),
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
    return this.result(
      'lookup_chat_evidence',
      uniqueItems.length ? 'ok' : 'empty',
      uniqueItems,
      undefined,
      uniqueItems.length > 8
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
    truncated = false
  ): AgentChatToolResult {
    return {
      version: AGENT_CHAT_TOOL_VERSION,
      tool,
      status,
      items: items.filter(item => Boolean(item.value)).slice(0, 8),
      truncated,
      ...(errorCode ? { errorCode } : {}),
    };
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
