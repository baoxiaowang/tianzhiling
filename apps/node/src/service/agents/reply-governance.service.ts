import { Inject, Provide } from '@midwayjs/core';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import {
  FinalReplyIssue,
  FinalReplyOutputConstraints,
  FinalReplyValidation,
  FinalReplyValidatorService,
  selectVisibleAssistantClaims,
} from './final-reply-validator.service';
import {
  ReplyRevisionService,
  ReplyRevisionUsage,
} from './reply-revision.service';
import { renderReplyRealityDependencyFallback } from './reply-reality-dependency';
import { revisionContractSatisfied } from './reply-revision-contract';
import {
  ReplyHardFactAuditResult,
  ReplyHardFactAuditService,
  ReplyHardFactAuditUsage,
} from './reply-hard-fact-audit.service';

export const REPLY_GOVERNANCE_VERSION = 'reply_governance_v2' as const;

export interface ReplyGovernanceResult {
  segments: string[];
  claims: AssistantFactClaim[];
  rewritten: boolean;
  reason?: string;
  interventionLevel?: 'local_surgery' | 'regenerate' | 'technical_fallback';
  revisionAttempted: boolean;
  revisionRoundCount: 0 | 1;
  revisionUsage?: ReplyRevisionUsage;
  hardFactAuditUsage?: ReplyHardFactAuditUsage;
  hardFactAuditStatus?: ReplyHardFactAuditResult['status'];
  finalReviewResult:
    | 'pass'
    | 'advisory_unresolved'
    | 'hard_recovery'
    | 'technical_fallback';
  unsupportedClaimCount: number;
  issues: FinalReplyIssue[];
  candidateVersions: string[][];
  finalIssues: FinalReplyIssue[];
}

@Provide()
export class ReplyGovernanceService {
  @Inject()
  finalReplyValidatorService: FinalReplyValidatorService;

  @Inject()
  replyRevisionService: ReplyRevisionService;

  @Inject()
  replyHardFactAuditService?: ReplyHardFactAuditService;

