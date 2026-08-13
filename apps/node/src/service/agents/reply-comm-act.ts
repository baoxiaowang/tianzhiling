import type {
  ConversationTurnPlan,
  ConversationUserState,
} from './reply-intent';
import { hasContentUnitEcho, type ContentUnit } from './reply-content-unit';
import type { ReplyStrategyQualityPlan } from './reply-strategy-quality';

// CommAct 描述"用什么沟通姿态"完成回复；与 ConversationMove 的"要完成什么功能"互补。
export const COMM_ACT_VERSION = 'comm_act_v1' as const;

export const COMM_ACT_KINDS = [
  'echo_content',
  'concretize',
  'reflect_feeling',
  'validate',
  'continuing_bond',
  'self_disclose',
  'invite',
  'share_stance',
  'silence_hold',
  'leave_space',
  'natural_close',
  'redirect',
  'follow_up_probe',
] as const;
export type CommActKind = (typeof COMM_ACT_KINDS)[number];

export type CommActLayer = 'L1' | 'L2' | 'L3';

export interface CommActStep {
  layer: CommActLayer;
  act: CommActKind;
  targetUnit?: ContentUnit;
}

export interface ReplyCommActPlan {
  version: typeof COMM_ACT_VERSION;
  state: ConversationUserState;
  steps: CommActStep[];
  targetUnit?: ContentUnit;
}

interface ResolveReplyCommActOptions {
  currentQuery: string;
  state: ConversationUserState;
  turnPlan?: ConversationTurnPlan;
  contentUnits?: ContentUnit[];
  strategyQuality?: ReplyStrategyQualityPlan;
  scene?: string;
  mode?: string;
  riskLevel?: string;
  questionNeed?: 'none' | 'helpful' | 'necessary';
  preferAsk?: boolean;
}

const STATE_DEFAULTS: Record<
  ConversationUserState,
  { L1: CommActKind; L2: CommActKind; L3: CommActKind }
> = {
  opening: { L1: 'echo_content', L2: 'reflect_feeling', L3: 'invite' },
  exploring: { L1: 'echo_content', L2: 'concretize', L3: 'invite' },
  deepening: { L1: 'concretize', L2: 'reflect_feeling', L3: 'silence_hold' },
  repairing: { L1: 'validate', L2: 'reflect_feeling', L3: 'share_stance' },
  withdrawing: { L1: 'reflect_feeling', L2: 'validate', L3: 'leave_space' },
  closing: { L1: 'validate', L2: 'reflect_feeling', L3: 'natural_close' },
};

const STRATEGY_TO_L3: Partial<
  Record<ReplyStrategyQualityPlan['preferredAlternative'], CommActKind>
> = {
  natural_close: 'natural_close',
  self_expression: 'self_disclose',
  grounded_detail: 'concretize',
  topic_transition: 'redirect',
  leave_space: 'leave_space',
  answer: 'echo_content',
};

const ACT_TEXT: Record<CommActKind, string> = {
  echo_content: '复述用户说的具体内容',
  concretize: '贴着一个具体细节展开',
  reflect_feeling: '把情绪放回那个情境里回应',
  validate: '肯定这份感受的合理性',
  continuing_bond: '维持"我还在"的联结',
  self_disclose: '给亲人侧当下的心意',
  invite: '留一个让用户愿意继续说的小口子',
  share_stance: '明确站在用户这边',
  silence_hold: '少说多陪，不把情绪填满',
  leave_space: '停在这件事上，不追问不转移',
  natural_close: '顺着收尾信号轻收',
  redirect: '贴着新信息轻转相邻一步',
  follow_up_probe: '顺着已确认的具体内容问一个开放式问题',
};

function stateFromTurnPlan(
  turnPlan: ConversationTurnPlan | undefined,
  fallback: ConversationUserState
): ConversationUserState {
  return turnPlan?.state || fallback;
}

export function resolveConversationState(options: {
  currentQuery: string;
  scene?: string;
  mode?: string;
  riskLevel?: string;
}): ConversationUserState {
  if (/晚安|先睡|不聊了|拜拜|再见|回头再聊|下次再聊/.test(options.currentQuery)) {
    return 'closing';
  }
  if (/不对|不是这样|你理解错|不像你|别(?:再)?编/.test(options.currentQuery)) {
    return 'repairing';
  }
  if (options.riskLevel === 'high' || options.scene === 'comfort_request') {
    return 'deepening';
  }
  if (options.currentQuery.length <= 8 && options.mode !== 'memory') {
    return 'opening';
  }
  return 'exploring';
}

function resolveTargetUnit(units: ContentUnit[] = []): ContentUnit | undefined {
  return units[0];
}

