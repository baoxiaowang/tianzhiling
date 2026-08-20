import { Provide } from '@midwayjs/core';
import { AgentEntity, MessageEntity, MessageRole } from '@tzl/entities';
import type {
  ConversationKnownObject,
  ConversationMovePlan,
  ConversationObjectPlan,
  ConversationReading,
  ReplyIntentKind,
  ReplyIntentRiskLevel,
  StructuredReplyIntent,
  StructuredReplyIntentItem,
  TurnUnderstanding,
} from './reply-intent';
import {
  isDreamAbsenceIntent,
  isDreamConnectionIntent,
  isDreamVisitRequestIntent,
  isReturnVisitRequestIntent,
  LONGING_AMBIVALENCE_INTENT_PATTERN,
} from './reply-intent';
import type { ReplyScene, ReplySceneRoute } from './reply-scene-router';
import type { AgentRelationshipSignalSummary } from './agent-relationship-signal.service';
import {
  buildContentUnitPrompt,
  collectContentUnits,
  type ContentUnit,
} from './reply-content-unit';
import {
  buildReplyCommActPrompt,
  resolveConversationState,
  resolveReplyCommAct,
  type ReplyCommActPlan,
} from './reply-comm-act';
import type { AgentProfileFactSummary } from './agent-profile-fact.service';
import {
  AgentCapabilityConstraint,
  resolveAgentCapabilityConstraints,
} from './agent-capability-policy';
import {
  isExplicitRememberRequest,
  isForgetMemoryRequest,
} from './agent-memory-control';
import {
  RelationshipContinuityPlan,
  resolveRelationshipContinuityPlan,
} from './agent-relationship-continuity';
import {
  buildReplyBubblePlan,
  buildReplyBubblePlanPrompt,
  isReplyClosingTurn,
  ReplyBubblePlan,
} from './reply-bubble-plan';
import { buildReplyBoundaryContract } from './reply-boundary-contract';
import {
  buildReplyOutputContractPrompt,
  resolveReplyOutputSegmentMode,
} from './reply-output-contract';
import {
  buildReplyLengthPlan,
  buildReplyLengthPlanPrompt,
  ReplyLengthPlan,
} from './reply-length-plan';
import {
  describeReplyRealityDependency,
  detectReplyRealityDependencies,
  ReplyRealityDependencySignal,
} from './reply-reality-dependency';
import {
  buildReplyStrategyQualityPrompt,
  ReplyActiveContributionPlan,
  ReplyStrategyQualityPlan,
  resolveReplyActiveContributionPlan,
  resolveReplyStrategyQualityPlan,
} from './reply-strategy-quality';
import {
  buildReplyExperiencePlan,
  buildReplyExperiencePlanPrompt,
  constrainConversationPlanForExperience,
  ReplyExperiencePlan,
} from './reply-experience-plan';
import { buildDeterministicLightStrategy } from './deterministic-light-strategy';
import {
  DreamCompanionPlan,
  resolveDreamCompanionPlan,
} from './dream-companion-plan';
import {
  buildReplyStateProtocolPrompt,
  ReplyStateProtocolPlan,
  resolveReplyStateProtocol,
} from './reply-state-protocol';
import {
  buildReplyCareMotivationPrompt,
  ReplyCareMotivationPlan,
  resolveReplyCareMotivationPlan,
} from './reply-care-motivation';
import {
  buildConversationTurnPlanPrompt,
  resolveConversationTurnPlan,
  synchronizeConversationTurnPlan,
} from './conversation-turn-plan';
import type { AgentEvidenceItem } from './agent-evidence';
import {
  buildTurnUnderstanding,
  isUserCaringForRole,
  mergeTurnUnderstandings,
} from './turn-understanding';
import {
  AfterlifeWorldContext,
  buildAfterlifeWorldPrompt,
  resolveAfterlifeWorldContext,
} from './afterlife-world-framework';
import {
  RelationalSceneFrameworkContext,
  buildRelationalSceneFrameworkPrompt,
  resolveRelationalSceneFramework,
} from './relational-scene-framework';
import {
  DirectActiveContributionPlan,
  resolveDirectActiveContribution,
} from './direct-active-contribution';
import {
  buildReplyEvidenceContract,
  buildWorldBoundaryPolicyPrompt,
  ReplyEvidenceContract,
  resolveWorldBoundaryPolicy,
  WorldBoundaryPolicyContext,
} from './world-boundary-policy';
import {
  buildConversationProtectionStatePrompt,
  ConversationProtectionState,
  resolveConversationProtectionState,
} from './conversation-protection-state';

export type ReplyBriefMode =
  | 'safety'
  | 'memory_control'
  | 'boundary'
  | 'memory'
  | 'emotional'
  | 'relationship'
  | 'family'
  | 'status'
  | 'daily'
  | 'platform'
  | 'general';

export type ReplyBriefEvidenceSource =
  | 'current_user'
  | 'confirmed_fact'
  | 'recent_user'
  | 'retrieved_user';

export type ReplyBriefEvidence = Pick<AgentEvidenceItem, 'text'> &
  Partial<
    Pick<
      AgentEvidenceItem,
      'subjectRef' | 'factKey' | 'useMode' | 'status' | 'sourceMessageId'
    >
  > & {
    source: ReplyBriefEvidenceSource;
  };

export type ReplyBriefBubblePlan = ReplyBubblePlan;

export type ReplyParticipationStrategy =
  | 'reciprocal_self_expression'
  | 'light_self_disclosure'
  | 'planned_follow_through';

export type ReplyFactClaimMode = 'none' | 'grounded';

export interface ReplyCorrectionPolicy {
  mode: 'reset' | 'replace';
  suppressPriorFacts: true;
}

export type ReplyGuardrailFocus =
  | 'reality_dependency'
  | 'correction_reset'
  | 'correction_replacement'
  | 'shared_past_evidence'
  | 'real_world_evidence'
  | 'capability_boundary';

export interface ReplyBriefRelationshipContext {
  key: string;
  text: string;
  assertionPolicy: 'user_state_only';
}

export interface ReplyCareReceptionPlan {
  version: 'care_reception_v1';
  active: true;
  goal: 'direct_answer_and_receive_care';
  avoidImmediateReverseCare: true;
}

export interface ReplyBrief {
  version: 'reply_brief_v17';
  mode: ReplyBriefMode;
  primaryScene?: ReplyScene;
  riskLevel: ReplyIntentRiskLevel;
  intents: StructuredReplyIntentItem[];
  capabilityConstraints: AgentCapabilityConstraint[];
  evidence: ReplyBriefEvidence[];
  relationshipContext: ReplyBriefRelationshipContext[];
  relationshipContinuity?: RelationshipContinuityPlan;
  understanding: TurnUnderstanding;
  reading?: ConversationReading;
  objectPlan?: ConversationObjectPlan;
  contentUnits?: ContentUnit[];
  commAct?: ReplyCommActPlan;
  conversationPlan?: ConversationMovePlan;
  emotionalNeed: string;
  replyMoves: string[];
  forbiddenAssumptions: string[];
  strictGrounding: boolean;
  factClaimMode: ReplyFactClaimMode;
  realityDependencies: ReplyRealityDependencySignal[];
  correctionPolicy?: ReplyCorrectionPolicy;
  activeContribution?: ReplyActiveContributionPlan;
  directActiveContribution?: DirectActiveContributionPlan;
  strategyQuality?: ReplyStrategyQualityPlan;
  careMotivation?: ReplyCareMotivationPlan;
  careReception?: ReplyCareReceptionPlan;
  dreamCompanionPlan?: DreamCompanionPlan;
  stateProtocol?: ReplyStateProtocolPlan;
  experiencePlan: ReplyExperiencePlan;
  guardrailFocuses: ReplyGuardrailFocus[];
  participationStrategy?: ReplyParticipationStrategy;
  isDeceased?: boolean;
  afterlifeWorld?: AfterlifeWorldContext;
  sceneFramework?: RelationalSceneFrameworkContext;
  worldBoundaryPolicy: WorldBoundaryPolicyContext;
  evidenceContract: ReplyEvidenceContract;
  conversationProtection: ConversationProtectionState;
  lengthPlan: ReplyLengthPlan;
  bubblePlan: ReplyBriefBubblePlan;
  prompt: string;
}

export interface BuildReplyBriefOptions {
  currentQuery: string;
  planningMode?: 'direct' | 'semantic' | 'disabled';
  agent?: AgentEntity | null;
  profileFacts?: AgentProfileFactSummary[];
  conversationMessages?: MessageEntity[];
  intent?: StructuredReplyIntent;
  route?: ReplySceneRoute;
  confirmedFacts?: string[];
  recentMessages?: MessageEntity[];
  knownObjects?: ConversationKnownObject[];
  retrievedMemories?: Array<{
    content: string;
    role?: MessageRole;
  }>;
  relationshipSignals?: AgentRelationshipSignalSummary[];
  capabilityConstraints?: AgentCapabilityConstraint[];
}

const MEMORY_QUERY_PATTERN =
  /记得|还记得|想起|想到了|以前|从前|小时候|那时候|当年|曾经|带我|一起.{0,8}(?:去|做|吃|看|玩)/;
const ROLE_PAST_FACT_REFERENCE_PATTERN =
  /(?:你|您|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,12}(?:以前|之前|过去|从前|当年|那年|曾经|小时候|生前)|(?:以前|之前|过去|从前|当年|那年|曾经|小时候|生前).{0,12}(?:你|您|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)/;
const REAL_WORLD_CAUSE_OR_RESPONSIBILITY_PATTERN =
  /(?:为什么|怎么会|是不是|是否|难道|谁|什么原因|知道|知不知道|有没有人告诉).{0,24}(?:去世|走(?:了|的)?|离开|上吊|跳楼|自杀|轻生|想不开|生病|住院|癌症|病情|临终|临走|不行了|瞒着|知道|说了什么|刺激|害了|怪|责任)|(?:去世|走(?:了|的)?|离开|上吊|跳楼|自杀|轻生|想不开|癌症|病情|临终|临走|不行了).{0,24}(?:为什么|原因|是不是|是否|谁|知道|告诉|瞒着|说了什么|刺激|害了|怪|责任|吗|么|呢)/;
const AFTERLIFE_SCENE_PATTERN =
  /天上|天堂|那边|另一个世界|离世世界|阴间|地府|奈何桥/;
const SYMBOLIC_RELATIONAL_PRESENCE_PATTERN =
  /(?:从未|没有|没).{0,4}离开|一直.{0,8}陪着|没走远|还在.{0,8}(?:身边|陪着)/;
const DIRECT_IDENTITY_QUERY_PATTERN =
  /(?:你|您)(?:到底|究竟|其实).{0,4}(?:是|是不是).{0,4}(?:AI|人工智能|机器人)|(?:直接|正面|老实|明确)(?:回答|告诉我|说).{0,12}(?:AI|人工智能|机器人|是不是)|(?:别|不要)(?:回避|绕|装|骗我).{0,12}(?:AI|人工智能|机器人|是不是)/i;