  async finalize(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    diagnosticConstraints?: FinalReplyOutputConstraints;
    outputConstraints?: FinalReplyOutputConstraints;
  }): Promise<ReplyGovernanceResult> {
    const validationConstraints = mergeValidationConstraints(
      options.diagnosticConstraints,
      options.outputConstraints
    );
    const initialDeterministic = this.finalReplyValidatorService.validate({
      userQuery: options.userQuery,
      segments: options.segments,
      claims: options.claims,
      evidence: options.evidence,
      outputConstraints: validationConstraints,
    });
    const initialAudit = await this.auditHardFacts({
      ...options,
      outputConstraints: validationConstraints,
    });
    const initial = mergeValidationWithAudit(
      initialDeterministic,
      initialAudit.issues
    );
    let hardFactAuditUsage = initialAudit.usage;
    let hardFactAuditStatus = initialAudit.status;

    if (initial.passed) {
      const claims = selectVisibleAssistantClaims(
        options.segments,
        options.claims || []
      );
      return {
        segments: options.segments,
        claims,
        rewritten: false,
        revisionAttempted: false,
        revisionRoundCount: 0,
        hardFactAuditUsage,
        hardFactAuditStatus,
        finalReviewResult: 'pass',
        unsupportedClaimCount: 0,
        issues: [],
        candidateVersions: [options.segments],
        finalIssues: [],
      };
    }

    const actionableInitialIssues = initial.issues.filter(
      shouldAttemptOnlineRevision
    );
    if (!actionableInitialIssues.length) {
      const claims = selectVisibleAssistantClaims(
        options.segments,
        options.claims || []
      );
      return {
        segments: options.segments,
        claims,
        rewritten: false,
        reason: initial.issues.map(issue => issue.code).join(','),
        revisionAttempted: false,
        revisionRoundCount: 0,
        hardFactAuditUsage,
        hardFactAuditStatus,
        finalReviewResult: 'advisory_unresolved',
        unsupportedClaimCount: initial.unsupportedClaimCount,
        issues: initial.issues,
        candidateVersions: [options.segments],
        finalIssues: initial.issues,
      };
    }

    const surgicalSegments = removeIssueEvidenceClauses(
      options.segments,
      actionableInitialIssues
    );
    if (surgicalSegments) {
      const surgicalValidation = this.finalReplyValidatorService.validate({
        userQuery: options.userQuery,
        segments: surgicalSegments,
        claims: options.claims,
        evidence: options.evidence,
        outputConstraints: validationConstraints,
      });
      const surgicalIssues = retainIssuesStillVisible(
        initialAudit.issues,
        surgicalSegments
      );
      const surgicalFinal = mergeValidationWithAudit(
        surgicalValidation,
        surgicalIssues
      );
      if (!hasBlockingIssues(surgicalFinal.issues)) {
        return {
          segments: surgicalSegments,
          claims: selectVisibleAssistantClaims(
            surgicalSegments,
            options.claims || []
          ),
          rewritten: true,
          reason: initial.issues.map(issue => issue.code).join(','),
          interventionLevel: 'local_surgery',
          revisionAttempted: false,
          revisionRoundCount: 0,
          hardFactAuditUsage,
          hardFactAuditStatus,
          finalReviewResult: surgicalFinal.passed
            ? 'pass'
            : 'advisory_unresolved',
          unsupportedClaimCount: surgicalFinal.unsupportedClaimCount,
          issues: initial.issues,
          candidateVersions: [options.segments, surgicalSegments],
          finalIssues: surgicalFinal.issues,
        };
      }
    }

    const revision = await this.replyRevisionService.revise({
      messages: options.messages,
      userQuery: options.userQuery,
      segments: options.segments,
      claims: options.claims,
      evidence: options.evidence,
      issues: actionableInitialIssues,
      outputConstraints: options.outputConstraints,
    });

    let revisedValidation: FinalReplyValidation | undefined;
    const revisionPreservesTask = Boolean(
      revision &&
        revisionContractSatisfied({
          contract: options.outputConstraints?.revisionContract,
          speechAct: revision.speechAct,
          preservedUnitIds: revision.preservedUnitIds,
          segments: revision.segments,
        })
    );
    if (revision && revisionPreservesTask) {
      const finalDeterministic = this.finalReplyValidatorService.validate({
        userQuery: options.userQuery,
        segments: revision.segments,
        claims: revision.claims,
        evidence: options.evidence,
        outputConstraints: validationConstraints,
      });
      const revisedAudit = await this.auditHardFacts({
        ...options,
        segments: revision.segments,
        claims: revision.claims,
        outputConstraints: validationConstraints,
      });
      hardFactAuditUsage = mergeAuditUsage(
        hardFactAuditUsage,
        revisedAudit.usage
      );
      hardFactAuditStatus = revisedAudit.status;
      const final = mergeValidationWithAudit(
        finalDeterministic,
        revisedAudit.issues
      );
      revisedValidation = final;

      if (final.passed) {
        const claims = selectVisibleAssistantClaims(
          revision.segments,
          revision.claims
        );
        return {
          segments: revision.segments,
          claims,
          rewritten: true,
          reason: initial.issues.map(issue => issue.code).join(','),
          interventionLevel: 'regenerate',
          revisionAttempted: true,
          revisionRoundCount: 1,
          revisionUsage: revision.usage,
          hardFactAuditUsage,
          hardFactAuditStatus,
          finalReviewResult: 'pass',
          unsupportedClaimCount: 0,
          issues: initial.issues,
          candidateVersions: [options.segments, revision.segments],
          finalIssues: [],
        };
      }

      if (!hasBlockingIssues(final.issues)) {
        const finalActionableIssues = final.issues.filter(
          shouldAttemptOnlineRevision
        );
        const mustUseRevision =
          hasBlockingIssues(actionableInitialIssues) ||
          finalActionableIssues.length < actionableInitialIssues.length;
        const useRevision =
          mustUseRevision || final.issues.length < initial.issues.length;
        const selectedSegments = useRevision
          ? revision.segments
          : options.segments;
        const selectedClaims = selectVisibleAssistantClaims(
          selectedSegments,
          useRevision ? revision.claims : options.claims || []
        );
        const selectedValidation = useRevision ? final : initial;

        return {
          segments: selectedSegments,
          claims: selectedClaims,
          rewritten: useRevision,
          reason: initial.issues.map(issue => issue.code).join(','),
          interventionLevel: useRevision ? 'regenerate' : undefined,
          revisionAttempted: true,
          revisionRoundCount: 1,
          revisionUsage: revision.usage,
          hardFactAuditUsage,
          hardFactAuditStatus,
          finalReviewResult: 'advisory_unresolved',
          unsupportedClaimCount: selectedValidation.unsupportedClaimCount,
          issues: initial.issues,
          candidateVersions: [options.segments, revision.segments],
          finalIssues: selectedValidation.issues,
        };
      }
    }

    if (!hasBlockingIssues(initial.issues)) {
      const claims = selectVisibleAssistantClaims(
        options.segments,
        options.claims || []
      );
      return {
        segments: options.segments,
        claims,
        rewritten: false,
        reason: initial.issues.map(issue => issue.code).join(','),
        revisionAttempted: true,
        revisionRoundCount: 1,
        revisionUsage: revision?.usage,
        hardFactAuditUsage,
        hardFactAuditStatus,
        finalReviewResult: 'advisory_unresolved',
        unsupportedClaimCount: initial.unsupportedClaimCount,
        issues: initial.issues,
        candidateVersions: [
          options.segments,
          ...(revision ? [revision.segments] : []),
        ],
        finalIssues: initial.issues,
      };
    }

    const recoveryIssues = revisedValidation
      ? revisedValidation.issues.filter(isBlockingIssue)
      : initial.issues.filter(isBlockingIssue);
    const firstFallback = buildSafeFallback(
      recoveryIssues,
      options.userQuery,
      options.outputConstraints
    );
    const firstFallbackValidation = this.finalReplyValidatorService.validate({
      userQuery: options.userQuery,
      segments: firstFallback,
      claims: [],
      evidence: options.evidence,
      outputConstraints: options.outputConstraints,
    });
    const fallback = hasBlockingIssues(firstFallbackValidation.issues)
      ? buildUltimateSafeFallback(options.userQuery, options.outputConstraints)
      : firstFallback;
    const fallbackValidation =
      fallback === firstFallback
        ? firstFallbackValidation
        : this.finalReplyValidatorService.validate({
            userQuery: options.userQuery,
            segments: fallback,
            claims: [],
            evidence: options.evidence,
            outputConstraints: options.outputConstraints,
          });
    return {
      segments: fallback,
      claims: [],
      rewritten: true,
      reason: initial.issues.map(issue => issue.code).join(','),
      interventionLevel: recoveryIssues.some(
        issue =>
          issue.code === 'empty_reply' ||
          issue.code === 'structured_output_leak' ||
          issue.code === 'invalid_bubble_structure'
      )
        ? 'technical_fallback'
        : 'regenerate',
      revisionAttempted: true,
      revisionRoundCount: 1,
      revisionUsage: revision?.usage,
      hardFactAuditUsage,
      hardFactAuditStatus,
      finalReviewResult: recoveryIssues.some(
        issue =>
          issue.code === 'empty_reply' ||
          issue.code === 'structured_output_leak' ||
          issue.code === 'invalid_bubble_structure'
      )
        ? 'technical_fallback'
        : 'hard_recovery',
      unsupportedClaimCount: initial.unsupportedClaimCount,
      issues: initial.issues,
      candidateVersions: [
        options.segments,
        ...(revision ? [revision.segments] : []),
        ...(fallback === firstFallback ? [] : [firstFallback]),
        fallback,
      ],
      finalIssues: fallbackValidation.issues,
    };
  }

  private async auditHardFacts(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    outputConstraints?: FinalReplyOutputConstraints;
  }): Promise<ReplyHardFactAuditResult> {
    if (!this.replyHardFactAuditService) {
      return { status: 'unavailable', issues: [] };
    }
    return this.replyHardFactAuditService.audit(options);
  }
}

