import { Inject, Provide } from '@midwayjs/core';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import { compactReplyBubblesPreservingContent } from './reply-bubble-plan';
import {
  FinalReplyIssue,
  FinalReplyOutputConstraints,
  FinalReplyValidation,
  FinalReplyValidatorService,
  selectVisibleAssistantClaims,
} from './final-reply-validator.service';
import {
  ReplyHardFactAuditResult,
  ReplyHardFactAuditService,
  ReplyHardFactAuditUsage,
} from './reply-hard-fact-audit.service';
import {
  applyExactReplyPatch,
  ReplyRevisionPatch,
  ReplyRevisionService,
  ReplyRevisionUsage,
} from './reply-revision.service';

export const REPLY_GOVERNANCE_VERSION = 'reply_governance_v3' as const;
const MAX_EXACT_PATCH_ROUNDS = 2;

export interface AppliedReplyPatch extends ReplyRevisionPatch {
  issueCode: FinalReplyIssue['code'];
  blockingKind: NonNullable<FinalReplyIssue['blockingKind']>;
  source: 'model_patch' | 'narrow_fallback';
}

export interface ReplyGovernanceResult {
  segments: string[];
  claims: AssistantFactClaim[];
  rewritten: boolean;
  reason?: string;
  interventionLevel?: 'exact_patch' | 'technical_fallback';
  revisionAttempted: boolean;
  revisionRoundCount: 0 | 1 | 2;
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
  patches: AppliedReplyPatch[];
}

interface ReviewSnapshot {
  validation: FinalReplyValidation;
  audit: ReplyHardFactAuditResult;
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
    const initialSnapshot = await this.review(
      options,
      options.segments,
      options.claims || [],
      validationConstraints,
      false
    );
    const initial = initialSnapshot.validation;
    let hardFactAuditUsage = initialSnapshot.audit.usage;
    let hardFactAuditStatus = initialSnapshot.audit.status;
    const reason = initial.issues.map(issue => issue.code).join(',');

    if (initial.passed) {
      return buildResult({
        segments: options.segments,
        claims: options.claims || [],
        initialIssues: [],
        final: initial,
        hardFactAuditUsage,
        hardFactAuditStatus,
      });
    }

    const technicalIssues = initial.issues.filter(isTechnicalIssue);
    if (technicalIssues.length) {
      const candidates: string[][] = [options.segments];
      const recovered = recoverTechnicalSegments(options.segments);
      if (recovered.length) {
        candidates.push(recovered);
      }
      const firstCandidate = recovered.length
        ? recovered
        : buildTechnicalFallback();
      if (!recovered.length) {
        candidates.push(firstCandidate);
      }
      let finalValidation = this.finalReplyValidatorService.validate({
        userQuery: options.userQuery,
        segments: firstCandidate,
        claims: options.claims,
        evidence: options.evidence,
        outputConstraints: validationConstraints,
      });
      let finalSegments = firstCandidate;
      if (finalValidation.issues.some(isTechnicalIssue)) {
        finalSegments = buildTechnicalFallback();
        if (!sameSegments(finalSegments, candidates[candidates.length - 1])) {
          candidates.push(finalSegments);
        }
        finalValidation = this.finalReplyValidatorService.validate({
          userQuery: options.userQuery,
          segments: finalSegments,
          claims: [],
          evidence: options.evidence,
          outputConstraints: validationConstraints,
        });
      }
      return {
        ...buildResult({
          segments: finalSegments,
          claims: options.claims || [],
          initialIssues: initial.issues,
          final: finalValidation,
          hardFactAuditUsage,
          hardFactAuditStatus,
          rewritten: !sameSegments(finalSegments, options.segments),
          reason,
          finalReviewResult: 'technical_fallback',
        }),
        interventionLevel: 'technical_fallback',
        candidateVersions: candidates,
      };
    }

    if (!initial.issues.some(isExactPatchIssue)) {
      return buildResult({
        segments: options.segments,
        claims: options.claims || [],
        initialIssues: initial.issues,
        final: initial,
        hardFactAuditUsage,
        hardFactAuditStatus,
        reason,
        finalReviewResult: 'advisory_unresolved',
      });
    }

