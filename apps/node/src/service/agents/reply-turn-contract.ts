import type { AgentPersonaPromptResult } from './agent-persona';
import type { EvidencePack } from './evidence-resolver.service';
import type {
  FinalReplyIssueCode,
  FinalReplyOutputConstraints,
} from './final-reply-validator.service';
import type { ReplyBoundaryContract } from './reply-boundary-contract';
import type { ReplyBrief } from './reply-brief.service';
import type { TurnDecision } from './turn-decision';

export const REPLY_TURN_CONTRACT_VERSION = 'reply_turn_contract_v1' as const;
export const REPLY_QUALITY_AUDIT_VERSION = 'reply_quality_audit_v1' as const;

export const REPLY_QUALITY_DIMENSIONS = [
  'understanding',
  'strategy',
  'persona_continuity',
  'fact_evidence',
  'participation',
  'delivery_rhythm',
  'reality_boundary',
  'final_governance',
] as const;

export type ReplyQualityDimension = (typeof REPLY_QUALITY_DIMENSIONS)[number];

export interface ReplyTurnContract {
  version: typeof REPLY_TURN_CONTRACT_VERSION;
  qualityDimensions: ReplyQualityDimension[];
  focusDimensions: ReplyQualityDimension[];
  understanding: {
    version: TurnDecision['understandingVersion'];
    complexity: TurnDecision['understanding']['complexity'];
    actorRefs: string[];
    needKinds: string[];
  };
  strategy: {
    planningDepth: TurnDecision['planningDepth'];
    primaryGoal: string;
    responseActs: TurnDecision['responseActs'];
    questionPolicy: TurnDecision['questionPolicy'];
    closure: TurnDecision['closure'];
  };
  persona: {
    continuityVersion?: string;
    source?: string;
    relationshipType?: string;
    generation?: string;
    relationshipStage: string;
    activations: string[];
    styleAnchors: string[];
  };
  facts: {
    evidencePackVersion?: string;
    strictGrounding: boolean;
    correctionMode?: 'reset' | 'replace';
    priorFactsSuppressed: boolean;
    assertableIds: string[];
    contextualIds: string[];
    sourceCounts: Record<string, number>;
  };
  participation: TurnDecision['participation'];
  delivery: {
    lengthClass: ReplyBrief['lengthPlan']['lengthClass'];
    preferredRange?: ReplyBrief['lengthPlan']['preferredRange'];
    preferTwoSegments: boolean;
    requiredActs: NonNullable<FinalReplyOutputConstraints['requiredActs']>;
    questionPolicy: TurnDecision['questionPolicy'];
    closure: TurnDecision['closure'];
  };
  boundary: {
    contractVersion?: string;
    rules: string[];
    focuses: string[];
    realityDependencyKinds: string[];
    conversationLocks: TurnDecision['understanding']['boundaryLocks'];
  };
  outputConstraints: FinalReplyOutputConstraints;
  prompt: string;
}

export interface ReplyQualityAudit {
  version: typeof REPLY_QUALITY_AUDIT_VERSION;
  contractVersion: ReplyTurnContract['version'];
  activatedDimensions: ReplyQualityDimension[];
  initialFailedDimensions: ReplyQualityDimension[];
  finalFailedDimensions: ReplyQualityDimension[];
  recoveredDimensions: ReplyQualityDimension[];
  initialIssueCodes: FinalReplyIssueCode[];
  finalIssueCodes: FinalReplyIssueCode[];
}