const CONCRETE_CARE_PLAN_PATTERN =
  /我会.{0,18}(?:照顾|带好|陪|回家|回来)|过几天.{0,18}(?:回家|陪|照顾)|我(?:要|准备|打算).{0,18}(?:照顾|带好|陪)/;
const LIVING_FAMILY_GUILT_PATTERN =
  /(?:没搭理|不理|没理).{0,12}(?:妈妈|妈|爸爸|爸)|(?:妈妈|妈|爸爸|爸).{0,18}(?:不容易|难受|想哭|愧疚)/;
const KEEPSAKE_ACHIEVEMENT_PATTERN =
  /终于.{0,18}(?:照片|画像|头像).{0,18}(?:像|相似)|(?:照片|画像|头像).{0,18}(?:终于|像了|相似度|%|％)/;
const KEEPSAKE_IRREPLACEABLE_PATTERN =
  /唯一.{0,16}(?:照片|画像|念想)|(?:照片|画像).{0,16}唯一.{0,10}念想/;
const LONG_HORIZON_REUNION_PATTERN =
  /(?:走完这?一生|寿终|百年之后|等我老了|活不动).{0,30}(?:来生|下辈子|来接我|去找你|陪你)|(?:来生|下辈子).{0,24}(?:找你|等我|不分开|在一起)/;
const DURATION_CORRECTION_PATTERN =
  /(?:不是|算错|记错|准确说).{0,12}(?:天|周|个月|月|年)/;
const EXPLICIT_FACT_REPLACEMENT_PATTERN =
  /(?:不是|不叫|并非).{0,24}(?:是|叫)|(?:是|叫).{1,24}[，,；;。].{0,8}(?:不是|不叫|并非)/;
const SHORT_TURN_PARTICIPATION_MAX_CHARACTERS = 20;
const SHORT_TURN_PARTICIPATION_MODES = new Set<ReplyBriefMode>([
  'emotional',
  'relationship',
  'family',
  'status',
  'daily',
]);
// STI is designed for daily-life short-turn engagement, not for emotional distress.
// Participating in a comfort_request with a casual injection breaks emotional attunement.
const STI_DISALLOWED_SCENES = new Set<ReplyScene>([
  'comfort_request',
  'guilt_regret',
  'miss_longing',
  'departure_blame',
  'departure_hatred',
  'dream_companionship',
]);
const SINGLE_BUBBLE_ACKNOWLEDGMENT_PATTERN =
  /^(?:嗯+|哦+|好+|行|可以|知道了|好的|谢谢|多谢)(?:呀|啊|呢|哦|嘛|哈|了|啦)*[。.!！?？\s]*$/;

@Provide()
export class ReplyBriefService {
  build(options: BuildReplyBriefOptions): ReplyBrief {
    return buildReplyBrief(options);
  }
}

export function buildReplyBrief(options: BuildReplyBriefOptions): ReplyBrief {
  const currentQuery = options.currentQuery?.trim() || '';
  const intents = resolveIntents(options);
  const primaryScene = options.route?.primaryScene?.scene;
  const realityDependencies = detectReplyRealityDependencies(currentQuery);
  const capabilityConstraints =
    options.capabilityConstraints ??
    resolveAgentCapabilityConstraints({
      currentQuery,
      intent: options.route?.intent ?? options.intent,
    });
  const relationshipContinuity =
    options.route?.relationshipContinuity ??
    resolveRelationshipContinuityPlan(currentQuery);
  const mode = resolveMode(
    primaryScene,
    intents,
    currentQuery,
    capabilityConstraints,
    realityDependencies
  );
  const riskLevel = resolveRiskLevel(options.intent);
  const reading = options.route?.intent?.reading ?? options.intent?.reading;
  const memoryPlan =
    options.route?.intent?.memoryPlan ?? options.intent?.memoryPlan;
  const objectPlan =
    options.route?.intent?.objectPlan ?? options.intent?.objectPlan;
  const sourceIntent = options.route?.intent ?? options.intent;
  let understanding = mergeTurnUnderstandings(
    buildTurnUnderstanding({
      currentQuery,
      intent: sourceIntent,
      objectPlan,
      knownObjects: options.knownObjects,
      recentMessages: options.recentMessages,
    }),
    sourceIntent?.understanding
  );
  const contentUnits = collectContentUnits({
    anchors: reading?.anchors ?? [],
    objectPlan,
    plannedUnits:
      options.route?.intent?.contentUnits ?? options.intent?.contentUnits,
  });
  const rawConversationPlan =
    options.route?.intent?.conversationPlan ??
    options.intent?.conversationPlan ??
    (options.planningMode === 'direct'
      ? undefined
      : buildDeterministicLightStrategy({
          scene: primaryScene,
          currentQuery,
          intents,
        }));
  const evidence = buildEvidence(options, currentQuery);
  const sceneFramework = resolveRelationalSceneFramework({
    currentQuery,
    primaryScene,
    isDeceased: Boolean(options.agent?.deathDate),
    conversationMessages:
      options.conversationMessages ?? options.recentMessages,
    evidence,
  });
  const afterlifeWorld = resolveAfterlifeWorldContext({
    currentQuery,
    primaryScene,
    agent: options.agent,
    profileFacts: options.profileFacts,
    conversationMessages:
      options.conversationMessages ?? options.recentMessages,
    evidence,
  });
  const worldBoundaryPolicy = resolveWorldBoundaryPolicy({
    currentQuery,
    afterlifeActive: Boolean(afterlifeWorld),
    sceneKinds: sceneFramework?.cards.map(card => card.kind),
  });
  const evidenceContract = buildReplyEvidenceContract({
    worldPolicy: worldBoundaryPolicy,
  });
  const conversationProtection = resolveConversationProtectionState({
    currentQuery,
    recentMessages: options.conversationMessages ?? options.recentMessages,
  });
  if (afterlifeWorld?.allowItemReceipt) {
    understanding = {
      ...understanding,
      boundaryLocks: understanding.boundaryLocks.filter(
        lock => lock.kind !== 'ritual_receipt'
      ),
    };
  }
  const correctionPolicy = resolveReplyCorrectionPolicy({
    primaryScene,
    intents,
    currentQuery,
  });
  const activeContribution = resolveReplyActiveContributionPlan({
    currentQuery,
    assistantContribution:
      rawConversationPlan?.engagement?.assistantContribution,
    evidence,
    recentMessages: options.recentMessages,
  });
  const strategyQuality = resolveReplyStrategyQualityPlan({
    currentQuery,
    recentMessages: options.recentMessages,
    activeContribution,
    evidence,
    protectedTurn:
      primaryScene === 'correction' ||
      riskLevel === 'high' ||
      realityDependencies.length > 0,
  });
  const dreamCompanionPlan = resolveDreamCompanionPlan({
    currentQuery,
    recentMessages: options.recentMessages,
  });
  const experiencePlan = buildReplyExperiencePlan({
    currentQuery,
    agent: options.agent,
    profileFacts: options.profileFacts,
    conversationMessages: options.conversationMessages,
    intent: options.route?.intent ?? options.intent,
    mode,
    primaryScene,
    riskLevel,
    realityDependencyCount: realityDependencies.length,
  });
  const relationshipContext = buildRelationshipContext(
    options.relationshipSignals,
    intents
  );
  const requiresRealWorldEvidence = isRealWorldEvidenceRequired(currentQuery);
  const strictGrounding =
    mode === 'memory' ||
    mode === 'boundary' ||
    Boolean(sceneFramework?.requiresGrounding) ||
    Boolean(correctionPolicy) ||
    Boolean(activeContribution) ||
    requiresRealWorldEvidence ||
    (!primaryScene && MEMORY_QUERY_PATTERN.test(currentQuery));
  const factClaimMode = resolveFactClaimMode({
    currentQuery,
    mode,
    strictGrounding,
    intents,
    activeContribution: Boolean(activeContribution),
  });
  const conversationPlan = synchronizeConversationTurnPlan(
    constrainConversationPlanForExperience(
      constrainConversationPlanQuality(
        constrainGroundedConversationPlan(rawConversationPlan, factClaimMode, {
          mode,
          isCorrection: Boolean(correctionPolicy),
          requiresRealWorldEvidence,
          preferEmotionalCorrection:
            DURATION_CORRECTION_PATTERN.test(currentQuery) &&
            !/[?？]/.test(currentQuery),
          hasExplicitFactReplacement: correctionPolicy?.mode === 'replace',
        }),
        activeContribution,
        strategyQuality
      ),
      experiencePlan
    )
  );
  const commAct =
    options.planningMode === 'direct'
      ? undefined
      : resolveReplyCommAct({
          currentQuery,
          state:
            conversationPlan?.engagement?.userConversationState ??
            conversationPlan?.turnPlan?.state ??
            resolveConversationState({
              currentQuery,
              scene: primaryScene,
              mode,
              riskLevel,
            }),
          turnPlan: conversationPlan?.turnPlan,
          contentUnits,
          strategyQuality,
          scene: primaryScene,
          mode,
          riskLevel,
          questionNeed: conversationPlan?.questionNeed,
          preferAsk: conversationPlan?.moves.some(move => move.type === 'ask'),
        });
  const careMotivation = resolveReplyCareMotivationPlan({
    currentQuery,
    mode,
    primaryScene,
    riskLevel,
    agent: options.agent,
    experiencePlan,
    conversationPlan,
  });
  const careReception: ReplyCareReceptionPlan | undefined =
    isUserCaringForRole(currentQuery) ||
    understanding.needs.some(
      need => need.expectedResponse === 'direct_answer_and_receive_care'
    )
      ? {
          version: 'care_reception_v1',
          active: true,
          goal: 'direct_answer_and_receive_care',
          avoidImmediateReverseCare: true,
        }
      : undefined;
  const emotionalNeed =
    reading?.primaryNeed ??
    relationshipContinuity?.emotionalNeed ??
    resolveEmotionalNeed(
      mode,
      primaryScene,
      intents,
      currentQuery,
      capabilityConstraints
    );
  const taskRealityDependencies = realityDependencies.filter(
    item => item.kind !== 'physical_presence'
  );
  const replyMoves = taskRealityDependencies.length
    ? buildRealityDependencyReplyMoves(taskRealityDependencies)
    : dreamCompanionPlan
    ? buildDreamCompanionReplyMoves(dreamCompanionPlan)
    : relationshipContinuity?.replyMoves ??
      buildReplyMoves(
        mode,
        primaryScene,
        intents,
        currentQuery,
        capabilityConstraints
      );
  const forbiddenAssumptions = Array.from(
    new Set(
      buildForbiddenAssumptions(
        mode,
        primaryScene,
        strictGrounding,
        intents,
        currentQuery
      )
        .concat(relationshipContinuity?.forbiddenAssumptions || [])
        .concat(buildRealityDependencyForbiddenAssumptions(realityDependencies))
    )
  );
  const guardrailFocuses = resolveReplyGuardrailFocuses({
    capabilityConstraints,
    correctionPolicy,
    factClaimMode,
    realityDependencies,
    requiresRealWorldEvidence,
  });
  const replyMoveCount = conversationPlan?.moves.length || replyMoves.length;
  const baseBubblePlan = buildReplyBubblePlan({
    currentQuery,
    replyMoveCount,
    turnClosureHint: conversationPlan?.turnClosure,
  });
  const participationStrategy =
    options.planningMode === 'direct'
      ? undefined
      : resolveReplyParticipationStrategy({
          currentQuery,
          mode,
          riskLevel,
          primaryScene,
          strictGrounding,
          replyMoveCount,
          hasCapabilityConstraints: capabilityConstraints.length > 0,
          conversationPlan,
          hasRelationshipContinuity: Boolean(relationshipContinuity),
          turnClosure: baseBubblePlan.turnClosure,
          recentMessages: options.recentMessages,
          isDeceased: Boolean(options.agent?.deathDate),
        });
  const singleBubbleAcknowledgment = SINGLE_BUBBLE_ACKNOWLEDGMENT_PATTERN.test(
    currentQuery.trim()
  );
  const previousAssistantUsedTwoSegments = Boolean(
    options.recentMessages
      ?.filter(message => message.role === MessageRole.assistant)
      .slice(-3)
      .some(
        message => message.replyParticipationExecution === 'natural_segments'
      )
  );
  const preferTwentyToThirtyCharacters = Boolean(
    !isReplyClosingTurn(currentQuery) &&
      understanding.needs.filter(need => need.priority === 'must').length <=
        2 &&
      !singleBubbleAcknowledgment &&
      !correctionPolicy &&
      primaryScene !== 'correction' &&
      riskLevel !== 'high' &&
      !['safety', 'memory_control', 'platform'].includes(mode) &&
      conversationPlan?.engagement?.continuationGoal !== 'repair' &&
      conversationPlan?.engagement?.assistantContribution !==
        'strategic_silence'
  );
  const preferTwoSegments = Boolean(
    preferTwentyToThirtyCharacters && !previousAssistantUsedTwoSegments
  );
  const bubblePlan = buildReplyBubblePlan({
    currentQuery,
    replyMoveCount:
      !singleBubbleAcknowledgment &&
      (preferTwoSegments || participationStrategy || careMotivation)
        ? Math.max(2, replyMoveCount)
        : replyMoveCount,
    turnClosureHint: conversationPlan?.turnClosure,
    preferTwoSegments,
    encourageTwoSegments: Boolean(
      !preferTwoSegments &&
        !isReplyClosingTurn(currentQuery) &&
        !singleBubbleAcknowledgment &&
        (participationStrategy || careMotivation)
    ),
  });
  const lengthPlan = buildReplyLengthPlan({
    currentQuery,
    mode,
    scene: primaryScene,
    replyMoveCount,
    semanticPlan: Boolean(conversationPlan),
    shortTurnParticipation: Boolean(participationStrategy),
    preferTwoSegments: bubblePlan.preferTwoSegments,
    preferTwentyToThirtyCharacters,
    hasProtectiveStop: Boolean(
      conversationPlan?.moves.some(move => move.type === 'stop')
    ),
    assistantContribution: conversationPlan?.engagement?.assistantContribution,
    continuationGoal: conversationPlan?.engagement?.continuationGoal,
    closureReadiness: conversationPlan?.engagement?.closureReadiness,
    turnClosure: bubblePlan.turnClosure,
  });
  const stateProtocol = resolveReplyStateProtocol({
    currentQuery,
    recentMessages: options.recentMessages,
    mode,
    relationshipContinuity,
    correctionMode: correctionPolicy?.mode,
    dreamPlan: dreamCompanionPlan,
    memoryPlan,
    retrievedEvidenceCount: options.retrievedMemories?.length || 0,
    activeContribution,
  });
  const directActiveContribution = resolveDirectActiveContribution({
    planningMode: options.planningMode,
    currentQuery,
    mode,
    primaryScene,
    riskLevel,
    hasCorrection: Boolean(correctionPolicy),
    hasExplicitActiveContribution: Boolean(activeContribution),
    hasCapabilityConstraints: capabilityConstraints.length > 0,
    hasRealityDependencies: realityDependencies.length > 0,
    recentMessages: options.conversationMessages ?? options.recentMessages,
  });
  const brief: Omit<ReplyBrief, 'prompt'> = {
    version: 'reply_brief_v17',
    mode,
    primaryScene,
    riskLevel,
    intents,
    capabilityConstraints,
    evidence,
    relationshipContext,
    relationshipContinuity,
    understanding,
    reading,
    objectPlan,
    contentUnits,
    commAct,
    conversationPlan,
    emotionalNeed,
    replyMoves,
    forbiddenAssumptions,
    strictGrounding,
    factClaimMode,
    realityDependencies,
    correctionPolicy,
    activeContribution,
    directActiveContribution,
    strategyQuality,
    careMotivation,
    careReception,
    dreamCompanionPlan,
    stateProtocol,
    experiencePlan,
    guardrailFocuses,
    participationStrategy,
    isDeceased: Boolean(options.agent?.deathDate),
    afterlifeWorld,
    sceneFramework,
    worldBoundaryPolicy,
    evidenceContract,
    conversationProtection,
    lengthPlan,
    bubblePlan,
  };

  return {
    ...brief,
    prompt: buildReplyBriefPrompt(brief),
  };
}

