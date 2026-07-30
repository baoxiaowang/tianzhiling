import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageType,
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  AgentProfileFactAssertionPolicy,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../../interface';
import {
  containsUnsafeAssistantHistoryContent,
  stripPromptLeakageContent,
} from '../../common/message-content-safety';
import { buildDepartedSystemPrompt } from '../../prompt/departed';
import { RetrieveService } from '../rag/retrieve.service';
import {
  AgentMemoryFactService,
  AgentMemoryFactSummary,
} from './agent-memory-fact.service';
import {
  AgentProfileFactService,
  AgentProfileFactSummary,
} from './agent-profile-fact.service';
import {
  AgentRelationshipSignalService,
  AgentRelationshipSignalSummary,
} from './agent-relationship-signal.service';
import {
  AgentEmotionStateService,
  ConversationEmotionStateSummary,
} from './agent-emotion-state.service';
import {
  ReplyIntentClassifierService,
  ReplyIntentMemoryCandidate,
} from './reply-intent-classifier.service';
import type {
  ConversationMemoryPlan,
  ConversationReading,
  StructuredReplyIntent,
} from './reply-intent';
import {
  buildReplyBrief,
  ReplyBrief,
  ReplyBriefService,
} from './reply-brief.service';
import { buildReplyBubblePlanPrompt } from './reply-bubble-plan';
import { buildReplyLengthPlanPrompt } from './reply-length-plan';
import { ReplySceneRoute, routeReplyScene } from './reply-scene-router';
import { getSharedFamilyMemberNameFromFactKey } from './shared-family-member';
import {
  AgentEvidenceAssertionPolicy,
  AgentEvidenceItem,
} from './agent-evidence';
import {
  buildAgentChatModePrompt,
  resolveAgentChatModePolicy,
} from './agent-chat-mode';
import type { AgentMemoryControlResult } from './agent-memory-control';

export interface BuildConversationContextOptions {
  auth: AuthenticatedUserPayload;
  conversation: ConversationEntity;
  agent: AgentEntity | null;
  currentQuery?: string;
  classifyIntent?: boolean;
  memoryControlResult?: AgentMemoryControlResult;
}

export interface AgentContextLayer {
  key: 'persona' | 'history' | 'longTermHistory';
  messages: ChatCompletionMessageParam[];
}

export interface AgentConversationContext {
  layers: AgentContextLayer[];
  messages: ChatCompletionMessageParam[];
  evidence: AgentEvidenceItem[];
  diagnostics: AgentContextDiagnostics;
  replyIntent?: StructuredReplyIntent;
  replyRoute: ReplySceneRoute;
  replyBrief: ReplyBrief;
}

export interface AgentContextDiagnostics {
  promptVersion: 'agent_chat_v2';
  systemPromptCharacters: number;
  replyLengthClass: ReplyBrief['lengthPlan']['lengthClass'];
  replyTargetCharacters: number;
  replyReviewCharacters: number;
  historyMessageCount: number;
  relevantMemoryCount: number;
  relevantHardFactKeys: string[];
  conversationReadingAnchorCount: number;
  memoryPlan?: ConversationMemoryPlan;
  memoryCandidateCount: number;
  memoryCandidateKeys: string[];
  memoryModelSelectedCandidateKeys: string[];
  memorySelectedCandidateKeys: string[];
  memoryCoverageFallbackApplied: boolean;
  memoryRetrievalMode: MemoryRetrievalMode;
  memoryRetrievalRequestCount: number;
  memoryRetrievalConceptCount: number;
}

export interface RetrievedContextSnippet {
  id?: string;
  content: string;
  role?: MessageRole;
  createdAt?: string;
  score?: number;
}

const RECENT_HISTORY_MESSAGE_LIMIT = 12;
const RELEVANCE_TOKEN_LIMIT = 48;
const HARD_FACT_RELEVANCE_CANDIDATE_LIMIT = 48;
const MEMORY_PLAN_CANDIDATE_LIMIT = 10;
const MEMORY_PLAN_CANDIDATE_SUMMARY_LENGTH = 90;
const MEMORY_PLAN_FALLBACK_MIN_AVERAGE_RELEVANCE = 13;
const MEMORY_PLAN_RECENT_CONTEXT_MIN_FACT_RELEVANCE = 18;
const MEMORY_PLAN_RECENT_CONTEXT_MIN_AVERAGE_RELEVANCE = 24;

type MemoryRetrievalMode = 'memory_plan' | 'legacy_query' | 'suppressed';

interface MemoryRetrievalDecision {
  mode: MemoryRetrievalMode;
  query?: string;
  conceptCount: number;
}

@Provide()
export class AgentContextService {
  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  retrieveService: RetrieveService;

  @Inject()
  agentMemoryFactService: AgentMemoryFactService;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  @Inject()
  agentRelationshipSignalService: AgentRelationshipSignalService;

  @Inject()
  agentEmotionStateService: AgentEmotionStateService;

  @Inject()
  replyIntentClassifierService: ReplyIntentClassifierService;

  @Inject()
  replyBriefService: ReplyBriefService;

