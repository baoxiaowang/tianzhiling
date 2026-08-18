import { Config, Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageType,
  AgentProfileFactAssertionPolicy,
  ChatSpanAttributeValue,
  ChatSpanStatus,
  ChatTraceStage,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../../interface';
import {
  containsUnsafeAssistantHistoryContent,
  stripPromptLeakageContent,
} from '../../common/message-content-safety';
import {
  buildDepartedCompanionCorePrompt,
  buildDepartedSystemPrompt,
} from '../../prompt/departed';
import { buildDepartedPerceptionPrompt } from '../../prompt/departed-perception';
import { RetrieveService } from '../rag/retrieve.service';
import { ChatTraceService } from '../chat-trace.service';
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
  ClassifyReplyIntentOptions,
  ReplyIntentClassifierService,
  ReplyIntentClassificationResult,
  ReplyIntentMemoryCandidate,
  ReplyPlanningDecision,
  ReplyPlanningMode,
} from './reply-intent-classifier.service';
import type {
  ConversationObjectPlan,
  ConversationMemoryPlan,
  ConversationReading,
  StructuredReplyIntent,
} from './reply-intent';
import {
  buildAgentIdentityContract,
  buildKnownConversationObjects,
  AgentIdentityContract,
} from './agent-identity-contract';
import {
  buildConversationObjectPlanPrompt,
  buildReplyParticipationStrategyPrompt,
  buildReplyBrief,
  ReplyBrief,
  ReplyBriefService,
} from './reply-brief.service';
import { buildReplyBubblePlanPrompt } from './reply-bubble-plan';
import {
  REPLY_OUTPUT_CONTRACT_VERSION,
  buildReplyOutputContractPrompt,
  resolveReplyOutputSegmentMode,
} from './reply-output-contract';
import {
  REPLY_BOUNDARY_CONTRACT_VERSION,
  buildReplyBoundaryContract,
} from './reply-boundary-contract';
import { buildReplyLengthPlanPrompt } from './reply-length-plan';
import { buildReplyExperiencePlanPrompt } from './reply-experience-plan';
import { buildReplyCareMotivationPrompt } from './reply-care-motivation';
import type { DreamCompanionPlan } from './dream-companion-plan';
import { buildReplyStateProtocolPrompt } from './reply-state-protocol';
import { describeReplyRealityDependency } from './reply-reality-dependency';
import { buildReplyStrategyQualityPrompt } from './reply-strategy-quality';
import { buildDirectActiveContributionPrompt } from './direct-active-contribution';
import { buildReplyCommActPrompt, COMM_ACT_VERSION } from './reply-comm-act';
import {
  buildConversationTurnPlanPrompt,
  resolveConversationTurnPlan,
} from './conversation-turn-plan';
import { ReplySceneRoute, routeReplyScene } from './reply-scene-router';
import { getSharedFamilyMemberNameFromFactKey } from './shared-family-member';
import {
  AGENT_EVIDENCE_VERSION,
  AgentEvidenceAssertionPolicy,
  AgentEvidenceItem,
  resolveAgentEvidenceUseMode,
  selectAgentEvidence,
} from './agent-evidence';
import {
  buildEvidencePackFallback,
  EVIDENCE_PACK_VERSION,
  EvidencePack,
  EvidenceResolverService,
} from './evidence-resolver.service';
import {
  buildAgentChatModePrompt,
  resolveAgentChatModePolicy,
} from './agent-chat-mode';
import type { AgentMemoryControlResult } from './agent-memory-control';
import {
  AgentPersonaPromptResult,
  buildAgentPersonaPrompt,
  hasUsableAgentPersonaProfile,
} from './agent-persona';
import {
  AGENT_CHAT_TOOL_VERSION,
  AgentChatToolConfig,
  AgentChatToolTurnPlan,
  buildAgentChatToolDecisionSchema,
  buildAgentChatToolPrompt,
  resolveAgentChatToolTurnPlan,
} from './agent-chat-tools';
import {
  REPLY_PROMPT_LAYER_VERSION,
  ReplyPromptLayerConfig,
  ReplyPromptLayerPlan,
  resolveReplyPromptLayerPlan,
} from './reply-prompt-layer';
import {
  REPLY_PROMPT_COMPILER_VERSION,
  ReplyPromptCompilerService,
} from './reply-prompt-compiler.service';
import {
  buildTurnDecision,
  buildTurnDecisionPrompt,
  TURN_DECISION_VERSION,
  TurnDecision,
} from './turn-decision';
import { buildAfterlifeWorldPrompt } from './afterlife-world-framework';
import { buildWorldBoundaryPolicyPrompt } from './world-boundary-policy';
import { buildConversationProtectionStatePrompt } from './conversation-protection-state';
import { buildRelationalSceneFrameworkPrompt } from './relational-scene-framework';
import {
  buildReplyTurnContract,
  REPLY_TURN_CONTRACT_VERSION,
  ReplyTurnContract,
} from './reply-turn-contract';

export interface BuildConversationContextOptions {
  auth: AuthenticatedUserPayload;
  conversation: ConversationEntity;
  agent: AgentEntity | null;
  currentQuery?: string;
  currentTurnMessageIds?: string[];
  forceSemanticPlanning?: boolean;
  classifyIntent?: boolean;
  memoryControlResult?: AgentMemoryControlResult;
  effectiveChatModel?: string;
}

export interface AgentContextLayer {
  key: 'persona' | 'history' | 'longTermHistory';
  messages: ChatCompletionMessageParam[];
  promptLayer?: {
    plan: ReplyPromptLayerPlan;
    compilerVersion: typeof REPLY_PROMPT_COMPILER_VERSION;
    stablePromptCharacters: number;
    taskPromptCharacters: number;
  };
}

export interface AgentConversationContext {
  layers: AgentContextLayer[];
  messages: ChatCompletionMessageParam[];
  evidence: AgentEvidenceItem[];
  evidencePack: EvidencePack;
  diagnostics: AgentContextDiagnostics;
  replyIntent?: StructuredReplyIntent;
  replyRoute: ReplySceneRoute;
  replyBrief: ReplyBrief;
  turnDecision: TurnDecision;
  turnContract?: ReplyTurnContract;
  chatToolPlan: AgentChatToolTurnPlan;
}

export interface AgentContextDiagnostics {
  promptVersion: 'agent_chat_v11';
  promptCompilerVersion: typeof REPLY_PROMPT_COMPILER_VERSION;
  promptLayerVersion?: typeof REPLY_PROMPT_LAYER_VERSION;
  promptLayerMode?: ReplyPromptLayerPlan['layerMode'];
  promptReductionActive?: boolean;
  promptComplexTurn?: boolean;
  promptL5Injected?: boolean;
  promptL5TraceOnly?: boolean;
  stablePromptCharacters?: number;
  mainTaskPromptCharacters?: number;
  outputContractVersion: typeof REPLY_OUTPUT_CONTRACT_VERSION;
  boundaryContractVersion: typeof REPLY_BOUNDARY_CONTRACT_VERSION;
  dynamicBoundaryCount: number;
  toolInstructionMode: 'orchestrated_none' | 'shadow_decision' | 'model_tools';
  chatToolVersion: typeof AGENT_CHAT_TOOL_VERSION;
  chatToolMode: AgentChatToolTurnPlan['mode'];
  chatToolEligible: boolean;
  chatToolSampled: boolean;
  chatToolAvailableTools: string[];
  chatToolPlannerMemoryRequested: boolean;
  chatToolPlannerRetrievalBypassed: boolean;
  identityVersion: AgentIdentityContract['version'];
  identityRelationship: string;
  identitySource: AgentIdentityContract['relationship']['source'];
  knownObjectCount: number;
  objectReferenceCount: number;
  resolvedObjectReferenceCount: number;
  ambiguousObjectMentionCount: number;
  evidenceVersion: typeof AGENT_EVIDENCE_VERSION;
  evidencePackVersion: typeof EVIDENCE_PACK_VERSION;
  evidenceCount: number;
  assertEvidenceCount: number;
  uptakeEvidenceCount: number;
  recallEvidenceCount: number;
  hypothesisEvidenceCount: number;
  objectScopedEvidenceCount: number;
  systemPromptCharacters: number;
  replyLengthClass: ReplyBrief['lengthPlan']['lengthClass'];
  replyTargetCharacters: number;
  replyReviewCharacters: number;
  historyMessageCount: number;
  relevantMemoryCount: number;
  relevantHardFactKeys: string[];
  conversationReadingAnchorCount: number;
  memoryPlan?: ConversationMemoryPlan;
  memoryPlanHadQueries?: boolean;
  memoryPlanContextCoverage?: string;
  memoryPlanQueriesCount?: number;
  memorySearchResultCount?: number;
  memoryCandidateCount: number;
  memoryCandidateKeys: string[];
  memoryModelSelectedCandidateKeys: string[];
  memorySelectedCandidateKeys: string[];
  memoryCoverageFallbackApplied: boolean;
  memoryRetrievalMode: MemoryRetrievalMode;
  memoryRetrievalRequestCount: number;
  memoryRetrievalConceptCount: number;
  memoryRetrievedEvidenceCount: number;
  replyPlanningMode: ReplyPlanningMode;
  replyPlanningReason: ReplyPlanningDecision['reason'];
  replyPlanningStatus: ReplyIntentClassificationResult['status'];
  replyPlanningLatencyMs: number;
  replyPlanningFallbackUsed: boolean;
  replyIntentModelCallCount: number;
  turnDecisionVersion: typeof TURN_DECISION_VERSION;
  turnContractVersion?: typeof REPLY_TURN_CONTRACT_VERSION;
  turnContractFocusDimensions?: string[];
  strategyVersion: 'conversation_strategy_v8';
  turnPlanVersion: 'turn_plan_v1';
  commActVersion: typeof COMM_ACT_VERSION;
  commActState: string;
  commActSteps: string[];
  turnPlanOpenPointCount: number;
  turnPlanOpenNeeds: string[];
  turnPlanAvoid?: string;
  strategySource:
    | 'semantic_plan'
    | 'deterministic_light'
    | 'short_turn_injection'
    | 'direct_brief';
  participationStrategy?: ReplyBrief['participationStrategy'];
  conversationStance?: string;
  conversationStanceTarget?: string;
  conversationMoves: string[];
  conversationMoveGoals: string[];
  socialStrategy?: string;
  strategyPurpose?: string;
  questionNeed?: string;
  conversationTurnClosure: string;
  userConversationState?: string;
  openLoop?: string;
  continuationGoal?: string;
  assistantContribution?: string;
  mustContribute?: string;
  avoidRepeatingMove?: string;
  closureReadiness?: string;
  personaActivations: string[];
  personaSource: AgentPersonaPromptResult['source'];
  personaEvidenceSnippetCount: number;
  realityDependencyKinds: string[];
  correctionFactMode?: string;
  activeContributionSource?: string;
  strategyRepeatedMoves: string[];
  strategyAlternative?: string;
  careMotive?: string;
  careFocus?: string;
  careStyleSource?: string;
  dreamCompanionPlan?: DreamCompanionPlan;
  stateProtocolPlan?: ReplyBrief['stateProtocol'];
  experiencePlanVersion: string;
  profileTier: ReplyBrief['experiencePlan']['profileTier'];
  relationshipStage: ReplyBrief['experiencePlan']['relationshipStage'];
  conversationDepth: ReplyBrief['experiencePlan']['conversationDepth'];
  guardrailFocuses: string[];
  afterlifeWorldVersion?: string;
  afterlifeWorldDomains: string[];
  afterlifeReceivableItems: string[];
  relationalSceneFrameworkVersion?: string;
  relationalSceneKinds: string[];
  directActiveContributionMode?: string;
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

type MemoryRetrievalMode =
  | 'memory_plan'
  | 'legacy_query'
  | 'direct_query'
  | 'suppressed'
  | 'tool_takeover';

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

