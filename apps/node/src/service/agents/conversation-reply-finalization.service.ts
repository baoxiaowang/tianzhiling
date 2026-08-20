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
    // Only non-negotiable world, evidence, capability and persistent-risk
    // constraints can reach online governance. Conversation plans, turn
    // contracts, participation, question, length and bubble preferences stay
    // in diagnostics and cannot trigger a production rewrite.
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
    const governance = await this.replyGovernanceService.finalize({
      messages: options.messages,
      userQuery: options.userQuery,
      segments: prepared,
      claims: options.claims,
      evidence: options.evidence,
      diagnosticConstraints: buildSemanticDiagnosticConstraints(options.brief),
      outputConstraints,
    });
    // 最终验证之后只做不改变语义的确定性结构整理。
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