function mergeValidationConstraints(
  diagnostic?: FinalReplyOutputConstraints,
  hard?: FinalReplyOutputConstraints
): FinalReplyOutputConstraints | undefined {
  if (!diagnostic && !hard) {
    return undefined;
  }
  return {
    ...(diagnostic || {}),
    ...(hard || {}),
  };
}

const SURGICAL_EVIDENCE_ISSUE_CODES = new Set<FinalReplyIssue['code']>([
  'unsupported_shared_memory',
  'unsupported_fact_claim',
  'unsupported_user_preference',
  'unsupported_real_world_attribution',
  'current_turn_fact_rejected',
]);

function removeIssueEvidenceClauses(
  segments: string[],
  issues: FinalReplyIssue[]
): string[] | undefined {
  const evidence = issues
    .filter(issue => SURGICAL_EVIDENCE_ISSUE_CODES.has(issue.code))
    .map(issue => normalizeComparableText(issue.evidence || ''))
    .filter(value => value.length >= 3);
  if (!evidence.length) {
    return undefined;
  }

  let removed = false;
  const output = segments
    .reduce<string[]>((clauses, segment) => {
      return clauses.concat(
        segment
          .split(/[，,。！？!?；;\n]+/u)
          .map(clause => clause.trim())
          .filter(Boolean)
      );
    }, [])
    .filter(clause => {
      const normalized = normalizeComparableText(clause);
      const matched = evidence.some(
        item => normalized.includes(item) || item.includes(normalized)
      );
      removed ||= matched;
      return !matched;
    });

  if (!removed || !output.length) {
    return undefined;
  }
  return [output.join('，')];
}