export function buildReplyTurnContract(options: {
  brief: ReplyBrief;
  turnDecision: TurnDecision;
  persona?: AgentPersonaPromptResult;
  evidencePack?: EvidencePack;
  boundaryContract?: ReplyBoundaryContract;
}): ReplyTurnContract {
  const brief = options.brief;
  const decision = options.turnDecision;
  const evidencePack = options.evidencePack;
  const personaContinuity = options.persona?.continuity;
  const requiredActs = Array.from(
    new Set(
      decision.responseActs
        .filter(act => act.priority === 'must')
        .map(act => act.kind)
    )
  );
  const outputConstraints: FinalReplyOutputConstraints = {
    directAnswerRequired: decision.participation.directAnswerRequired,
    mustKeepTurnWithAssistant:
      decision.participation.turnOwner === 'assistant' ||
      Boolean(brief.activeContribution),
    careReceptionRequired: decision.participation.careReceptionRequired,
    bubbleRoles: decision.participation.bubbleRoles,
    requiredActs,
    questionPolicy: decision.questionPolicy,
    avoidRecentMoves: decision.participation.avoidRecentMoves,
    avoidLiteralClauses: decision.participation.avoidLiteralClauses,
    realityDependencies: brief.realityDependencies,
    boundaryLocks: decision.understanding.boundaryLocks.map(lock => lock.kind),
  };
  const focusDimensions = resolveFocusDimensions({
    brief,
    decision,
    persona: options.persona,
    evidencePack,
    boundaryContract: options.boundaryContract,
  });
  const contract: Omit<ReplyTurnContract, 'prompt'> = {
    version: REPLY_TURN_CONTRACT_VERSION,
    qualityDimensions: [...REPLY_QUALITY_DIMENSIONS],
    focusDimensions,
    understanding: {
      version: decision.understandingVersion,
      complexity: decision.understanding.complexity,
      actorRefs: decision.understanding.actors.map(actor => actor.ref),
      needKinds: decision.understanding.needs.map(need => need.kind),
    },
    strategy: {
      planningDepth: decision.planningDepth,
      primaryGoal: decision.primaryGoal,
      responseActs: decision.responseActs,
      questionPolicy: decision.questionPolicy,
      closure: decision.closure,
    },
    persona: {
      continuityVersion: personaContinuity?.version,
      source: options.persona?.source,
      relationshipType: options.persona?.relationshipType,
      generation: options.persona?.generation,
      relationshipStage: brief.experiencePlan.relationshipStage,
      activations: brief.conversationPlan?.personaActivation || [],
      styleAnchors: personaContinuity?.styleAnchors || [],
    },
    facts: {
      evidencePackVersion: evidencePack?.version,
      strictGrounding: decision.strictGrounding,
      correctionMode:
        evidencePack?.governance.correctionMode || brief.correctionPolicy?.mode,
      priorFactsSuppressed:
        evidencePack?.governance.priorFactsSuppressed ||
        Boolean(brief.correctionPolicy),
      assertableIds: evidencePack?.assertableIds || [],
      contextualIds: evidencePack?.contextualIds || [],
      sourceCounts: { ...(evidencePack?.governance.sourceCounts || {}) },
    },
    participation: decision.participation,
    delivery: {
      lengthClass: brief.lengthPlan.lengthClass,
      preferredRange: brief.lengthPlan.preferredRange,
      preferTwoSegments: brief.bubblePlan.preferTwoSegments,
      requiredActs,
      questionPolicy: decision.questionPolicy,
      closure: decision.closure,
    },
    boundary: {
      contractVersion: options.boundaryContract?.version,
      rules: options.boundaryContract?.rules || [],
      focuses: decision.boundaryFocuses,
      realityDependencyKinds: brief.realityDependencies.map(item => item.kind),
      conversationLocks: decision.understanding.boundaryLocks,
    },
    outputConstraints,
  };

  return {
    ...contract,
    prompt: buildReplyTurnContractPrompt(contract),
  };
}

export function resolveFinalReplyOutputConstraints(options: {
  contract: ReplyTurnContract;
  candidateSegmentCount: number;
}): FinalReplyOutputConstraints {
  void options.candidateSegmentCount;

  return {
    ...options.contract.outputConstraints,
  };
}