function resolveL3(
  state: ConversationUserState,
  strategyQuality?: ReplyStrategyQualityPlan,
  options?: Pick<
    ResolveReplyCommActOptions,
    | 'questionNeed'
    | 'preferAsk'
    | 'contentUnits'
    | 'turnPlan'
    | 'scene'
    | 'riskLevel'
  >
): CommActKind {
  const preferred = strategyQuality?.preferredAlternative;
  const topicFollowups =
    options?.turnPlan?.open.filter(point => point.need === 'topic_followup') ||
    [];
  const hasMustTopicFollowup = topicFollowups.some(
    point => point.priority === 'must'
  );
  const hasSupportingTopicFollowup = topicFollowups.some(
    point => point.priority === 'supporting'
  );
  const turnPlan = options?.turnPlan;
  const preferAsk = Boolean(options?.preferAsk);

  // 模型经常把一件正在进行、值得继续了解的事判成 deepening。
  // 只要 turnPlan 明确保留了 topic_followup，就让具体追问优先于沉默陪伴，
  // 但不越过已经要收尾、退开或修复的关系状态。
  const stateAllowsFollowUp =
    state === 'opening' || state === 'exploring' || state === 'deepening';

  const turnIsClosing =
    turnPlan?.close === 'ready' ||
    turnPlan?.goal === 'close' ||
    state === 'closing';
  const emotionalHoldOnly =
    options?.scene === 'comfort_request' ||
    options?.scene === 'miss_longing' ||
    options?.riskLevel === 'high';
  const explicitAskFromPlanner =
    preferAsk && options?.questionNeed !== 'none';

  // 明确保留的 topic_followup 优先于通用策略换挡；换挡仍负责没有
  // 开放话题时的去重和自然转场。
  if (
    stateAllowsFollowUp &&
    !turnIsClosing &&
    (hasMustTopicFollowup ||
      explicitAskFromPlanner ||
      (hasSupportingTopicFollowup &&
        !emotionalHoldOnly &&
        options?.questionNeed !== 'none'))
  ) {
    return 'follow_up_probe';
  }

  if (preferred && STRATEGY_TO_L3[preferred]) {
    return STRATEGY_TO_L3[preferred] as CommActKind;
  }

  return STATE_DEFAULTS[state].L3;
}

function buildSteps(options: ResolveReplyCommActOptions): CommActStep[] {
  const defaults = STATE_DEFAULTS[options.state];
  const targetUnit = resolveTargetUnit(options.contentUnits);
  const L3 = resolveL3(options.state, options.strategyQuality, options);

  const steps: CommActStep[] = [];
  if (options.contentUnits?.length) {
    steps.push({ layer: 'L1', act: defaults.L1, targetUnit });
  } else if (options.currentQuery.trim().length >= 8) {
    // 没有结构化的具体内容时，L1 轻量回落到"具体化"，让模型贴着原话选一个点。
    steps.push({ layer: 'L1', act: 'concretize', targetUnit });
  }

  if (defaults.L2 !== defaults.L1 || !options.contentUnits?.length) {
    steps.push({ layer: 'L2', act: defaults.L2 });
  }
  steps.push({ layer: 'L3', act: L3, targetUnit });

  return steps.slice(0, 3);
}

export function resolveReplyCommAct(
  options: ResolveReplyCommActOptions
): ReplyCommActPlan {
  const fallback = resolveConversationState(options);
  const state = stateFromTurnPlan(options.turnPlan, fallback);
  const targetUnit = resolveTargetUnit(options.contentUnits);

  return {
    version: COMM_ACT_VERSION,
    state,
    steps: buildSteps({ ...options, state }),
    targetUnit,
  };
}

export function buildReplyCommActPrompt(plan?: ReplyCommActPlan): string {
  if (!plan?.steps.length) return '';

  const steps = plan.steps
    .map(step => {
      const target = step.targetUnit?.text
        ? `（锚点：${step.targetUnit.text}）`
        : '';
      return `${step.layer}=${ACT_TEXT[step.act]}${target}`;
    })
    .join('；');

  const hasFollowUpProbe = plan.steps.some(
    step => step.act === 'follow_up_probe'
  );
  const followUpHint = hasFollowUpProbe
    ? '追问最多一个，先接住或点出这件事再问；不让用户重讲已经说清的内容，不审问，不把表达责任推回用户。'
    : '';

  return `沟通姿态：${steps}。${followUpHint}用自然口吻完成，不输出这些字段；若与用户原话或当前关系分寸冲突，以用户原话为准。`;
}

export function verifyReplyCommActEcho(
  replyText: string,
  plan?: ReplyCommActPlan
): { passed: boolean; echoedUnits: ContentUnit[] } {
  const targetUnits = [
    plan?.targetUnit,
    ...(plan?.steps.reduce<ContentUnit[]>((units, step) => (step.targetUnit ? units.concat(step.targetUnit) : units), []) || []),
  ].filter((unit): unit is ContentUnit => Boolean(unit));

  const uniqueTargetUnits = targetUnits.reduce<ContentUnit[]>((units, unit) => {
    if (!units.some(candidate => candidate.text === unit.text)) {
      units.push(unit);
    }
    return units;
  }, []);

  if (!uniqueTargetUnits.length) {
    return { passed: true, echoedUnits: [] };
  }

  const echoedUnits = uniqueTargetUnits.filter(unit =>
    hasContentUnitEcho(replyText, [unit])
  );

  return { passed: echoedUnits.length > 0, echoedUnits };
}