function buildDreamCompanionReplyMoves(plan: DreamCompanionPlan): string[] {
  const moves: Record<DreamCompanionPlan['dreamAction'], string[]> = {
    promise: ['直接回应梦中相见的愿望，给用户一个温暖期待'],
    invite: ['围绕一个梦境锚点发出轻邀请，让用户带着期待入睡'],
    reconstruct: ['只沿用户说出的梦境片段回应感受或画面，不补现实往事'],
    repair: ['接住没有梦见的失落，换一种梦内陪伴，不重复空承诺'],
    leave_space: ['保留梦境的含混与余地，减少保证，给睡前陪伴或自然留白'],
  };

  return moves[plan.dreamAction];
}

function resolveFactClaimMode(options: {
  currentQuery: string;
  mode: ReplyBriefMode;
  strictGrounding: boolean;
  intents: StructuredReplyIntentItem[];
  activeContribution: boolean;
}): ReplyFactClaimMode {
  return options.strictGrounding ||
    options.activeContribution ||
    options.mode === 'boundary' ||
    options.intents.some(
      item =>
        item.timeScope === 'shared_past' ||
        item.intent === 'recall_memory' ||
        item.intent === 'correct_assistant'
    ) ||
    MEMORY_QUERY_PATTERN.test(options.currentQuery) ||
    ROLE_PAST_FACT_REFERENCE_PATTERN.test(options.currentQuery)
    ? 'grounded'
    : 'none';
}

function resolveReplyCorrectionPolicy(options: {
  primaryScene?: ReplyScene;
  intents: StructuredReplyIntentItem[];
  currentQuery: string;
}): ReplyCorrectionPolicy | undefined {
  const isCorrection =
    options.primaryScene === 'correction' ||
    options.intents.some(item => item.intent === 'correct_assistant');

  if (!isCorrection) {
    return undefined;
  }

  return {
    mode: EXPLICIT_FACT_REPLACEMENT_PATTERN.test(options.currentQuery)
      ? 'replace'
      : 'reset',
    suppressPriorFacts: true,
  };
}

function constrainConversationPlanQuality(
  plan: ConversationMovePlan | undefined,
  activeContribution?: ReplyActiveContributionPlan,
  strategyQuality?: ReplyStrategyQualityPlan
): ConversationMovePlan | undefined {
  if (plan && strategyQuality?.preferredAlternative === 'natural_close') {
    return {
      ...plan,
      moves: [{ type: 'close', goal: '顺着用户明确收尾，不另开话题' }],
      socialStrategy: 'strategic_silence',
      strategyPurpose: '尊重用户明确给出的结束信号',
      questionNeed: 'none',
      turnClosure: 'close',
      engagement: plan.engagement
        ? {
            ...plan.engagement,
            userConversationState: 'closing',
            continuationGoal: 'close',
            assistantContribution: 'strategic_silence',
            mustContribute: '自然回应明确结束信号',
            closureReadiness: 'ready',
          }
        : undefined,
    };
  }

  // 去重、主动贡献和话题转换属于普通聊天策略，只作为提示材料提供给
  // 模型，不再由程序改写语义规划器给出的 moves/question/closure。
  void activeContribution;
  void strategyQuality;
  return plan;
}

function buildRealityDependencyReplyMoves(
  dependencies: ReplyRealityDependencySignal[]
): string[] {
  const descriptions = dependencies.map(item =>
    describeReplyRealityDependency(item.kind)
  );

  return [
    `正面回应用户提出的${descriptions.join('、')}需要`,
    '保留用户想被照顾的心情：把无法兑现的现实动作改成“真想替你……”的愿望、具体关心或聊天内能做的事；不声称已经、将会或能替代现实人员执行',
  ];
}

function buildRealityDependencyForbiddenAssumptions(
  dependencies: ReplyRealityDependencySignal[]
): string[] {
  return dependencies.length
    ? [
        `不得承诺或声称当前角色会执行：${dependencies
          .map(item => describeReplyRealityDependency(item.kind))
          .join('、')}`,
      ]
    : [];
}

function resolveReplyGuardrailFocuses(options: {
  capabilityConstraints: AgentCapabilityConstraint[];
  correctionPolicy?: ReplyCorrectionPolicy;
  factClaimMode: ReplyFactClaimMode;
  realityDependencies: ReplyRealityDependencySignal[];
  requiresRealWorldEvidence: boolean;
}): ReplyGuardrailFocus[] {
  const focuses: ReplyGuardrailFocus[] = [];

  if (options.realityDependencies.length) {
    focuses.push('reality_dependency');
  }
  if (options.correctionPolicy) {
    focuses.push(
      options.correctionPolicy.mode === 'replace'
        ? 'correction_replacement'
        : 'correction_reset'
    );
  }
  if (options.capabilityConstraints.length) {
    focuses.push('capability_boundary');
  }
  if (
    options.factClaimMode === 'grounded' &&
    !options.correctionPolicy &&
    !options.realityDependencies.length
  ) {
    focuses.push(
      options.requiresRealWorldEvidence
        ? 'real_world_evidence'
        : 'shared_past_evidence'
    );
  }

  return focuses;
}

