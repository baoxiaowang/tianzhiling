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
import { buildAgentPersonaPrompt } from './agent-persona';
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
      if (name === 'search_relationship_memory') {
        return this.searchRelationshipMemory(args, context);
      }
      if (name === 'get_family_facts') {
        return this.getFamilyFacts(args, context);
      }
      if (name === 'get_persona_evidence') {
        return this.getPersonaEvidence(args, context);
      }
      return this.recordUserCorrection(args, context);
    } catch {
      return this.result(name, 'error', [], 'tool_execution_failed');
    }
  }

  private async searchRelationshipMemory(
    args: Record<string, unknown>,
    context: AgentChatToolExecutionContext
  ): Promise<AgentChatToolResult> {
    const concepts = args.missingConcepts as string[];
    const subjectRef = String(args.subjectRef || '').trim();
    const limit = Number(args.limit);
    const memories = await this.retrieveService.retrieveConversationMemories({
      query: [...concepts, subjectRef].filter(Boolean).join(' '),
      userId: this.stringifyObjectId(context.userId),
      agentId: this.stringifyObjectId(context.agentId),
      conversationId: this.stringifyObjectId(context.conversationId),
      excludeMessageIds: [this.stringifyObjectId(context.currentMessage.id)],
      createdBeforeTs: context.currentMessage.createdAt?.getTime?.(),
      limit,
    });
    const items = memories.slice(0, limit).map(
      (memory, index): AgentChatToolEvidenceItem => ({
        id: memory.id?.trim() || `relationship_memory_${index + 1}`,
        source: 'conversation_memory',
        sourceAt: memory.createdAt || '',
        confidence: this.normalizeScore(memory.score, 0.65),
        conflictStatus: 'unknown',
        ...(subjectRef ? { subjectRef } : {}),
        value: this.clean(memory.content, 260),
      })
    );

    return this.result(
      'search_relationship_memory',
      items.length ? 'ok' : 'empty',
      items,
      undefined,
      memories.length > items.length
    );
  }

  private async getFamilyFacts(
    args: Record<string, unknown>,
    context: AgentChatToolExecutionContext
  ): Promise<AgentChatToolResult> {
    const subjectRefs = args.subjectRefs as string[];
    const limit = Number(args.limit);
    const facts = await this.agentProfileFactService.listFactsForPrompt({
      userId: context.userId,
      agentId: context.agentId,
      limit: Math.max(limit * 2, 8),
    });
    const matching = facts
      .filter(
        fact =>
          fact.status === AgentProfileFactStatus.active &&
          [
            AgentProfileFactType.family,
            AgentProfileFactType.relationship,
          ].includes(fact.type)
      )
      .filter(fact => this.matchesAnySubject(fact, subjectRefs));
    const selected = matching.slice(0, limit);
    const items = selected.map(fact => this.profileFactToEvidence(fact));

    return this.result(
      'get_family_facts',
      items.length ? 'ok' : 'empty',
      items,
      undefined,
      matching.length > limit
    );
  }

  private async getPersonaEvidence(
    args: Record<string, unknown>,
    context: AgentChatToolExecutionContext
  ): Promise<AgentChatToolResult> {
    const limit = Number(args.limit);
    const dimensions = args.dimensions as string[];
    const facts = await this.agentProfileFactService.listFactsForPrompt({
      userId: context.userId,
      agentId: context.agentId,
      limit: Math.max(limit * 3, 12),
    });
    const personaFacts = facts
      .filter(fact =>
        [
          AgentProfileFactType.style,
          AgentProfileFactType.preference,
          AgentProfileFactType.identity,
        ].includes(fact.type)
      )
      .filter(fact => this.matchesPersonaDimensions(fact, dimensions))
      .slice(0, limit)
      .map(fact => this.profileFactToEvidence(fact));
    const compiledPersona = buildAgentPersonaPrompt({
      agent: context.agent,
      recentMessages: [],
    });

    if (
      compiledPersona.source !== 'relationship_defaults' &&
      personaFacts.length < limit
    ) {
      personaFacts.unshift({
        id: 'agent_persona_profile',
        source: `agent.${compiledPersona.source}`,
        sourceAt: context.agent?.updatedAt?.toISOString?.() || '',
        confidence:
          compiledPersona.source === 'chat_derived_profile' ? 0.9 : 0.78,
        conflictStatus: 'none',
        subjectRef: 'agent',
        factKey: 'persona.compiled',
        value: this.clean(compiledPersona.classifierContext, 320),
      });
    }

    const items = personaFacts.slice(0, limit);
    return this.result(
      'get_persona_evidence',
      items.length ? 'ok' : 'empty',
      items,
      undefined,
      personaFacts.length > limit
    );
  }

  private async recordUserCorrection(
    args: Record<string, unknown>,
    context: AgentChatToolExecutionContext
  ): Promise<AgentChatToolResult> {
    const currentQuery = this.normalizeComparable(context.currentQuery);
    const rejectedFact = String(args.rejectedFact || '').trim();
    const replacementFact = String(args.replacementFact || '').trim();
    const previousAssistant = this.normalizeComparable(
      context.previousAssistantContent || ''
    );

    if (
      !/(?:不对|不是|没有|没这回事|记错|说错|胡说|瞎编|乱编|别编)/.test(
        currentQuery
      )
    ) {
      return this.result(
        'record_user_correction',
        'denied',
        [],
        'no_explicit_user_correction'
      );
    }

    const normalizedRejected = this.normalizeComparable(rejectedFact);
    if (
      !normalizedRejected ||
      (!currentQuery.includes(normalizedRejected) &&
        !previousAssistant.includes(normalizedRejected))
    ) {
      return this.result(
        'record_user_correction',
        'denied',
        [],
        'rejected_fact_not_grounded'
      );
    }

    const normalizedReplacement = this.normalizeComparable(replacementFact);
    if (
      normalizedReplacement &&
      !currentQuery.includes(normalizedReplacement)
    ) {
      return this.result(
        'record_user_correction',
        'denied',
        [],
        'replacement_not_in_user_message'
      );
    }

    const fact = await this.agentProfileFactService.recordUserCorrection({
      message: context.currentMessage,
      subjectRef: String(args.subjectRef),
      correctionKind: args.correctionKind as
        | 'fact'
        | 'relationship'
        | 'memory'
        | 'persona',
      rejectedFact,
      replacementFact,
    });
    return this.result('record_user_correction', 'ok', [
      this.profileFactToEvidence(fact),
    ]);
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

  private matchesPersonaDimensions(
    fact: AgentProfileFactSummary,
    dimensions: string[]
  ): boolean {
    if (!dimensions.length) {
      return true;
    }

    const value = `${fact.key} ${fact.value}`;
    const patterns: Record<string, RegExp> = {
      tone: /语气|情感|温和|直接|严厉|关心/,
      wording: /语言|称呼|用词|口头禅|节奏/,
      temperament: /性格|脾气|冲突|幽默|棱角/,
      values: /价值|重视|原则|在意/,
      habits: /习惯|爱好|经常|平时/,
    };
    return dimensions.some(dimension => patterns[dimension]?.test(value));
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