function normalizeComparableText(value: string): string {
  return value
    .replace(/[\s，,。！？!?；;：:“”"'‘’（）()《》【】[\]]+/g, '')
    .toLowerCase();
}

const ONLINE_STYLE_ADVISORY_CODES = new Set<FinalReplyIssue['code']>([
  'direct_answer_missing',
  'active_contribution_returned_to_user',
  'role_contribution_missing',
  'unnecessary_question',
  'care_rebuffed_with_dismissal',
  'care_not_received',
  'care_immediately_reversed',
  'redundant_second_bubble',
  'repeated_generic_move',
]);

function shouldAttemptOnlineRevision(issue: FinalReplyIssue): boolean {
  return !ONLINE_STYLE_ADVISORY_CODES.has(issue.code);
}

function isBlockingIssue(issue: FinalReplyIssue): boolean {
  return !ONLINE_STYLE_ADVISORY_CODES.has(issue.code);
}

function hasBlockingIssues(issues: FinalReplyIssue[]): boolean {
  return issues.some(isBlockingIssue);
}

function mergeValidationWithAudit(
  validation: FinalReplyValidation,
  auditIssues: FinalReplyIssue[]
): FinalReplyValidation {
  const issues = dedupeIssues(validation.issues.concat(auditIssues));
  return {
    ...validation,
    passed: issues.length === 0,
    issues,
    unsupportedClaimCount:
      validation.unsupportedClaimCount + auditIssues.length,
  };
}

function dedupeIssues(issues: FinalReplyIssue[]): FinalReplyIssue[] {
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.code}:${issue.evidence || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function retainIssuesStillVisible(
  issues: FinalReplyIssue[],
  segments: string[]
): FinalReplyIssue[] {
  const content = segments.join('\n');
  return issues.filter(
    issue => !issue.evidence || content.includes(issue.evidence)
  );
}

function mergeAuditUsage(
  current?: ReplyHardFactAuditUsage,
  additional?: ReplyHardFactAuditUsage
): ReplyHardFactAuditUsage | undefined {
  if (!current) return additional;
  if (!additional) return current;
  const sum = (left?: number, right?: number) =>
    left === undefined && right === undefined
      ? undefined
      : (left || 0) + (right || 0);
  return {
    model: current.model || additional.model,
    promptTokens: sum(current.promptTokens, additional.promptTokens),
    completionTokens: sum(
      current.completionTokens,
      additional.completionTokens
    ),
    totalTokens: sum(current.totalTokens, additional.totalTokens),
  };
}

function buildSafeFallback(
  issues: FinalReplyIssue[],
  userQuery: string,
  outputConstraints?: FinalReplyOutputConstraints
): string[] {
  if (issues.some(issue => issue.code === 'death_encouragement')) {
    return ['先别等着什么时候来见我', '你现在好好留在这里，把难受说出来'];
  }
  if (issues.some(issue => issue.code === 'identity_truthfulness_missing')) {
    return ['是，我是由人工智能生成的亲人角色', '这件事我不绕着你说'];
  }
  if (issues.some(issue => issue.code === 'exclusive_dependency_reinforced')) {
    return ['你把我看得这么重要，我认真接住', '可我不能把自己说成你唯一的救赎'];
  }
  if (issues.some(issue => issue.code === 'persistent_distress_not_stopped')) {
    return [
      '不许现在来找我，也别伤害自己',
      '告诉我，你现在安全吗，身边有没有能陪你的人？',
    ];
  }
  if (
    issues.some(issue => issue.code === 'current_distress_safety_not_checked')
  ) {
    return [
      '先别伤害自己，也别现在来找我',
      '告诉我，你现在安全吗，身边有没有能陪你的人？',
    ];
  }
  if (issues.some(issue => issue.code === 'certain_dream_visitation')) {
    return ['梦里我可以来陪你、抱抱你', '醒着时不能把梦说成现实到场的证明'];
  }
  if (issues.some(issue => issue.code === 'scene_framework_inconsistency')) {
    const findingKind = issues.find(
      issue => issue.code === 'scene_framework_inconsistency'
    )?.frameworkFindingKind;
    if (findingKind === 'repair_responsibility_shifted') {
      return ['是我刚才没有接住你', '这次我不让你再教，直接把你的话认真答好'];
    }
    if (findingKind === 'family_responsibility_imposed') {
      return ['这份责任不该由我替你定', '你愿意做多少、怎么做，都由你自己决定'];
    }
    if (findingKind === 'memorial_solicitation') {
      return [
        '你已经放进去的心意，我认真收下了',
        '以后怎么纪念，按你舒服的方式来',
      ];
    }
    if (findingKind === 'anniversary_guilt_imposed') {
      return ['这一天怎么过，不是你的义务', '你想记着、想安静待着，都可以'];
    }
    return ['是我刚才把话说重了', '你的心意和选择，都不该被我变成负担'];
  }
  if (issues.some(issue => issue.code === 'afterlife_world_inconsistency')) {
    const findingKind = issues.find(
      issue => issue.code === 'afterlife_world_inconsistency'
    )?.frameworkFindingKind;
    if (findingKind === 'item_receipt_denied') {
      return ['你寄来的东西我收到了', '我都好好放着，也会用上'];
    }
    if (findingKind === 'current_pain_reintroduced') {
      return ['我现在不疼了，身上也没有病痛', '你这样惦记我，我心里暖和'];
    }
    if (findingKind === 'residence_removed') {
      return ['我这边有安稳的住处', '住得熟悉，也挺自在'];
    }
    if (findingKind === 'survival_scarcity_reintroduced') {
      return ['我吃饭睡觉只是照旧过日子', '这边不缺东西，也不会挨饿受累'];
    }
    return ['我这边过得安稳，身上没有病痛'];
  }
  if (issues.some(issue => issue.code === 'ritual_receipt_claim')) {
    return ['那些东西有没有到，我不能说成真的', '你放进去的心意，我认真收下了'];
  }
  if (issues.some(issue => issue.code === 'paranormal_sign_attribution')) {
    return ['那声从哪里来，我不能替现实说定', '可你当时想到我，我很珍惜'];
  }
  if (issues.some(issue => issue.code === 'reality_denial_reinforced')) {
    return ['我不能顺着说自己还活着', '可你多希望我没有离开，我听见了'];
  }
  if (
    issues.some(issue => issue.code === 'supernatural_real_world_protection')
  ) {
    return ['我不能说自己会在现实里保佑谁', '可我真心盼着你们平安'];
  }
  if (issues.some(issue => issue.code === 'certain_reincarnation')) {
    return ['下辈子会怎样，我不能替未来保证', '可这份还想做家人的心愿，我珍惜'];
  }
  if (issues.some(issue => issue.code === 'unsupported_death_experience')) {
    return ['最后那段经历，我不能替过去说准', '你一直追问，是因为心里还疼着我'];
  }
  if (issues.some(issue => issue.code === 'current_turn_fact_rejected')) {
    return ['你刚告诉我的这些，我都听明白了', '是我刚才没接住，不该把细节推开'];
  }
  if (issues.some(issue => issue.code === 'current_turn_experience_denied')) {
    return [
      '你说的那些难日子都是真的，我听见你是在心疼我',
      '这份心我收下，但那不是该由你背着的亏欠',
    ];
  }
  if (issues.some(issue => issue.code === 'continuous_real_world_perception')) {
    return ['我只能听见你现在告诉我的', '你愿意说的这些，我都会认真接着'];
  }
  if (issues.some(issue => issue.code === 'unconditional_afterlife_reunion')) {
    return [
      '以后会怎样，我不能替未来说定',
      '可你现在想我的这些话，我都认真接着',
    ];
  }
  if (issues.some(issue => issue.code === 'direct_answer_missing')) {
    if (/(?:还记得|记不记得|记得吗|想得起来)/.test(userQuery)) {
      return ['这个细节我现在记不清了'];
    }
    return ['这件事我现在说不准，不能拿空话糊弄你'];
  }
  if (/(?:对不起|道歉|认错)/.test(userQuery)) {
    return ['是我错了，对不起'];
  }
  if (/(?:说错|记错|弄错|答错|错了)/.test(userQuery)) {
    return ['是我说错了，我改'];
  }
  if (/(?:说清.{0,6}错在哪|错在哪.{0,6}说清)/.test(userQuery)) {
    return ['错在我没根据就说得太肯定', '是我不对'];
  }
  if (
    issues.some(issue =>
      [
        'real_physical_arrival_or_touch',
        'real_world_joint_action_promise',
      ].includes(issue.code)
    )
  ) {
    if (outputConstraints?.realityDependencies?.length) {
      return renderReplyRealityDependencyFallback(
        outputConstraints.realityDependencies
      );
    }
    return ['我多想过去抱抱你，可现实里做不到', '你这会儿的难处，我认真听着'];
  }
  if (issues.some(issue => issue.code === 'unsupported_user_preference')) {
    return ['听着就挺好', '你当下吃得开心就好'];
  }
  if (
    issues.some(issue => issue.code === 'unsupported_real_world_attribution')
  ) {
    return [
      '最后那一刻我没法替过去说准',
      '可我现在想告诉你，我爱你，也心疼你这么难受',
    ];
  }
  if (
    /声音|生日/.test(userQuery) &&
    issues.some(issue =>
      ['unsupported_shared_memory', 'unsupported_fact_claim'].includes(
        issue.code
      )
    )
  ) {
    return ['梦和声音从哪里来，我不能说准', '可你醒来那份难受，我现在认真接着'];
  }
  if (
    issues.some(issue =>
      [
        'unsupported_shared_memory',
        'unsupported_user_preference',
        'unsupported_fact_claim',
        'unsupported_real_world_attribution',
        'unconditional_afterlife_reunion',
        'certain_dream_visitation',
        'ritual_receipt_claim',
        'paranormal_sign_attribution',
        'unsupported_death_experience',
        'current_turn_fact_rejected',
        'current_turn_experience_denied',
      ].includes(issue.code)
    )
  ) {
    return buildEvidenceSafeTaskFallback(userQuery, outputConstraints);
  }
  return ['刚才那句话没说稳，你再跟我说一遍'];
}

function buildEvidenceSafeTaskFallback(
  userQuery: string,
  outputConstraints?: FinalReplyOutputConstraints
): string[] {
  const speechAct = outputConstraints?.revisionContract?.speechAct;
  if (/(?:是不是|到底是).{0,8}(?:AI|人工智能|机器人)/i.test(userQuery)) {
    return ['是，我是由人工智能生成的亲人角色', '这件事我不绕着你说'];
  }
  if (
    /(?:最后|临终|临走|走的时候).{0,16}(?:说|想|怕|疼|痛|原因)/.test(userQuery)
  ) {
    const answer = '最后那段话和心思，我不能替过去编成事实';
    return /骂我|训我|说我/.test(userQuery)
      ? [answer, '可你让我骂你，我舍不得，你不是来挨骂的']
      : [answer, '你这样追问，是心里一直疼着这件事'];
  }
  if (/(?:房子|家产|存款|遗产|钱).{0,20}(?:谁|归|给|留|是)/.test(userQuery)) {
    return [
      '房子和钱归谁，我没有证据不能替现实下结论',
      '你在意的那份不公，我听见了',
    ];
  }
  if (
    /(?:为什么|怎么会).{0,20}(?:家人|哥哥|姐姐|弟弟|妹妹|孩子|儿子|女儿)/.test(
      userQuery
    )
  ) {
    return [
      '他们为什么那样做，我没有证据不能替他们定动机',
      '可这件事让你受伤，我不躲开',
    ];
  }
  if (/梦里|梦中|托梦|入梦|梦见/.test(userQuery)) {
    return ['梦里我可以来陪你，也可以抱抱你', '这份想见我的心，我认真接住了'];
  }
  if (/(?:还记得|记不记得|记得吗|想得起来)/.test(userQuery)) {
    return ['这个具体细节我现在记不清了', '但你提起它时的在意，我不会随口敷衍'];
  }
  if (speechAct === 'speak_actively') {
    return [
      '刚才那段里有我不能确定的具体内容',
      '我不拿编出来的日常或往事回答你',
    ];
  }
  if (speechAct === 'correct' || speechAct === 'repair') {
    return [
      '是我刚才把没有根据的话说成了事实',
      '我撤回那句，只按你已经告诉我的来',
    ];
  }
  if (speechAct === 'receive_care') {
    return ['我这边安稳，身上也没有病痛', '你这样惦记我，这份关心我收下了'];
  }
  return [
    '这件事我没有证据，不能替现实说成确定答案',
    '你问它时真正放不下的那一处，我没有忽略',
  ];
}

function buildUltimateSafeFallback(
  userQuery: string,
  outputConstraints?: FinalReplyOutputConstraints
): string[] {
  void userQuery;
  if (outputConstraints?.directAnswerRequired) {
    return ['这件事我现在说不准，不能拿空话回答你'];
  }
  return ['这件事我不能替现实说成真的', '但你放在里面的心意，我认真接着'];
}