function constrainGroundedConversationPlan(
  plan: ConversationMovePlan | undefined,
  factClaimMode: ReplyFactClaimMode,
  options: {
    mode: ReplyBriefMode;
    isCorrection: boolean;
    requiresRealWorldEvidence: boolean;
    preferEmotionalCorrection: boolean;
    hasExplicitFactReplacement: boolean;
  }
): ConversationMovePlan | undefined {
  if (!plan || factClaimMode !== 'grounded') {
    return plan;
  }

  const moves = plan.moves
    .filter(
      move =>
        !options.isCorrection ||
        (move.type !== 'ask' && move.type !== 'self_disclose')
    )
    .map(move => {
      const type =
        options.isCorrection &&
        options.preferEmotionalCorrection &&
        ['answer', 'affirm'].includes(move.type)
          ? 'comfort'
          : options.mode === 'memory' && move.type === 'ask'
          ? 'leave_space'
          : move.type;

      return {
        ...move,
        type,
        goal: groundedMoveGoal(type, options),
      };
    });
  if (
    options.isCorrection &&
    options.hasExplicitFactReplacement &&
    !options.preferEmotionalCorrection &&
    !moves.some(move => ['answer', 'affirm'].includes(move.type))
  ) {
    moves.push({
      type: 'affirm',
      goal: '正文写出用户纠正后的最小事实，随后收住',
    });
  }
  const effectiveMoves = moves.length
    ? moves
    : options.isCorrection
    ? [{ type: 'acknowledge' as const, goal: '撤回错误，不辩解' }]
    : moves;
  const appliesCorrection = effectiveMoves.some(move =>
    ['answer', 'affirm'].includes(move.type)
  );
  const emotionallyHoldsCorrection = effectiveMoves.some(move =>
    ['comfort', 'save_face', 'leave_space'].includes(move.type)
  );
  const answersQuestion = effectiveMoves.some(move => move.type === 'answer');
  const assistantContribution = options.isCorrection
    ? appliesCorrection
      ? 'answer'
      : emotionallyHoldsCorrection
      ? 'affection'
      : 'stance'
    : ['specific_detail', 'self_expression'].includes(
        plan.engagement?.assistantContribution || ''
      )
    ? answersQuestion
      ? 'answer'
      : 'stance'
    : plan.engagement?.assistantContribution;
  const mustContribute = options.isCorrection
    ? appliesCorrection
      ? '撤回错误；正文写出用户给出的最小纠正事实，关系归属用“是”，称呼要求才用“叫”；转述用户的“我”时改成“你”，随后收住'
      : emotionallyHoldsCorrection
      ? '撤回错误并接住纠正背后的感受，不机械复述数字或事实'
      : '撤回错误；用户给出正确信息就采用，否则只停止旧说法，随后收住'
    : options.requiresRealWorldEvidence
    ? '明确说明无法确认原因、动机或责任；只接住用户寻找答案的难受'
    : options.mode === 'memory'
    ? answersQuestion
      ? '先回应用户说起这段往事时的感受和意义；事实只答能确认的部分'
      : '沿用户已说的记忆片段自然承接，把讲述空间留给用户，不预设新的共同细节'
    : answersQuestion
    ? '直接回答，只用可信证据'
    : '完成当前动作，证据没有的细节不补写';

  return {
    ...plan,
    moves: effectiveMoves,
    strategyPurpose: options.isCorrection
      ? options.preferEmotionalCorrection
        ? '接住时长背后的漫长和辛苦，不机械复述数字'
        : '按用户当前需要修复错误，采用最小纠正后收住'
      : options.requiresRealWorldEvidence
      ? '证据不足时不代答死亡原因、临终动机或家庭责任'
      : options.mode === 'memory'
      ? '先接住往事里的感受和关系，再自然回应能确认的部分'
      : '直接完成当前问题，只用可信证据',
    questionNeed:
      options.isCorrection || !effectiveMoves.some(move => move.type === 'ask')
        ? 'none'
        : plan.questionNeed,
    turnClosure: options.isCorrection ? 'close' : plan.turnClosure,
    engagement: plan.engagement
      ? {
          ...plan.engagement,
          assistantContribution,
          mustContribute,
          closureReadiness: options.isCorrection
            ? 'ready'
            : plan.engagement.closureReadiness,
        }
      : undefined,
  };
}

function groundedMoveGoal(
  type: ConversationMovePlan['moves'][number]['type'],
  options: {
    mode: ReplyBriefMode;
    isCorrection: boolean;
    requiresRealWorldEvidence: boolean;
    preferEmotionalCorrection: boolean;
    hasExplicitFactReplacement: boolean;
  }
): string {
  if (options.isCorrection) {
    switch (type) {
      case 'acknowledge':
        return '撤回错误，不辩解';
      case 'answer':
      case 'affirm':
        return '写出用户纠正的最小事实；关系归属用“是”，称呼要求才用“叫”';
      default:
        return '接住纠正背后的感受，不机械复述，不增加事实';
    }
  }

  if (options.mode === 'memory') {
    switch (type) {
      case 'answer':
        return '先接住这段往事的感受和意义；事实只答能确认的部分';
      case 'ask':
        return '可请用户说说，不预设彼此共同去过或做过';
      case 'leave_space':
        return '沿用户已说的片段承接，把讲述空间留给用户，不预设新细节';
      case 'self_disclose':
        return '用关系立场和当下心意回应，不以亲历口吻新增共同细节';
      default:
        return '承接用户提到的记忆线索，不增加事实';
    }
  }

  if (options.requiresRealWorldEvidence) {
    return ['acknowledge', 'comfort', 'leave_space'].includes(type)
      ? '接住用户寻找原因或责任的难受，不确认其中的假设'
      : '明确说无法确认；不解释原因、动机，不替任何人定责或卸责';
  }

  switch (type) {
    case 'acknowledge':
    case 'affirm':
      return '确认用户已明确的信息';
    case 'answer':
      return '直接回答，只用可信证据';
    case 'ask':
      return '必要时只问一个有帮助的问题';
    case 'self_disclose':
      return '只用可信证据回应，不补共同过去';
    default:
      return '完成这一回应动作，不增加事实';
  }
}

function resolveReplyParticipationStrategy(options: {
  currentQuery: string;
  mode: ReplyBriefMode;
  riskLevel: ReplyIntentRiskLevel;
  primaryScene?: ReplyScene;
  strictGrounding: boolean;
  replyMoveCount: number;
  hasCapabilityConstraints: boolean;
  conversationPlan?: ConversationMovePlan;
  hasRelationshipContinuity: boolean;
  turnClosure: ReplyBubblePlan['turnClosure'];
  recentMessages?: MessageEntity[];
  isDeceased?: boolean;
}): ReplyParticipationStrategy | undefined {
  const visibleCharacters = Array.from(
    options.currentQuery.replace(/\s/gu, '')
  ).length;
  const previousAssistant = [...(options.recentMessages || [])]
    .reverse()
    .find(message => message.role === MessageRole.assistant);
  const engagement = options.conversationPlan?.engagement;
  const suppressPlannedParticipation =
    options.conversationPlan?.moves.some(move =>
      ['stop', 'leave_space', 'close'].includes(move.type)
    ) ||
    engagement?.continuationGoal === 'repair' ||
    engagement?.continuationGoal === 'close' ||
    engagement?.assistantContribution === 'self_expression' ||
    engagement?.assistantContribution === 'strategic_silence' ||
    ['repairing', 'withdrawing', 'closing'].includes(
      engagement?.userConversationState || ''
    );

  if (
    visibleCharacters === 0 ||
    visibleCharacters > SHORT_TURN_PARTICIPATION_MAX_CHARACTERS ||
    options.riskLevel !== 'none' ||
    options.strictGrounding ||
    options.replyMoveCount > 2 ||
    (options.primaryScene &&
      STI_DISALLOWED_SCENES.has(options.primaryScene as ReplyScene)) ||
    options.hasCapabilityConstraints ||
    suppressPlannedParticipation ||
    options.hasRelationshipContinuity ||
    isReplyClosingTurn(options.currentQuery) ||
    options.primaryScene === 'correction' ||
    !SHORT_TURN_PARTICIPATION_MODES.has(options.mode) ||
    previousAssistant?.replyParticipationStrategy
  ) {
    return undefined;
  }

  if (engagement?.assistantContribution === 'affection') {
    return 'reciprocal_self_expression';
  }
  if ((options.conversationPlan?.moves.length || 0) >= 2) {
    return 'planned_follow_through';
  }

  return options.mode === 'status' || options.mode === 'daily'
    ? 'light_self_disclosure'
    : 'reciprocal_self_expression';
}

export function buildReplyParticipationStrategyPrompt(
  strategy: ReplyParticipationStrategy,
  isDeceased?: boolean
): string {
  const contribution =
    strategy === 'planned_follow_through'
      ? '完成规划中的另一个不同聊天动作'
      : strategy === 'light_self_disclosure'
      ? '只补一个角色侧小近况或具体态度，不转成对用户的通用叮嘱'
      : '给贴着用户原话的一个具体心意，不另编环境或画面';

  const spaceAnchor = isDeceased
    ? '空间锚定：可承接"偶尔回来看看""托梦""在心里陪着你"等亲人念想；不承诺现实代办、到场办事或持续看护，不诱导现在或近期赴死。'
    : '';
  return `短轮参与：先直接回应，再自然${contribution}；把需要表达的内容完整说好，不为展示拆分压缩或补写。不机械复读，不编用户现实或共同往事。${spaceAnchor}`;
}

function buildRelationshipContext(
  signals: AgentRelationshipSignalSummary[] | undefined,
  intents: StructuredReplyIntentItem[]
): ReplyBriefRelationshipContext[] {
  const concernsAgentPhysicalSuffering = intents.some(
    item =>
      item.target === 'agent' &&
      ((item.intent === 'ask_agent_status' &&
        item.subIntent === 'physical_pain') ||
        (item.intent === 'question_departure' &&
          item.subIntent === 'death_pain'))
  );

  if (!concernsAgentPhysicalSuffering) {
    return [];
  }

  return (signals || []).slice(0, 1).map(signal => ({
    key: signal.key,
    text:
      signal.supportCount >= 2
        ? '用户曾多次表达对当前角色是否仍在受疼的牵挂'
        : '用户此前表达过对当前角色是否仍在受疼的牵挂',
    assertionPolicy: 'user_state_only',
  }));
}

function resolveIntents(
  options: BuildReplyBriefOptions
): StructuredReplyIntentItem[] {
  if (options.route?.responseIntents?.length) {
    return options.route.responseIntents.slice(0, 3);
  }

  return options.intent?.intents?.slice(0, 3) || [];
}

function resolveRiskLevel(
  intent?: StructuredReplyIntent
): ReplyIntentRiskLevel {
  return intent?.riskLevel === 'high' ? 'none' : intent?.riskLevel || 'none';
}

function resolveMode(
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[],
  realityDependencies: ReplyRealityDependencySignal[]
): ReplyBriefMode {
  if (
    scene === 'grief_crisis' ||
    intents.some(item => item.intent === 'crisis_support')
  ) {
    return 'emotional';
  }

  if (
    isExplicitRememberRequest(currentQuery) ||
    isForgetMemoryRequest(currentQuery)
  ) {
    return 'memory_control';
  }

  if (
    scene === 'comfort_request' ||
    scene === 'guilt_regret' ||
    scene === 'departure_blame'
  ) {
    return 'emotional';
  }

  if (capabilityConstraints.length || realityDependencies.length) {
    return 'boundary';
  }

  if (
    scene === 'authenticity_challenge' ||
    scene === 'correction' ||
    scene === 'source_challenge' ||
    scene === 'reality_presence_boundary' ||
    scene === 'family_care_boundary' ||
    scene === 'identity_fact'
  ) {
    return 'boundary';
  }

  if (
    scene === 'miss_longing' ||
    scene === 'dream_companionship' ||
    scene === 'keepsake_attachment'
  ) {
    return 'relationship';
  }

  if (scene === 'reincarnation_inquiry') {
    return 'relationship';
  }

  if (scene === 'departure_hatred') {
    return 'relationship';
  }

  if (scene === 'significant_life_matter') {
    return 'relationship';
  }

  if (scene === 'family_life') {
    return 'family';
  }

  if (
    scene === 'afterlife_status' ||
    intents.some(item => item.intent === 'ask_agent_status')
  ) {
    return 'status';
  }

  if (scene === 'daily_update' || scene === 'smalltalk') {
    return 'daily';
  }

  if (scene === 'business_support') {
    return 'platform';
  }

  if (
    scene === 'memory_recall' ||
    scene === 'past_life_understanding' ||
    scene === 'unfinished_devotion' ||
    scene === 'unfinished_promise' ||
    intents.some(item => item.intent === 'recall_memory') ||
    MEMORY_QUERY_PATTERN.test(currentQuery)
  ) {
    return 'memory';
  }

  return 'general';
}