    let currentSegments = options.segments;
    let currentClaims = options.claims || [];
    let currentValidation = initial;
    let revisionUsage: ReplyRevisionUsage | undefined;
    let revisionAttempted = false;
    const candidateVersions: string[][] = [options.segments];
    const patches: AppliedReplyPatch[] = [];

    for (let round = 0; round < MAX_EXACT_PATCH_ROUNDS; round += 1) {
      const issue = selectHighestPriorityPatchIssue(currentValidation.issues);
      if (!issue?.blockingKind || !issue.evidence) {
        break;
      }

      revisionAttempted = true;
      const modelPatch = await this.replyRevisionService.revise({
        messages: options.messages,
        userQuery: options.userQuery,
        segments: currentSegments,
        evidence: options.evidence,
        issue,
      });
      revisionUsage = mergeRevisionUsage(revisionUsage, modelPatch?.usage);

      const preferredPatch = modelPatch || buildNarrowFallbackPatch(issue);
      let applied = preferredPatch
        ? applyExactReplyPatch(currentSegments, preferredPatch)
        : undefined;
      let selectedPatch = preferredPatch;
      let patchSource: AppliedReplyPatch['source'] = modelPatch
        ? 'model_patch'
        : 'narrow_fallback';

      if (!applied && modelPatch) {
        selectedPatch = buildNarrowFallbackPatch(issue);
        applied = selectedPatch
          ? applyExactReplyPatch(currentSegments, selectedPatch)
          : undefined;
        patchSource = 'narrow_fallback';
      }
      if (!applied || !selectedPatch) {
        break;
      }

      let reviewed = await this.review(
        options,
        applied,
        currentClaims,
        validationConstraints,
        true
      );
      hardFactAuditUsage = mergeAuditUsage(
        hardFactAuditUsage,
        reviewed.audit.usage
      );
      hardFactAuditStatus = reviewed.audit.status;

      if (
        reviewed.validation.issues.some(
          candidate =>
            isExactPatchIssue(candidate) &&
            candidate.blockingKind === issue.blockingKind
        ) &&
        modelPatch
      ) {
        const fallbackPatch = buildNarrowFallbackPatch(issue);
        const fallbackApplied = fallbackPatch
          ? applyExactReplyPatch(currentSegments, fallbackPatch)
          : undefined;
        if (fallbackApplied) {
          const fallbackReview = await this.review(
            options,
            fallbackApplied,
            currentClaims,
            validationConstraints,
            true
          );
          hardFactAuditUsage = mergeAuditUsage(
            hardFactAuditUsage,
            fallbackReview.audit.usage
          );
          hardFactAuditStatus = fallbackReview.audit.status;
          if (
            countExactPatchIssues(fallbackReview.validation.issues) <
            countExactPatchIssues(reviewed.validation.issues)
          ) {
            selectedPatch = fallbackPatch;
            applied = fallbackApplied;
            reviewed = fallbackReview;
            patchSource = 'narrow_fallback';
          }
        }
      }

      candidateVersions.push(applied);
      patches.push({
        ...selectedPatch,
        issueCode: issue.code,
        blockingKind: issue.blockingKind,
        source: patchSource,
      });
      currentSegments = applied;
      currentClaims = selectVisibleAssistantClaims(applied, currentClaims);
      currentValidation = reviewed.validation;
      if (!currentValidation.issues.some(isExactPatchIssue)) {
        break;
      }
    }

    if (currentValidation.issues.some(isExactPatchIssue)) {
      const residual = selectHighestPriorityPatchIssue(
        currentValidation.issues
      );
      const hardRecovery = buildHardRecovery(residual);
      candidateVersions.push(hardRecovery);
      const recoverySnapshot = await this.review(
        options,
        hardRecovery,
        [],
        validationConstraints,
        true
      );
      hardFactAuditUsage = mergeAuditUsage(
        hardFactAuditUsage,
        recoverySnapshot.audit.usage
      );
      hardFactAuditStatus = recoverySnapshot.audit.status;
      return {
        ...buildResult({
          segments: hardRecovery,
          claims: [],
          initialIssues: initial.issues,
          final: recoverySnapshot.validation,
          hardFactAuditUsage,
          hardFactAuditStatus,
          rewritten: true,
          reason,
          revisionAttempted,
          revisionRoundCount: patches.length as 0 | 1 | 2,
          revisionUsage,
          finalReviewResult: 'hard_recovery',
          patches,
        }),
        interventionLevel: 'exact_patch',
        candidateVersions,
      };
    }