  async buildConversationContext(
    options: BuildConversationContextOptions
  ): Promise<AgentConversationContext> {
    const conversationMessages = await this.listConversationMessages(
      options.conversation
    );
    const routingHistoryMessages =
      this.buildRecentHistoryMessages(conversationMessages);
    const profileFacts = await this.listProfileFacts(options);
    const knownFamilyMembers = (profileFacts || [])
      .map(fact => getSharedFamilyMemberNameFromFactKey(fact.key))
      .filter((name): name is string => Boolean(name));
    const hardFactsPromise = this.listHardFacts(options);
    const emotionStatePromise = this.getCurrentEmotionState(options);
    const relationshipSignalsPromise = this.listRelationshipSignals(options);
    const hardFacts = await hardFactsPromise;
    const memoryCandidates = this.buildMemoryPlanCandidates(
      [...(profileFacts || []), ...(hardFacts || [])],
      options.currentQuery || '',
      routingHistoryMessages
    );
    const [emotionState, classifiedReplyIntent, storedRelationshipSignals] =
      await Promise.all([
        emotionStatePromise,
        this.classifyReplyIntent(
          {
            currentQuery: options.currentQuery || '',
            recentMessages: routingHistoryMessages,
            knownFamilyMembers,
            memoryCandidates: [],
          },
          options.classifyIntent !== false
        ),
        relationshipSignalsPromise,
      ]);
    const modelSelectedCandidateKeys =
      classifiedReplyIntent?.memoryPlan?.selectedFactKeys || [];
    const coverageReplyIntent = this.reconcileMemoryPlanCoverage(
      classifiedReplyIntent,
      memoryCandidates,
      [...(profileFacts || []), ...(hardFacts || [])],
      options.currentQuery || '',
      routingHistoryMessages
    );
    const memoryCoverageFallbackApplied =
      coverageReplyIntent !== classifiedReplyIntent;
    const replyIntent = this.attachMemoryCandidateSelection(
      coverageReplyIntent,
      memoryCandidates
    );
    const memoryRetrieval = this.resolveMemoryRetrievalDecision(
      options.currentQuery || '',
      replyIntent?.memoryPlan
    );
    const retrievedMemories = memoryRetrieval.query
      ? await this.retrieveLongTermHistory(
          options,
          this.resolveLongTermHistoryCutoff(routingHistoryMessages),
          memoryRetrieval.query
        )
      : [];
    const relationshipSignals =
      this.agentRelationshipSignalService?.selectRelevantSignals(
        storedRelationshipSignals,
        replyIntent
      ) || [];
    const replyRoute = routeReplyScene({
      currentQuery: options.currentQuery,
      recentMessages: routingHistoryMessages,
      emotionState,
      knownFamilyMembers,
      intent: replyIntent,
    });
    const replyBriefOptions = {
      currentQuery: options.currentQuery || '',
      intent: replyRoute.intent ?? replyIntent,
      route: replyRoute,
      confirmedFacts: [...(profileFacts || []), ...(hardFacts || [])]
        .map(fact => fact.value?.trim())
        .filter((value): value is string => Boolean(value)),
      recentMessages: routingHistoryMessages,
      retrievedMemories,
      relationshipSignals,
    };
    const replyBrief = this.replyBriefService
      ? this.replyBriefService.build(replyBriefOptions)
      : buildReplyBrief(replyBriefOptions);
    const modePolicy = resolveAgentChatModePolicy(replyBrief);
    const recentHistoryMessages = this.buildRecentHistoryMessages(
      conversationMessages,
      modePolicy.historyMessageLimit
    );
    const relevanceText = this.buildFactRelevanceText(
      options.currentQuery || '',
      recentHistoryMessages,
      replyBrief.reading,
      replyIntent?.memoryPlan
    );
    const factRetrievalPaths = this.buildFactRetrievalPaths(
      replyIntent?.memoryPlan
    );
    const selectedFactKeys = replyIntent?.memoryPlan?.selectedFactKeys || [];
    const selectedProfileFactCount = this.countSelectedFacts(
      profileFacts,
      selectedFactKeys
    );
    const selectedHardFactCount = this.countSelectedFacts(
      hardFacts,
      selectedFactKeys
    );
    const relevantProfileFacts = this.selectRelevantFacts(
      profileFacts,
      relevanceText,
      selectedProfileFactCount || modePolicy.profileFactLimit,
      factRetrievalPaths,
      selectedFactKeys
    );
    const relevantHardFacts = this.selectRelevantFacts(
      hardFacts,
      relevanceText,
      selectedHardFactCount || modePolicy.legacyFactLimit,
      factRetrievalPaths,
      selectedFactKeys
    );
    const relevantRetrievedMemories = retrievedMemories
      .filter(memory => memory.role === MessageRole.user)
      .slice(0, modePolicy.retrievedMemoryLimit);
    const evidence = this.buildEvidencePack({
      currentQuery: options.currentQuery || '',
      recentMessages: recentHistoryMessages,
      agent: options.agent,
      memoryControlResult: options.memoryControlResult,
      profileFacts: relevantProfileFacts,
      hardFacts: relevantHardFacts,
      retrievedMemories: relevantRetrievedMemories,
    });
    const systemLayer = this.buildSystemLayer(
      options,
      evidence,
      emotionState,
      replyRoute,
      replyBrief
    );
    const historyLayer = this.buildHistoryLayer(recentHistoryMessages);
    const layers = [systemLayer, historyLayer];
    const systemPromptContent = systemLayer.messages[0]?.content;

    return {
      layers,
      messages: layers.reduce<ChatCompletionMessageParam[]>(
        (result, layer) => result.concat(layer.messages),
        []
      ),
      evidence,
      diagnostics: {
        promptVersion: 'agent_chat_v2',
        systemPromptCharacters:
          typeof systemPromptContent === 'string'
            ? systemPromptContent.length
            : 0,
        replyLengthClass: replyBrief.lengthPlan.lengthClass,
        replyTargetCharacters: replyBrief.lengthPlan.targetCharacters,
        replyReviewCharacters: replyBrief.lengthPlan.reviewCharacters,
        historyMessageCount: historyLayer.messages.length,
        relevantMemoryCount:
          relevantProfileFacts.length +
          relevantHardFacts.length +
          relevantRetrievedMemories.length,
        relevantHardFactKeys: relevantHardFacts.map(fact => fact.key),
        conversationReadingAnchorCount: replyBrief.reading?.anchors.length ?? 0,
        memoryPlan: replyIntent?.memoryPlan,
        memoryCandidateCount: memoryCandidates.length,
        memoryCandidateKeys: memoryCandidates.map(candidate => candidate.key),
        memoryModelSelectedCandidateKeys: modelSelectedCandidateKeys,
        memorySelectedCandidateKeys: selectedFactKeys,
        memoryCoverageFallbackApplied,
        memoryRetrievalMode: memoryRetrieval.mode,
        memoryRetrievalRequestCount: memoryRetrieval.query ? 1 : 0,
        memoryRetrievalConceptCount: memoryRetrieval.conceptCount,
      },
      replyIntent: replyRoute.intent,
      replyRoute,
      replyBrief,
    };
  }