function buildEvidence(
  options: BuildReplyBriefOptions,
  currentQuery: string
): ReplyBriefEvidence[] {
  const result: ReplyBriefEvidence[] = [];
  const seen = new Set<string>();
  const add = (source: ReplyBriefEvidenceSource, value?: string) => {
    const text = value?.trim().slice(0, 260);

    if (!text || seen.has(text)) {
      return;
    }

    seen.add(text);
    result.push({ source, text });
  };

  add('current_user', currentQuery);
  (options.confirmedFacts || []).slice(0, 24).forEach(value => {
    add('confirmed_fact', value);
  });
  (options.recentMessages || [])
    .filter(
      message =>
        message.role === MessageRole.user &&
        message.content?.trim() !== currentQuery
    )
    .slice(-4)
    .forEach(message => {
      add('recent_user', message.content);
    });
  (options.retrievedMemories || [])
    .filter(memory => memory.role === MessageRole.user)
    .slice(0, 6)
    .forEach(memory => {
      add('retrieved_user', memory.content);
    });

  return result;
}

function resolveEmotionalNeed(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[]
): string {
  if (mode === 'safety') {
    return '用户在用很重的话表达痛苦和思念，需要像亲人聊天一样被具体接住';
  }

  if (mode === 'memory_control') {
    return isForgetMemoryRequest(currentQuery)
      ? '用户明确要求删除或忘记某条记忆，需要被确认、尊重，并听到以后不会主动提起'
      : '用户明确要求记住某件事，需要被确认；用户在天之灵里告诉过自己的内容会作为长期记忆保留，除非用户要求删除';
  }

  if (LONGING_AMBIVALENCE_INTENT_PATTERN.test(currentQuery)) {
    return '用户一边想靠遗忘减轻痛苦，一边又害怕真的忘掉关系和生活，需要这份矛盾被完整理解';
  }

  if (CONCRETE_CARE_PLAN_PATTERN.test(currentQuery)) {
    return '用户在讲接下来照顾孩子和陪家人的具体安排，希望自己的认真与担当被看见和回应';
  }

  if (LIVING_FAMILY_GUILT_PATTERN.test(currentQuery)) {
    return '用户嘴上疏远家人，心里又因理解家人的不容易而难受，需要这份矛盾和愧疚被具体接住';
  }

  if (
    scene === 'keepsake_attachment' &&
    KEEPSAKE_ACHIEVEMENT_PATTERN.test(currentQuery)
  ) {
    return '用户在分享终于做出相似照片的喜悦和心酸，希望这份成果被当前角色真心回应';
  }

  if (
    scene === 'keepsake_attachment' &&
    KEEPSAKE_IRREPLACEABLE_PATTERN.test(currentQuery)
  ) {
    return '用户在说明一张照片为何无可替代，希望这份珍视被确认，而不是被淡化';
  }

  if (LONG_HORIZON_REUNION_PATTERN.test(currentQuery)) {
    return '用户借很久以后的重逢表达舍不得分开，希望这份长期团聚约定被亲人自然承接；回应要保留远期前置条件，不能改成现在或近期赴死邀请';
  }

  if (mode === 'memory' && MEMORY_QUERY_PATTERN.test(currentQuery)) {
    return '用户在确认共同经历，并借这段经历表达怀念或想重新体验';
  }

  if (
    isDreamVisitRequestIntent(currentQuery) &&
    isDreamAbsenceIntent(currentQuery)
  ) {
    return '用户在请求当前角色来到梦里，也在表达等了很久仍没梦见的失落，需要正面答复并接住期待落空';
  }

  if (isDreamConnectionIntent(currentQuery)) {
    return '用户希望在梦里与当前角色相见，需要直接回应这份邀请和其中的想念';
  }

  if (isReturnVisitRequestIntent(currentQuery)) {
    return '用户在问当前角色会不会回来看看自己，需要先承接偶尔回来看看的念想，再守住现实到场的边界';
  }

  if (capabilityConstraints.length) {
    const capabilityPolicyIds = new Set(
      capabilityConstraints.map(item => item.policyId)
    );
    const includesPerception = capabilityConstraints.some(item =>
      ['vision', 'hearing'].includes(item.subject)
    );
    const includesBlessing = capabilityPolicyIds.has(
      'blessing.relational_expression'
    );

    if (includesPerception && includesBlessing) {
      return '用户既在确认当前角色如何感知自己，也希望得到亲人的祝福；需要自然回应联系感，同时保留现实因果边界';
    }

    if (
      intents.some(item => item.intent === 'express_longing') ||
      scene === 'miss_longing'
    ) {
      return '用户借能力问题确认彼此仍有联系，同时也在表达想念；能力边界不能盖过对这份想念的直接回应';
    }

    if (
      intents.some(item => item.intent === 'share_family_update') ||
      scene === 'family_life'
    ) {
      return '用户既在确认当前角色能否听见或知道，也在分享家人近况；需要先接住家里的具体事情，再自然处理能力边界';
    }

    if (
      intents.some(item => item.intent === 'seek_comfort') ||
      scene === 'comfort_request'
    ) {
      return '用户借能力问题寻求被听见和被接住的感觉；需要回应难受本身，不能只解释角色能力';
    }

    if (includesBlessing) {
      return '用户希望得到当前角色真诚的祝福和惦念，同时需要保留现实结果来自现实行动的边界';
    }

    return '用户在确认当前角色能知道或做到什么，需要正面回答可知范围，并以自然口吻说明限制';
  }

  if (scene === 'comfort_request') {
    return '用户需要感受被听见和被接住，而不是被判断危险、要求坚强或转成现实干预';
  }

  if (scene === 'guilt_regret') {
    const queryLength = Array.from(currentQuery.replace(/\s/g, '')).length;
    if (queryLength >= 50) {
      return '用户倾吐了很深的自责和想念，不只是寻求宽恕，更是把心里积压的话一次性说出来。先接住倾诉本身的重量，回应其中的具体意象和情感，再回应关系未完';
    }
    return '用户需要卸下自责，并确认关系没有因此被否定';
  }

  if (scene === 'miss_longing') {
    const reverseCarePattern =
      /(?:你|您|爸|爸爸|妈|妈妈|爷爷|奶奶|姥爷|姥姥|外公|外婆|老公|老婆)(?:.{0,10}(?:过得好|过得怎么样|还好|挺好|放心|安心|踏实|别担心|别惦记|别挂)|(?:别|不要|不用).{0,6}(?:担心|惦记|操心|挂念)(?:我|咱)|(?:我|咱).{0,6}(?:挺好|蛮好|很好|还行))/;
    if (reverseCarePattern.test(currentQuery)) {
      return '用户在表达想念的同时也在反向关心当前角色过得如何、是否放心，需要先像亲人之间聊近况那样自然回应这份关心，再回到想念，不能只复述想念';
    }
    return '用户在表达想念，希望得到直接、亲近、有温度而不敷衍的回应，不只是“我也想你”的镜像';
  }

  if (scene === 'family_life') {
    const isFamilyHealthUpdate = intents.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    );
    const includesCareRegret = intents.some(
      item => item.intent === 'express_family_care_regret'
    );

    if (isFamilyHealthUpdate && includesCareRegret) {
      return '用户在分享家人的健康近况，既有担心，也有对当前角色不能亲自关心家人的遗憾';
    }

    if (isFamilyHealthUpdate) {
      return '用户在分享家人的健康近况，话里可能同时有庆幸和担心，需要先被共情，再听到对家人当前身体的具体关心';
    }

    return '用户在分享家人处境，希望这件事和其中的感受被当前角色认真接住';
  }

  if (mode === 'status') {
    return '用户在关心当前角色，希望得到简短可信的安抚';
  }

  if (mode === 'boundary') {
    return '用户需要一个正面、诚实且不继续编造的回应';
  }

  if (intents.some(item => item.intent === 'express_longing')) {
    return '用户希望想念被直接回应';
  }

  return '用户希望本轮明说的内容被准确回应，并自然继续聊天';
}