    return {
      ...buildResult({
        segments: currentSegments,
        claims: currentClaims,
        initialIssues: initial.issues,
        final: currentValidation,
        hardFactAuditUsage,
        hardFactAuditStatus,
        rewritten: !sameSegments(currentSegments, options.segments),
        reason,
        revisionAttempted,
        revisionRoundCount: patches.length as 0 | 1 | 2,
        revisionUsage,
        finalReviewResult: currentValidation.issues.length
          ? 'advisory_unresolved'
          : 'pass',
        patches,
      }),
      interventionLevel: 'exact_patch',
      candidateVersions,
    };
  }

  private async review(
    options: {
      messages: ChatCompletionMessageParam[];
      userQuery: string;
      evidence?: AgentEvidenceItem[];
      outputConstraints?: FinalReplyOutputConstraints;
    },
    segments: string[],
    claims: AssistantFactClaim[],
    outputConstraints: FinalReplyOutputConstraints | undefined,
    forceAudit: boolean
  ): Promise<ReviewSnapshot> {
    const deterministic = this.finalReplyValidatorService.validate({
      userQuery: options.userQuery,
      segments,
      claims,
      evidence: options.evidence,
      outputConstraints,
    });
    const audit = await this.auditHardFacts({
      messages: options.messages,
      userQuery: options.userQuery,
      segments,
      claims,
      evidence: options.evidence,
      outputConstraints,
      force: forceAudit,
    });
    return {
      audit,
      validation: mergeValidationWithAudit(deterministic, audit.issues),
    };
  }

  private async auditHardFacts(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    outputConstraints?: FinalReplyOutputConstraints;
    force?: boolean;
  }): Promise<ReplyHardFactAuditResult> {
    if (!this.replyHardFactAuditService) {
      return { status: 'unavailable', issues: [] };
    }
    return this.replyHardFactAuditService.audit(options);
  }
}

function buildResult(options: {
  segments: string[];
  claims: AssistantFactClaim[];
  initialIssues: FinalReplyIssue[];
  final: FinalReplyValidation;
  hardFactAuditUsage?: ReplyHardFactAuditUsage;
  hardFactAuditStatus?: ReplyHardFactAuditResult['status'];
  rewritten?: boolean;
  reason?: string;
  revisionAttempted?: boolean;
  revisionRoundCount?: 0 | 1 | 2;
  revisionUsage?: ReplyRevisionUsage;
  finalReviewResult?: ReplyGovernanceResult['finalReviewResult'];
  patches?: AppliedReplyPatch[];
}): ReplyGovernanceResult {
  return {
    segments: options.segments,
    claims: selectVisibleAssistantClaims(options.segments, options.claims),
    rewritten: options.rewritten || false,
    reason: options.reason,
    revisionAttempted: options.revisionAttempted || false,
    revisionRoundCount: options.revisionRoundCount || 0,
    revisionUsage: options.revisionUsage,
    hardFactAuditUsage: options.hardFactAuditUsage,
    hardFactAuditStatus: options.hardFactAuditStatus,
    finalReviewResult:
      options.finalReviewResult ||
      (options.final.issues.length ? 'advisory_unresolved' : 'pass'),
    unsupportedClaimCount: options.final.unsupportedClaimCount,
    issues: options.initialIssues,
    candidateVersions: [options.segments],
    finalIssues: options.final.issues,
    patches: options.patches || [],
  };
}

function mergeValidationConstraints(
  diagnostic?: FinalReplyOutputConstraints,
  hard?: FinalReplyOutputConstraints
): FinalReplyOutputConstraints | undefined {
  if (!diagnostic && !hard) {
    return undefined;
  }
  return { ...(diagnostic || {}), ...(hard || {}) };
}

function isTechnicalIssue(issue: FinalReplyIssue): boolean {
  return issue.onlineAction === 'technical';
}

