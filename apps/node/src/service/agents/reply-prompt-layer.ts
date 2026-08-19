import type { AgentChatToolTurnPlan } from './agent-chat-tools';
import type { ReplyPlanningMode } from './reply-intent-classifier.service';
import type { ReplyBrief } from './reply-brief.service';

export const REPLY_PROMPT_LAYER_VERSION = 'reply_prompt_layers_v1' as const;

export type ReplyPromptReductionMode = 'off' | 'active';
export type ReplyPromptLayerMode = 'minimal' | 'hybrid' | 'full';

export interface ReplyPromptLayerConfig {
  mode?: ReplyPromptReductionMode;
  modelPromptLayer?: ReplyPromptLayerMode;
  l5TraceOnly?: boolean;
}

export interface ReplyPromptLayerPlan {
  version: typeof REPLY_PROMPT_LAYER_VERSION;
  reductionActive: boolean;
  layerMode: ReplyPromptLayerMode;
  l5TraceOnly: boolean;
  planningMode: ReplyPlanningMode;
  complex: boolean;
  includeReading: boolean;
  includeMode: boolean;
  includeEvidence: boolean;
  includeContinuity: boolean;
  includeTask: boolean;
  includeL5: boolean;
  includeTools: boolean;
  reason: string;
}

export function normalizeReplyPromptReductionMode(
  value: string | undefined
): ReplyPromptReductionMode {
  return value === 'off' ? 'off' : 'active';
}

export function normalizeReplyPromptLayerMode(
  value: string | undefined
): ReplyPromptLayerMode {
  return value === 'minimal' || value === 'full' ? value : 'hybrid';
}

export function isComplexReplyBrief(replyBrief?: ReplyBrief): boolean {
  if (!replyBrief) {
    return false;
  }

  return (
    replyBrief.riskLevel === 'high' ||
    replyBrief.mode === 'boundary' ||
    replyBrief.mode === 'memory' ||
    replyBrief.mode === 'memory_control' ||
    Boolean(replyBrief.correctionPolicy) ||
    Boolean(replyBrief.realityDependencies?.length) ||
    Boolean(replyBrief.objectPlan?.ambiguousMentions?.length) ||
    Boolean(replyBrief.activeContribution) ||
    Boolean(replyBrief.stateProtocol) ||
    Boolean(replyBrief.dreamCompanionPlan) ||
    Boolean(replyBrief.strategyQuality?.repeatedMoves?.length)
  );
}

export function resolveReplyPromptLayerPlan(options: {
  config?: ReplyPromptLayerConfig;
  planningMode: ReplyPlanningMode;
  replyBrief?: ReplyBrief;
  chatToolPlan?: AgentChatToolTurnPlan;
  hasContinuitySummary: boolean;
}): ReplyPromptLayerPlan {
  const reductionMode = normalizeReplyPromptReductionMode(options.config?.mode);
  const layerMode = normalizeReplyPromptLayerMode(
    options.config?.modelPromptLayer
  );
  const reductionActive = reductionMode === 'active';
  // 是否注入扩展策略层由本轮真实风险/边界决定，不再因为调用过
  // 语义规划器就自动携带整套 L5。
  const complex = isComplexReplyBrief(options.replyBrief);
  const hasTools =
    options.chatToolPlan?.mode === 'shadow' ||
    options.chatToolPlan?.mode === 'active';
  const hasReading = Boolean(options.replyBrief?.reading);

  let includeL5 = false;
  let reason: string;

  if (!reductionActive) {
    includeL5 = true;
    reason = 'program_reduction_off';
  } else if (layerMode === 'full') {
    includeL5 = true;
    reason = 'full_layer_mode';
  } else if (layerMode === 'minimal') {
    includeL5 = false;
    reason = 'minimal_layer_mode';
  } else {
    includeL5 = complex;
    reason = complex ? 'complex_hybrid' : 'ordinary_hybrid';
  }

  return {
    version: REPLY_PROMPT_LAYER_VERSION,
    reductionActive,
    layerMode,
    l5TraceOnly:
      reductionActive && !includeL5 && options.config?.l5TraceOnly !== false,
    planningMode: options.planningMode,
    complex,
    includeReading: hasReading || !reductionActive || complex,
    includeMode: false,
    includeEvidence: true,
    includeContinuity: options.hasContinuitySummary,
    includeTask: true,
    includeL5,
    includeTools: Boolean(hasTools),
    reason,
  };
}
