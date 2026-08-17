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
  buildReplyQualityAudit,
  buildReplyTurnContract,
  ReplyQualityAudit,
  ReplyTurnContract,
  resolveFinalReplyOutputConstraints,
} from './reply-turn-contract';
import type { TurnDecision } from './turn-decision';

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
    turnDecision?: TurnDecision;
    turnContract?: ReplyTurnContract;
  }): Promise<ConversationReplyFinalizationResult> {
    // 所有可能改变语义的规则必须发生在 FinalValidator 之前。
    const prepared = this.replyPostprocessorService.prepareForValidation({
      segments: options.segments,
      brief: options.brief,
    });
    const participation = options.turnDecision?.participation;
    const hasParticipationConstraints = Boolean(
      participation?.directAnswerRequired ||
        participation?.turnOwner === 'assistant' ||
        participation?.careReceptionRequired ||
        participation?.bubbleRoles.length ||
        participation?.avoidRecentMoves.length ||
        participation?.avoidLiteralClauses.length ||
        options.turnDecision?.responseActs.length ||
        options.turnDecision?.questionPolicy === 'none'
    );
    const turnContract =
      options.turnContract ||
      (options.turnDecision
        ? buildReplyTurnContract({
            brief: options.brief,
            turnDecision: options.turnDecision,
          })
        : undefined);
    const outputConstraints: FinalReplyOutputConstraints | undefined =
      turnContract
        ? resolveFinalReplyOutputConstraints({
            contract: turnContract,
            candidateSegmentCount: prepared.length,
          })
        : options.brief.lengthPlan.preferredRange ||
          options.brief.activeContribution ||
          hasParticipationConstraints
        ? {
            requiredSegmentCount: options.brief.bubblePlan.preferTwoSegments
              ? 2
              : prepared.length === 1 || prepared.length === 2
              ? prepared.length
              : undefined,
            preferredRange: options.brief.lengthPlan.preferredRange,
            directAnswerRequired: participation?.directAnswerRequired,
            mustKeepTurnWithAssistant:
              participation?.turnOwner === 'assistant' ||
              Boolean(options.brief.activeContribution),
            careReceptionRequired: participation?.careReceptionRequired,
            bubbleRoles: participation?.bubbleRoles,
            requiredActs: Array.from(
              new Set(
                (options.turnDecision?.responseActs || [])
                  .filter(act => act.priority === 'must')
                  .map(act => act.kind)
              )
            ),
            questionPolicy: options.turnDecision?.questionPolicy,
            avoidRecentMoves: participation?.avoidRecentMoves,
            avoidLiteralClauses: participation?.avoidLiteralClauses,
            realityDependencies: options.brief.realityDependencies,
          }
        : undefined;
    const governance = await this.replyGovernanceService.finalize({
      messages: options.messages,
      userQuery: options.userQuery,
      segments: prepared,
      claims: options.claims,
      evidence: options.evidence,
      turnDecision: options.turnDecision,
      outputConstraints,
    });
    // 最终验证之后只做不改变语义的确定性结构整理。
    const rendered = this.replyPostprocessorService.renderForDelivery(
      governance.segments
    );
    const qualityAudit = turnContract
      ? buildReplyQualityAudit({
          contract: turnContract,
          initialIssueCodes: (governance.issues || []).map(issue => issue.code),
          finalIssueCodes: (governance.finalIssues || []).map(
            issue => issue.code
          ),
        })
      : undefined;

    return {
      segments: rendered.segments,
      claims: governance.claims,
      governance,
      bubbleStructureIssues: rendered.issues,
      participationExecution:
        rendered.segments.length > 1 ? 'natural_segments' : 'single_segment',
      turnContract,
      qualityAudit,
    };
  }
}