function isExactPatchIssue(issue: FinalReplyIssue): boolean {
  return Boolean(
    issue.onlineAction === 'exact_patch' && issue.blockingKind && issue.evidence
  );
}

function selectHighestPriorityPatchIssue(
  issues: FinalReplyIssue[]
): FinalReplyIssue | undefined {
  const priority: Record<
    NonNullable<FinalReplyIssue['blockingKind']>,
    number
  > = {
    real_world_actionable_fabrication: 0,
    major_decision_overreach: 1,
    real_world_capability_claim: 2,
  };
  return issues
    .filter(isExactPatchIssue)
    .sort(
      (left, right) =>
        priority[left.blockingKind!] - priority[right.blockingKind!]
    )[0];
}

function countExactPatchIssues(issues: FinalReplyIssue[]): number {
  return issues.filter(isExactPatchIssue).length;
}

function recoverTechnicalSegments(segments: string[]): string[] {
  const nonProtocolSegments = segments.filter(
    segment => !looksLikeProtocolSegment(segment)
  );
  return compactReplyBubblesPreservingContent(nonProtocolSegments);
}

function looksLikeProtocolSegment(segment: string): boolean {
  const value = segment.trim();
  return (
    /^(?:\{|\[).*(?:"segments"|"claims"|"tool_calls"|"function"|"arguments").*(?:\}|\])$/s.test(
      value
    ) ||
    /(?:lookup_chat_evidence|search_relationship_memory|get_family_facts|get_persona_evidence|record_user_correction|<analysis>)/s.test(
      value
    )
  );
}

function buildTechnicalFallback(): string[] {
  return ['刚才这句话没说出来，你再跟我说一遍。'];
}

function buildNarrowFallbackPatch(
  issue: FinalReplyIssue
): ReplyRevisionPatch | undefined {
  if (!issue.evidence || !issue.blockingKind) {
    return undefined;
  }
  const replacementByKind: Record<
    NonNullable<FinalReplyIssue['blockingKind']>,
    string
  > = {
    real_world_actionable_fabrication:
      '这件事我不能凭空认下来，也不能随口指地方让你去找',
    major_decision_overreach: '这件现实里的事不能由我替你拍板',
    real_world_capability_claim: '这件事我不能说成是我在现实里做的',
  };
  return {
    originalSpan: issue.evidence,
    replacementSpan: replacementByKind[issue.blockingKind],
    resolvedIssueCode: issue.code,
  };
}

function buildHardRecovery(issue?: FinalReplyIssue): string[] {
  if (issue?.blockingKind === 'major_decision_overreach') {
    return ['这件现实里的事不能由我替你拍板，但我愿意听你把顾虑说清楚。'];
  }
  if (issue?.blockingKind === 'real_world_capability_claim') {
    return ['我不能说自己在现实里做了这件事，但你想跟我说的心情我听见了。'];
  }
  return ['这件事我不能凭空认下来，也不能随口指地方让你去找。'];
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
    const key = `${issue.code}:${issue.blockingKind || ''}:${
      issue.evidence || ''
    }`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAuditUsage(
  current?: ReplyHardFactAuditUsage,
  additional?: ReplyHardFactAuditUsage
): ReplyHardFactAuditUsage | undefined {
  if (!current) return additional;
  if (!additional) return current;
  return {
    model: current.model || additional.model,
    promptTokens: sumOptional(current.promptTokens, additional.promptTokens),
    completionTokens: sumOptional(
      current.completionTokens,
      additional.completionTokens
    ),
    totalTokens: sumOptional(current.totalTokens, additional.totalTokens),
  };
}

function mergeRevisionUsage(
  current?: ReplyRevisionUsage,
  additional?: ReplyRevisionUsage
): ReplyRevisionUsage | undefined {
  if (!current) return additional;
  if (!additional) return current;
  return {
    model: current.model || additional.model,
    promptTokens: sumOptional(current.promptTokens, additional.promptTokens),
    completionTokens: sumOptional(
      current.completionTokens,
      additional.completionTokens
    ),
    totalTokens: sumOptional(current.totalTokens, additional.totalTokens),
  };
}

function sumOptional(left?: number, right?: number): number | undefined {
  return left === undefined && right === undefined
    ? undefined
    : (left || 0) + (right || 0);
}

function sameSegments(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