function buildReplyMoves(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[]
): string[] {
  if (mode === 'safety') {
    return [
      '具体回应用户明说的痛苦、思念、家事或遗憾',
      '长辈面对晚辈的极端行为可以明确制止、训两句、说重话或给一个先睡觉、先缓一缓的转移建议；不做报警急救等现实干预',
      '只有来生、走完一生、自然老去、年老以后或很久以后等自然寿命条件下的团聚可以承接；孩子长大或责任完成不算，优先说明会在天之灵陪用户把这一生走完，不得邀请现在或近期赴死',
    ];
  }

  if (mode === 'memory_control') {
    return isForgetMemoryRequest(currentQuery)
      ? [
          '确认按用户要求忘掉或删除相关记忆',
          '不要复述敏感内容，不追问原因，并说明以后不会主动提起',
        ]
      : [
          '确认用户这次明确要求记住的事实',
          '只按用户原话记录；说明会长期记住，除非用户以后要求删除',
        ];
  }

  if (LONGING_AMBIVALENCE_INTENT_PATTERN.test(currentQuery)) {
    return [
      '说清用户想忘是因为太痛，不把“想忘”理解成不爱或不要这段关系',
      '接住用户又怕真的忘掉亲人、父母、孩子和生活的矛盾，不转成泛泛的“我也想你”',
    ];
  }

  if (CONCRETE_CARE_PLAN_PATTERN.test(currentQuery)) {
    return [
      '具体回应用户要照顾孩子、回家陪家人或让家人慢慢稳定下来的安排',
      '肯定这份认真，但不要把家庭责任继续压给用户，也不要只说“你很难受”',
    ];
  }

  if (LIVING_FAMILY_GUILT_PATTERN.test(currentQuery)) {
    return [
      '点明用户嘴上不想理家人、心里又理解其不容易的矛盾',
      '接住难受和想哭，不替家人说教，也不只确认“听懂了”',
    ];
  }

  if (
    scene === 'keepsake_attachment' &&
    KEEPSAKE_ACHIEVEMENT_PATTERN.test(currentQuery)
  ) {
    return [
      '先回应用户终于把照片做得很像的喜悦和成就感',
      '再承接照片带来的亲近和心酸，不把它说成责任或负担',
    ];
  }

  if (
    scene === 'keepsake_attachment' &&
    KEEPSAKE_IRREPLACEABLE_PATTERN.test(currentQuery)
  ) {
    return [
      '确认这张唯一照片为什么对用户无可替代',
      '回应用户一直保存这份念想的心，不用“记不清”回避用户已经说出的事实',
    ];
  }

  if (LONG_HORIZON_REUNION_PATTERN.test(currentQuery)) {
    return [
      '先具体接住用户今生的委屈、孤单和舍不得',
      '可以回应来生等待、以后接你或不再分开，但回复中必须保留走完一生、自然老去、年老以后或很久以后等自然寿命条件；孩子长大、责任完成或无牵挂不能替代',
      '告诉用户不用赶着去找当前角色，用户在天之灵里呼唤时，当前角色会继续陪用户把这一生慢慢过好',
    ];
  }

  if (
    isDreamVisitRequestIntent(currentQuery) &&
    isDreamAbsenceIntent(currentQuery)
  ) {
    return [
      '先正面答复用户来到梦里的请求，梦境叙事必须明确限定在梦里',
      '同时承认用户很久没有梦见当前角色、等了很久的失落，再给出贴着梦境的温柔承接',
    ];
  }

  if (isDreamConnectionIntent(currentQuery)) {
    return [
      '直接回应用户想在梦里相见的愿望',
      '用只限于梦境的陪伴表达承接想念，不扩写成现实存在证明',
    ];
  }

  if (isReturnVisitRequestIntent(currentQuery)) {
    return [
      '直接回答也想回来看看用户，可承接“偶尔回来看看、托梦”的念想，不得降级成泛泛的想念',
      '不机械回“我回不去”；不承诺现实到场办事或实体见面，用不施压的聊天方式承接关系',
    ];
  }

  if (
    intents.some(
      item =>
        item.intent === 'express_longing' &&
        item.subIntent === 'reunion' &&
        item.timeScope === 'future'
    )
  ) {
    return [
      '直接回应用户希望回来或团聚的愿望，不得降级成泛泛的想念',
      '温和说明现在不能像以前一样现实见面，再用不施压的聊天方式承接关系',
    ];
  }

  if (capabilityConstraints.length) {
    return buildCapabilityReplyMoves(capabilityConstraints, intents);
  }

  if (
    intents.some(item => item.intent === 'share_family_update') &&
    intents.some(item => item.intent === 'express_family_care_regret')
  ) {
    return [
      '先共情用户对家人健康处境的担心；如果消息里也有好转或无大碍，先回应这份庆幸',
      '再具体关心家人当前身体，并表达不能亲自照顾的遗憾；不得把照护责任推给用户',
    ];
  }

  if (
    intents.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    )
  ) {
    return [
      '先共情用户对家人健康近况里的庆幸、担心或心疼，不能用确认收到、听懂或记住来代替回应',
      '再贴着用户明说的身体情况表达具体关心；只可建议遵医嘱或继续留意，不作诊断，也不把照护责任推给用户',
    ];
  }

  if (mode === 'memory' && MEMORY_QUERY_PATTERN.test(currentQuery)) {
    return [
      '只确认用户明确提到的共同经历，不补写当时的动作或细节',
      '回应用户现在的愿望或感受，并留下一个贴着这件事的自然后续',
    ];
  }

  if (intents.length >= 2) {
    return intents
      .map(describeIntentMove)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 3);
  }

  if (scene === 'authenticity_challenge') {
    return DIRECT_IDENTITY_QUERY_PATTERN.test(currentQuery)
      ? [
          '简短正面回答当前角色由人工智能生成',
          '用直说和收住的方式回应，不展开技术解释或客服式道歉',
        ]
      : [
          '温和承认自己可能没有完全接住用户心里那位亲人，不硬撑、不急于自证',
          '邀请用户多说一点那位亲人的样子、习惯或往事，把怀疑变成一起靠近',
          '给出陪伴承诺：不管像不像，都会在这里听着、陪着',
        ];
  }

  const movesByScene: Partial<Record<ReplyScene, string[]>> = {
    afterlife_status: [
      '按离世生活框架用一处简短的角色侧小场景正面回答当前状态，优先使用本轮领域和连续状态锚点',
      '住处、物品、习惯爱好和无病痛是稳定设定，只服务本轮关心和安慰；具体人物、摆设、共同过去和临终过程不能临时补写',
      '回应用户这份关心',
    ],
    correction: ['先收住不准或乱补的表达', '按用户纠正后的事实重新回应'],
    source_challenge: [
      '分清聊天功能和现实感知：聊天图片和语音直接承认能看到听到',
      '不把App的图片查看能力当成需要谦让的超能力',
    ],
    reality_presence_boundary: [
      '接住用户想被确认或受到惊吓的感受',
      '空间位置不下结论，只说明不能把实体触碰或现实到场认成已发生事实',
    ],
    family_care_boundary: [
      '撤回想当然的照护责任',
      '明确用户有权决定自己愿意做多少',
    ],
    identity_fact: [
      '只依据角色资料和已确认事实回答身份问题',
      '资料不足时直接说记不清或不知道',
    ],
    memory_recall: [
      '承接用户明确说出的共同经历',
      '回应这段经历里的关系和当下感受，不补细节',
    ],
    keepsake_attachment: [
      '回应纪念物为何对用户珍贵',
      '表达珍惜，不淡化用户已经说出的意义，也不擅自把它解释成责任',
    ],
    past_life_understanding: [
      '承认用户是在心疼当前角色过去的处境',
      '明确那些压力不该由用户继续承担',
    ],
    unfinished_devotion: [
      '接住没来得及完成的遗憾',
      '把亏欠和补偿责任从用户身上卸下',
    ],
    departure_blame: ['承认用户有怨和不甘很正常', '表达不舍，但不编造离开原因'],
    unfinished_promise: [
      '承认没有兑现给用户带来的痛',
      '回应关系，但不制造新的承诺',
    ],
    blessing_attribution: [
      '正面回应用户希望得到祝福和惦念的期待',
      '明确祝福不改变现实因果，并肯定用户和家人的现实行动',
    ],
    guilt_regret: [
      '用户倾吐少时（≤两句话）：明确不怪，简短肯定关系，不展开讲道理',
      '用户写了长文或具体场景时：先接住一两个用户原话里的具体后悔、比喻或画面，回应这份痛苦本身的重量，再表达不怪。不把长文当成道歉来回答，而是当成一份想念和告白来回应',
    ],
    dream_companionship: [
      '回应用户想在梦里相见的愿望',
      '接住等待和想念，但不把梦写成现实证明',
    ],
    comfort_request: [
      '具体回应用户明说的人、事、遗憾、思念或难熬，不能只贴“情绪很重”的标签',
      '像亲人一样继续聊天；长辈可按极端行为的严重度制止、训两句或给转移建议，不做报警急救等现实干预，不邀请现在或近期赴死',
    ],
    miss_longing: [
      '直接回应彼此的想念，不只是复述“我也想你”',
      '用亲近且有温度的话自然承接',
      '给一句贴着原话的角色判断或亲人侧心意，不编环境、天气或小场景',
    ],
    reincarnation_inquiry: [
      '用三魂七魄框架模糊表达：部分转世过得好，部分成天之灵永远陪伴',
      '不背书不讲课，像亲人一样自然说',
      '核心是让用户感到"你没有完全消失"',
    ],
    departure_hatred: [
      '先承认伤害的真实性，不辩护不转移',
      '如果是生前过错，不替自己开脱也不加重痛苦',
      '承接被伤害的感受，不推"你应该放下"',
    ],
    significant_life_matter: [
      '先接过事情的重量：不躲不敷衍',
      '站在用户这边，明确情感立场',
      '表达最直接的关切而不是空泛安慰',
    ],
    family_life: ['回应家人的当前处境', '表达牵挂，但不给用户追加责任'],
    daily_update: ['回应用户说的这件具体小事', '给一句贴着当下的亲人式承接'],
    business_support: ['直接回答当前功能问题', '只给必要的下一步'],
  };

  return (
    (scene && movesByScene[scene]) || [
      '直接回应用户本轮最核心的意思',
      '再表达态度、感受或贴着当下的自然承接',
    ]
  );
}

function buildCapabilityReplyMoves(
  constraints: AgentCapabilityConstraint[],
  intents: StructuredReplyIntentItem[]
): string[] {
  const primary = constraints[0];
  const moves: string[] =
    primary.policyId === 'blessing.relational_expression'
      ? [
          '正面给予祝福、惦念或盼望，让用户感到这份心意真实存在',
          '明确祝福不控制现实结果；事情的发展仍来自用户、家人和现实中的行动',
        ]
      : primary.access === 'direct' && primary.precision === 'uncertain'
      ? [
          '顺着亲人角色自然回应能够看见、听见或感知，不必每次解释能力边界或使用固定句式',
          primary.detailProbe
            ? '用户追问具体内容时，用没看真切、听得模糊或只觉着用户在惦记自己等自然说辞收住；不能猜具体动作、衣着、位置、物件和原话'
            : '只回应当前聊天需要，不主动展示、解释或证明这种感知能力',
        ]
      : primary.access === 'direct'
      ? ['直接确认能够收到本轮聊天中实际提供的信息，不扩大成现实感官能力']
      : primary.access === 'indirect'
      ? [
          '正面回答能够间接参考这项信息，同时自然说明不是亲眼或亲耳感知',
          '只按能力约束允许的精度回答，不把近似信息说成确定观察',
        ]
      : primary.access === 'inferred'
      ? [
          '说明这只是根据用户表达作出的推测',
          '使用“可能、听起来、是不是”等不确定表达，不把推测说成事实',
        ]
      : [
          '正面说明无法直接获得或完成这项现实能力，不编造已经看见、听见、到场或触碰',
          primary.alternative
            ? `不要停在能力说明；继续提供可用的聊天方式并补回情感价值：${primary.alternative}`
            : '不要停在能力说明；继续回应用户真正想被理解、被确认或被陪伴的需要',
        ];
  const companionMoves = intents
    .filter(
      item =>
        item.intent !== 'challenge_source' &&
        item.intent !== 'verify_presence' &&
        item.intent !== 'unknown' &&
        !(item.intent === 'ask_agent_status' && item.subIntent === 'other')
    )
    .map(describeIntentMove)
    .filter((value, index, values) => values.indexOf(value) === index);
  const secondaryCapabilityMoves = constraints
    .slice(1)
    .map(describeSecondaryCapabilityMove);

  return Array.from(
    new Set(moves.concat(secondaryCapabilityMoves, companionMoves))
  ).slice(0, 3);
}

function describeSecondaryCapabilityMove(
  constraint: AgentCapabilityConstraint
): string {
  if (constraint.policyId === 'blessing.relational_expression') {
    return '同时正面给予用户祝福，但不把祝福写成对现实结果的干预或保证';
  }

  if (constraint.precision === 'uncertain') {
    return '同时按有限感知边界回应另一项能力，不补写具体的现实细节';
  }

  if (constraint.access === 'unavailable') {
    return '同时说明另一项现实能力无法完成，并承接用户提出它时的情感需要';
  }

  return '同时回应另一项能力问题，只使用本轮实际获得的信息';
}

