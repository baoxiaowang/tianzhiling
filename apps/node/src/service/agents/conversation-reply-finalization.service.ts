import { Inject, Provide } from '@midwayjs/core';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import type { ReplyBubbleStructureIssue } from './reply-bubble-plan';
import type { ReplyBrief } from './reply-brief.service';
import type { FinalReplyOutputConstraints } from './final-reply-validator.service';
import {
  ReplyGovernanceResult,
  ReplyGovernanceService,
} from './reply-governance.service';
import { ReplyPostprocessorService } from './reply-postprocessor.service';
import {
  isExactRepeatedReply,
  suppressRepeatedQuestions,
} from './reply-repetition-guard';
import {
  ReplyRevisionService,
  ReplyRevisionUsage,
} from './reply-revision.service';
import type {
  ReplyQualityAudit,
  ReplyTurnContract,
} from './reply-turn-contract';

export interface ConversationReplyFinalizationResult {
  segments: string[];
  claims: AssistantFactClaim[];
  governance: ReplyGovernanceResult;
  bubbleStructureIssues: ReplyBubbleStructureIssue[];
  participationExecution?: 'natural_segments' | 'single_segment';
  turnContract?: ReplyTurnContract;
  qualityAudit?: ReplyQualityAudit;
}

@Provide()
export class ConversationReplyFinalizationService {
  @Inject()
  replyGovernanceService: ReplyGovernanceService;

  @Inject()
  replyPostprocessorService: ReplyPostprocessorService;

  @Inject()
  replyRevisionService: ReplyRevisionService;

  async finalize(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    brief: ReplyBrief;
  }): Promise<ConversationReplyFinalizationResult> {
    // 所有可能改变语义的规则必须发生在 FinalValidator 之前。
    const prepared = this.replyPostprocessorService.prepareForValidation({
      segments: options.segments,
      brief: options.brief,
    });
    // Ordinary wording preferences must not delete or replace a semantic reply.
    const outputConstraints: FinalReplyOutputConstraints = {
      realityDependencies: options.brief.realityDependencies,
      boundaryLocks: options.brief.understanding.boundaryLocks.map(
        lock => lock.kind
      ),
      correctionRequired: Boolean(options.brief.correctionPolicy),
      afterlifeWorld: options.brief.afterlifeWorld,
      sceneFramework: options.brief.sceneFramework,
      worldBoundaryPolicy: options.brief.worldBoundaryPolicy,
      evidenceContract: options.brief.evidenceContract,
      conversationProtection: options.brief.conversationProtection,
    };
    let governance = await this.replyGovernanceService.finalize({
      messages: options.messages,
      userQuery: options.userQuery,
      segments: prepared,
      claims: options.claims,
      evidence: options.evidence,
      diagnosticConstraints: buildSemanticDiagnosticConstraints(options.brief),
      outputConstraints,
    });
    // Safety repair has priority; never start a second quality-repair loop.
    if (
      isExactRepeatedReply(governance.segments, options.messages) &&
      !governance.revisionAttempted &&
      governance.finalReviewResult !== 'technical_fallback'
    ) {
      const previous = governance;
      const repair = await this.replyRevisionService
        ?.reviseRepeatedReply({
          messages: options.messages,
          userQuery: options.userQuery,
          segments: previous.segments,
        })
        .catch(() => undefined);
      const usable =
        repair?.segments.length &&
        !isExactRepeatedReply(repair.segments, options.messages);
      if (usable) {
        governance = await this.replyGovernanceService.finalize({
          messages: options.messages,
          userQuery: options.userQuery,
          segments: this.replyPostprocessorService.prepareForValidation({
            segments: repair.segments,
            brief: options.brief,
          }),
          claims: [],
          evidence: options.evidence,
          diagnosticConstraints: buildSemanticDiagnosticConstraints(
            options.brief
          ),
          outputConstraints,
          maxRevisionRounds: 1,
        });
        governance.hardFactAuditUsage = sumUsage(
          previous.hardFactAuditUsage,
          governance.hardFactAuditUsage
        );
      }
      governance.revisionAttempted = true;
      governance.revisionRoundCount = Math.min(
        2,
        governance.revisionRoundCount + 1
      ) as 1 | 2;
      governance.revisionUsage = sumUsage(
        repair?.usage,
        governance.revisionUsage
      );
      governance.rewritten =
        previous.rewritten ||
        JSON.stringify(previous.segments) !==
          JSON.stringify(governance.segments);
      governance.reason = [
        governance.reason,
        'repeated_generic_move[L1]',
        usable ? 'exact_repeat_repair' : 'exact_repeat_repair_unresolved',
      ]
        .filter(Boolean)
        .join(',');
      governance.candidateVersions = [
        ...previous.candidateVersions,
        ...(usable ? governance.candidateVersions : []),
      ];
    }
    if (isExactRepeatedReply(governance.segments, options.messages)) {
      governance.segments = ['好，这个问题就先放下。'];
      governance.claims = [];
      governance.rewritten = true;
      governance.candidateVersions = [
        ...governance.candidateVersions,
        governance.segments,
      ];
      if (!governance.reason?.includes('repeated_generic_move[L1]')) {
        governance.reason = [governance.reason, 'repeated_generic_move[L1]']
          .filter(Boolean)
          .join(',');
      }
    }
    const questionGuard = suppressRepeatedQuestions(
      governance.segments,
      options.messages
    );
    if (questionGuard.removed.length) {
      governance.segments = questionGuard.segments;
      governance.claims = [];
      governance.rewritten = true;
      governance.reason = [governance.reason, 'repeated_generic_move[L2]']
        .filter(Boolean)
        .join(',');
      governance.candidateVersions = [
        ...governance.candidateVersions,
        governance.segments,
      ];
    }
    const rendered = this.replyPostprocessorService.renderForDelivery(
      governance.segments
    );
    return {
      segments: rendered.segments,
      claims: governance.claims,
      governance,
      bubbleStructureIssues: rendered.issues,
      participationExecution:
        rendered.segments.length > 1 ? 'natural_segments' : 'single_segment',
      turnContract: undefined,
      qualityAudit: undefined,
    };
  }
}

function buildSemanticDiagnosticConstraints(
  brief: ReplyBrief
): FinalReplyOutputConstraints | undefined {
  const activeSpeechRequest = Boolean(
    brief.understanding.activeSpeechRequest || brief.activeContribution
  );
  const careReceptionRequired = Boolean(brief.careReception?.active);
  const directAnswerRequired = brief.understanding.questions.some(
    question => question.mustAnswer
  );
  if (!activeSpeechRequest && !careReceptionRequired && !directAnswerRequired) {
    return undefined;
  }

  return {
    directAnswerRequired,
    mustKeepTurnWithAssistant: activeSpeechRequest,
    careReceptionRequired,
    requiredActs: [
      ...(activeSpeechRequest ? (['role_contribution'] as const) : []),
      ...(careReceptionRequired ? (['receive_care'] as const) : []),
    ],
    questionPolicy: activeSpeechRequest ? 'none' : 'helpful',
  };
}

function sumUsage(
  left?: ReplyRevisionUsage,
  right?: ReplyRevisionUsage
): ReplyRevisionUsage | undefined {
  if (!left && !right) return undefined;
  return {
    model: right?.model || left?.model,
    promptTokens: (left?.promptTokens || 0) + (right?.promptTokens || 0),
    completionTokens:
      (left?.completionTokens || 0) + (right?.completionTokens || 0),
    totalTokens: (left?.totalTokens || 0) + (right?.totalTokens || 0),
  };
}
