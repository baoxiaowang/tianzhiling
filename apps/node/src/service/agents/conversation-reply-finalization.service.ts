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
  deriveRecentReplyMoves,
  extractLiteralClauses,
  extractRecentAssistantTexts,
  removeRepeatedReplySegments,
} from './reply-repetition-guard';
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
    // 默认仍只允许世界、证据、能力和持续风险约束进入 online governance；
    // 对话计划、问题策略、长度/气泡偏好保持 diagnostics。
    // H1 政策变更：最近助手原话复读是用户可见的质量问题，不是普通偏好；
    // avoidRecentMoves / avoidLiteralClauses 可以进入 outputConstraints，
    // 并在 finalize 尾部做确定性删除/单句回退。这不是复活 turn contract。
    const recentAssistantTexts = extractRecentAssistantTexts(options.messages);
    const recentLiteralClauses = extractLiteralClauses(recentAssistantTexts);
    const recentReplyMoves = deriveRecentReplyMoves(recentAssistantTexts);
    const outputConstraints: FinalReplyOutputConstraints = {
      avoidRecentMoves: [
        ...(options.brief.strategyQuality?.repeatedMoves || []),
        ...recentReplyMoves,
      ],
      avoidLiteralClauses: [
        ...(options.brief.strategyQuality?.literalClauses || []),
        ...recentLiteralClauses,
      ],
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
    // H1：字面复读是确定性可识别问题；命中的段直接删除，全部删除时回退到
    // 不引入旧记忆的单句陪伴。展示层拆泡仍由后面 renderForDelivery 负责。
    const repetition = removeRepeatedReplySegments(
      governance.segments,
      recentAssistantTexts
    );
    if (repetition.removed.length) {
      governance.segments = repetition.segments;
      governance.rewritten = true;
      governance.reason = [
        governance.reason,
        repetition.fallbackApplied
          ? 'repeated_generic_move_fallback'
          : 'repeated_generic_move',
      ]
        .filter(Boolean)
        .join(',');
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