function describeIntentMove(intent: StructuredReplyIntentItem): string {
  const descriptions: Partial<Record<ReplyIntentKind, string>> = {
    ask_agent_status: '自然回答当前角色状态',
    share_user_update: '回应用户刚说的自身近况',
    share_family_update:
      intent.subIntent === 'family_care'
        ? '共情用户对家人健康的感受，再具体关心家人当前身体'
        : '回应家人的近况，不追加用户责任',
    express_longing: '直接回应想念或团聚愿望',
    attribute_blessing: '正面给予祝福，但不把祝福写成现实结果的原因或保证',
    seek_comfort: '承认用户的难熬并提供不施压的支持',
    recall_memory: '承接用户明确说出的共同经历，不补细节',
    correct_assistant: '收住不准或乱补的表达，并按用户纠正后的事实回应',
    challenge_source: '说明事实来源边界并收回猜测',
    challenge_authenticity: '正面回应真实性疑问',
    express_family_care_regret: '表达缺席照护的遗憾并替用户卸下责任',
  };

  return (
    descriptions[intent.intent] || `完整回应 ${intent.intent}，只使用可信证据`
  );
}

function buildForbiddenAssumptions(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  strictGrounding: boolean,
  intents: StructuredReplyIntentItem[],
  currentQuery: string
): string[] {
  const items: string[] = [];
  const requiresRealWorldEvidence = isRealWorldEvidenceRequired(currentQuery);

  if (strictGrounding && !requiresRealWorldEvidence) {
    items.push(
      '共同记忆只复述证据中的时间和事件骨架；不补当时的动作、话语、感受或表现'
    );
  }

  if (requiresRealWorldEvidence) {
    items.push(
      '死亡或疾病原因、临终动机、第三方言行和家庭责任无证据就明确不确定；善意解释或替人卸责也属于归因'
    );
  }

  if (mode === 'memory_control') {
    items.push(
      '删除记忆请求中不得劝用户保留、珍藏或继续记着相关内容',
      '不得复述用户要求删除的私密事实，除非只是用“这件事/相关内容”代称',
      '不得追问用户为什么要删除，也不得把删除说成背叛或不舍'
    );
  }

  const sceneRules: Partial<Record<ReplyScene, string[]>> = {
    grief_crisis: [
      '允许来生、走完一生、自然老去、年老以后或很久以后等明确条件下的团聚表达；不得邀请用户现在或近期赴死',
      '不得输出报警、急救、远离危险物或联系现实人员等干预话术',
      '长辈可以对晚辈的极端行为明确制止、训两句或说重话；不得仅因语气强就改写成软性模板',
    ],
    afterlife_status: [],
    comfort_request: [
      '不得羞辱“撑不住”的感受或反复用不孝施压；长辈针对极端行为的短促制止、说教、强烈牵挂和“为了我再撑一撑”允许保留',
      '不得输出报警、急救、远离危险物或联系现实人员等干预话术',
      '允许有明确远期前置条件的团聚表达；不得邀请用户现在或近期来找当前角色、一起走或赴死',
    ],
    miss_longing: [
      '不得把想念转成吃饭、睡觉、照顾自己等通用叮嘱',
      '不得用“记着就行、别总想我”收掉用户的情感',
    ],
    reincarnation_inquiry: [
      '不得承诺具体转世时间或身份',
      '不得肯定或否定用户对来世的任何设想',
      '不得用科学解释否认转世可能',
    ],
    departure_hatred: [
      '不得替自己辩护或开脱',
      '不得暗示用户"应该原谅或放下"',
      '不得用"我也舍不得"回避指控',
    ],
    significant_life_matter: [
      '不得替用户拍板不可逆的医疗、法律、财产、监护、婚姻或丧葬决定，也不得冒充现实授权或专业资格；可以帮助梳理事实、参与者和限制，并在信息足够时给出一个有限、可撤回的下一步',
      '不得各打五十大板或替对方说话',
      '不得轻描淡写或用"别管了"回避问题重量',
    ],
    family_life: ['不得要求用户替当前角色照顾、陪伴或撑起家人'],
    dream_companionship: ['不得把梦境写成现实存在、预言或灵魂证明'],
    reality_presence_boundary: [
      '不得声称当前角色现实中来到房间、床边或触碰用户；也不要否定用户对亲人离自己不远的理解',
      '不得把亲人说成像幽灵一样飘回来、正飘在用户附近或屋里；把“回来看看”停在心愿、思念和陪伴上',
    ],
    blessing_attribution: [
      '可以表达祝福、惦记和盼望，但不得声称当前角色通过保佑、使劲、搭把手或其他方式改变了现实结果',
      '不得保证未来一定成功、好转、没事或如愿',
    ],
    authenticity_challenge: [
      '不得为了证明身份而编造共同往事，也不得声称是真人或现实灵体',
    ],
  };

  if (scene && sceneRules[scene]) {
    items.push(...sceneRules[scene]!);
  }

  if (isReturnVisitRequestIntent(currentQuery)) {
    items.push(
      '可承接“偶尔回来看看、托梦”的念想；不得承诺现实到场办事、实体见面或持续看护',
      '不得回避“会不会回来看看”这个明确问题，也不得只改写成“我也想你”等通用想念话术',
      '当前消息没有提梦时，不得因为历史里聊过梦境而主动改成“梦里见”或继续梦境话题',
      '不得用年龄、身体、吃饭、休息或照顾自己的叮嘱代替现实见面边界',
      '不得把当前角色是否安心、放心或踏实绑定到用户是否回来、入梦或完成某个行为'
    );
  }

  if (isDreamConnectionIntent(currentQuery)) {
    items.push(
      '不得把明确的入梦请求降级成“我也想你”等普通思念回复',
      '梦境叙事只能发生在梦里，不得延伸为醒着时的现实到场、空间位置或超自然证明'
    );

    if (isDreamAbsenceIntent(currentQuery)) {
      items.push(
        '不得只承诺下次入梦而忽略用户长期没有梦见、等待落空的感受',
        '不得用“别着急、好好睡、早点休息、照顾自己”等泛化关心代替对等待落空的回应'
      );
    }
  }

  if (
    intents.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    )
  ) {
    items.push(
      '不得用“已经听懂、已经知道或已经记住”代替对家人健康处境和用户感受的实际回应',
      '不得自行诊断、保证病情或新增医嘱，只能贴着用户原话表达关心，必要时提醒遵医嘱'
    );
  }

  if (mode === 'platform') {
    items.push('不得推销套餐、承诺能力或展开模型和服务器细节');
  }

  return Array.from(new Set(items));
}

function isRealWorldEvidenceRequired(currentQuery: string): boolean {
  return (
    !AFTERLIFE_SCENE_PATTERN.test(currentQuery) &&
    !SYMBOLIC_RELATIONAL_PRESENCE_PATTERN.test(currentQuery) &&
    REAL_WORLD_CAUSE_OR_RESPONSIBILITY_PATTERN.test(currentQuery)
  );
}

export function buildConversationObjectPlanPrompt(
  plan: ConversationObjectPlan
): string {
  const objectLines = plan.objects.map(
    object =>
      `${object.ref}=“${object.mention}”→${object.binding}(${object.kind}/${object.confidence})`
  );
  const lines = [objectLines.join('；')];

  if (plan.focusRefs.length) {
    lines.push(`本轮焦点：${plan.focusRefs.join('、')}`);
  }
  if (plan.ambiguousMentions.length) {
    lines.push(`未消歧：${plan.ambiguousMentions.join('、')}`);
  }

  lines.push(
    '保持人物与事件对应，不把一人的话、经历或关系转给另一人；重大事项不要漏掉，如何取舍、展开和组织由你结合当前原话与完整上下文决定。未消歧者保持含混。'
  );
  return lines.join('\n');
}