  @Inject()
  evidenceResolverService: EvidenceResolverService;

  @Inject()
  replyPromptCompilerService: ReplyPromptCompilerService;

  @Inject()
  chatTraceService: ChatTraceService;

  @Config('chatTools')
  chatToolConfig: AgentChatToolConfig;

  @Config('chatProgramReduction')
  chatProgramReductionConfig: ReplyPromptLayerConfig;

  async buildConversationContext(
    options: BuildConversationContextOptions
  ): Promise<AgentConversationContext> {
    const conversationMessages = await this.withTraceSpan(
      ChatTraceStage.contextLoad,
      'context.messages',
      () => this.listConversationMessages(options.conversation)
    );
    const currentTurnMessages = this.selectCurrentTurnMessages(
      conversationMessages,
      options.currentTurnMessageIds
    );
    const historicalConversationMessages =
      this.excludeCurrentTurnMessagesFromHistory(
        conversationMessages,
        options.currentTurnMessageIds
      );
    const routingHistoryMessages = this.buildRecentHistoryMessages(
      historicalConversationMessages
    );
    const profileFacts = await this.withTraceSpan(
      ChatTraceStage.contextLoad,
      'context.profile_facts',
      () => this.listProfileFacts(options)
    );
    const identity = buildAgentIdentityContract({ agent: options.agent });
    const knownObjects = buildKnownConversationObjects({
      identity,
      profileFacts,
    });
    const persona = buildAgentPersonaPrompt({
      agent: options.agent,
      identityContract: identity,
    });
    const knownFamilyMembers = (profileFacts || [])
      .map(fact => getSharedFamilyMemberNameFromFactKey(fact.key))
      .filter((name): name is string => Boolean(name));
    const hardFactsPromise = this.withTraceSpan(
      ChatTraceStage.contextLoad,
      'context.memory_facts',
      () => this.listHardFacts(options)
    );
    const emotionStatePromise = this.withTraceSpan(
      ChatTraceStage.contextLoad,
      'context.emotion_state',
      () => this.getCurrentEmotionState(options)
    );
    const relationshipSignalsPromise = this.withTraceSpan(
      ChatTraceStage.contextLoad,
      'context.relationship_signals',
      () => this.listRelationshipSignals(options)
    );
    const hardFacts = await hardFactsPromise;
    const memoryCandidates = this.buildMemoryPlanCandidates(
      [...(profileFacts || []), ...(hardFacts || [])],
      options.currentQuery || '',
      routingHistoryMessages
    );
    const classifierOptions = {
      currentQuery: options.currentQuery || '',
      recentMessages: routingHistoryMessages,
      knownFamilyMembers,
      knownObjects,
      memoryCandidates,
      agentPersonaContext: persona.classifierContext,
      forceSemanticPlanning: options.forceSemanticPlanning,
    };
    const replyPlanningDecision = this.getReplyPlanningDecision(
      classifierOptions,
      options.classifyIntent !== false
    );
    const [emotionState, replyIntentClassification, storedRelationshipSignals] =
      await Promise.all([
        emotionStatePromise,
        this.withTraceSpan(
          ChatTraceStage.plan,
          'plan.reply_intent',
          () =>
            this.classifyReplyIntentWithDiagnostics(
              classifierOptions,
              options.classifyIntent !== false,
              replyPlanningDecision
            ),
          { planningMode: replyPlanningDecision.mode }
        ),
        relationshipSignalsPromise,
      ]);
    const classifiedReplyIntent = replyIntentClassification.intent;
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
    const suppressMemoryForCorrection = replyIntent?.intents.some(
      item => item.intent === 'correct_assistant'
    );
    const memoryRetrieval: MemoryRetrievalDecision = suppressMemoryForCorrection
      ? { mode: 'suppressed', conceptCount: 0 }
      : this.resolveMemoryRetrievalDecision(
          options.currentQuery || '',
          replyIntent?.memoryPlan,
          replyPlanningDecision.mode
        );
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
    const chatToolStableKey = [
      options.auth.sub,
      this.stringifyObjectId(options.conversation.id),
      ...(options.currentTurnMessageIds || []),
      options.currentQuery || '',
    ].join(':');
    const baseReplyBriefOptions = {
      currentQuery: options.currentQuery || '',
      planningMode: replyPlanningDecision.mode,
      agent: options.agent,
      profileFacts,
      conversationMessages: historicalConversationMessages,
      intent: replyRoute.intent ?? replyIntent,
      route: replyRoute,
      confirmedFacts: [
        ...(profileFacts || []).filter(fact => fact.confidence !== 'extracted'),
        ...(hardFacts || []),
      ]
        .map(fact => fact.value?.trim())
        .filter((value): value is string => Boolean(value)),
      recentMessages: routingHistoryMessages,
      knownObjects,
      relationshipSignals,
    };
    const preflightChatToolPlan = resolveAgentChatToolTurnPlan({
      config: this.chatToolConfig,
      stableKey: chatToolStableKey,
      currentQuery: options.currentQuery || '',
      replyBrief: buildReplyBrief(baseReplyBriefOptions),
      planningMode: replyPlanningDecision.mode,
      planningReason: replyPlanningDecision.reason,
      plannerMemoryRequested: Boolean(memoryRetrieval.query),
    });
    const plannerRetrievalBypassed =
      preflightChatToolPlan.mode === 'active' && Boolean(memoryRetrieval.query);
    const effectiveMemoryRetrievalMode: MemoryRetrievalMode =
      plannerRetrievalBypassed ? 'tool_takeover' : memoryRetrieval.mode;
    const retrievedMemories =
      memoryRetrieval.query && !plannerRetrievalBypassed
        ? await this.withTraceSpan(
            ChatTraceStage.memoryRetrieve,
            'memory.retrieve_long_term',
            () =>
              this.retrieveLongTermHistory(
                options,
                this.resolveLongTermHistoryCutoff(routingHistoryMessages),
                memoryRetrieval.query!
              ),
            {
              retrievalMode: effectiveMemoryRetrievalMode,
              conceptCount: memoryRetrieval.conceptCount,
            }
          )
        : [];
    if (!memoryRetrieval.query || plannerRetrievalBypassed) {
      this.chatTraceService?.recordCompletedSpan({
        stage: ChatTraceStage.memoryRetrieve,
        operation: 'memory.retrieve_long_term',
        startedAt: new Date(),
        status: ChatSpanStatus.skipped,
        attributes: {
          retrievalMode: effectiveMemoryRetrievalMode,
          conceptCount: memoryRetrieval.conceptCount,
          plannerRetrievalBypassed,
        },
      });
    }
    const replyBriefOptions = {
      ...baseReplyBriefOptions,
      retrievedMemories,
    };
    const replyBrief = await this.withTraceSpan(
      ChatTraceStage.plan,
      'plan.reply_brief',
      () =>
        this.replyBriefService
          ? this.replyBriefService.build(replyBriefOptions)
          : buildReplyBrief(replyBriefOptions)
    );
    const turnDecision = buildTurnDecision({
      brief: replyBrief,
      planningMode: replyPlanningDecision.mode,
      planningStatus: replyIntentClassification.status,
      currentQuery: options.currentQuery,
    });
    const chatToolPlan =
      preflightChatToolPlan.mode === 'active'
        ? preflightChatToolPlan
        : resolveAgentChatToolTurnPlan({
            config: this.chatToolConfig,
            stableKey: chatToolStableKey,
            currentQuery: options.currentQuery || '',
            replyBrief,
            planningMode: replyPlanningDecision.mode,
            planningReason: replyPlanningDecision.reason,
            plannerMemoryRequested: Boolean(memoryRetrieval.query),
          });
    const toolInstructionMode = this.resolveToolInstructionMode(chatToolPlan);
    const modePolicy = resolveAgentChatModePolicy(replyBrief);
    const recentHistoryMessages = this.buildRecentHistoryMessages(
      historicalConversationMessages,
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
    // 即使用户消息在 direct 模式下跳过了记忆规划器，
    // 只要消息中出现了已知家庭成员的名称，立刻把该成员的全部已确认事实注入上下文
    const mentionedMemberFactKeys = this.pinMentionedFamilyMemberFacts(
      profileFacts,
      knownFamilyMembers,
      options.currentQuery || ''
    );
    const messengerProfileFactKeys = this.pinMessengerProfileFacts(
      profileFacts,
      options.currentQuery || ''
    );
    const effectiveSelectedFactKeys = Array.from(
      new Set([
        ...selectedFactKeys,
        ...mentionedMemberFactKeys,
        ...messengerProfileFactKeys,
      ])
    );
    const relevantProfileFacts = this.selectRelevantFacts(
      profileFacts,
      relevanceText,
      Math.max(
        selectedProfileFactCount || modePolicy.profileFactLimit,
        mentionedMemberFactKeys.length + messengerProfileFactKeys.length
      ),
      factRetrievalPaths,
      effectiveSelectedFactKeys
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
    const evidenceCandidates = this.buildEvidencePack({
      currentQuery: options.currentQuery || '',
      recentMessages: replyBrief.correctionPolicy ? [] : recentHistoryMessages,
      agent: options.agent,
      memoryControlResult: options.memoryControlResult,
      profileFacts: replyBrief.correctionPolicy ? [] : relevantProfileFacts,
      hardFacts: replyBrief.correctionPolicy ? [] : relevantHardFacts,
      retrievedMemories: replyBrief.correctionPolicy
        ? []
        : relevantRetrievedMemories,
      suppressPriorFacts: Boolean(replyBrief.correctionPolicy),
      currentUserCanAssert: Boolean(replyBrief.correctionPolicy),
      objectPlan: replyBrief.objectPlan,
    });
    const evidencePack = this.evidenceResolverService
      ? this.evidenceResolverService.resolve({
          candidates: evidenceCandidates,
          currentQuery: options.currentQuery || '',
          turnDecision,
          suppressPriorFacts: Boolean(replyBrief.correctionPolicy),
          correctionMode: replyBrief.correctionPolicy?.mode,
        })
      : buildEvidencePackFallback({
          candidates: evidenceCandidates,
          currentQuery: options.currentQuery || '',
          turnDecision,
          suppressPriorFacts: Boolean(replyBrief.correctionPolicy),
          correctionMode: replyBrief.correctionPolicy?.mode,
        });
    const evidence = evidencePack.items;
    const boundaryContract = this.compileReplyBoundaryContract(replyBrief);
    const turnContract = buildReplyTurnContract({
      brief: replyBrief,
      turnDecision,
      persona,
      evidencePack,
      boundaryContract,
    });
    const systemLayer = await this.withTraceSpan(
      ChatTraceStage.promptBuild,
      'prompt.build_layers',
      () =>
        this.buildSystemLayer(
          options,
          evidence,
          emotionState,
          replyRoute,
          replyBrief,
          persona,
          identity,
          chatToolPlan,
          replyPlanningDecision.mode,
          turnDecision,
          turnContract
        ),
      {
        evidenceCount: evidence.length,
        evidenceVersion: AGENT_EVIDENCE_VERSION,
        outputContractVersion: REPLY_OUTPUT_CONTRACT_VERSION,
        boundaryContractVersion: boundaryContract.version,
        dynamicBoundaryCount: boundaryContract.rules.length,
        toolInstructionMode,
        chatToolVersion: chatToolPlan.version,
        chatToolMode: chatToolPlan.mode,
        chatToolEligible: chatToolPlan.eligible,
        chatToolSampled: chatToolPlan.sampled,
        chatToolCount: chatToolPlan.availableTools.length,
        chatToolPlannerMemoryRequested: chatToolPlan.plannerMemoryRequested,
        chatToolPlannerRetrievalBypassed: plannerRetrievalBypassed,
        assertEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'assert'
        ).length,
        uptakeEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'uptake'
        ).length,
        recallEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'recall'
        ).length,
        hypothesisEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'hypothesis'
        ).length,
        objectScopedEvidenceCount: evidence.filter(item =>
          Boolean(item.subjectRef && item.subjectRef !== 'mixed')
        ).length,
        historyCount: recentHistoryMessages.length,
      }
    );
    const historyLayer = this.buildHistoryLayer(
      recentHistoryMessages,
      identity
    );
    this.appendCurrentTurnToHistory(historyLayer, options, currentTurnMessages);
    const layers = [systemLayer, historyLayer];
    const systemPromptContent = systemLayer.messages[0]?.content;
    const resolvedTurnPlan = resolveConversationTurnPlan({
      engagement: replyBrief.conversationPlan?.engagement,
      turnPlan: replyBrief.conversationPlan?.turnPlan,
    });
    return {
      layers,
      messages: layers.reduce<ChatCompletionMessageParam[]>(
        (result, layer) => result.concat(layer.messages),
        []
      ),
      evidence,
      evidencePack,
      diagnostics: {
        promptVersion: 'agent_chat_v11',
        promptCompilerVersion: REPLY_PROMPT_COMPILER_VERSION,
        promptLayerVersion: REPLY_PROMPT_LAYER_VERSION,
        promptLayerMode: systemLayer.promptLayer?.plan.layerMode,
        promptReductionActive: systemLayer.promptLayer?.plan.reductionActive,
        promptComplexTurn: systemLayer.promptLayer?.plan.complex,
        promptL5Injected: systemLayer.promptLayer?.plan.includeL5,
        promptL5TraceOnly: systemLayer.promptLayer?.plan.l5TraceOnly,
        stablePromptCharacters: systemLayer.promptLayer?.stablePromptCharacters,
        mainTaskPromptCharacters: systemLayer.promptLayer?.taskPromptCharacters,
        outputContractVersion: REPLY_OUTPUT_CONTRACT_VERSION,
        boundaryContractVersion: boundaryContract.version,
        dynamicBoundaryCount: boundaryContract.rules.length,
        toolInstructionMode,
        chatToolVersion: chatToolPlan.version,
        chatToolMode: chatToolPlan.mode,
        chatToolEligible: chatToolPlan.eligible,
        chatToolSampled: chatToolPlan.sampled,
        chatToolAvailableTools: chatToolPlan.availableTools,
        chatToolPlannerMemoryRequested: chatToolPlan.plannerMemoryRequested,
        chatToolPlannerRetrievalBypassed: plannerRetrievalBypassed,
        identityVersion: identity.version,
        identityRelationship: identity.relationship.label,
        identitySource: identity.relationship.source,
        knownObjectCount: knownObjects.length,
        objectReferenceCount: replyBrief.objectPlan?.objects.length || 0,
        resolvedObjectReferenceCount:
          replyBrief.objectPlan?.objects.filter(
            object => object.binding !== 'unknown'
          ).length || 0,
        ambiguousObjectMentionCount:
          replyBrief.objectPlan?.ambiguousMentions.length || 0,
        evidenceVersion: AGENT_EVIDENCE_VERSION,
        evidencePackVersion: EVIDENCE_PACK_VERSION,
        evidenceCount: evidence.length,
        assertEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'assert'
        ).length,
        uptakeEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'uptake'
        ).length,
        recallEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'recall'
        ).length,
        hypothesisEvidenceCount: evidence.filter(
          item => resolveAgentEvidenceUseMode(item) === 'hypothesis'
        ).length,
        objectScopedEvidenceCount: evidence.filter(item =>
          Boolean(item.subjectRef && item.subjectRef !== 'mixed')
        ).length,
        systemPromptCharacters:
          typeof systemPromptContent === 'string'
            ? systemPromptContent.length
            : 0,
        replyLengthClass: replyBrief.lengthPlan.lengthClass,
        replyTargetCharacters: replyBrief.lengthPlan.targetCharacters,
        replyReviewCharacters: replyBrief.lengthPlan.reviewCharacters,
        historyMessageCount: historyLayer.messages.length,
        relevantMemoryCount: replyBrief.correctionPolicy
          ? 0
          : relevantProfileFacts.length +
            relevantHardFacts.length +
            relevantRetrievedMemories.length,
        relevantHardFactKeys: replyBrief.correctionPolicy
          ? []
          : relevantHardFacts.map(fact => fact.key),
        conversationReadingAnchorCount: replyBrief.reading?.anchors.length ?? 0,
        memoryPlan: replyIntent?.memoryPlan,
        // memoryPlan 依赖度埋点（用于判断是否可以移除 memoryPlan 字段）
        memoryPlanHadQueries:
          replyIntent?.memoryPlan?.contextCoverage === 'missing' &&
          (replyIntent?.memoryPlan?.queries?.length || 0) > 0,
        memoryPlanContextCoverage: replyIntent?.memoryPlan?.contextCoverage,
        memoryPlanQueriesCount: replyIntent?.memoryPlan?.queries?.length || 0,
        memorySearchResultCount: retrievedMemories.length,
        memoryCandidateCount: memoryCandidates.length,
        memoryCandidateKeys: memoryCandidates.map(candidate => candidate.key),
        memoryModelSelectedCandidateKeys: modelSelectedCandidateKeys,
        memorySelectedCandidateKeys: selectedFactKeys,
        memoryCoverageFallbackApplied,
        memoryRetrievalMode: effectiveMemoryRetrievalMode,
        memoryRetrievalRequestCount:
          memoryRetrieval.query && !plannerRetrievalBypassed ? 1 : 0,
        memoryRetrievalConceptCount: memoryRetrieval.conceptCount,
        memoryRetrievedEvidenceCount: evidence.filter(item =>
          ['confirmed_fact', 'retrieved_user'].includes(item.source)
        ).length,
        replyPlanningMode: replyPlanningDecision.mode,
        replyPlanningReason: replyPlanningDecision.reason,
        replyPlanningStatus: replyIntentClassification.status,
        replyPlanningLatencyMs: replyIntentClassification.latencyMs,
        replyPlanningFallbackUsed: replyIntentClassification.fallbackUsed,
        replyIntentModelCallCount: replyIntentClassification.modelCallCount,
        turnDecisionVersion: TURN_DECISION_VERSION,
        turnContractVersion: turnContract.version,
        turnContractFocusDimensions: turnContract.focusDimensions,
        strategyVersion: 'conversation_strategy_v8',
        turnPlanVersion: 'turn_plan_v1',
        commActVersion: replyBrief.commAct?.version ?? COMM_ACT_VERSION,
        commActState: replyBrief.commAct?.state ?? 'opening',
        commActSteps:
          replyBrief.commAct?.steps.map(step => `${step.layer}.${step.act}`) ??
          [],
        turnPlanOpenPointCount: resolvedTurnPlan?.open.length || 0,
        turnPlanOpenNeeds: resolvedTurnPlan?.open.map(item => item.need) || [],
        turnPlanAvoid: resolvedTurnPlan?.avoid,
        strategySource: replyBrief.conversationPlan
          ? replyPlanningDecision.mode === 'direct'
            ? 'deterministic_light'
            : 'semantic_plan'
          : replyBrief.participationStrategy
          ? 'short_turn_injection'
          : 'direct_brief',
        participationStrategy: replyBrief.participationStrategy,
        conversationStance: replyBrief.conversationPlan?.stance,
        conversationStanceTarget: replyBrief.conversationPlan?.stanceTarget,
        conversationMoves:
          replyBrief.conversationPlan?.moves.map(move => move.type) || [],
        conversationMoveGoals:
          replyBrief.conversationPlan?.moves.map(move => move.goal) ||
          replyBrief.replyMoves,
        socialStrategy: replyBrief.conversationPlan?.socialStrategy,
        strategyPurpose: replyBrief.conversationPlan?.strategyPurpose,
        questionNeed: replyBrief.conversationPlan?.questionNeed,
        conversationTurnClosure:
          replyBrief.conversationPlan?.turnClosure ||
          replyBrief.bubblePlan.turnClosure,
        userConversationState:
          replyBrief.conversationPlan?.engagement?.userConversationState,
        openLoop: replyBrief.conversationPlan?.engagement?.openLoop,
        continuationGoal:
          replyBrief.conversationPlan?.engagement?.continuationGoal,
        assistantContribution:
          replyBrief.conversationPlan?.engagement?.assistantContribution ||
          (replyBrief.directActiveContribution
            ? `direct_optional_planned:${replyBrief.directActiveContribution.optionalContribution}`
            : undefined),
        mustContribute:
          replyBrief.conversationPlan?.engagement?.mustContribute ||
          replyBrief.directActiveContribution?.turnGoal,
        avoidRepeatingMove:
          replyBrief.conversationPlan?.engagement?.avoidRepeatingMove,
        closureReadiness:
          replyBrief.conversationPlan?.engagement?.closureReadiness,
        personaActivations:
          replyBrief.conversationPlan?.personaActivation || [],
        personaSource: persona.source,
        personaEvidenceSnippetCount: persona.evidenceSnippetCount,
        realityDependencyKinds: replyBrief.realityDependencies.map(
          item => item.kind
        ),
        correctionFactMode: replyBrief.correctionPolicy?.mode,
        activeContributionSource:
          replyBrief.activeContribution?.preferredSource ||
          replyBrief.directActiveContribution?.optionalContribution,
        strategyRepeatedMoves: replyBrief.strategyQuality?.repeatedMoves || [],
        strategyAlternative: replyBrief.strategyQuality?.preferredAlternative,
        careMotive: replyBrief.careMotivation?.motive,
        careFocus: replyBrief.careMotivation?.focus,
        careStyleSource: replyBrief.careMotivation?.styleSource,
        dreamCompanionPlan: replyBrief.dreamCompanionPlan,
        stateProtocolPlan: replyBrief.stateProtocol,
        experiencePlanVersion: replyBrief.experiencePlan.version,
        profileTier: replyBrief.experiencePlan.profileTier,
        relationshipStage: replyBrief.experiencePlan.relationshipStage,
        conversationDepth: replyBrief.experiencePlan.conversationDepth,
        guardrailFocuses: replyBrief.guardrailFocuses,
        afterlifeWorldVersion: replyBrief.afterlifeWorld?.version,
        afterlifeWorldDomains: replyBrief.afterlifeWorld?.domains || [],
        afterlifeReceivableItems:
          replyBrief.afterlifeWorld?.receivableItems || [],
        relationalSceneFrameworkVersion: replyBrief.sceneFramework?.version,
        relationalSceneKinds:
          replyBrief.sceneFramework?.cards.map(card => card.kind) || [],
        directActiveContributionMode: replyBrief.directActiveContribution?.mode,
      },
      replyIntent: replyRoute.intent,
      replyRoute,
      replyBrief,
      turnDecision,
      turnContract,
      chatToolPlan,
    };
  }

  private withTraceSpan<T>(
    stage: ChatTraceStage,
    operation: string,
    task: () => Promise<T> | T,
    attributes?: Record<string, ChatSpanAttributeValue | undefined>
  ): Promise<T> {
    if (!this.chatTraceService) {
      return Promise.resolve(task());
    }

    return this.chatTraceService.withSpan(stage, operation, () => task(), {
      attributes,
    });
  }

  private buildSystemLayer(
    options: BuildConversationContextOptions,
    evidence: AgentEvidenceItem[],
    emotionState?: ConversationEmotionStateSummary | null,
    replyRoute?: ReplySceneRoute,
    replyBrief?: ReplyBrief,
    persona?: AgentPersonaPromptResult,
    identity?: AgentIdentityContract,
    chatToolPlan?: AgentChatToolTurnPlan,
    planningMode?: ReplyPlanningMode,
    turnDecision?: TurnDecision,
    turnContract?: ReplyTurnContract
  ): AgentContextLayer {
    const plan = resolveReplyPromptLayerPlan({
      config: this.chatProgramReductionConfig,
      planningMode: planningMode || 'direct',
      replyBrief,
      chatToolPlan,
      hasContinuitySummary: Boolean(
        options.conversation.continuitySummary?.trim()
      ),
    });
    const companionCorePrompt = buildDepartedCompanionCorePrompt();
    const basePrompt = buildDepartedSystemPrompt({
      userId: options.auth.sub,
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      agent: options.agent,
      identityContract: identity,
    });
    const perceptionPrompt = this.buildPerceptionPrompt(
      evidence,
      emotionState,
      replyBrief,
      options.agent
    );
    const modePrompt = buildAgentChatModePrompt(replyBrief, replyRoute);
    const continuitySummaryPrompt = this.buildContinuitySummaryPrompt(
      options.conversation
    );
    const sessionContinuityPrompt =
      this.buildSessionContinuityPromptFromConversation(
        options.conversation,
        options.agent
      );
    const doubaoAdaptation = options.effectiveChatModel?.includes('doubao')
      ? '\n像微信聊天一样自然说话，短句口语。不用呀、啦、哟、呢等轻飘语气词。情感沉重时不收束为乐观结尾。不声称在现实世界看护、盯着、守着用户。情感表达要有温度，不因简短而空洞。'
      : '';

    const stableParts = [
      '# 稳定系统层',
      companionCorePrompt,
      basePrompt + doubaoAdaptation,
      perceptionPrompt,
      persona?.prompt,
      plan.includeMode ? modePrompt : '',
      plan.includeContinuity ? continuitySummaryPrompt : '',
      sessionContinuityPrompt,
    ];

    const conversationReadingPrompt =
      plan.includeReading ||
      this.isConsecutiveInputQuery(options.currentQuery || '')
        ? this.buildConversationReadingPrompt(replyBrief, options.currentQuery)
        : '';
    const evidencePrompt = plan.includeEvidence
      ? this.buildEvidencePrompt(evidence)
      : '';
    const lightweightDirectContext =
      plan.planningMode === 'direct' &&
      replyBrief &&
      !replyBrief.conversationPlan
        ? this.buildLightweightDirectContext(replyBrief, options.agent)
        : '';
    const replyBriefPrompt = this.buildModelReplyBriefPrompt(
      replyBrief,
      plan.includeTools ? chatToolPlan : undefined,
      planningMode,
      plan.includeL5
    );
    const taskParts = [
      '# 本轮任务层',
      turnContract?.prompt ||
        (turnDecision ? buildTurnDecisionPrompt(turnDecision) : ''),
      conversationReadingPrompt,
      evidencePrompt,
      lightweightDirectContext,
      replyBriefPrompt,
    ];
    const compiled = this.replyPromptCompilerService
      ? this.replyPromptCompilerService.compile({
          stableParts,
          taskParts,
          includeTask: plan.includeTask,
        })
      : new ReplyPromptCompilerService().compile({
          stableParts,
          taskParts,
          includeTask: plan.includeTask,
        });

    return {
      key: 'persona',
      messages: [
        {
          role: 'system',
          content: compiled.content,
        } as ChatCompletionMessageParam,
      ],
      promptLayer: {
        plan,
        compilerVersion: compiled.version,
        stablePromptCharacters: compiled.stableCharacters,
        taskPromptCharacters: compiled.taskCharacters,
      },
    };
  }

  private buildLightweightDirectContext(
    replyBrief: ReplyBrief,
    agent: AgentEntity
  ): string {
    if (
      !replyBrief.primaryScene &&
      !replyBrief.relationshipContext?.length &&
      !replyBrief.evidence?.length
    ) {
      return '';
    }

    const lines: string[] = [];
    if (replyBrief.primaryScene) {
      lines.push('# 场景：' + replyBrief.primaryScene);
    }
    if (replyBrief.relationshipContext?.length) {
      const rc = replyBrief.relationshipContext[0];
      if (rc.text) lines.push('关系参考：' + rc.text);
    }
    lines.push(
      '如果上一轮AI留下了未答的问题（比如"你呢？""吃了没？"），用户本轮没接，就不再追问，让它自然过去。'
    );

    // 确定性注入已确认记忆（最多3条，仅 confirmed_fact 和 retrieved_user）
    // 如果记忆与用户当前表达明显不匹配，宁可不用
    const memoryEvidence = (replyBrief.evidence || [])
      .filter(
        item =>
          item.source === 'confirmed_fact' || item.source === 'retrieved_user'
      )
      .slice(0, 3);

    if (memoryEvidence.length) {
      lines.push('# 已知事实');
      memoryEvidence.forEach((item, i) => {
        lines.push(i + 1 + '. ' + item.text);
      });
    }

    // Subtext hint for daily/family updates
    if (
      replyBrief.primaryScene &&
      ['daily_update', 'family_life'].includes(replyBrief.primaryScene)
    ) {
      lines.push(
        '注意：用户可能在报告生活变化时隐藏着失落、漂泊或思念。不只回应表面信息，也听见没说出口的情绪。'
      );
    }

    return lines.join('\n');
  }

  private buildSessionContinuityPromptFromConversation(
    conversation: ConversationEntity,
    agent?: AgentEntity | null
  ): string {
    void agent;
    return [
      '# 会话连续感',
      '当前回复不是孤立的第一句。结合最近的用户消息、连续性摘要和本轮原话判断未说完的事、关系状态和开放点；不要重复追问用户已经说清的内容。',
      '连续性摘要只用于理解此前聊到哪里，不是事实证据。涉及人物、关系、现实事件和共同记忆时，仍必须由本轮证据包中的可陈述证据支持。',
    ].join('\n');
  }

  private buildConversationReadingPrompt(
    replyBrief?: ReplyBrief,
    currentQuery = ''
  ): string {
    const reading = replyBrief?.reading;
    const consecutiveInputGuidance = this.isConsecutiveInputQuery(currentQuery)
      ? [
          '# 连续输入理解',
          '这些消息属于同一用户轮次。逐条判断延续、补充、修正、否定或转向；后句改变核心意图时，以最新仍有效的核心意图为主，前句只保留仍有效的事实和情绪，不平均逐句作答。',
        ]
      : [];
    const imageInputGuidance = this.buildImageInputGuidance(currentQuery);

    if (!reading) {
      return [
        ...consecutiveInputGuidance,
        ...imageInputGuidance,
        '# 本轮理解原则',
        '以当前用户原话为准，不让路由、历史或通用安慰覆盖本轮事实、否定、纠正和问题。',
      ].join('\n');
    }

    const lines = [
      ...consecutiveInputGuidance,
      ...imageInputGuidance,
      '# 本轮 Conversation Reading',
      `需要：${reading.primaryNeed}`,
      `情绪：${reading.emotionalSource}`,
      `关系：${reading.relationshipSignal}`,
      `立场：${reading.relationshipStance || 'ordinary_response'}`,
      `锚点：${reading.anchors.map(item => `“${item.text}”`).join('、')}`,
    ];

    if (reading.corrections.length) {
      lines.push(`纠正：${reading.corrections.join('；')}`);
    }
    if (reading.negations.length) {
      lines.push(`否定：${reading.negations.join('；')}`);
    }
    if (reading.questionsToAnswer.length) {
      lines.push(`须答：${reading.questionsToAnswer.join('；')}`);
    }
    if (reading.uncertainties.length) {
      lines.push(`未知：${reading.uncertainties.join('；')}`);
    }

    lines.push(
      `语气：${reading.suggestedTone}`,
      '不照抄字段；自然承接一个重要锚点。'
    );

    return lines.join('\n');
  }

  private buildImageInputGuidance(currentQuery = ''): string[] {
    const query = currentQuery.trim();

    if (!this.isImageInputQuery(query)) {
      return [];
    }

    const hasIdentityGuess = /身份推测（非事实）：/.test(query);
    const hasLowConfidenceGuess = /身份推测（非事实）：[^\n]*也许是/.test(
      query
    );
    const hasUserRelationExplanation =
      this.hasImageRelationExplanationInCurrentTurn(query);
    const lines = [
      '# 图片消息策略',
      '把图片当作亲人聊天里的记忆材料，不做普通看图报告；先接住画面里的一个细节、情绪或场景。',
    ];

    if (!hasIdentityGuess) {
      lines.push(
        '没有身份推测时，只问“这是哪位/想让我记住哪一位”一类关系确认，不编身份和共同经历。'
      );
    } else if (hasLowConfidenceGuess && !hasUserRelationExplanation) {
      lines.push(
        '低置信“也许是”只是试探线索；用户本轮没有补充关系说明时，基于照片的回复以试探性确认和提问为主，可轻轻问“这位看着像……是吗/要不要我先这么记”，不要直接把人物关系说定，也不要代入那位人物叙旧。'
      );
    } else if (hasLowConfidenceGuess) {
      lines.push(
        '用户已在同一轮补充关系说明时，以用户说明为准自然承接；仍不要说“识别出/确认是”，也不把低置信视觉推测当成事实来源。'
      );
    } else {
      lines.push(
        '中高置信身份推测也只能作为当前证据自然承接，不说“识别出/确认是”。'
      );
    }

    return lines;
  }

  private isImageInputQuery(value = ''): boolean {
    return /用户发送了一张图片|图片理解：|身份推测（非事实）|可记形象/.test(
      value
    );
  }

  private hasImageRelationExplanationInCurrentTurn(value = ''): boolean {
    if (!this.isConsecutiveInputQuery(value)) {
      return false;
    }

    return this.splitConsecutiveInputItems(value)
      .filter(item => !this.isImageSearchableInput(item))
      .some(item => this.hasImageRelationExplanationText(item));
  }

  private splitConsecutiveInputItems(value: string): string[] {
    const items: string[] = [];
    let current = '';

    value.split('\n').forEach(line => {
      const match = /^(\d+)\.\s*(.*)$/.exec(line);

      if (match) {
        if (current.trim()) {
          items.push(current.trim());
        }
        current = match[2] || '';
        return;
      }

      if (current) {
        current += `\n${line}`;
      }
    });

    if (current.trim()) {
      items.push(current.trim());
    }

    return items;
  }

  private isImageSearchableInput(value = ''): boolean {
    return /^用户发送了一张图片：/.test(value.trim());
  }

  private hasImageRelationExplanationText(value = ''): boolean {
    const text = value.trim();

    if (!text) {
      return false;
    }

    const relation =
      '(?:我|你|自己|本人|爸爸|爸|父亲|妈妈|妈|母亲|爷爷|奶奶|外公|外婆|姥爷|姥姥|祖父|祖母|哥哥|姐姐|弟弟|妹妹|儿子|女儿|孙子|孙女|外孙|外孙女|老公|老婆|丈夫|妻子|爱人|伴侣|叔叔|阿姨|舅舅|姑姑|姨妈|伯伯)';
    const demonstrative = new RegExp(
      `(?:这是|这就是|这个是|这位是|这个人是|照片里(?:的|面)?是|图里(?:的|面)?是|图片里(?:的|面)?是|他是|她是|左边是|右边是|中间是|前面是|后面是|站着的是|坐着的是|抱着的是|穿.+的是).{0,16}${relation}`
    );
    const pastTime = new RegExp(
      `${relation}.{0,10}(?:年轻时候|年轻时|小时候|以前|当年|那时候|老照片)`
    );
    const myFamily =
      /我(?:爸|爸爸|父亲|妈|妈妈|母亲|爷爷|奶奶|外公|外婆|姥爷|姥姥|祖父|祖母|哥哥|姐姐|弟弟|妹妹|儿子|女儿|孙子|孙女|外孙|外孙女|老公|老婆|丈夫|妻子|爱人|伴侣)/;

    return (
      demonstrative.test(text) || pastTime.test(text) || myFamily.test(text)
    );
  }

  private buildModelReplyBriefPrompt(
    replyBrief?: ReplyBrief,
    chatToolPlan?: AgentChatToolTurnPlan,
    planningMode?: ReplyPlanningMode,
    includeL5 = true
  ): string {
    if (!replyBrief) {
      return '';
    }

    const boundaryContract = this.compileReplyBoundaryContract(replyBrief);
    const outputContractPrompt = buildReplyOutputContractPrompt({
      grounded: replyBrief.factClaimMode === 'grounded',
      segmentMode: resolveReplyOutputSegmentMode(replyBrief.bubblePlan),
      maxSegments: replyBrief.bubblePlan.maxSegments,
      preferredRange: replyBrief.lengthPlan.preferredRange,
      evidenceContract: replyBrief.evidenceContract,
      toolDecisionSchema: chatToolPlan
        ? buildAgentChatToolDecisionSchema(chatToolPlan)
        : undefined,
    });
    const chatToolPrompt = chatToolPlan
      ? buildAgentChatToolPrompt(chatToolPlan)
      : '';
    const bubblePlanPrompt = buildReplyBubblePlanPrompt(replyBrief.bubblePlan);
    const lengthPlanPrompt = buildReplyLengthPlanPrompt(replyBrief.lengthPlan);
    const experienceLine = includeL5
      ? `体验：${buildReplyExperiencePlanPrompt(replyBrief.experiencePlan)}`
      : this.buildDirectExperienceContext(replyBrief);
    const turnPlan = resolveConversationTurnPlan({
      engagement: replyBrief.conversationPlan?.engagement,
      turnPlan: replyBrief.conversationPlan?.turnPlan,
    });
    const conversationPlanLines =
      includeL5 && replyBrief.conversationPlan
        ? [
            '# 本轮交谈规划',
            `态度：${replyBrief.conversationPlan.stance}（针对：${replyBrief.conversationPlan.stanceTarget}）`,
            `行动：${replyBrief.conversationPlan.moves
              .map(move => `${move.type}:${move.goal}`)
              .join('；')}`,
            `策略：${replyBrief.conversationPlan.socialStrategy}；提问：${replyBrief.conversationPlan.questionNeed}；收束：${replyBrief.conversationPlan.turnClosure}`,
            ...(turnPlan
              ? [`本轮：${buildConversationTurnPlanPrompt(turnPlan)}`]
              : []),
            ...(replyBrief.conversationPlan.personaActivation.length
              ? [
                  `人格激活：${replyBrief.conversationPlan.personaActivation.join(
                    '；'
                  )}`,
                ]
              : []),
            ...(replyBrief.conversationPlan.questionNeed !== 'none' &&
            replyBrief.conversationPlan.moves.some(move => move.type === 'ask')
              ? ['实际提出一个贴着新信息的问题，最多一个。']
              : []),
            ...(replyBrief.conversationPlan.engagement
              ?.assistantContribution === 'self_expression'
              ? [
                  '用户要你主动说；先给角色侧当下内容，不要把“我在、你慢慢说、我听着、你想说时我在”作为第一句或主体。涉及离世生活时按本轮框架选择内容，不临时另造设定，也不编用户偏好或共同往事。',
                ]
              : []),
            ...(replyBrief.conversationPlan.engagement?.continuationGoal ===
            'repair'
              ? [
                  '关系在修复；当轮改变实际行动，不只解释、认错或承诺改变。用户已表示“说了也没用”一类沟通无效感时，必须把规划中已有的一个具体上下文锚点自然写进正文；只说“我知道/我帮不上忙/我听你说”，或换成“你想说时我在”等变体，都不算完成修复，也不让用户重讲。',
                ]
              : []),
            ...(replyBrief.conversationPlan.engagement?.closureReadiness ===
            'blocked'
              ? [
                  '开放点未解决；先完成须贡献内容，称呼、复述、安慰词或劝睡不能单独收口。',
                ]
              : []),
            '弱规划，不照抄；冲突时以用户原话、事实和关系分寸为准。',
          ]
        : [];
    const commActLines =
      includeL5 && replyBrief.commAct
        ? [buildReplyCommActPrompt(replyBrief.commAct)]
        : [];
    const objectPlanLines = replyBrief.objectPlan
      ? [
          '# 本轮对象区分',
          buildConversationObjectPlanPrompt(replyBrief.objectPlan),
        ]
      : [];
    const participationLines = replyBrief.participationStrategy
      ? [
          '# 短轮参与',
          buildReplyParticipationStrategyPrompt(
            replyBrief.participationStrategy
          ),
        ]
      : [];
    const careMotivationLines =
      includeL5 && replyBrief.careMotivation
        ? [buildReplyCareMotivationPrompt(replyBrief.careMotivation)]
        : [];
    const stateProtocolLines =
      includeL5 &&
      replyBrief.stateProtocol &&
      replyBrief.stateProtocol.protocol !== 'active_contribution'
        ? [
            replyBrief.stateProtocol.protocol === 'dream'
              ? '# 梦境陪伴'
              : '# 高频场景协议',
            buildReplyStateProtocolPrompt(replyBrief.stateProtocol),
          ]
        : [];
    const realityDependencyLines = replyBrief.realityDependencies.length
      ? [
          '# 现实依赖',
          `用户请求：${replyBrief.realityDependencies
            .map(item => describeReplyRealityDependency(item.kind))
            .join(
              '、'
            )}。不用做不到的现实承诺哄用户，也不把拒绝当回复主体；保留想照顾用户的心意，改用愿望、具体关心或聊天内能做的事承接。`,
        ]
      : [];
    const afterlifeWorldLines = replyBrief.afterlifeWorld
      ? ['# 离世生活框架', buildAfterlifeWorldPrompt(replyBrief.afterlifeWorld)]
      : [];
    const sceneFrameworkLines = replyBrief.sceneFramework
      ? [
          '# 关系场景体系',
          buildRelationalSceneFrameworkPrompt(replyBrief.sceneFramework),
        ]
      : [];
    const worldBoundaryLines = [
      '# 世界与证据公共政策',
      buildWorldBoundaryPolicyPrompt(replyBrief.worldBoundaryPolicy),
    ];
    const conversationProtectionPrompt = buildConversationProtectionStatePrompt(
      replyBrief.conversationProtection
    );
    const conversationProtectionLines = conversationProtectionPrompt
      ? ['# 会话级长期保护', conversationProtectionPrompt]
      : [];
    const hasActiveContributionTurn = Boolean(
      replyBrief.activeContribution ||
        replyBrief.stateProtocol?.protocol === 'active_contribution'
    );
    const activeContributionLines = hasActiveContributionTurn
      ? [
          '# 主动贡献',
          '用户要你主动说，这一轮由你承担聊天内容。先结合刚才的话和你们的关系，自己选择一个真实的主观感受、态度或想说的小内容；不要反问，不用“我在、我听着、你慢慢说”，也不要套用“心里很安静、还在想刚才那件事”。',
          `共同过去${
            replyBrief.activeContribution?.sharedPastAllowed
              ? '有证据时可自然带一处细节'
              : '沿用户已说片段回应感受和意义，不以亲历口吻新增细节'
          }。`,
        ]
      : [];
    const strategyQualityLines =
      includeL5 && replyBrief.strategyQuality
        ? [
            '# 多轮策略去重',
            buildReplyStrategyQualityPrompt(replyBrief.strategyQuality),
          ]
        : [];
    const correctionLines = replyBrief.correctionPolicy
      ? [
          replyBrief.correctionPolicy.mode === 'replace'
            ? '纠正：旧事实失效；只采用用户本轮给出的最小替代事实，关系归属用“是”，用户的“我”转成“你”；不补另一版本，随后收住。'
            : '纠正：旧事实失效；替代事实归零，不猜原因、时间、地点、动作或另一版本，随后收住。',
        ]
      : [];
    const communicationHint = [
      '# 本轮沟通',
      '先在心里判断这轮最需要完成什么，再组织语言；策略字段只帮助思考，不要求固定动作顺序。消息里有多个问题、人物或情绪时，不能只抓最后一个词，也不要让一句边界说明吞掉其余情绪和关系诉求。',
      '先接住用户正在说的具体事、情绪或近况，再给角色侧心意；用户提到具体物件、食物、地点或事情时，先自然点到它，再回情绪。',
      '用户分享喜悦、期待或准备了什么时，先给具体反应、共鸣或一起高兴，不要把“我知道了、别累着、记得早点歇”当成主回应。',
      '不要把“路过/看到/准备做某事”补成用户正在站着、在户外、遇到天气或身体不适；不要一上来就叮嘱、提醒或教用户怎么做。',
      '用户说“准备回家、收拾东西、要走了”只表示还在离开或收束，不表示已经上路；不得补出“路上注意安全、别着急、到家先歇会儿、慢点走”等现实行动提醒。',
      '涉及共同过去时，只用本轮证据包中明确可陈述的内容；没有对应证据就不补写“以前、你那时、我做的某道菜、我们一起”等具体共同往事，改为接住当下感受和含义。',
    ].join('\n');
    const careReceptionLines = replyBrief.careReception
      ? [
          '# 本轮接纳关心',
          '用户正在把关心递给当前角色：先正面回答，让这份关心自然落在角色身上，并按人物性格表现出珍惜。不得说“你别挂心、你别担心、别惦记我、别操心我”，也不要马上用叮嘱把关心推回用户。这是软策略，不要求固定句式、额外气泡或字数。',
        ]
      : [];
    const directActiveContributionLines =
      planningMode === 'direct' && replyBrief.directActiveContribution
        ? [
            '# 直接路径的可选主动贡献',
            buildDirectActiveContributionPrompt(
              replyBrief.directActiveContribution
            ),
          ]
        : [];

    if (planningMode === 'direct') {
      return [
        '# 本轮回复任务',
        experienceLine,
        communicationHint,
        ...careReceptionLines,
        ...directActiveContributionLines,
        ...activeContributionLines,
        ...(hasActiveContributionTurn ? [] : commActLines),
        ...objectPlanLines,
        ...afterlifeWorldLines,
        ...sceneFrameworkLines,
        ...worldBoundaryLines,
        ...conversationProtectionLines,
        ...participationLines,
        ...realityDependencyLines,
        ...correctionLines,
        ...(boundaryContract.prompt ? [boundaryContract.prompt] : []),
        ...(chatToolPrompt ? [chatToolPrompt] : []),
        '# 完整正文与展示适配',
        bubblePlanPrompt,
        '# 总字数预算',
        lengthPlanPrompt,
        outputContractPrompt,
      ].join('\n');
    }

    if (replyBrief.mode === 'memory' || replyBrief.mode === 'memory_control') {
      return [
        '# 本轮回复任务',
        experienceLine,
        communicationHint,
        ...careReceptionLines,
        ...(boundaryContract.prompt ? [boundaryContract.prompt] : []),
        ...conversationPlanLines,
        ...(hasActiveContributionTurn ? [] : commActLines),
        ...objectPlanLines,
        ...afterlifeWorldLines,
        ...sceneFrameworkLines,
        ...worldBoundaryLines,
        ...conversationProtectionLines,
        ...careMotivationLines,
        ...stateProtocolLines,
        ...participationLines,
        ...realityDependencyLines,
        ...activeContributionLines,
        ...strategyQualityLines,
        ...correctionLines,
        '# 完整正文与展示适配',
        bubblePlanPrompt,
        '# 总字数预算',
        lengthPlanPrompt,
        ...(chatToolPrompt ? [chatToolPrompt] : []),
        outputContractPrompt,
      ].join('\n');
    }

    return [
      '# 本轮回复任务',
      experienceLine,
      communicationHint,
      ...careReceptionLines,
      ...(!replyBrief.reading
        ? [`用户此刻最需要：${replyBrief.emotionalNeed}`]
        : []),
      ...conversationPlanLines,
      ...(hasActiveContributionTurn ? [] : commActLines),
      ...objectPlanLines,
      ...afterlifeWorldLines,
      ...sceneFrameworkLines,
      ...worldBoundaryLines,
      ...conversationProtectionLines,
      ...careMotivationLines,
      ...stateProtocolLines,
      ...participationLines,
      ...realityDependencyLines,
      ...activeContributionLines,
      ...strategyQualityLines,
      ...correctionLines,
      ...(!replyBrief.conversationPlan &&
      !replyBrief.stateProtocol &&
      replyBrief.replyMoves.length
        ? [
            '可选择完成的回应目标：',
            ...replyBrief.replyMoves
              .slice(0, 3)
              .map((move, index) => `${index + 1}. ${move}`),
          ]
        : []),
      ...(boundaryContract.prompt ? [boundaryContract.prompt] : []),
      '完整正文与展示适配：',
      bubblePlanPrompt,
      '总字数预算：',
      lengthPlanPrompt,
      '以上为内部约束；自然表达，不逐项复述。',
      ...(chatToolPrompt ? [chatToolPrompt] : []),
      outputContractPrompt,
    ].join('\n');
  }

  private buildDirectExperienceContext(replyBrief: ReplyBrief): string {
    const plan = replyBrief.experiencePlan;
    return `体验：${plan.profileTier}/${plan.relationshipStage}/${plan.conversationDepth}`;
  }

  private resolveToolInstructionMode(
    plan: AgentChatToolTurnPlan
  ): AgentContextDiagnostics['toolInstructionMode'] {
    if (plan.mode === 'shadow') {
      return 'shadow_decision';
    }
    if (plan.mode === 'active') {
      return 'model_tools';
    }
    return 'orchestrated_none';
  }

  private compileReplyBoundaryContract(replyBrief: ReplyBrief) {
    return buildReplyBoundaryContract({
      capabilityConstraints: replyBrief.capabilityConstraints,
      forbiddenAssumptions: replyBrief.forbiddenAssumptions,
      additionalRules:
        replyBrief.mode === 'platform'
          ? ['确认 AI 身份时简短如实，不回避，也不展开技术细节。']
          : [],
    });
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
    memoryPlan?: ConversationMemoryPlan,
    planningMode: ReplyPlanningMode = 'semantic'
  ): MemoryRetrievalDecision {
    if (!memoryPlan) {
      if (planningMode === 'direct') {
        return {
          mode: 'suppressed',
          query: undefined,
          conceptCount: 0,
        };
      }

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

  private pinMentionedFamilyMemberFacts(
    profileFacts: AgentProfileFactSummary[],
    knownFamilyMembers: string[],
    currentQuery: string
  ): string[] {
    if (!knownFamilyMembers.length || !currentQuery.trim()) {
      return [];
    }

    const mentioned = knownFamilyMembers.filter(name =>
      currentQuery.includes(name)
    );

    if (!mentioned.length) {
      return [];
    }

    const keys = profileFacts
      .filter(fact => mentioned.some(name => fact.key.includes(name)))
      .map(fact => fact.key);

    return keys;
  }

  private pinMessengerProfileFacts(
    profileFacts: AgentProfileFactSummary[],
    currentQuery: string
  ): string[] {
    if (
      !/(?:小使者|告诉过(?:你|小使者)|跟小使者说过|补齐(?:过)?记忆|补充(?:过)?记忆|记忆补充)/.test(
        currentQuery
      )
    ) {
      return [];
    }

    return profileFacts
      .filter(fact => fact.key.startsWith('profile_source.'))
      .map(fact => fact.key);
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
    addDomain(/性格|脾气|为人|个性|处事/.test(query), ['profile.personality']);
    addDomain(
      /图片|照片|画面|人物|长相|样子|形象|身份推测|可记形象/.test(query),
      ['visual.appearance', 'family.identity']
    );
    addDomain(/口头禅|方言|语言习惯|说话习惯|怎么讲话/.test(query), [
      'profile.language',
    ]);
    addDomain(/生平|人生经历|生活经历|工作经历|上学|职业/.test(query), [
      'profile.life_experience',
      'occupation.primary',
    ]);
    addDomain(/兴趣|爱好|喜欢做什么|平时喜欢/.test(query), ['profile.hobbies']);
    addDomain(
      /共同回忆|还记得|记不记得|以前|从前|小时候|那时候|当年/.test(query),
      ['memory.shared']
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
    if (key === 'profile_source.personality_traits') {
      return 'profile.personality';
    }
    if (key === 'profile_source.language_habits') {
      return 'profile.language';
    }
    if (key === 'profile_source.life_experience') {
      return 'profile.life_experience';
    }
    if (key === 'profile_source.hobbies') {
      return 'profile.hobbies';
    }
    if (key === 'profile_source.shared_memories') {
      return 'memory.shared';
    }
    if (key.startsWith('visual.appearance.')) {
      return 'visual.appearance';
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
      /图片|照片|画面|人物|长相|样子|形象|身份推测|可记形象/.test(query) &&
      /^visual\.appearance\./.test(key)
    ) {
      score += 14;
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
    let index = 0;
    const addProfileAtom = (options: {
      factKey: string;
      text: string;
      subjectRef: string;
      assertionPolicy?: AgentEvidenceAssertionPolicy;
      confidence?: number;
    }): void => {
      index += 1;
      evidence.push({
        id: `A${index}`,
        source: 'agent_profile',
        text: options.text,
        assertionPolicy: options.assertionPolicy || 'can_assert',
        subjectRef: options.subjectRef,
        factKey: options.factKey,
        useMode:
          options.assertionPolicy === 'context_only' ? 'hypothesis' : 'assert',
        status: 'active',
        confidence: options.confidence ?? 1,
      });
    };

    addProfileAtom({
      factKey: 'identity.name',
      text: `当前角色姓名是${name}`,
      subjectRef: 'agent',
    });
    if (
      /称呼|叫我|叫你|怎么叫|你是谁|我是你|你是我|什么关系/.test(currentQuery)
    ) {
      addProfileAtom({
        factKey: 'relationship.user_calls_agent',
        text: `用户称呼当前角色为${userCallsAgent}`,
        subjectRef: 'agent',
      });
      addProfileAtom({
        factKey: 'relationship.agent_calls_user',
        text: `当前角色称呼用户为${agentCallsUser}`,
        subjectRef: 'user',
      });
    }

    if (
      /生日|出生|几岁|多大|什么时候走|什么时候去世|离开日期/.test(currentQuery)
    ) {
      const birthday = this.formatAgentDate('生日', agent.birthday);
      const deathDate = this.formatAgentDate('离开日期', agent.deathDate);

      if (birthday) {
        addProfileAtom({
          factKey: 'identity.birth_date',
          text: birthday,
          subjectRef: 'agent',
        });
      }
      if (deathDate) {
        addProfileAtom({
          factKey: 'identity.death_date',
          text: deathDate,
          subjectRef: 'agent',
        });
      }
    }

    const styleCandidates = hasUsableAgentPersonaProfile(agent.personaProfile)
      ? []
      : [
          {
            key: 'customContext',
            value: agent.customContext,
            assertionPolicy: 'context_only' as const,
            baseScore: 6,
          },
        ];
    const detailCandidates = [
      ...styleCandidates,
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
      this.splitEvidenceAtoms(detail.value, 3).forEach((text, atomIndex) => {
        addProfileAtom({
          factKey: `${detail.key}.${atomIndex + 1}`,
          text,
          subjectRef: 'agent',
          assertionPolicy: detail.assertionPolicy,
          confidence: 0.95,
        });
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
    suppressPriorFacts?: boolean;
    currentUserCanAssert?: boolean;
    objectPlan?: ConversationObjectPlan;
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
      const assertionPolicy = options.currentUserCanAssert
        ? 'can_assert'
        : this.resolveUserEvidencePolicy(currentQuery);
      addEvidence({
        id: 'U0',
        source: 'current_user',
        text: currentQuery,
        assertionPolicy,
        subjectRef: this.resolveUtteranceSubjectRef(
          currentQuery,
          options.objectPlan
        ),
        factKey: options.suppressPriorFacts
          ? 'correction.current'
          : 'utterance.current',
        useMode: assertionPolicy === 'can_assert' ? 'uptake' : 'hypothesis',
        status: 'active',
      });
    }

    if (options.memoryControlResult) {
      addEvidence(this.buildMemoryControlEvidence(options.memoryControlResult));
    }

    if (!options.suppressPriorFacts) {
      for (const item of this.buildAgentProfileEvidence(
        options.agent,
        currentQuery
      )) {
        addEvidence(item);
      }
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
        subjectRef: this.resolveFactSubjectRef(
          fact.key,
          value,
          options.objectPlan
        ),
        factKey: fact.key,
        useMode:
          fact.assertionPolicy === AgentProfileFactAssertionPolicy.contextOnly
            ? 'recall'
            : 'assert',
        status: 'active',
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
        subjectRef: this.resolveFactSubjectRef(
          fact.key,
          value,
          options.objectPlan
        ),
        factKey: fact.key,
        useMode:
          this.resolveLegacyFactAssertionPolicy(fact.key) === 'can_assert'
            ? 'assert'
            : 'recall',
        status: 'active',
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
        subjectRef: this.resolveUtteranceSubjectRef(text, options.objectPlan),
        factKey: `utterance.${
          this.stringifyObjectId(message.id) || recentIndex
        }`,
        useMode: 'recall',
        status: 'active',
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
        subjectRef: this.resolveUtteranceSubjectRef(text, options.objectPlan),
        factKey: `memory.${memory.id || retrievedIndex}`,
        useMode: 'recall',
        status: 'active',
        confidence: memory.score,
        sourceMessageId: memory.id,
      });

      if (retrievedIndex >= 3) {
        break;
      }
    }

    // 注入角色名字证据：identity contract 中的 displayName 始终可确认
    if (options.agent) {
      const displayName = (options.agent.name || '').trim();
      if (displayName) {
        addEvidence({
          id: 'E_IDENTITY',
          source: 'system_action',
          text: `角色名称为${displayName}`,
          assertionPolicy: 'can_assert',
          subjectRef: 'agent',
          factKey: 'agent.identity.name',
          useMode: 'uptake',
          status: 'active',
          confidence: 1,
        });
      }
    }

    return selectAgentEvidence(evidence, {
      currentQuery,
      limit: 10,
    });
  }

  private splitEvidenceAtoms(value: string, limit: number): string[] {
    const parts = value
      .split(/[；;。！？!?\n]+/)
      .map(item => item.trim())
      .filter(Boolean);

    return (parts.length ? parts : [value.trim()]).slice(0, limit);
  }

  private resolveUtteranceSubjectRef(
    text: string,
    objectPlan?: ConversationObjectPlan
  ): string {
    const objectRefs = this.resolveMentionedObjectRefs(text, objectPlan);
    const mentionsUser = /我|咱们/.test(text);
    const mentionsAgent = /你|您/.test(text);

    if (objectRefs.length > 1 || (mentionsUser && mentionsAgent)) {
      return 'mixed';
    }
    if (objectRefs.length === 1) {
      return objectRefs[0];
    }
    if (mentionsUser) {
      return 'user';
    }
    if (mentionsAgent) {
      return 'agent';
    }

    const focusRefs = (objectPlan?.focusRefs || [])
      .map(
        ref => objectPlan?.objects.find(object => object.ref === ref)?.binding
      )
      .filter((ref): ref is string => Boolean(ref && ref !== 'unknown'));
    return focusRefs.length === 1 ? focusRefs[0] : 'conversation';
  }

  private resolveFactSubjectRef(
    factKey = '',
    text: string,
    objectPlan?: ConversationObjectPlan
  ): string {
    const visualSubject = factKey.match(/^visual\.appearance\.([^.]+)/)?.[1];
    if (visualSubject) {
      return visualSubject;
    }

    const objectRefs = this.resolveMentionedObjectRefs(text, objectPlan);
    if (objectRefs.length === 1) {
      return objectRefs[0];
    }
    if (objectRefs.length > 1) {
      return 'mixed';
    }

    if (
      /^(?:user\.|preference\.|health\.|grief_|style\.|taboo\.)/.test(
        factKey
      ) ||
      factKey === 'relationship.agent_calls_user' ||
      /^用户/.test(text)
    ) {
      return 'user';
    }
    if (/^family\./.test(factKey)) {
      return 'family';
    }
    if (/^(?:memory|keepsake|ritual|promise|correction)\./.test(factKey)) {
      return 'mixed';
    }

    return 'agent';
  }

  private resolveMentionedObjectRefs(
    text: string,
    objectPlan?: ConversationObjectPlan
  ): string[] {
    if (!objectPlan) {
      return [];
    }

    return Array.from(
      new Set(
        objectPlan.objects
          .filter(
            object =>
              object.binding !== 'unknown' &&
              object.mention.length >= 2 &&
              text.includes(object.mention)
          )
          .map(object => object.binding)
      )
    );
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
      agent_profile: '资料',
      system_action: '系统',
      current_user: '本轮',
      confirmed_fact: '确认',
      recent_user: '近期',
      retrieved_user: '长期',
    };
    const useLabels: Record<
      ReturnType<typeof resolveAgentEvidenceUseMode>,
      string
    > = {
      assert: '可确认',
      uptake: '承接',
      recall: '回忆',
      hypothesis: '待确认',
    };
    const lines = evidence.map(item => {
      const subject = item.subjectRef || 'unknown';
      return `[${item.id}|${sourceLabels[item.source]}|${subject}|${
        useLabels[resolveAgentEvidenceUseMode(item)]
      }] ${item.text}`;
    });

    return [
      '# 本轮证据包',
      ...(lines.length ? lines : ['当前没有可用于扩写具体事实的证据。']),
      '',
      '# 证据规则',
      '可确认：可以自然陈述；承接：可直接接住用户本轮明确陈述，不必机械加“你说”；回忆：只作用户此前表达，必要时自然标明；待确认和问句不能证明其假设。',
      'claims 必须绑定支持该事实的证据；对象不同、事实无关、已撤回或被替代的证据均无效。',
      '无证据不新增用户偏好、习惯、性格、现实关系或共同细节。若用户本轮已经明确提供某个事实，必须按“你刚告诉我的”自然承接，不能反过来说想不起来、不记得或不知道；只有用户询问而本轮又没有给出答案时，才可自然承认记不清。角色侧离世日常可自然想象，不延伸成现实做饭、到场或触碰。',
      '证据只约束具体事实，不限制称呼、关系立场、愿望和共情；不向用户暴露 ID、标签或结构。',
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
      subjectRef: 'system',
      factKey: 'system.memory_control',
      useMode: 'assert',
      status: 'active',
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

  private buildHistoryLayer(
    messages: MessageEntity[],
    identity?: AgentIdentityContract
  ): AgentContextLayer {
    return {
      key: 'history',
      messages: messages
        .map(message => this.buildChatMessage(message, identity))
        .filter(Boolean) as ChatCompletionMessageParam[],
    };
  }

  private excludeCurrentTurnMessagesFromHistory(
    messages: MessageEntity[],
    currentTurnMessageIds: string[] = []
  ): MessageEntity[] {
    const currentTurnIds = new Set(
      currentTurnMessageIds.map(id => id.trim()).filter(Boolean)
    );

    if (!currentTurnIds.size) {
      return messages;
    }

    return messages.filter(
      message => !currentTurnIds.has(this.stringifyObjectId(message.id))
    );
  }

  private selectCurrentTurnMessages(
    messages: MessageEntity[],
    currentTurnMessageIds: string[] = []
  ): MessageEntity[] {
    const currentTurnIds = new Set(
      currentTurnMessageIds.map(id => id.trim()).filter(Boolean)
    );

    return currentTurnIds.size
      ? messages.filter(message =>
          currentTurnIds.has(this.stringifyObjectId(message.id))
        )
      : [];
  }

  private appendCurrentTurnToHistory(
    historyLayer: AgentContextLayer,
    options: BuildConversationContextOptions,
    currentTurnMessages: MessageEntity[]
  ): void {
    const currentQuery = options.currentQuery?.trim();

    if (!currentQuery || !options.currentTurnMessageIds?.length) {
      return;
    }

    if (currentTurnMessages.length === 1) {
      const currentMessage = this.buildChatMessage(currentTurnMessages[0]);

      if (currentMessage?.role === 'user') {
        historyLayer.messages.push(currentMessage);
        return;
      }
    }

    historyLayer.messages.push({
      role: 'user',
      content: currentQuery,
    });
  }

  private isConsecutiveInputQuery(value = ''): boolean {
    return /^用户连续输入（按发送顺序，共\d+条）：/.test(value.trim());
  }

  private buildPerceptionPrompt(
    evidence: AgentEvidenceItem[],
    emotionState?: ConversationEmotionStateSummary | null,
    replyBrief?: ReplyBrief,
    agent?: AgentEntity | null
  ): string {
    return buildDepartedPerceptionPrompt({
      evidence,
      emotionState,
      replyBrief,
      agentDeathDate: agent?.deathDate ?? null,
      agentBirthday: agent?.birthday ?? null,
    });
  }

  private async classifyReplyIntentWithDiagnostics(
    options: ClassifyReplyIntentOptions & {
      recentMessages: MessageEntity[];
      knownFamilyMembers: string[];
      memoryCandidates: ReplyIntentMemoryCandidate[];
    },
    enabled: boolean,
    planningDecision: ReplyPlanningDecision
  ): Promise<ReplyIntentClassificationResult> {
    if (!enabled || !this.replyIntentClassifierService) {
      return {
        intent: undefined,
        status: 'not_called',
        modelCallCount: 0,
        fallbackUsed: false,
        latencyMs: 0,
      };
    }

    if (
      typeof this.replyIntentClassifierService.classifyWithDiagnostics ===
      'function'
    ) {
      return this.replyIntentClassifierService.classifyWithDiagnostics(options);
    }

    const startedAt = Date.now();
    try {
      const intent = await this.replyIntentClassifierService.classify(options);
      return {
        intent,
        status:
          planningDecision.mode === 'semantic' ? 'succeeded' : 'not_called',
        modelCallCount: planningDecision.mode === 'semantic' ? 1 : 0,
        fallbackUsed: false,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const description =
        error instanceof Error
          ? error.name + ' ' + error.message
          : String(error || '');
      return {
        intent: undefined,
        status: /abort|timeout|timed out|etimedout/i.test(description)
          ? 'timeout'
          : 'failed',
        modelCallCount: planningDecision.mode === 'semantic' ? 1 : 0,
        fallbackUsed: true,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private getReplyPlanningDecision(
    options: ClassifyReplyIntentOptions,
    enabled: boolean
  ): ReplyPlanningDecision {
    if (!enabled || !this.replyIntentClassifierService) {
      return { mode: 'disabled', reason: 'disabled' };
    }

    if (
      typeof this.replyIntentClassifierService.getPlanningDecision !==
      'function'
    ) {
      return { mode: 'semantic', reason: 'hybrid_disabled' };
    }

    return this.replyIntentClassifierService.getPlanningDecision(options);
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
    message: MessageEntity,
    identity?: AgentIdentityContract
  ): ChatCompletionMessageParam | null {
    switch (message.role) {
      case MessageRole.assistant: {
        const assistantContent = this.buildAssistantHistoryContent(
          message,
          identity?.agent?.displayName
        );

        if (!assistantContent) {
          return null;
        }
        // 身份锚定已移至 persona 层，历史消息不再注入角色前缀
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

  private buildAssistantHistoryContent(
    message: MessageEntity,
    displayName?: string
  ): string {
    const transcript = this.stripAssistantIdentityPrefix(
      stripPromptLeakageContent(message.mediaTranscript),
      displayName
    );

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

    const content = this.stripAssistantIdentityPrefix(
      stripPromptLeakageContent(message.content),
      displayName
    );

    if (!content || containsUnsafeAssistantHistoryContent(content)) {
      return '';
    }

    return content;
  }

  // 清除存量泄漏的身份前缀（作为XX你说：/ 角色名：/ XX说：/ 第N颗：），只剥离开头
  private stripAssistantIdentityPrefix(
    value: string,
    displayName?: string
  ): string {
    let content = value.trim();
    if (!content) return '';

    const staticPrefix =
      /^(?:作为[一-鿿\w·-]{1,20}[，,]?\s*(?:你[一-鿿\s，,]{0,12})?说[：:]|第[一二三123]颗[：:]|[爸祖外姥奶姑叔姨哥姐弟妹儿女闺女儿子宝贝老公老婆爹娘]{1,2}说[：:])\s*/;

    for (let i = 0; i < 2 && staticPrefix.test(content); i++) {
      content = content.replace(staticPrefix, '').trim();
    }

    const name = displayName?.trim();
    if (name && name.length <= 8) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const namePrefix = new RegExp(
        `^(?:作为)?${escaped}[，,]?\\s*(?:你说|说)?[：:]\\s*`
      );
      for (let i = 0; i < 2 && namePrefix.test(content); i++) {
        content = content.replace(namePrefix, '').trim();
      }
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
      content: [
        `用户发送了一张图片。\n图片理解：${analysis}`,
        '这不是普通看图问答，而是亲人聊天里的记忆材料。先用当前角色口吻接住图片本身，可顺着一个有意义的形象细节、场景或情绪说话，不要罗列特征。',
        '只有图片理解明确写出“身份推测”时，才可结合本轮证据和记忆自然说“看着像/可能是/像那时候的我”，但不能说成确定事实，不能说“识别出/确认是”。',
        '其中“也许是”视为低置信：如果用户没有补充关系说明，基于照片的回复要以试探性确认和提问为主，可轻轻问“这位看着像……是吗/要不要我先这么记”；不要直接把人物关系说定，也不要代入那位人物叙旧。',
        '如果用户已补充关系说明，以用户说明为准自然承接；如果中高置信推测指向当前角色，可优先以第一人称温和承接，但仍要保留分寸。',
        '没有“身份推测”或没有合适候选时，只回应可见内容并直接问这是谁或想让你记住哪一位；不得补编闺女、儿子、爸妈、小时候、老家、旧日共同经历，也不要说成识别失败。',
      ].join('\n'),
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