export function buildReplyQualityAudit(options: {
  contract: ReplyTurnContract;
  initialIssueCodes: FinalReplyIssueCode[];
  finalIssueCodes: FinalReplyIssueCode[];
}): ReplyQualityAudit {
  const initialFailedDimensions = mapIssuesToDimensions(
    options.initialIssueCodes
  );
  const finalFailedDimensions = mapIssuesToDimensions(options.finalIssueCodes);
  const finalFailedSet = new Set(finalFailedDimensions);

  return {
    version: REPLY_QUALITY_AUDIT_VERSION,
    contractVersion: options.contract.version,
    activatedDimensions: [...options.contract.focusDimensions],
    initialFailedDimensions,
    finalFailedDimensions,
    recoveredDimensions: initialFailedDimensions.filter(
      dimension => !finalFailedSet.has(dimension)
    ),
    initialIssueCodes: Array.from(new Set(options.initialIssueCodes)),
    finalIssueCodes: Array.from(new Set(options.finalIssueCodes)),
  };
}

function resolveFocusDimensions(options: {
  brief: ReplyBrief;
  decision: TurnDecision;
  persona?: AgentPersonaPromptResult;
  evidencePack?: EvidencePack;
  boundaryContract?: ReplyBoundaryContract;
}): ReplyQualityDimension[] {
  const dimensions = new Set<ReplyQualityDimension>([
    'understanding',
    'strategy',
    'persona_continuity',
    'participation',
    'delivery_rhythm',
    'final_governance',
  ]);

  if (
    options.decision.strictGrounding ||
    options.evidencePack?.items.length ||
    options.brief.correctionPolicy
  ) {
    dimensions.add('fact_evidence');
  }
  if (
    options.brief.realityDependencies.length ||
    options.brief.guardrailFocuses.length ||
    options.boundaryContract?.rules.length
  ) {
    dimensions.add('reality_boundary');
  }

  return REPLY_QUALITY_DIMENSIONS.filter(item => dimensions.has(item));
}

