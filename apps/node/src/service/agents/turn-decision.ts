import type { ReplyBrief } from './reply-brief.service';
import type { ReplyPlanningMode } from './reply-intent-classifier.service';

export const TURN_DECISION_VERSION = 'turn_decision_v1' as const;

export type TurnDecisionPlanningStatus =
  | 'not_called'
  | 'succeeded'
  | 'timeout'
  | 'parse_failed'
  | 'failed';

export interface TurnDecision {
  version: typeof TURN_DECISION_VERSION;
  planningMode: ReplyPlanningMode;
  planningStatus: TurnDecisionPlanningStatus;
  userNeed: string;
  primaryAct: string;
  supportingActs: string[];
  answerRequired: boolean;
  shouldContinue: boolean;
  evidenceRequired: boolean;
  memoryAllowed: boolean;
  strictGrounding: boolean;
  boundaryFocuses: string[];
  output: {
    tone: string;
    length: ReplyBrief['lengthPlan']['lengthClass'];
    bubbles: 'natural' | 'single_preferred' | 'two_preferred';
  };
}

export function buildTurnDecision(options: {
  brief: ReplyBrief;
  planningMode: ReplyPlanningMode;
  planningStatus?: TurnDecisionPlanningStatus;
  currentQuery?: string;
}): TurnDecision {
  const brief = options.brief;
  const commActs: string[] = brief.commAct?.steps.map(step => step.act) || [];
  const conversationActs: string[] =
    brief.conversationPlan?.moves.map(move => move.type) || [];
  const acts = uniqueStrings(
    commActs.length ? commActs : [...conversationActs, ...brief.replyMoves]
  );
  const questionsToAnswer = brief.reading?.questionsToAnswer || [];
  const primaryIntent = brief.intents[0]?.intent || '';
  const activeContributionRequired = Boolean(
    brief.activeContribution ||
      brief.conversationPlan?.engagement?.assistantContribution ===
        'self_expression'
  );
  const answerRequired =
    activeContributionRequired ||
    questionsToAnswer.length > 0 ||
    /[?？]/.test(options.currentQuery || '') ||
    /^(?:ask_|request_|correct_assistant)/.test(primaryIntent) ||
    ['answer', 'acknowledge'].includes(conversationActs[0]);
  const turnClosure =
    brief.conversationPlan?.turnClosure || brief.bubblePlan.turnClosure;
  const memoryAllowed =
    !brief.correctionPolicy &&
    (brief.mode === 'memory' ||
      brief.factClaimMode === 'grounded' ||
      brief.evidence.length > 0);

  return {
    version: TURN_DECISION_VERSION,
    planningMode: options.planningMode,
    planningStatus:
      options.planningStatus ||
      (options.planningMode === 'semantic' ? 'succeeded' : 'not_called'),
    userNeed:
      brief.reading?.primaryNeed ||
      brief.emotionalNeed ||
      brief.replyMoves[0] ||
      '回应用户当前原话',
    primaryAct: acts[0] || (answerRequired ? 'answer' : 'acknowledge'),
    supportingActs: acts.slice(1, 3),
    answerRequired,
    shouldContinue:
      turnClosure === 'continue' ||
      brief.conversationPlan?.engagement?.closureReadiness === 'blocked',
    evidenceRequired:
      brief.strictGrounding ||
      brief.factClaimMode === 'grounded' ||
      brief.realityDependencies.length > 0,
    memoryAllowed,
    strictGrounding: brief.strictGrounding,
    boundaryFocuses: uniqueStrings([
      ...brief.guardrailFocuses,
      ...brief.forbiddenAssumptions,
    ]),
    output: {
      tone: brief.reading?.suggestedTone || '自然、亲近、克制',
      length: brief.lengthPlan.lengthClass,
      bubbles: brief.bubblePlan.preferTwoSegments
        ? 'two_preferred'
        : brief.bubblePlan.turnClosure === 'close'
        ? 'single_preferred'
        : 'natural',
    },
  };
}

export function buildTurnDecisionPrompt(decision: TurnDecision): string {
  return [
    '# 本轮唯一决策',
    '需要：' + decision.userNeed,
    '主动作：' + decision.primaryAct,
    decision.supportingActs.length
      ? '辅助动作：' + decision.supportingActs.join('、')
      : '',
    '必须直接回答：' + (decision.answerRequired ? '是' : '否'),
    '续聊：' + (decision.shouldContinue ? '可自然留下开放点' : '自然收住'),
    '事实：' +
      (decision.evidenceRequired
        ? '具体事实必须来自证据包'
        : '没有证据也不得新增具体共同经历或现实事实'),
    '表达：' +
      decision.output.tone +
      '；' +
      decision.output.length +
      '；' +
      (decision.output.bubbles === 'single_preferred'
        ? '优先一颗气泡'
        : decision.output.bubbles === 'two_preferred'
        ? '优先两颗气泡；两颗动作不同，合计控制在本轮长度预算内'
        : '按语义自然分泡，不凑数量'),
    decision.boundaryFocuses.length
      ? '边界：' + decision.boundaryFocuses.join('；')
      : '',
    '其他历史计划字段只作解释材料；与本决策冲突时，以本决策、用户原话和证据包为准。',
  ]
    .filter(Boolean)
    .join('\n');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map(value => value?.trim()).filter(Boolean) as string[])
  );
}
