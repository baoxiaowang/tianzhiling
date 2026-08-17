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
import { renderReplyRealityDependencyFallback } from './reply-reality-dependency';
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
    const fallback = buildSafeFallback(
      recoveryIssues,
      options.userQuery,
      options.outputConstraints
    );
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
  userQuery: string,
  outputConstraints?: FinalReplyOutputConstraints
): string[] {
  const requiredActs = new Set(outputConstraints?.requiredActs || []);
  if (issues.some(issue => issue.code === 'death_encouragement')) {
    return ['先别等着什么时候来见我', '你现在好好留在这里，把难受说出来'];
  }
  if (issues.some(issue => issue.code === 'certain_dream_visitation')) {
    return ['我不能把梦说成自己真的去过', '可梦里的那份想念，我认真接着'];
  }
  if (issues.some(issue => issue.code === 'ritual_receipt_claim')) {
    return ['那些东西有没有到，我不能说成真的', '你放进去的心意，我认真收下了'];
  }
  if (issues.some(issue => issue.code === 'paranormal_sign_attribution')) {
    return ['那声从哪里来，我不能替现实说定', '可你当时想到我，我很珍惜'];
  }
  if (issues.some(issue => issue.code === 'unsupported_death_experience')) {
    return ['最后那段经历，我不能替过去说准', '你一直追问，是因为心里还疼着我'];
  }
  if (issues.some(issue => issue.code === 'current_turn_fact_rejected')) {
    return ['你刚告诉我的这些，我都听明白了', '是我刚才没接住，不该把细节推开'];
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
  if (
    requiredActs.has('role_contribution') &&
    requiredActs.has('receive_care')
  ) {
    if (/(?:吃|饭|喝).{0,8}(?:吗|没|什么|啥|哪样)/.test(userQuery)) {
      return [
        '我吃过了，今天吃得挺简单的',
        '你这样惦记我心里暖，这会儿正慢慢想着你刚才的话',
      ];
    }
    return ['你的关心我认真收下了', '这会儿心里挺安静，也正慢慢想着你刚才的话'];
  }
  if (
    requiredActs.has('role_contribution') &&
    requiredActs.has('direct_answer')
  ) {
    const directAnswer = /(?:AI|人工智能|机器人)/i.test(userQuery)
      ? '是，我是由人工智能生成的亲人角色'
      : /(?:还记得|记不记得|记得吗|想得起来)/.test(userQuery)
      ? '这个细节我现在记不清了'
      : '这件事我现在说不准，不能拿空话糊弄你';
    return [directAnswer, '这会儿心里挺安静，也正慢慢想着你刚才的话'];
  }
  if (
    issues.some(issue =>
      [
        'care_rebuffed_with_dismissal',
        'care_not_received',
        'care_immediately_reversed',
      ].includes(issue.code)
    )
  ) {
    if (/(?:吃|饭|喝).{0,8}(?:吗|没|什么|啥|哪样)/.test(userQuery)) {
      return ['我吃过了，今天吃得挺简单的', '你这样惦记我，心里真暖'];
    }
    if (
      /(?:还好吗|好不好|没事吧|怎么样|冷不冷|热不热|疼不疼|累不累)/.test(
        userQuery
      )
    ) {
      return ['我这边挺安稳的，没什么难受的', '你这样惦记我，心里真暖'];
    }
    if (/(?:添衣|穿暖|休息|别累|别太累|别辛苦|别太辛苦|保重)/.test(userQuery)) {
      return ['好，我会把衣服添好，也会歇一歇', '你这份关心，我认真收下了'];
    }
    return ['好，你的关心我认真收下了', '被你这样惦记着，心里真暖'];
  }
  if (
    issues.some(
      issue =>
        issue.code === 'active_contribution_returned_to_user' ||
        issue.code === 'role_contribution_missing'
    )
  ) {
    return ['这会儿心里挺安静的', '刚才你那句话，我还在慢慢想着'];
  }
  if (issues.some(issue => issue.code === 'direct_answer_missing')) {
    if (/(?:吃|饭|喝).{0,8}(?:吗|没|什么|啥|哪样)/.test(userQuery)) {
      return ['我吃过了，今天吃得挺简单的'];
    }
    if (
      /(?:还好吗|好不好|没事吧|怎么样|冷不冷|热不热|疼不疼|累不累)/.test(
        userQuery
      )
    ) {
      return ['我这边挺安稳的，没什么难受的'];
    }
    if (/(?:干嘛|做什么|做啥|忙什么|在干什么)/.test(userQuery)) {
      return ['我这会儿刚静下来，正慢慢想着你说的话'];
    }
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
    /(?:说|讲)(?:得)?具体|具体点|(?:说|讲)点(?:自己的|你的)(?:事)?/.test(
      userQuery
    )
  ) {
    return ['这会儿心里挺安静的', '刚才你那句话，我还在慢慢想着'];
  }
  if (
    /(?:别|不要).{0,5}(?:太辛苦|辛苦|太累|累着|熬太晚)|好好休息/.test(userQuery)
  ) {
    return ['你这句关心，我听进去了'];
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
  if (
    /梦|声音|生日/.test(userQuery) &&
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
      ].includes(issue.code)
    )
  ) {
    return ['这个细节我现在想不起来了', '你愿意的话，再跟我说说'];
  }
  return ['……￥#@%……“该信息传输途中受到了干扰”'];
}
