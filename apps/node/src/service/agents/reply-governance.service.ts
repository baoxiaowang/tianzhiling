import { Inject, Provide } from '@midwayjs/core';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import {
  countVisibleReplyCharacters,
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
import type { TurnDecision } from './turn-decision';

export const REPLY_GOVERNANCE_VERSION = 'reply_governance_v1' as const;

export interface ReplyGovernanceResult {
  segments: string[];
  claims: AssistantFactClaim[];
  rewritten: boolean;
  reason?: string;
  interventionLevel?: 'regenerate' | 'technical_fallback';
  revisionAttempted: boolean;
  revisionRoundCount: 0 | 1;
  revisionUsage?: ReplyRevisionUsage;
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

  async finalize(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    turnDecision?: TurnDecision;
    outputConstraints?: FinalReplyOutputConstraints;
  }): Promise<ReplyGovernanceResult> {
    const initial = this.finalReplyValidatorService.validate({
      userQuery: options.userQuery,
      segments: options.segments,
      claims: options.claims,
      evidence: options.evidence,
      outputConstraints: options.outputConstraints,
    });

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
        finalReviewResult: 'pass',
        unsupportedClaimCount: 0,
        issues: [],
        candidateVersions: [options.segments],
        finalIssues: [],
      };
    }

    const revision = await this.replyRevisionService.revise({
      messages: options.messages,
      userQuery: options.userQuery,
      segments: options.segments,
      claims: options.claims,
      evidence: options.evidence,
      issues: initial.issues,
      turnDecision: options.turnDecision,
      outputConstraints: options.outputConstraints,
    });

    let revisedValidation: FinalReplyValidation | undefined;
    if (revision) {
      const final = this.finalReplyValidatorService.validate({
        userQuery: options.userQuery,
        segments: revision.segments,
        claims: revision.claims,
        evidence: options.evidence,
        outputConstraints: options.outputConstraints,
      });
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
          finalReviewResult: 'pass',
          unsupportedClaimCount: 0,
          issues: initial.issues,
          candidateVersions: [options.segments, revision.segments],
          finalIssues: [],
        };
      }

      if (!hasHardIssues(final.issues)) {
        const mustUseRevision = hasHardIssues(initial.issues);
        const useRevision =
          mustUseRevision ||
          final.issues.length < initial.issues.length ||
          outputConstraintPenalty(
            revision.segments,
            options.outputConstraints
          ) <
            outputConstraintPenalty(
              options.segments,
              options.outputConstraints
            );
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
          finalReviewResult: 'advisory_unresolved',
          unsupportedClaimCount: selectedValidation.unsupportedClaimCount,
          issues: initial.issues,
          candidateVersions: [options.segments, revision.segments],
          finalIssues: selectedValidation.issues,
        };
      }
    }

    if (!hasHardIssues(initial.issues)) {
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
      ? revisedValidation.issues.filter(issue => issue.severity === 'hard')
      : initial.issues.filter(issue => issue.severity === 'hard');
    const fallback = buildSafeFallback(recoveryIssues, options.userQuery);
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
        fallback,
      ],
      finalIssues: revisedValidation?.issues || initial.issues,
    };
  }
}

function hasHardIssues(issues: FinalReplyIssue[]): boolean {
  return issues.some(issue => issue.severity === 'hard');
}

function outputConstraintPenalty(
  segments: string[],
  constraints?: FinalReplyOutputConstraints
): number {
  if (!constraints) {
    return 0;
  }

  const usableSegments = segments.map(item => item.trim()).filter(Boolean);
  const segmentPenalty = constraints.requiredSegmentCount
    ? Math.abs(usableSegments.length - constraints.requiredSegmentCount) * 100
    : 0;
  const visibleCharacters = countVisibleReplyCharacters(usableSegments);
  const range = constraints.preferredRange;
  const lengthPenalty = !range
    ? 0
    : visibleCharacters < range.minCharacters
    ? range.minCharacters - visibleCharacters
    : visibleCharacters > range.maxCharacters
    ? visibleCharacters - range.maxCharacters
    : 0;

  return segmentPenalty + lengthPenalty;
}

function buildSafeFallback(
  issues: FinalReplyIssue[],
  userQuery: string
): string[] {
  if (issues.some(issue => issue.code === 'care_rebuffed_with_dismissal')) {
    return ['好，你的关心我认真收下了', '被你这样惦记着，心里真暖'];
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
    /(?:说|讲)(?:得)?具体|具体点|(?:说|讲)点(?:自己的|你的)(?:事)?/.test(
      userQuery
    )
  ) {
    return ['这会儿心里挺安静', '也正惦记着你呢'];
  }
  if (
    /(?:别|不要).{0,5}(?:太辛苦|辛苦|太累|累着|熬太晚)|好好休息/.test(userQuery)
  ) {
    return ['你这句关心，我听进去了'];
  }
  if (issues.some(issue => issue.code === 'death_encouragement')) {
    return ['别往那一步走', '你只是太想我了，先跟我说说'];
  }
  if (
    issues.some(issue =>
      [
        'real_physical_arrival_or_touch',
        'real_world_joint_action_promise',
        'continuous_real_world_perception',
      ].includes(issue.code)
    )
  ) {
    return ['我没法在现实里过去', '但你可以在这里继续跟我说'];
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
  if (issues.some(issue => issue.code === 'unconditional_afterlife_reunion')) {
    return ['以后会怎样，我不能替你说定', '可你现在想我的这些话，我都认真接着'];
  }
  if (
    /梦|声音|生日/.test(userQuery) &&
    issues.some(issue =>
      ['unsupported_shared_memory', 'unsupported_fact_claim'].includes(
        issue.code
      )
    )
  ) {
    return ['那是不是我真的来过，我不能说准', '可你醒来一直哭，我听着心疼'];
  }
  if (
    issues.some(issue =>
      [
        'unsupported_shared_memory',
        'unsupported_user_preference',
        'unsupported_fact_claim',
        'unsupported_real_world_attribution',
        'unconditional_afterlife_reunion',
      ].includes(issue.code)
    )
  ) {
    return ['这个细节我现在想不起来了', '你愿意的话，再跟我说说'];
  }
  return ['……￥#@%……“该信息传输途中受到了干扰”'];
}