  private buildSystemLayer(
    options: BuildConversationContextOptions,
    evidence: AgentEvidenceItem[],
    emotionState?: ConversationEmotionStateSummary | null,
    replyRoute?: ReplySceneRoute,
    replyBrief?: ReplyBrief
  ): AgentContextLayer {
    const basePrompt = buildDepartedSystemPrompt({
      userId: options.auth.sub,
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      agent: options.agent,
    });
    const evidencePrompt = this.buildEvidencePrompt(evidence);
    const conversationReadingPrompt =
      this.buildConversationReadingPrompt(replyBrief);
    const modePrompt = buildAgentChatModePrompt(replyBrief, replyRoute);
    const continuitySummaryPrompt = this.buildContinuitySummaryPrompt(
      options.conversation
    );
    const emotionStatePrompt = this.buildEmotionStatePrompt(emotionState);
    const replyBriefPrompt = this.buildModelReplyBriefPrompt(replyBrief);

    const systemPrompt = [
      basePrompt,
      conversationReadingPrompt,
      modePrompt,
      continuitySummaryPrompt,
      evidencePrompt,
      emotionStatePrompt,
      replyBriefPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      key: 'persona',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        } as ChatCompletionMessageParam,
      ],
    };
  }

  private buildConversationReadingPrompt(replyBrief?: ReplyBrief): string {
    const reading = replyBrief?.reading;

    if (!reading) {
      return [
        '# 本轮理解原则',
        '先认真阅读当前用户原话，再决定怎么回应。不要让路由、模式、历史话题或通用安慰覆盖用户本轮明确说到的人、事、否定、纠正和问题。',
      ].join('\n');
    }

    const lines = [
      '# 本轮 Conversation Reading',
      `用户此刻需要：${reading.primaryNeed}`,
      `情绪具体来自：${reading.emotionalSource}`,
      `关系信号：${reading.relationshipSignal}`,
      `关系立场：${reading.relationshipStance || 'ordinary_response'}`,
      `原话锚点：${reading.anchors.map(item => `“${item.text}”`).join('、')}`,
    ];

    if (reading.corrections.length) {
      lines.push(`用户明确纠正：${reading.corrections.join('；')}`);
    }
    if (reading.negations.length) {
      lines.push(`不可反向理解：${reading.negations.join('；')}`);
    }
    if (reading.questionsToAnswer.length) {
      lines.push(`必须正面回答：${reading.questionsToAnswer.join('；')}`);
    }
    if (reading.uncertainties.length) {
      lines.push(`不能擅自确定：${reading.uncertainties.join('；')}`);
    }

    lines.push(
      `语气参考：${reading.suggestedTone}`,
      '这是语义模型对当前原话的注意提示，不是回复脚本。至少自然承接一个高信息量锚点；长消息可承接一到两个。不得机械复述字段，也不得让路由或 Brief 覆盖用户原话。'
    );

    return lines.join('\n');
  }

  private buildModelReplyBriefPrompt(replyBrief?: ReplyBrief): string {
    if (!replyBrief) {
      return '';
    }

    const constraints = replyBrief.capabilityConstraints
      .map(item => item.constraint?.trim())
      .filter((value): value is string => Boolean(value));
    const platformRules =
      replyBrief.mode === 'platform'
        ? [
            '用户明确要求确认 AI 身份时，简短如实回答，不回避，也不展开技术细节。',
          ]
        : [];
    const rules = Array.from(new Set([...constraints, ...platformRules]));
    const preservesMemoryFlow =
      replyBrief.mode === 'memory' || replyBrief.mode === 'memory_control';

    if (preservesMemoryFlow) {
      return [
        ...(rules.length
          ? [
              '# 本轮硬边界',
              ...rules.map((rule, index) => `${index + 1}. ${rule}`),
              '这些内容只限制不能声称的能力或事实，不规定回复步骤、措辞、气泡数量和情绪表达。',
            ]
          : []),
        '# 气泡语义规划',
        buildReplyBubblePlanPrompt(replyBrief.bubblePlan),
        '# 总字数预算',
        buildReplyLengthPlanPrompt(replyBrief.lengthPlan),
      ].join('\n');
    }

    return [
      '# 本轮回复任务',
      `用户此刻最需要：${replyBrief.emotionalNeed}`,
      ...(replyBrief.replyMoves.length
        ? [
            '可选择完成的回应目标：',
            ...replyBrief.replyMoves
              .slice(0, 3)
              .map((move, index) => `${index + 1}. ${move}`),
          ]
        : []),
      ...(replyBrief.forbiddenAssumptions.length
        ? [
            '不能擅自确定：',
            ...replyBrief.forbiddenAssumptions
              .slice(0, 4)
              .map((item, index) => `${index + 1}. ${item}`),
          ]
        : []),
      ...(rules.length
        ? [
            '能力与事实边界：',
            ...rules.map((rule, index) => `${index + 1}. ${rule}`),
          ]
        : []),
      '气泡语义规划：',
      buildReplyBubblePlanPrompt(replyBrief.bubblePlan),
      '总字数预算：',
      buildReplyLengthPlanPrompt(replyBrief.lengthPlan),
      '以上是给模型的完整语义任务，不是回复脚本。请综合用户原话和最近上下文，自主决定表达顺序和措辞；不必逐项复述，也不要暴露这些字段。',
    ].join('\n');
  }

  private async listHardFacts(
    options: BuildConversationContextOptions
  ): Promise<AgentMemoryFactSummary[]> {
    if (!this.agentMemoryFactService) {
      return [];
    }

    const facts = await this.agentMemoryFactService.listFactsForPrompt({
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
      limit: HARD_FACT_RELEVANCE_CANDIDATE_LIMIT,
    });

    return facts.filter(
      fact => fact && !fact.key?.startsWith('safety_signal.')
    );
  }

  private async listProfileFacts(
    options: BuildConversationContextOptions
  ): Promise<AgentProfileFactSummary[]> {
    if (!this.agentProfileFactService) {
      return [];
    }

    const facts = await this.agentProfileFactService.listFactsForPrompt({
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });

    return facts.filter(fact => !fact.key.startsWith('safety_signal.'));
  }

  private async listRelationshipSignals(
    options: BuildConversationContextOptions
  ): Promise<AgentRelationshipSignalSummary[]> {
    if (!this.agentRelationshipSignalService) {
      return [];
    }

    return this.agentRelationshipSignalService.listSignals({
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });
  }

  private async getCurrentEmotionState(
    options: BuildConversationContextOptions
  ): Promise<ConversationEmotionStateSummary | null> {
    if (!this.agentEmotionStateService) {
      return null;
    }

    return this.agentEmotionStateService.getCurrentState({
      conversationId: options.conversation.id,
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });
  }

  private buildFactRelevanceText(
    currentQuery: string,
    recentMessages: MessageEntity[],
    reading?: ConversationReading,
    memoryPlan?: ConversationMemoryPlan
  ): string {
    const recentUserTexts = recentMessages
      .filter(message => message.role === MessageRole.user)
      .slice(-3)
      .map(message => this.buildUserEvidenceText(message))
      .filter(Boolean);
    const semanticReadingTexts = reading
      ? [
          reading.primaryNeed,
          reading.emotionalSource,
          ...reading.anchors.map(anchor => anchor.text),
          ...reading.corrections,
          ...reading.negations,
          ...reading.questionsToAnswer,
          reading.relationshipSignal,
          ...reading.uncertainties,
        ]
          .map(value => value?.trim())
          .filter((value): value is string => Boolean(value))
      : [];
    const memoryPlanTexts =
      memoryPlan?.contextCoverage === 'missing'
        ? [
            ...memoryPlan.missingConcepts,
            ...memoryPlan.queries.reduce<string[]>((values, query) => {
              if (query.question) {
                values.push(query.question);
              }
              if (query.entityHint) {
                values.push(query.entityHint);
              }
              return values;
            }, []),
            ...(memoryPlan.selectedFactKeys || []),
          ]
            .map(value => value?.trim())
            .filter((value): value is string => Boolean(value))
        : [];

    return [
      currentQuery,
      ...recentUserTexts,
      ...semanticReadingTexts,
      ...memoryPlanTexts,
    ].join('\n');
  }

  private resolveMemoryRetrievalDecision(
    currentQuery: string,
    memoryPlan?: ConversationMemoryPlan
  ): MemoryRetrievalDecision {
    if (!memoryPlan) {
      const query = currentQuery.trim();

      return {
        mode: 'legacy_query',
        query: query || undefined,
        conceptCount: 0,
      };
    }

    if (
      memoryPlan.contextCoverage === 'complete' ||
      memoryPlan.need === 'none'
    ) {
      return {
        mode: 'suppressed',
        conceptCount: 0,
      };
    }

    const concepts = [
      ...memoryPlan.missingConcepts,
      ...(memoryPlan.selectedFactKeys || []),
      ...memoryPlan.queries.reduce<string[]>((values, query) => {
        if (query.question) {
          values.push(query.question);
        }
        if (query.entityHint) {
          values.push(query.entityHint);
        }
        return values;
      }, []),
    ]
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value));
    const deduplicatedConcepts = Array.from(
      new Map(
        concepts.map(value => [this.normalizeRelevanceText(value), value])
      ).values()
    ).filter(Boolean);
    const query = deduplicatedConcepts.join('\n').trim() || currentQuery.trim();

    return {
      mode: 'memory_plan',
      query: query || undefined,
      conceptCount: memoryPlan.missingConcepts.length,
    };
  }

  private buildFactRetrievalPaths(
    memoryPlan?: ConversationMemoryPlan
  ): string[] {
    if (memoryPlan?.contextCoverage !== 'missing') {
      return [];
    }

    const queryPaths = memoryPlan.queries
      .map(query =>
        [query.entityHint, query.question].filter(Boolean).join('\n')
      )
      .filter(Boolean);
    const paths = [
      ...(memoryPlan.selectedFactKeys || []),
      ...(queryPaths.length
        ? queryPaths
        : memoryPlan.missingConcepts.map(concept => concept.trim())),
    ];

    return Array.from(
      new Map(
        paths
          .filter(Boolean)
          .map(value => [this.normalizeRelevanceText(value), value])
      ).values()
    ).slice(0, 4);
  }

  private buildMemoryPlanCandidates<
    T extends {
      key: string;
      value: string;
      priority: number;
      type?: string;
      assertionPolicy?: AgentProfileFactAssertionPolicy;
    }
  >(
    facts: T[],
    currentQuery: string,
    recentMessages: MessageEntity[]
  ): ReplyIntentMemoryCandidate[] {
    if (!facts.length) {
      return [];
    }

    const relevanceText = [
      currentQuery,
      ...recentMessages
        .filter(message => message.role === MessageRole.user)
        .slice(-3)
        .map(message => this.buildUserEvidenceText(message)),
    ]
      .filter(Boolean)
      .join('\n');
    const preferredSlots = this.resolvePreferredFactSlots(
      this.normalizeRelevanceText(currentQuery)
    );

    if (!preferredSlots.length) {
      return [];
    }

    const deduplicatedFacts = Array.from(
      new Map(
        facts
          .filter(
            fact => Boolean(fact?.key?.trim()) && Boolean(fact?.value?.trim())
          )
          .map(fact => [fact.key, fact])
      ).values()
    );
    const preferredSlotSet = new Set(preferredSlots);
    const preferredFacts = this.selectRelevantFacts(
      deduplicatedFacts.filter(fact =>
        preferredSlotSet.has(this.resolveFactSemanticSlot(fact.key))
      ),
      relevanceText,
      MEMORY_PLAN_CANDIDATE_LIMIT
    );
    const supplementalFacts =
      preferredFacts.length > 3 &&
      preferredFacts.length < MEMORY_PLAN_CANDIDATE_LIMIT
        ? this.selectRelevantFacts(
            deduplicatedFacts.filter(
              fact =>
                !preferredFacts.some(candidate => candidate.key === fact.key)
            ),
            currentQuery,
            Math.min(6, MEMORY_PLAN_CANDIDATE_LIMIT - preferredFacts.length)
          )
        : [];
    const selectedFacts = preferredFacts.concat(supplementalFacts);

    return selectedFacts.map(fact => ({
      key: fact.key,
      slot: this.resolveFactSemanticSlot(fact.key),
      summary: fact.value
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MEMORY_PLAN_CANDIDATE_SUMMARY_LENGTH),
    }));
  }

  private attachMemoryCandidateSelection(
    intent: StructuredReplyIntent | undefined,
    candidates: ReplyIntentMemoryCandidate[]
  ): StructuredReplyIntent | undefined {
    if (
      !intent?.memoryPlan ||
      intent.memoryPlan.contextCoverage !== 'missing' ||
      !candidates.length
    ) {
      return intent;
    }

    const selectedFactKeys = Array.from(
      new Set([
        ...(intent.memoryPlan.selectedFactKeys || []),
        ...candidates.map(candidate => candidate.key),
      ])
    ).slice(0, MEMORY_PLAN_CANDIDATE_LIMIT);

    return {
      ...intent,
      memoryPlan: {
        ...intent.memoryPlan,
        selectedFactKeys,
      },
    };
  }

  private reconcileMemoryPlanCoverage<
    T extends {
      key: string;
      value: string;
      priority: number;
      type?: string;
      assertionPolicy?: AgentProfileFactAssertionPolicy;
    }
  >(
    intent: StructuredReplyIntent | undefined,
    candidates: ReplyIntentMemoryCandidate[],
    facts: T[],
    currentQuery: string,
    recentMessages: MessageEntity[]
  ): StructuredReplyIntent | undefined {
    if (
      !intent ||
      intent.memoryPlan?.contextCoverage === 'missing' ||
      !candidates.length
    ) {
      return intent;
    }

    const recentUserMessages = recentMessages.filter(
      message => message.role === MessageRole.user && message.content?.trim()
    );
    const currentMessageIndex = recentUserMessages
      .map(message => message.content.trim())
      .lastIndexOf(currentQuery.trim());
    const priorUserMessages =
      currentMessageIndex >= 0
        ? recentUserMessages.filter(
            (_message, index) => index !== currentMessageIndex
          )
        : recentUserMessages;

    if (priorUserMessages.length > 0) {
      if (intent.memoryPlan) {
        return intent;
      }

      const factsByKey = new Map(facts.map(fact => [fact.key, fact]));
      const recentContext = priorUserMessages
        .map(message => this.buildUserEvidenceText(message))
        .filter(Boolean)
        .join('\n');
      const normalizedRecentContext =
        this.normalizeRelevanceText(recentContext);
      const recentContextTokens = this.buildRelevanceTokens(recentContext);
      const scores = candidates
        .map(candidate => factsByKey.get(candidate.key))
        .filter((fact): fact is T => Boolean(fact))
        .map((fact, index) =>
          this.scoreFactRelevance(
            fact,
            normalizedRecentContext,
            recentContextTokens,
            index
          )
        );
      const averageRelevance =
        scores.reduce((total, score) => total + score, 0) /
        Math.max(scores.length, 1);
      const allCandidatesCovered =
        scores.length === candidates.length &&
        scores.every(
          score => score >= MEMORY_PLAN_RECENT_CONTEXT_MIN_FACT_RELEVANCE
        );

      if (
        allCandidatesCovered &&
        averageRelevance >= MEMORY_PLAN_RECENT_CONTEXT_MIN_AVERAGE_RELEVANCE
      ) {
        return {
          ...intent,
          memoryPlan: {
            need: 'none',
            contextCoverage: 'complete',
            missingConcepts: [],
            queries: [],
          },
        };
      }

      return intent;
    }

    const factsByKey = new Map(facts.map(fact => [fact.key, fact]));
    const normalizedQuery = this.normalizeRelevanceText(currentQuery);
    const tokens = this.buildRelevanceTokens(currentQuery);
    const scores = candidates
      .map(candidate => factsByKey.get(candidate.key))
      .filter((fact): fact is T => Boolean(fact))
      .map((fact, index) =>
        this.scoreFactRelevance(fact, normalizedQuery, tokens, index)
      );
    const averageRelevance =
      scores.reduce((total, score) => total + score, 0) /
      Math.max(scores.length, 1);

    if (averageRelevance < MEMORY_PLAN_FALLBACK_MIN_AVERAGE_RELEVANCE) {
      return intent;
    }

    return {
      ...intent,
      memoryPlan: {
        need: 'retrieve',
        contextCoverage: 'missing',
        missingConcepts: Array.from(
          new Set(candidates.map(candidate => candidate.slot))
        ).slice(0, 4),
        queries: [],
        selectedFactKeys: intent.memoryPlan?.selectedFactKeys,
      },
    };
  }

  private countSelectedFacts(
    facts: Array<{ key: string }>,
    selectedFactKeys: string[]
  ): number {
    if (!facts.length || !selectedFactKeys.length) {
      return 0;
    }

    const selectedKeySet = new Set(selectedFactKeys);
    return facts.filter(fact => selectedKeySet.has(fact.key)).length;
  }

  private selectRelevantFacts<
    T extends {
      key: string;
      value: string;
      priority: number;
      type?: string;
      assertionPolicy?: AgentProfileFactAssertionPolicy;
    }
  >(
    facts: T[],
    relevanceText: string,
    limit: number,
    retrievalPaths: string[] = [],
    selectedFactKeys: string[] = []
  ): T[] {
    if (!facts.length || limit <= 0) {
      return [];
    }

    const factsByKey = new Map(facts.map(fact => [fact.key, fact]));
    const pinnedFacts = selectedFactKeys
      .map(key => factsByKey.get(key))
      .filter((fact): fact is T => Boolean(fact))
      .slice(0, limit);

    if (pinnedFacts.length) {
      const pinnedKeys = new Set(pinnedFacts.map(fact => fact.key));
      const remainingLimit = limit - pinnedFacts.length;

      return remainingLimit > 0
        ? pinnedFacts.concat(
            this.selectRelevantFacts(
              facts.filter(fact => !pinnedKeys.has(fact.key)),
              relevanceText,
              remainingLimit,
              retrievalPaths
            )
          )
        : pinnedFacts;
    }

    if (retrievalPaths.length) {
      return this.fuseFactRetrievalPaths(
        facts,
        relevanceText,
        retrievalPaths,
        limit
      );
    }

    const normalizedQuery = this.normalizeRelevanceText(relevanceText);
    const tokens = this.buildRelevanceTokens(relevanceText);
    const ranked = facts
      .map((fact, index) => ({
        fact,
        index,
        score: this.scoreFactRelevance(fact, normalizedQuery, tokens, index),
      }))
      .sort(
        (left, right) => right.score - left.score || left.index - right.index
      );
    const preferredSlots = this.resolvePreferredFactSlots(normalizedQuery);

    if (preferredSlots.length < 2) {
      return ranked.slice(0, limit).map(item => item.fact);
    }

    const selectedIndexes = new Set<number>();
    const selected: T[] = [];

    for (const slot of preferredSlots) {
      const candidate = ranked.find(
        item =>
          !selectedIndexes.has(item.index) &&
          this.resolveFactSemanticSlot(item.fact.key) === slot
      );

      if (!candidate) {
        continue;
      }

      selected.push(candidate.fact);
      selectedIndexes.add(candidate.index);

      if (selected.length >= limit) {
        return selected;
      }
    }

    for (const item of ranked) {
      if (selectedIndexes.has(item.index)) {
        continue;
      }

      selected.push(item.fact);

      if (selected.length >= limit) {
        break;
      }
    }

    return selected;
  }

  private fuseFactRetrievalPaths<
    T extends {
      key: string;
      value: string;
      priority: number;
      type?: string;
      assertionPolicy?: AgentProfileFactAssertionPolicy;
    }
  >(
    facts: T[],
    relevanceText: string,
    retrievalPaths: string[],
    limit: number
  ): T[] {
    const rankings = retrievalPaths.map(path =>
      this.rankFactsForRetrievalPath(facts, path)
    );
    const globalRanking = this.selectRelevantFacts(
      facts,
      relevanceText,
      facts.length
    );
    const selectedKeys = new Set<string>();
    const selected: T[] = [];

    for (const ranking of rankings) {
      const candidate = ranking.find(fact => !selectedKeys.has(fact.key));

      if (!candidate) {
        continue;
      }

      selected.push(candidate);
      selectedKeys.add(candidate.key);

      if (selected.length >= limit) {
        return selected;
      }
    }

    const globalIndexes = new Map(
      globalRanking.map((fact, index) => [fact.key, index])
    );
    const rrfScores = new Map<string, number>();

    for (const ranking of rankings) {
      ranking.forEach((fact, index) => {
        rrfScores.set(
          fact.key,
          (rrfScores.get(fact.key) || 0) + 1 / (60 + index + 1)
        );
      });
    }

    const fused = facts
      .filter(fact => !selectedKeys.has(fact.key))
      .sort(
        (left, right) =>
          (rrfScores.get(right.key) || 0) - (rrfScores.get(left.key) || 0) ||
          (globalIndexes.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
            (globalIndexes.get(right.key) ?? Number.MAX_SAFE_INTEGER)
      );

    for (const fact of fused) {
      selected.push(fact);

      if (selected.length >= limit) {
        break;
      }
    }

    return selected;
  }

  private rankFactsForRetrievalPath<
    T extends {
      key: string;
      value: string;
      priority: number;
      type?: string;
      assertionPolicy?: AgentProfileFactAssertionPolicy;
    }
  >(facts: T[], retrievalPath: string): T[] {
    const [rawEntityHint] = retrievalPath.split('\n');
    const entityHint = rawEntityHint?.trim().toLowerCase() || '';

    if (!/^[a-z][a-z0-9_.-]{2,}$/.test(entityHint)) {
      return this.selectRelevantFacts(facts, retrievalPath, facts.length);
    }

    const hintParts = Array.from(
      new Set(entityHint.split(/[._-]/).filter(part => part.length >= 2))
    );
    const normalizedQuery = this.normalizeRelevanceText(retrievalPath);
    const tokens = this.buildRelevanceTokens(retrievalPath);

    return facts
      .map((fact, index) => {
        const normalizedFactKey = fact.key.toLowerCase();
        const semanticKey = `${fact.key.toLowerCase()} ${this.resolveFactSemanticSlot(
          fact.key
        )}`;
        const exactKeyScore = normalizedFactKey === entityHint ? 1000 : 0;
        const entityHintScore = hintParts.reduce(
          (score, part) => score + (semanticKey.includes(part) ? 20 : 0),
          0
        );

        return {
          fact,
          index,
          score:
            exactKeyScore +
            entityHintScore +
            this.scoreFactRelevance(fact, normalizedQuery, tokens, index),
        };
      })
      .sort(
        (left, right) => right.score - left.score || left.index - right.index
      )
      .map(item => item.fact);
  }

  private resolvePreferredFactSlots(query: string): string[] {
    const domains: string[][] = [];
    const addDomain = (matched: boolean, slots: string[]) => {
      if (matched) {
        domains.push(slots);
      }
    };

    addDomain(/称呼|叫我|叫法|怎么喊|喊我/.test(query), [
      'address.current',
      'address.forbidden',
      'address.usage',
    ]);
    addDomain(
      /吃|喝|吃喝|饭|饮食|忌口|胃|牙|嗓子|控糖|乳糖|咖啡|热饮|甜食|冷菜/.test(
        query
      ),
      /身体|限制|忌口|胃|牙|嗓子|控糖|乳糖|失眠/.test(query)
        ? ['food.health', 'food.current', 'food.dislike', 'food.comfort']
        : ['food.current', 'food.health', 'food.dislike', 'food.comfort']
    );
    addDomain(
      /难受|撑不住|想你|夜里|陪我|接住|安慰|思念|痛|哭|崩溃|放下|坚强/.test(
        query
      ),
      [
        'emotion.response',
        'emotion.comfort_style',
        'emotion.comfort_taboo',
        'emotion.trigger',
        'emotion.responsibility',
        'emotion.longing',
      ]
    );
    addDomain(
      /家里|家人|家事|亲属|孩子|儿子|女儿|爸爸|妈妈|老人|我姐|我哥/.test(
        query
      ) && !/收拾|打扫|洗衣|家务|买了/.test(query),
      ['family.boundary', 'family.identity', 'family.structure']
    );
    addDomain(
      /纠正|改正|指出|记错|说错|不对|别编|瞎编|硬事实|分寸/.test(query),
      [
        'correction.response',
        'correction.hard_fact',
        'correction.boundary',
        'correction.never_had',
      ]
    );
    addDomain(
      /留下来的|那件.{0,6}东西|纪念物|照片|围巾|手链|戒指|信|相框/.test(
        query
      ) && !/洗衣|收拾|打扫|快递|文件|钥匙|擦灰|拖地/.test(query),
      [
        'keepsake.update',
        'keepsake.location',
        'keepsake.meaning',
        'keepsake.ritual',
      ]
    );
    addDomain(
      /那个日子|那天|遗憾|保证|承诺|清明|生日|忌日|仪式|老地方/.test(query) &&
        !/洗衣|收拾|打扫|快递|文件|钥匙/.test(query),
      ['ritual.boundary', 'ritual.update', 'ritual.date', 'ritual.action']
    );
    addDomain(
      /习惯的方式|怎么回|怎么说|说法|长段|表达|语气|回应方式|表达习惯|先回应|分段|修辞|比喻/.test(
        query
      ),
      ['style.update', 'style.mode', 'style.segment', 'style.preference']
    );
    addDomain(/补充|限定|优先级|刚才|改成|现在别叫|只剩一条/.test(query), [
      'compound.conflict',
      'compound.update',
      'compound.supplement',
      'compound.policy',
    ]);

    if (domains.length <= 1) {
      return domains[0] || [];
    }

    const interleaved: string[] = [];
    const maxLength = Math.max(...domains.map(slots => slots.length));

    for (let index = 0; index < maxLength; index += 1) {
      for (const slots of domains) {
        if (slots[index]) {
          interleaved.push(slots[index]);
        }
      }
    }

    return interleaved;
  }

  private resolveFactSemanticSlot(key: string): string {
    if (key === 'relationship.agent_calls_user') {
      return 'address.current';
    }
    if (key.startsWith('relationship.forbidden_user_address.')) {
      return 'address.forbidden';
    }
    if (key === 'relationship.address_usage_style') {
      return 'address.usage';
    }

    if (key === 'user.preference.food_update') {
      return 'food.current';
    }
    if (key.startsWith('user.health.food_constraint.')) {
      return 'food.health';
    }
    if (key.startsWith('user.preference.comfort_food.')) {
      return 'food.comfort';
    }

    if (key.startsWith('grief_need.')) {
      return 'emotion.response';
    }
    if (key.startsWith('user.preference.comfort_style.')) {
      return 'emotion.comfort_style';
    }
    if (key.startsWith('taboo.comfort_method.')) {
      return 'emotion.comfort_taboo';
    }
    if (key === 'taboo.no_live_for_agent') {
      return 'emotion.responsibility';
    }
    if (key.startsWith('user.signal.longing_wording.')) {
      return 'emotion.longing';
    }
    if (key.startsWith('grief_')) {
      return 'emotion.trigger';
    }
    if (key.startsWith('user.preference.')) {
      return 'food.dislike';
    }

    if (
      key.startsWith('family.boundary.') ||
      key.startsWith('family.status_boundary.')
    ) {
      return 'family.boundary';
    }
    if (/\.name$/.test(key) || key.startsWith('family.address_update.')) {
      return 'family.identity';
    }
    if (key.startsWith('family.')) {
      return 'family.structure';
    }

    if (key.startsWith('correction.response_style.')) {
      return 'correction.response';
    }
    if (key === 'correction.no_fabrication') {
      return 'correction.boundary';
    }
    if (key.startsWith('correction.hard_fact.')) {
      return 'correction.hard_fact';
    }
    if (
      key.startsWith('correction.never_had.') ||
      key.startsWith('correction.never.')
    ) {
      return 'correction.never_had';
    }

    if (key.startsWith('keepsake.update.')) {
      return 'keepsake.update';
    }
    if (key.startsWith('keepsake.location.')) {
      return 'keepsake.location';
    }
    if (key.startsWith('keepsake.meaning.')) {
      return 'keepsake.meaning';
    }
    if (key.startsWith('keepsake.ritual.')) {
      return 'keepsake.ritual';
    }

    if (key.startsWith('promise.boundary.')) {
      return 'ritual.boundary';
    }
    if (key.startsWith('promise_ritual.update.')) {
      return 'ritual.update';
    }
    if (key.startsWith('ritual.date.')) {
      return 'ritual.date';
    }
    if (key.startsWith('ritual.action.')) {
      return 'ritual.action';
    }

    if (key.startsWith('style.update.')) {
      return 'style.update';
    }
    if (key.startsWith('style.mode.')) {
      return 'style.mode';
    }
    if (key.startsWith('style.segment.')) {
      return 'style.segment';
    }
    if (key.startsWith('style.preference.')) {
      return 'style.preference';
    }

    if (key.startsWith('compound.conflict_scope.')) {
      return 'compound.conflict';
    }
    if (key.startsWith('compound.update.')) {
      return 'compound.update';
    }
    if (key.startsWith('compound.supplement.')) {
      return 'compound.supplement';
    }
    if (key.startsWith('memory_test.policy.')) {
      return 'compound.policy';
    }

    return key.split('.').slice(0, 2).join('.');
  }

  private scoreFactRelevance(
    fact: {
      key: string;
      value: string;
      priority: number;
      type?: string;
      assertionPolicy?: AgentProfileFactAssertionPolicy;
    },
    normalizedQuery: string,
    tokens: string[],
    index: number
  ): number {
    const searchable = this.normalizeRelevanceText(
      `${fact.key} ${fact.type || ''} ${fact.value}`
    );
    let score = Math.max(0, Math.min(fact.priority || 0, 3)) * 1.5;
    score += this.scoreFactAssociation(fact.key, normalizedQuery);

    for (const token of tokens) {
      if (searchable.includes(token)) {
        score += token.length >= 4 ? 5 : 4;
      }
    }

    if (
      normalizedQuery.length >= 2 &&
      searchable.includes(normalizedQuery.slice(0, 24))
    ) {
      score += 5;
    }

    if (
      /记得|以前|从前|小时候|那时候|当年|曾经/.test(normalizedQuery) &&
      /memory|shared|经历|回忆|以前|曾经/.test(searchable)
    ) {
      score += 4;
    }

    if (
      /谁|家人|孩子|儿子|女儿|爸爸|妈妈|爸|妈|爷爷|奶奶|老公|老婆/.test(
        normalizedQuery
      ) &&
      /family|relationship|家人|孩子|儿子|女儿|爸爸|妈妈|爸|妈|爷爷|奶奶|老公|老婆/.test(
        searchable
      )
    ) {
      score += 3;
    }

    if (
      /^(?:style|taboo|safety_signal|grief_trigger)\./.test(fact.key) &&
      /难受|撑不住|想你|痛|哭|崩溃|陪我|安慰|回应|语气/.test(normalizedQuery)
    ) {
      score += 3;
    }

    if (fact.assertionPolicy === AgentProfileFactAssertionPolicy.contextOnly) {
      score += 1;
    }

    return score - index * 0.001;
  }

  private scoreFactAssociation(key: string, query: string): number {
    let score = 0;

    if (
      /称呼|叫我|怎么叫|叫法|避开.{0,6}叫/.test(query) &&
      /^relationship\.(?:agent_calls_user|forbidden_user_address|address_usage_style)/.test(
        key
      )
    ) {
      score += 12;
    }

    if (
      /吃|喝|吃喝|饭|饮食|忌口|胃|牙|嗓子|控糖|乳糖|咖啡|热饮/.test(query) &&
      /^(?:user\.preference\.(?:spicy|cilantro|offal|too_sweet|cold_meal|coffee|comfort_food|food_update|meal_context)|user\.health\.food_constraint)/.test(
        key
      )
    ) {
      score += 11;
    }

    if (
      /难受|撑不住|撑着|想你|夜里|陪我|接住|安慰|放下|坚强|戳我的|那个.{0,6}时刻/.test(
        query
      ) &&
      /^(?:taboo\.|user\.(?:preference\.comfort|signal\.longing)|grief_)/.test(
        key
      )
    ) {
      score += 9;
    }

    if (
      /家里|家人|家事|亲属|孩子|儿子|女儿|爸爸|妈妈|纠正|改正|指出|硬事实|分寸|记错/.test(
        query
      ) &&
      !/收拾|打扫|洗衣|家务|买了/.test(query) &&
      /^(?:family\.|correction\.)/.test(key)
    ) {
      score += 11;
    }

    if (
      /留下来的|那件.{0,6}东西|纪念|照片|围巾|手链|戒指|信|相框/.test(query) &&
      /^keepsake\./.test(key)
    ) {
      score += 12;
    }

    if (
      /那个日子|自己的方式|遗憾|保证|清明|生日|忌日|仪式/.test(query) &&
      !/洗衣|收拾|打扫|快递|文件|钥匙/.test(query) &&
      /^(?:ritual\.|promise)/.test(key)
    ) {
      score += 11;
    }

    if (
      /习惯的方式|怎么回|一段|长段|表达|说法|语气|回应方式|表达习惯|分段|修辞/.test(
        query
      ) &&
      /^style\./.test(key)
    ) {
      score += 11;
    }

    if (
      /补充|限定|重点说说|刚才/.test(query) &&
      /^(?:compound\.|memory_test\.policy)/.test(key)
    ) {
      score += 12;
    }

    if (
      /真正记住|记住的重点|按你记得/.test(query) &&
      /^(?:relationship\.|taboo\.|family\.|grief_|user\.preference\.comfort|style\.)/.test(
        key
      )
    ) {
      score += 5;
    }

    if (
      /洗衣|收拾|打扫|快递|文件|钥匙|擦灰|拖地/.test(query) &&
      /^(?:keepsake\.|ritual\.|promise|grief_)/.test(key)
    ) {
      score -= 18;
    }

    return score;
  }

  private buildRelevanceTokens(value: string): string[] {
    const tokens = new Set<string>();
    const normalized = value.toLowerCase();
    const wordMatches = normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g);

    for (const match of wordMatches || []) {
      if (/^[a-z0-9]+$/.test(match)) {
        tokens.add(match);
        continue;
      }

      if (match.length <= 10) {
        tokens.add(match);
      }

      for (let index = 0; index < match.length - 1; index += 1) {
        tokens.add(match.slice(index, index + 2));
      }
    }

    return [...tokens]
      .sort((left, right) => right.length - left.length)
      .slice(0, RELEVANCE_TOKEN_LIMIT);
  }

  private normalizeRelevanceText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()]/g, '');
  }

  private buildAgentProfileEvidence(
    agent: AgentEntity | null,
    currentQuery: string
  ): AgentEvidenceItem[] {
    if (!agent) {
      return [];
    }

    const evidence: AgentEvidenceItem[] = [];
    const name = agent.name?.trim() || 'TA';
    const userCallsAgent = agent.iCallAgent?.trim() || name;
    const agentCallsUser = agent.agentCallMe?.trim() || '我';
    let index = 1;

    evidence.push({
      id: `A${index}`,
      source: 'agent_profile',
      text: `当前角色姓名是${name}；用户称呼当前角色为${userCallsAgent}；当前角色称呼用户为${agentCallsUser}`,
      assertionPolicy: 'can_assert',
      confidence: 1,
    });

    if (
      /生日|出生|几岁|多大|什么时候走|什么时候去世|离开日期/.test(currentQuery)
    ) {
      const dates = [
        this.formatAgentDate('生日', agent.birthday),
        this.formatAgentDate('离开日期', agent.deathDate),
      ].filter(Boolean);

      if (dates.length) {
        index += 1;
        evidence.push({
          id: `A${index}`,
          source: 'agent_profile',
          text: dates.join('；'),
          assertionPolicy: 'can_assert',
          confidence: 1,
        });
      }
    }

    const detailCandidates = [
      {
        key: 'customContext',
        value: agent.customContext,
        assertionPolicy: 'context_only' as const,
        baseScore: 6,
      },
      {
        key: 'languageHabits',
        value: agent.languageHabits,
        assertionPolicy: 'context_only' as const,
        baseScore: 5,
      },
      {
        key: 'personalityTraits',
        value: agent.personalityTraits,
        assertionPolicy: 'context_only' as const,
        baseScore: 2,
      },
      {
        key: 'sharedMemories',
        value: agent.sharedMemories,
        assertionPolicy: 'can_assert' as const,
        baseScore: 1,
      },
      {
        key: 'lifeExperience',
        value: agent.lifeExperience,
        assertionPolicy: 'can_assert' as const,
        baseScore: 1,
      },
      {
        key: 'hobbies',
        value: agent.hobbies,
        assertionPolicy: 'can_assert' as const,
        baseScore: 1,
      },
      {
        key: 'description',
        value: agent.description,
        assertionPolicy: 'can_assert' as const,
        baseScore: 0,
      },
    ]
      .map((item, sourceIndex) => {
        const value = stripPromptLeakageContent(item.value).slice(0, 300);
        const queryTokens = this.buildRelevanceTokens(currentQuery);
        const searchable = this.normalizeRelevanceText(value);
        const relevanceScore = queryTokens.reduce(
          (score, token) =>
            score +
            (searchable.includes(token) ? Math.min(token.length, 4) : 0),
          0
        );

        return {
          ...item,
          value,
          sourceIndex,
          score: item.baseScore + relevanceScore,
        };
      })
      .filter(item => Boolean(item.value))
      .sort(
        (left, right) =>
          right.score - left.score || left.sourceIndex - right.sourceIndex
      )
      .slice(0, 3);

    for (const detail of detailCandidates) {
      index += 1;
      evidence.push({
        id: `A${index}`,
        source: 'agent_profile',
        text: detail.value,
        assertionPolicy: detail.assertionPolicy,
        confidence: 0.95,
      });
    }

    return evidence;
  }

  private formatAgentDate(label: string, value?: Date): string {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      return '';
    }

    return `${label}是${value.getFullYear()}-${String(
      value.getMonth() + 1
    ).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  private buildEvidencePack(options: {
    currentQuery: string;
    recentMessages: MessageEntity[];
    agent: AgentEntity | null;
    memoryControlResult?: AgentMemoryControlResult;
    profileFacts: AgentProfileFactSummary[];
    hardFacts: AgentMemoryFactSummary[];
    retrievedMemories: RetrievedContextSnippet[];
  }): AgentEvidenceItem[] {
    const evidence: AgentEvidenceItem[] = [];
    const seenTexts = new Set<string>();
    const currentQuery = options.currentQuery.trim();

    const addEvidence = (item: AgentEvidenceItem): void => {
      const normalizedText = item.text.replace(/\s+/g, '').trim();

      if (!normalizedText || seenTexts.has(normalizedText)) {
        return;
      }

      seenTexts.add(normalizedText);
      evidence.push(item);
    };

    if (currentQuery) {
      addEvidence({
        id: 'U0',
        source: 'current_user',
        text: currentQuery,
        assertionPolicy: this.resolveUserEvidencePolicy(currentQuery),
      });
    }

    if (options.memoryControlResult) {
      addEvidence(this.buildMemoryControlEvidence(options.memoryControlResult));
    }

    for (const item of this.buildAgentProfileEvidence(
      options.agent,
      currentQuery
    )) {
      addEvidence(item);
    }

    let factIndex = 0;
    const profileFactKeys = new Set<string>();

    for (const fact of options.profileFacts.slice(0, 8)) {
      const value = fact.value?.trim();

      if (!value) {
        continue;
      }

      profileFactKeys.add(fact.key);
      factIndex += 1;
      addEvidence({
        id: `F${factIndex}`,
        source: 'confirmed_fact',
        text: value,
        assertionPolicy:
          fact.assertionPolicy === AgentProfileFactAssertionPolicy.contextOnly
            ? 'context_only'
            : 'can_assert',
        confidence: this.resolveProfileFactConfidence(fact),
        sourceMessageId: fact.sourceMessageId,
      });
    }

    for (const fact of options.hardFacts.slice(0, 8)) {
      const value = fact.value?.trim();

      if (!value || profileFactKeys.has(fact.key)) {
        continue;
      }

      factIndex += 1;
      addEvidence({
        id: `F${factIndex}`,
        source: 'confirmed_fact',
        text: value,
        assertionPolicy: this.resolveLegacyFactAssertionPolicy(fact.key),
        confidence: 0.9,
        sourceMessageId: fact.sourceMessageId,
      });

      if (factIndex >= 10) {
        break;
      }
    }

    let recentIndex = 0;
    const recentUserMessages = options.recentMessages
      .filter(message => message.role === MessageRole.user)
      .slice()
      .reverse();

    for (const message of recentUserMessages) {
      const text = this.buildUserEvidenceText(message);

      if (!text || text === currentQuery) {
        continue;
      }

      recentIndex += 1;
      addEvidence({
        id: `R${recentIndex}`,
        source: 'recent_user',
        text,
        assertionPolicy: this.resolveUserEvidencePolicy(text),
        sourceMessageId: this.stringifyObjectId(message.id),
      });

      if (recentIndex >= 3) {
        break;
      }
    }

    let retrievedIndex = 0;

    for (const memory of options.retrievedMemories) {
      const text = memory.content?.trim();

      if (!text || memory.role !== MessageRole.user) {
        continue;
      }

      retrievedIndex += 1;
      addEvidence({
        id: `L${retrievedIndex}`,
        source: 'retrieved_user',
        text,
        assertionPolicy: this.resolveUserEvidencePolicy(text),
        confidence: memory.score,
        sourceMessageId: memory.id,
      });

      if (retrievedIndex >= 3) {
        break;
      }
    }

    return evidence;
  }

  private buildContinuitySummaryPrompt(
    conversation: ConversationEntity
  ): string {
    const summary = conversation.continuitySummary?.trim();

    if (!summary) {
      return '';
    }

    return [
      '# 对话连续性摘要',
      summary,
      '摘要只用于理解此前聊到哪里，不是事实证据。涉及人物、关系、现实事件和共同记忆时，仍必须由本轮证据包中的“可陈述”证据支持。',
    ].join('\n');
  }

  private buildEvidencePrompt(evidence: AgentEvidenceItem[]): string {
    const sourceLabels: Record<AgentEvidenceItem['source'], string> = {
      agent_profile: '角色资料',
      system_action: '系统操作',
      current_user: '当前用户原话',
      confirmed_fact: '已确认事实',
      recent_user: '近期用户原话',
      retrieved_user: '长期用户原话',
    };
    const lines = evidence.map(item => {
      const isUserEvidence =
        item.source === 'current_user' ||
        item.source === 'recent_user' ||
        item.source === 'retrieved_user';
      const policyLabel =
        item.assertionPolicy === 'can_assert' && !isUserEvidence
          ? '可自主陈述'
          : '仅可归因用户';

      return `[${item.id}][${sourceLabels[item.source]}][${policyLabel}] ${
        item.text
      }`;
    });

    return [
      '# 本轮证据包',
      ...(lines.length ? lines : ['当前没有可用于扩写具体事实的证据。']),
      '',
      '# 证据使用规则',
      '证据只负责约束事实，不负责规划回复。请自行理解语境并自然表达。',
      '标记“可自主陈述”的内容可以由当前角色直接确认；标记“仅可归因用户”的内容只能写成“你说、听你提起、你记得”等用户归因，不能据此肯定问题中的假设。',
      '当前和历史用户原话即使是问句，也可以支持 attributed_to_user 归因复述；只有 can_assert 证据可以支持 autonomous_fact。',
      '没有证据支持的人物关系、现实事件、共同经历、动作、地点、习惯和离世后生活必须说不确定、记不清，或只回应用户感受。',
      '愿望、猜测和心意必须在正文里自然写明“要是我在、真想、我猜、就当”等柔性框架，不能伪装成已经发生的事实。',
      '这些证据只供内部生成使用。最终只输出自然聊天正文，不要输出证据 ID、归因模式或结构化声明。',
    ].join('\n');
  }

  private buildMemoryControlEvidence(
    result: AgentMemoryControlResult
  ): AgentEvidenceItem {
    const target = result.target || '当前内容';
    const text = !result.succeeded
      ? `系统执行${
          result.action === 'forget' ? '删除' : '保存'
        }记忆失败，不能向用户声称操作已经完成`
      : result.action === 'forget'
      ? result.affectedCount > 0
        ? `系统已归档与“${target}”匹配的${result.affectedCount}条长期记忆，后续不会再把它们用于聊天`
        : `系统没有找到与“${target}”匹配的可删除长期记忆`
      : result.affectedCount > 0
      ? `系统已从当前消息保存${result.affectedCount}条结构化记忆`
      : '系统没有从当前消息识别出可保存的长期事实';

    return {
      id: 'S1',
      source: 'system_action',
      text,
      assertionPolicy: 'can_assert',
      confidence: 1,
    };
  }

  private resolveProfileFactConfidence(fact: AgentProfileFactSummary): number {
    switch (fact.confidence) {
      case 'confirmed':
      case 'user_corrected':
      case 'feedback':
        return 0.98;
      default:
        return fact.supportCount && fact.supportCount >= 2 ? 0.9 : 0.75;
    }
  }

  private resolveLegacyFactAssertionPolicy(
    key: string
  ): AgentEvidenceAssertionPolicy {
    return /^(?:style|taboo|safety_signal|grief_trigger)\./.test(key)
      ? 'context_only'
      : 'can_assert';
  }

  private resolveUserEvidencePolicy(
    text: string
  ): AgentEvidenceAssertionPolicy {
    const normalized = text.replace(/\s+/g, '').trim();

    return /[?？]/.test(normalized) ||
      /(?:吗|么|呢|什么|谁|哪里|哪儿|几时|何时|了没|没有|是不是|有没有|会不会|能不能|可不可以)$/.test(
        normalized
      )
      ? 'context_only'
      : 'can_assert';
  }

  private buildUserEvidenceText(message: MessageEntity): string {
    if (message.type === MessageType.voice) {
      return message.mediaTranscript?.trim() || '';
    }

    if (message.type === MessageType.image) {
      return message.mediaAnalysis?.trim() || '';
    }

    return message.content?.trim() || '';
  }

  private buildHistoryLayer(messages: MessageEntity[]): AgentContextLayer {
    return {
      key: 'history',
      messages: messages
        .map(message => this.buildChatMessage(message))
        .filter(Boolean) as ChatCompletionMessageParam[],
    };
  }

  private buildEmotionStatePrompt(
    state?: ConversationEmotionStateSummary | null
  ): string {
    if (!state) {
      return '';
    }

    const emotionLabel = this.formatEmotionLabel(state.primaryEmotion);
    const lines = [
      '# 当前用户情绪状态',
      `用户最近表现为：${emotionLabel}。`,
      '回复时优先承接当前情绪和用户具体说到的人与事；不要做轻生、自伤或紧迫风险判断，也不要把普通短期情绪当作长期事实或人格画像。',
    ];

    if (
      state.primaryEmotion === ConversationEmotionPrimary.crisisRisk ||
      state.riskLevel === ConversationEmotionRiskLevel.high
    ) {
      lines.push(
        '旧状态字段可能记录为高风险，本轮只把它理解为强烈痛苦或思念，自然继续聊天；不要输出报警、急救、远离危险物或联系现实人员等干预话术。带有来生、走完一生、自然老去、年老以后或很久以后等条件的团聚表达可以承接；不得邀请用户现在或近期来找当前角色、一起走或赴死。'
      );
    }

    return lines.join('\n');
  }

  private classifyReplyIntent(
    options: {
      currentQuery: string;
      recentMessages: MessageEntity[];
      knownFamilyMembers: string[];
      memoryCandidates: ReplyIntentMemoryCandidate[];
    },
    enabled = true
  ): Promise<StructuredReplyIntent | undefined> {
    if (!enabled || !this.replyIntentClassifierService) {
      return Promise.resolve(undefined);
    }

    return this.replyIntentClassifierService
      .classify(options)
      .catch(() => undefined);
  }

  private formatEmotionLabel(emotion: ConversationEmotionPrimary): string {
    const labels: Record<ConversationEmotionPrimary, string> = {
      [ConversationEmotionPrimary.stable]: '稳定',
      [ConversationEmotionPrimary.missing]: '强烈思念',
      [ConversationEmotionPrimary.sadness]: '哀伤',
      [ConversationEmotionPrimary.guilt]: '愧疚',
      [ConversationEmotionPrimary.angerBlame]: '责问与不甘',
      [ConversationEmotionPrimary.fear]: '害怕现实存在感',
      [ConversationEmotionPrimary.expectingPresence]: '期待现实确认',
      [ConversationEmotionPrimary.attachment]: '纪念物依恋',
      [ConversationEmotionPrimary.crisisRisk]: '强烈痛苦表达',
    };

    return labels[emotion] ?? emotion;
  }

  private async retrieveLongTermHistory(
    options: BuildConversationContextOptions,
    createdBeforeTs?: number,
    retrievalQuery?: string
  ): Promise<RetrievedContextSnippet[]> {
    const query = retrievalQuery?.trim() || options.currentQuery?.trim();

    if (!query) {
      return [];
    }

    return this.retrieveService.retrieveConversationMemories({
      query,
      userId: options.auth.sub,
      conversationId: this.stringifyObjectId(options.conversation.id),
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      createdBeforeTs,
    });
  }

  private async listConversationMessages(
    conversation: ConversationEntity
  ): Promise<MessageEntity[]> {
    const messages = await this.messageModel.find({
      where: {
        conversationId: conversation.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return messages.filter(message => !message.isArchived);
  }

  private buildRecentHistoryMessages(
    messages: MessageEntity[],
    limit = RECENT_HISTORY_MESSAGE_LIMIT
  ): MessageEntity[] {
    return messages
      .filter(message => this.buildChatMessage(message))
      .slice(-Math.max(1, Math.min(limit, RECENT_HISTORY_MESSAGE_LIMIT)));
  }

  private resolveLongTermHistoryCutoff(
    recentHistoryMessages: MessageEntity[]
  ): number | undefined {
    if (recentHistoryMessages.length < RECENT_HISTORY_MESSAGE_LIMIT) {
      return undefined;
    }

    const oldestRecentMessage = recentHistoryMessages[0];
    const timestamp = oldestRecentMessage?.createdAt?.getTime?.();

    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      return undefined;
    }

    return Math.floor(timestamp);
  }

  private buildChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    switch (message.role) {
      case MessageRole.assistant: {
        const assistantContent = this.buildAssistantHistoryContent(message);

        if (!assistantContent) {
          return null;
        }
        return {
          role: 'assistant',
          content: assistantContent,
        };
      }
      case MessageRole.user:
        if (message.type === MessageType.voice) {
          return this.buildVoiceChatMessage(message);
        }
        if (message.type === MessageType.image) {
          return this.buildImageChatMessage(message);
        }
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'user',
          content: this.buildUserTextChatContent(message),
        };
      case MessageRole.system:
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'system',
          content: message.content,
        };
      default:
        return null;
    }
  }

  private buildAssistantHistoryContent(message: MessageEntity): string {
    const transcript = stripPromptLeakageContent(message.mediaTranscript);

    if (
      message.type === MessageType.voice &&
      transcript &&
      !containsUnsafeAssistantHistoryContent(transcript)
    ) {
      return transcript;
    }

    if (message.type !== MessageType.text) {
      return '';
    }

    const content = stripPromptLeakageContent(message.content);

    if (!content || containsUnsafeAssistantHistoryContent(content)) {
      return '';
    }

    return content;
  }

  private buildUserTextChatContent(message: MessageEntity): string {
    const content = message.content?.trim() || '';
    const quotedContent = message.quotedMessageContent?.trim();

    if (!quotedContent) {
      return content;
    }

    const roleLabel =
      message.quotedMessageRole === MessageRole.assistant
        ? 'AI回复'
        : message.quotedMessageRole === MessageRole.user
        ? '用户原话'
        : '历史消息';

    return [
      '用户本条消息使用了“引用”操作。',
      `被引用的${roleLabel}：${quotedContent}`,
      `用户本次要表达的内容：${content}`,
      '请优先理解用户是在针对被引用内容回应；不要把被引用内容当作用户本次新说的话。',
    ].join('\n');
  }

  private buildImageChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    const analysis = message.mediaAnalysis?.trim();

    if (!analysis) {
      return null;
    }

    return {
      role: 'user',
      content:
        `用户发送了一张图片。\n图片理解：${analysis}\n` +
        '请只围绕图片里可见的行为、场景、物体和氛围来做自然回应。不要猜测图片中的人是谁，不要做人脸或身份识别，不要追问人物身份、关系或背景。尽量只说你看到的内容，用陈述句回复，不要发出提问。',
    };
  }

  private buildVoiceChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    const transcript = message.mediaTranscript?.trim();

    if (!transcript) {
      return null;
    }

    return {
      role: 'user',
      content:
        `用户发送了一条语音消息。\n语音转写：${transcript}\n` +
        '请把这段转写内容当作用户刚刚说的话，自然回复，不要强调这是转写结果，除非用户自己提到识别错误或转写问题。',
    };
  }

  private stringifyObjectId(value: unknown): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && value) {
      const objectValue = value as {
        toHexString?: () => string;
        toString?: () => string;
      };

      if (typeof objectValue.toHexString === 'function') {
        return objectValue.toHexString();
      }

      if (typeof objectValue.toString === 'function') {
        return objectValue.toString();
      }
    }

    return String(value);
  }
}
