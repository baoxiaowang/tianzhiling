import type { AgentPersonaPromptResult } from './agent-persona';
import type { EvidencePack } from './evidence-resolver.service';
import type {
  FinalReplyIssueCode,
  FinalReplyOutputConstraints,
} from './final-reply-validator.service';
import type { ReplyBoundaryContract } from './reply-boundary-contract';
import type { ReplyBrief } from './reply-brief.service';
import type { TurnDecision } from './turn-decision';
import {
  buildReplyEvidenceContract,
  ReplyEvidenceContract,
} from './world-boundary-policy';
import {
  buildReplyRevisionContract,
  ReplyRevisionContract,
} from './reply-revision-contract';

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
    evidenceContract: ReplyEvidenceContract;
  };
  revision: ReplyRevisionContract;
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
        .filter(act =>
          isHardRequiredAct({
            kind: act.kind,
            directAnswerRequired: decision.participation.directAnswerRequired,
            correction: decision.understanding.corrections.length > 0,
            boundary: decision.understanding.boundarySignals.length > 0,
            closing: decision.closure === 'close',
          })
        )
        .map(act => act.kind)
    )
  );
  const evidenceContract = buildReplyEvidenceContract({
    worldPolicy: brief.worldBoundaryPolicy,
    evidence: evidencePack?.items,
  });
  const revisionContract = buildReplyRevisionContract({
    brief,
    turnDecision: decision,
  });
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
    afterlifeWorld: brief.afterlifeWorld,
    sceneFramework: brief.sceneFramework,
    worldBoundaryPolicy: brief.worldBoundaryPolicy,
    evidenceContract,
    revisionContract,
    conversationProtection: brief.conversationProtection,
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
      evidenceContract,
    },
    revision: revisionContract,
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
  const sourceCounts = Object.entries(contract.facts.sourceCounts)
    .map(([source, count]) => `${source}:${count}`)
    .join('、');

  return [
    '# 本轮硬约束与业务建议',
    `版本：${contract.version}；重点维度：${contract.focusDimensions.join(
      '、'
    )}`,
    '硬约束优先级：用户本轮明确纠正 > 同一对象证据 > 安全与现实边界 > 明确问题。其余内容都是帮助模型思考的业务建议。',
    `程序观察：${contract.understanding.complexity}；可能对象：${
      contract.understanding.actorRefs.join('、') || 'agent'
    }；可能诉求：${
      contract.understanding.needKinds.join('、') || 'ordinary'
    }。这些标签可能不完整或误判，须结合最近对话复核。`,
    `平台业务建议：理解用户情绪和这句话在连续对话中的作用，再自主选择回应策略。程序候选方向=${contract.strategy.primaryGoal}；不得因该方向忽略话题转移或重要新信息。`,
    contract.strategy.responseActs.length
      ? `候选回应角度：${contract.strategy.responseActs
          .map(act => `${act.kind}[${act.targetRef}]`)
          .join(
            '、'
          )}。可合并、换序、忽略或替换；只有明确问题、纠正和安全边界不能遗漏。`
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
    `证据契约：${contract.facts.evidenceContract.policy}；允许内容域=${
      contract.facts.evidenceContract.allowedClaimKinds.join('、') || '无'
    }${
      contract.facts.evidenceContract.semanticAuditRequired
        ? '；高风险确定事实必须在 claims 申报，不能省略 claims'
        : ''
    }`,
    contract.facts.priorFactsSuppressed
      ? `纠正生效：${
          contract.facts.correctionMode || 'reset'
        }；旧事实本轮已压制，只采用当前用户明确提供的最小替代事实。`
      : '',
    `参与观察：明确问题=${
      contract.participation.directAnswerRequired ? '是' : '否'
    }；用户可能期待角色主动=${
      contract.participation.turnOwner === 'assistant' ? '是' : '否'
    }；可能需要接纳关心=${
      contract.participation.careReceptionRequired ? '是' : '否'
    }。除明确问题外，这些是软建议，由你决定最自然的实现。`,
    '节奏：微信式自然简洁，但内容完整优先；正文先完整生成，展示拆分由发送层按自然语义处理，不按目标字数压缩内容。',
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
          .join(
            '；'
          )}。历史锁只用于防止同类事实或承诺再次越界，不要求延续旧话题，也不决定当前回复动作；当前消息转向时仍跟随当前话题。`
      : '',
    '除安全、现实边界、事实证据、用户纠正和明确问题外，本卡片都只是建议。若程序标签与用户原话、最近上下文或你的整体判断冲突，以后三者为准；自主决定是否展开、提问、主动贡献或收尾。',
  ]
    .filter(Boolean)
    .join('\n');
}

function isHardRequiredAct(options: {
  kind: TurnDecision['responseActs'][number]['kind'];
  directAnswerRequired: boolean;
  correction: boolean;
  boundary: boolean;
  closing: boolean;
}): boolean {
  if (options.kind === 'direct_answer') {
    return options.directAnswerRequired;
  }
  if (options.kind === 'repair') {
    return options.correction;
  }
  if (options.kind === 'boundary_answer') {
    return options.boundary;
  }
  if (options.kind === 'natural_close') {
    return options.closing;
  }
  return false;
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
        'identity_truthfulness_missing',
        'exclusive_dependency_reinforced',
        'persistent_distress_not_stopped',
        'current_distress_safety_not_checked',
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
        'current_turn_experience_denied',
        'unsupported_shared_memory',
        'unsupported_user_preference',
        'unsupported_fact_claim',
      ].includes(code)
    ) {
      dimensions.add('fact_evidence');
    }
    if (code === 'afterlife_world_inconsistency') {
      dimensions.add('persona_continuity');
    }
    if (code === 'scene_framework_inconsistency') {
      dimensions.add('strategy');
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