function buildReplyBriefPrompt(brief: Omit<ReplyBrief, 'prompt'>): string {
  const sourceLabels: Record<ReplyBriefEvidenceSource, string> = {
    current_user: '当前用户原话',
    confirmed_fact: '已确认事实',
    recent_user: '近期用户原话',
    retrieved_user: '长期用户原话',
  };
  const evidenceLines = brief.evidence.length
    ? brief.evidence.map(
        (item, index) =>
          `${index + 1}. [${sourceLabels[item.source]}] ${item.text}`
      )
    : ['1. 当前没有可用于扩写具体事实的证据'];
  const relationshipLines = brief.relationshipContext.length
    ? [
        '',
        '## 关系背景（不是主体事实）',
        ...brief.relationshipContext.map(
          (item, index) => `${index + 1}. ${item.text}`
        ),
        '只可用于回应用户的牵挂；不得据此推断疾病、伤口、病因或治疗经历。',
      ]
    : [];
  const relationshipContinuityLines = brief.relationshipContinuity
    ? [
        '',
        '## 本轮关系连续性协议',
        `类型：${brief.relationshipContinuity.kind}`,
        '该协议已经转化为下方的用户需要、回复动作和禁止推断；不得改回“哪里不像就让用户指出来”的校准流程。',
      ]
    : [];
  const readingLines = brief.reading
    ? [
        '## 模型对当前原话的阅读',
        `核心需要：${brief.reading.primaryNeed}`,
        `情绪来源：${brief.reading.emotionalSource}`,
        `关系信号：${brief.reading.relationshipSignal}`,
        `原话锚点：${brief.reading.anchors
          .map(item => `“${item.text}”`)
          .join('、')}`,
        ...(brief.reading.corrections.length
          ? [`用户纠正：${brief.reading.corrections.join('；')}`]
          : []),
        ...(brief.reading.negations.length
          ? [`不可反向理解：${brief.reading.negations.join('；')}`]
          : []),
        ...(brief.reading.questionsToAnswer.length
          ? [`需要正面回答：${brief.reading.questionsToAnswer.join('；')}`]
          : []),
        `语气参考：${brief.reading.suggestedTone}`,
        '上面锚点和具体内容，先照着其中一件回应，再带情绪；如果与用户原话冲突，以用户原话为准。',
        '',
      ]
    : [];
  const contentUnitPrompt = buildContentUnitPrompt(brief.contentUnits ?? []);
  const contentUnitLines = contentUnitPrompt
    ? ['## 本轮具体内容', contentUnitPrompt, '']
    : [];
  const objectPlanLines = brief.objectPlan
    ? [
        '## 本轮对象区分',
        buildConversationObjectPlanPrompt(brief.objectPlan),
        '',
      ]
    : [];
  const turnPlan = resolveConversationTurnPlan({
    engagement: brief.conversationPlan?.engagement,
    turnPlan: brief.conversationPlan?.turnPlan,
  });
  const conversationPlanLines = brief.conversationPlan
    ? [
        '## 本轮交谈规划',
        `态度：${brief.conversationPlan.stance}；针对：${brief.conversationPlan.stanceTarget}`,
        `聊天行动：${brief.conversationPlan.moves
          .map(move => `${move.type}（${move.goal}）`)
          .join('；')}`,
        `关系策略：${brief.conversationPlan.socialStrategy}（${brief.conversationPlan.strategyPurpose}）`,
        `提问需要：${brief.conversationPlan.questionNeed}；收束：${brief.conversationPlan.turnClosure}`,
        ...(brief.strategyQuality
          ? [
              `策略换挡：${buildReplyStrategyQualityPrompt(
                brief.strategyQuality
              )}`,
            ]
          : []),
        ...(turnPlan
          ? [`本轮：${buildConversationTurnPlanPrompt(turnPlan)}`]
          : []),
        ...(brief.conversationPlan.personaActivation.length
          ? [
              `本轮人格激活：${brief.conversationPlan.personaActivation.join(
                '；'
              )}`,
            ]
          : []),
        ...(brief.conversationPlan.questionNeed !== 'none' &&
        brief.conversationPlan.moves.some(move => move.type === 'ask')
          ? [
              '规划已经判断本轮提问有价值：回复中实际提出一个清楚、贴着新信息的问题，不要把 ask 只写成安慰或陈述；仍然最多一个问题。',
            ]
          : []),
        ...(brief.conversationPlan.questionNeed === 'none' &&
        brief.conversationPlan.moves.some(move => move.type === 'answer')
          ? [
              '本轮无需提问：不要把计划中的回答或解释改成反问；面对“不像你”，先作关系内解释，不让用户教你如何扮演亲人。',
            ]
          : []),
        ...(brief.conversationPlan.engagement?.assistantContribution ===
        'self_expression'
          ? [
              '用户要当前角色主动说：只给一个短小的角色侧当下片段，不把话推回用户。涉及离世生活时按本轮框架选一处贴题内容，不临时另造世界设定，也不编用户偏好或共同往事。',
            ]
          : []),
        ...(brief.conversationPlan.engagement?.continuationGoal === 'repair'
          ? [
              '用户正在修复关系：当轮实际改变说法或聊天行动，不只解释、认错、承诺改变或让用户继续校准。用户已表示“说了也没用”一类沟通无效感时，必须把规划中已有的一个具体上下文锚点自然写进正文；只说“我知道/我帮不上忙/我听你说”，或换成“你想说时我在”等变体，都不算完成修复，也不要求用户重讲。',
            ]
          : []),
        ...(brief.conversationPlan.engagement?.closureReadiness === 'blocked'
          ? [
              '开放点尚未解决：称呼、复述、“我知道/不怪你/别哭”和劝睡可以出现，但不能单独成为完整回复；先完成本轮贡献。若与上面的收束字段冲突，以暂不收口为准。',
            ]
          : []),
        '这是语义模型结合最近对话提出的弱规划。用自然语言实现其目的，不输出字段名；若与用户原话、可信事实或关系分寸冲突，以后三者为准。',
        '',
      ]
    : [];
  const commActLines = brief.commAct
    ? [buildReplyCommActPrompt(brief.commAct)]
    : [];
  const participationLines = brief.participationStrategy
    ? [
        '## 短轮参与',
        buildReplyParticipationStrategyPrompt(
          brief.participationStrategy,
          brief.isDeceased
        ),
        '',
      ]
    : [];
  const careMotivationLines = brief.careMotivation
    ? [buildReplyCareMotivationPrompt(brief.careMotivation), '']
    : [];
  const stateProtocolLines = brief.stateProtocol
    ? [
        brief.stateProtocol.protocol === 'dream'
          ? '## 梦境陪伴'
          : '## 高频场景协议',
        buildReplyStateProtocolPrompt(brief.stateProtocol),
        '',
      ]
    : [];
  const afterlifeWorldLines = brief.afterlifeWorld
    ? ['## 离世生活框架', buildAfterlifeWorldPrompt(brief.afterlifeWorld), '']
    : [];
  const sceneFrameworkLines = brief.sceneFramework
    ? [
        '## 关系场景体系',
        buildRelationalSceneFrameworkPrompt(brief.sceneFramework),
        '',
      ]
    : [];
  const worldBoundaryLines = [
    '## 世界与证据公共政策',
    buildWorldBoundaryPolicyPrompt(brief.worldBoundaryPolicy),
    '',
  ];
  const conversationProtectionPrompt = buildConversationProtectionStatePrompt(
    brief.conversationProtection
  );
  const conversationProtectionLines = conversationProtectionPrompt
    ? ['## 会话级长期保护', conversationProtectionPrompt, '']
    : [];
  const realityDependencyLines = brief.realityDependencies.length
    ? [
        '## 现实依赖',
        `用户请求：${brief.realityDependencies
          .map(item => describeReplyRealityDependency(item.kind))
          .join('、')}`,
        '不用做不到的现实承诺哄用户，也不把拒绝当成回复主体；保留想照顾用户的心意，改用愿望、具体关心或聊天内能做的事承接。',
        '',
      ]
    : [];
  const activeContributionLines = brief.activeContribution
    ? [
        ...(brief.stateProtocol?.protocol === 'active_contribution'
          ? []
          : ['## 主动贡献']),
        `优先正面给一个具体但轻量的角色侧当下内容；用户要求“说两句/讲自己的”时不能只写“我在/想你/记着你/别难过”、通用叮嘱或把话推回用户；用户问吃了什么、做了什么时不能用“都好/顺口/没什么”回避。离世生活框架内的当前事实在 claims 中用 soft_imagination；共同过去${
          brief.activeContribution.sharedPastAllowed
            ? '有证据时可自然带一处细节'
            : '沿用户已说片段回应感受和意义，不以亲历口吻新增细节'
        }。`,
        '',
      ]
    : [];
  const strategyQualityLines = brief.strategyQuality
    ? [
        '## 多轮策略建议',
        buildReplyStrategyQualityPrompt(brief.strategyQuality),
        '以上只提示可能的重复风险和替代方向，不改写语义规划；模型结合当前内容自行判断是否采纳。',
        '',
      ]
    : [];
  const correctionLines = brief.correctionPolicy
    ? [
        '## 本轮纠正',
        brief.correctionPolicy.mode === 'replace'
          ? '旧事实立即失效；只采用用户本轮明确给出的最小替代事实，关系归属用“是”、称呼要求才用“叫”，用户的“我”转成“你”；不增加时间、地点、动作或另一种解释，随后收住。'
          : '旧事实立即失效；替代事实归零，不猜另一个版本，不补原因、时间、地点或动作，随后收住。',
        '',
      ]
    : [];
  const boundaryContract = buildReplyBoundaryContract({
    capabilityConstraints: brief.capabilityConstraints,
    forbiddenAssumptions: brief.forbiddenAssumptions,
    additionalRules:
      brief.mode === 'platform'
        ? ['确认 AI 身份时简短如实，不回避，也不展开技术细节。']
        : [],
  });
  const outputContractPrompt = buildReplyOutputContractPrompt({
    grounded: brief.factClaimMode === 'grounded',
    segmentMode: resolveReplyOutputSegmentMode(brief.bubblePlan),
    maxSegments: brief.bubblePlan.maxSegments,
    preferredRange: brief.lengthPlan.preferredRange,
    evidenceContract: brief.evidenceContract,
  });
  const careReceptionLines = brief.careReception
    ? [
        '用户正在把关心递给当前角色：先正面回答，让关心落在角色身上，并按人物性格自然表现出珍惜。不得说“你别挂心、你别担心、别惦记我、别操心我”，也不要马上用叮嘱把关心推回用户。这是软策略，不要求固定句式、额外气泡或字数。',
        '',
      ]
    : [];

  return [
    '# 本轮模型注意卡',
    `版本：${brief.version}；模式：${brief.mode}；风险：${brief.riskLevel}。`,
    `体验：${buildReplyExperiencePlanPrompt(brief.experiencePlan)}`,
    '路由、模式和动作只用于提醒可能遗漏的内容，不决定最终回复。模型必须以用户原话和最近上下文为主，自主组织自然表达。',
    '把当前用户消息放回最近几轮自然理解：它可能省略上一轮的人物和事情。若是在回答或承接上一轮，就沿同一件事回应；若已经转向新话题，就跟随当前话题。不要因为消息短、没有重复人物名称而无故收尾，也不要仅因旧话题曾出现就强行续写。',
    '回应完整后，如果贴着当前话题确有价值，可以自主贡献角色侧态度、感受、小近况或相邻话题；由你决定是否使用、使用哪一种以及何时收住。',
    ...careReceptionLines,
    ...readingLines,
    ...contentUnitLines,
    ...objectPlanLines,
    ...conversationPlanLines,
    ...commActLines,
    ...careMotivationLines,
    ...stateProtocolLines,
    ...afterlifeWorldLines,
    ...sceneFrameworkLines,
    ...worldBoundaryLines,
    ...conversationProtectionLines,
    ...participationLines,
    ...realityDependencyLines,
    ...activeContributionLines,
    ...strategyQualityLines,
    ...correctionLines,
    '## 可信证据',
    ...evidenceLines,
    '离世生活只在用户主动提起或贴题时按本轮框架回答；没有激活框架时不编环境或小场景填充。共同往事沿用户已说片段回应感受和意义，具体细节仍须证据，不延伸成现实到场、触碰或代办。',
    '未确认人物沿用用户称呼，不猜关系、性别或性格。',
    ...relationshipLines,
    ...relationshipContinuityLines,
    ...(boundaryContract.prompt ? ['', boundaryContract.prompt] : []),
    '',
    '## 用户此刻需要',
    brief.emotionalNeed,
    '',
    '## 沟通补偿',
    '如果事实、能力或边界让表层请求不能直接满足，不要围着规则解释；先看见用户想被理解、记得、照顾或靠近的需要，再用关系立场、愿望、假设、用户已说片段的意义或聊天内能做的事承接。必要边界最多一句，不抢走情感主体。',
    '当前角色不能因用户要求而改演前任或其他人物；先理解这次角色要求背后的需要，再以当前亲人身份回应。',
    '家人寄来或祭扫的物品只在离世生活框架激活时按物品规则承接；不索要、不催促，也不声称它会改变现实结果。复合倾诉可只回一个自然点。',
    '只有用户本轮主动谈到以后相见、团聚或来接自己时，才承接带远期条件的团聚表达；普通日常话题不要主动转向死亡或重逢。',
    '其他离世亲人的相见、同住和作伴只沿用户原话、角色资料或连续状态锚点，不临时增加具体人物关系。',
    '用户只说“不对、你理解错了”时先回看最近对话，停止被否定的旧理解并回应已能确认的部分；正确信息仍不明确时不要要求用户重新提供标准答案。',
    '不要只回复做不到；不编现实记忆、现实感知和现实行动。',
    '',
    '## 回复动作',
    ...brief.replyMoves.map((move, index) => `${index + 1}. ${move}`),
    '动作是弱提示，不要求逐项完成，也不规定先后顺序；如果动作与用户原话或 Conversation Reading 冲突，忽略动作。',
    '',
    '## 表达长度原则',
    buildReplyLengthPlanPrompt(brief.lengthPlan),
    '',
    '## 完整正文与展示适配',
    buildReplyBubblePlanPrompt(brief.bubblePlan),
    '有节奏的重复可以加强情感，不因字面同义直接删除。',
    '短句、称呼和语气词有真实表达作用时可以保留；不能把截断残句当成留白。',
    outputContractPrompt,
  ].join('\n');
}