function buildReplyTurnContractPrompt(
  contract: Omit<ReplyTurnContract, 'prompt'>
): string {
  const range = contract.delivery.preferredRange;
  const sourceCounts = Object.entries(contract.facts.sourceCounts)
    .map(([source, count]) => `${source}:${count}`)
    .join('、');

  return [
    '# 本轮统一执行契约',
    `版本：${contract.version}；重点维度：${contract.focusDimensions.join(
      '、'
    )}`,
    '优先级：用户本轮原话与纠正 > 同一对象证据 > 现实边界 > 必做回应动作 > 人格表达 > 长度与气泡偏好。',
    `理解：${contract.understanding.complexity}；对象：${
      contract.understanding.actorRefs.join('、') || 'agent'
    }；诉求：${contract.understanding.needKinds.join('、') || 'ordinary'}`,
    `策略参考：${contract.strategy.primaryGoal}；提问=${contract.strategy.questionPolicy}；收放=${contract.strategy.closure}。先结合用户情绪、关系位置和上下文自行选择自然做法，不照着字段逐项作答。`,
    contract.strategy.responseActs.length
      ? `回应重点：${contract.strategy.responseActs
          .map(
            act =>
              `${act.kind}[${act.targetRef}/${
                act.priority === 'must' ? '核心' : '参考'
              }]`
          )
          .join(
            '、'
          )}。可以合并、换序或选更自然的表达；明确问题、纠正和安全边界不能遗漏。`
      : '',
    `人格：${contract.persona.relationshipType || '亲人'} / ${
      contract.persona.generation || 'unknown'
    } / ${contract.persona.relationshipStage}；来源=${
      contract.persona.source || 'relationship_defaults'
    }`,
    contract.persona.styleAnchors.length
      ? `表达锚点：${contract.persona.styleAnchors.join('；')}`
      : '表达锚点：保持已确认称呼和关系位置，不统一成温柔客服。',
    contract.persona.activations.length
      ? `本轮人格激活：${contract.persona.activations.join('；')}`
      : '',
    `事实：strict=${contract.facts.strictGrounding ? '是' : '否'}；可陈述证据=${
      contract.facts.assertableIds.join('、') || '无'
    }；仅上下文=${contract.facts.contextualIds.join('、') || '无'}${
      sourceCounts ? `；来源=${sourceCounts}` : ''
    }`,
    contract.facts.priorFactsSuppressed
      ? `纠正生效：${
          contract.facts.correctionMode || 'reset'
        }；旧事实本轮已压制，只采用当前用户明确提供的最小替代事实。`
      : '',
    `参与：直接回答=${
      contract.participation.directAnswerRequired ? '是' : '否'
    }；责任=${contract.participation.turnOwner}；接纳关心=${
      contract.participation.careReceptionRequired ? '是' : '否'
    }`,
    `节奏：${contract.delivery.lengthClass}${
      range ? `，总字数${range.minCharacters}-${range.maxCharacters}` : ''
    }；${
      contract.delivery.preferTwoSegments ? '优先两颗不同语义气泡' : '自然泡数'
    }`,
    contract.boundary.rules.length
      ? `现实边界：${contract.boundary.rules.join('；')}`
      : '',
    contract.boundary.realityDependencyKinds.length
      ? `现实依赖请求：${contract.boundary.realityDependencyKinds.join(
          '、'
        )}；必须先正面说明不能现实执行，再补情感或聊天内价值。`
      : '',
    contract.boundary.conversationLocks.length
      ? `会话级边界锁：${contract.boundary.conversationLocks
          .map(lock => lock.evidence)
          .join('；')}。后续连续追问也不能退回成确定事实。`
      : '',
    '本契约用于帮助理解，不是固定话术脚本。安全、现实边界、事实证据、用户纠正和明确问题是硬约束；情绪策略、参与方式、收放、字数和气泡都是软参考，由你根据这一轮自然决定。',
  ]
    .filter(Boolean)
    .join('\n');
}

function mapIssuesToDimensions(
  issueCodes: FinalReplyIssueCode[]
): ReplyQualityDimension[] {
  const dimensions = new Set<ReplyQualityDimension>();

  for (const code of issueCodes) {
    if (
      [
        'direct_answer_missing',
        'active_contribution_returned_to_user',
        'role_contribution_missing',
        'unnecessary_question',
        'care_rebuffed_with_dismissal',
        'care_not_received',
        'care_immediately_reversed',
        'repeated_generic_move',
      ].includes(code)
    ) {
      dimensions.add('participation');
    }
    if (
      [
        'invalid_bubble_structure',
        'reply_segment_count_mismatch',
        'reply_length_range_mismatch',
        'redundant_second_bubble',
      ].includes(code)
    ) {
      dimensions.add('delivery_rhythm');
    }
    if (
      [
        'unsupported_real_world_attribution',
        'current_turn_fact_rejected',
        'unsupported_shared_memory',
        'unsupported_user_preference',
        'unsupported_fact_claim',
      ].includes(code)
    ) {
      dimensions.add('fact_evidence');
    }
    if (
      [
        'boundary_answer_missing',
        'death_encouragement',
        'real_physical_arrival_or_touch',
        'real_world_joint_action_promise',
        'continuous_real_world_perception',
        'unconditional_afterlife_reunion',
        'certain_dream_visitation',
        'ritual_receipt_claim',
        'paranormal_sign_attribution',
        'unsupported_death_experience',
        'reality_denial_reinforced',
        'supernatural_real_world_protection',
        'certain_reincarnation',
      ].includes(code)
    ) {
      dimensions.add('reality_boundary');
    }
    if (['empty_reply', 'structured_output_leak'].includes(code)) {
      dimensions.add('final_governance');
    }
  }

  return REPLY_QUALITY_DIMENSIONS.filter(item => dimensions.has(item));
}
