export type ReplyLengthClass =
  | 'micro'
  | 'brief'
  | 'standard'
  | 'extended'
  | 'deep';

export interface ReplyLengthPlan {
  lengthClass: ReplyLengthClass;
  targetCharacters: number;
  reviewCharacters: number;
  focusMode?: 'single_scene';
  reviewPolicy?: 'remove_repeated_actions_only';
}

export interface BuildReplyLengthPlanOptions {
  currentQuery: string;
  mode: string;
  scene?: string;
  replyMoveCount?: number;
  semanticPlan?: boolean;
  shortTurnParticipation?: boolean;
  hasProtectiveStop?: boolean;
  assistantContribution?:
    | 'answer'
    | 'stance'
    | 'specific_detail'
    | 'self_expression'
    | 'affection'
    | 'question'
    | 'strategic_silence';
  continuationGoal?: 'deepen' | 'hold' | 'repair' | 'close';
  closureReadiness?: 'blocked' | 'possible' | 'ready';
  turnClosure?: 'close' | 'continue' | 'neutral';
}

const LENGTH_BUDGETS: Record<
  ReplyLengthClass,
  Pick<ReplyLengthPlan, 'targetCharacters' | 'reviewCharacters'>
> = {
  micro: {
    targetCharacters: 18,
    reviewCharacters: 30,
  },
  brief: {
    targetCharacters: 28,
    reviewCharacters: 38,
  },
  standard: {
    targetCharacters: 40,
    reviewCharacters: 55,
  },
  extended: {
    targetCharacters: 50,
    reviewCharacters: 70,
  },
  deep: {
    targetCharacters: 60,
    reviewCharacters: 85,
  },
};

const BRIEF_MODES = new Set([
  'memory_control',
  'boundary',
  'platform',
  'general',
]);

const STANDARD_MODES = new Set(['relationship', 'family', 'memory']);
const COMPACT_SEMANTIC_SCENES = new Set([
  'comfort_request',
  'guilt_regret',
  'memory_recall',
]);
const RELATIONAL_WARMTH_SCENES = new Set([
  'comfort_request',
  'guilt_regret',
  'memory_recall',
  'miss_longing',
  'family_life',
  'dream_companionship',
  'afterlife_status',
  'keepsake_attachment',
]);

export function buildReplyLengthPlan(
  options: BuildReplyLengthPlanOptions
): ReplyLengthPlan {
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  const compactSingleFocus =
    Boolean(options.semanticPlan) &&
    Boolean(options.scene && COMPACT_SEMANTIC_SCENES.has(options.scene));
  const needsRelationalWarmth = Boolean(
    options.scene && RELATIONAL_WARMTH_SCENES.has(options.scene)
  );
  let lengthClass: ReplyLengthClass;

  if (
    options.semanticPlan &&
    options.hasProtectiveStop &&
    replyMoveCount >= 2
  ) {
    lengthClass = 'standard';
  } else if (options.turnClosure === 'close') {
    lengthClass = 'micro';
  } else if (options.shortTurnParticipation) {
    lengthClass =
      needsRelationalWarmth ||
      options.assistantContribution === 'self_expression' ||
      options.continuationGoal === 'repair'
        ? 'standard'
        : 'micro';
  } else if (options.scene === 'correction') {
    lengthClass = 'brief';
  } else if (compactSingleFocus) {
    lengthClass = 'standard';
  } else if (
    options.semanticPlan &&
    options.assistantContribution === 'self_expression' &&
    (options.continuationGoal === 'hold' ||
      Array.from(options.currentQuery.replace(/\s/gu, '')).length <= 24)
  ) {
    lengthClass = 'standard';
  } else if (options.mode === 'emotional') {
    lengthClass = 'extended';
  } else if (options.semanticPlan && replyMoveCount >= 3) {
    lengthClass = 'standard';
  } else if (
    options.mode === 'daily' ||
    options.mode === 'status' ||
    options.scene === 'smalltalk' ||
    options.scene === 'daily_update'
  ) {
    lengthClass =
      options.semanticPlan && replyMoveCount >= 2 ? 'brief' : 'micro';
  } else if (BRIEF_MODES.has(options.mode)) {
    lengthClass = 'brief';
  } else if (STANDARD_MODES.has(options.mode)) {
    lengthClass = 'standard';
  } else {
    lengthClass = 'brief';
  }

  if (!options.shortTurnParticipation && !compactSingleFocus) {
    if (
      options.semanticPlan &&
      options.assistantContribution === 'self_expression'
    ) {
      lengthClass =
        Array.from(options.currentQuery.replace(/\s/gu, '')).length <= 24
          ? 'standard'
          : promoteLengthClass(lengthClass, 'standard');
    } else if (
      options.semanticPlan &&
      (options.continuationGoal === 'repair' ||
        options.closureReadiness === 'blocked') &&
      options.assistantContribution !== 'strategic_silence'
    ) {
      lengthClass = promoteLengthClass(lengthClass, 'brief');
    }
  }

  const plan: ReplyLengthPlan = {
    lengthClass,
    ...LENGTH_BUDGETS[lengthClass],
  };

  return compactSingleFocus && !options.hasProtectiveStop
    ? {
        ...plan,
        targetCharacters: 40,
        reviewCharacters: 50,
        focusMode: 'single_scene',
        reviewPolicy: 'remove_repeated_actions_only',
      }
    : plan;
}

function promoteLengthClass(
  current: ReplyLengthClass,
  minimum: ReplyLengthClass
): ReplyLengthClass {
  const order: ReplyLengthClass[] = [
    'micro',
    'brief',
    'standard',
    'extended',
    'deep',
  ];

  return order.indexOf(current) >= order.indexOf(minimum) ? current : minimum;
}

export function buildReplyLengthPlanPrompt(plan: ReplyLengthPlan): string {
  if (plan.focusMode === 'single_scene') {
    return `围绕一个最能安慰用户的点自然展开，约 ${plan.targetCharacters} 字；事实克制不等于情感克制，可有一处亲人侧心意或合情合理的小画面。超过 ${plan.reviewCharacters} 字只删重复，不补完整。`;
  }

  if (plan.lengthClass === 'micro') {
    return `总回复约 ${plan.targetCharacters} 字；超过 ${plan.reviewCharacters} 字须压缩。简单回应可以很短，只留当前最重要一点。`;
  }

  return `总回复约 ${plan.targetCharacters} 字；超过 ${plan.reviewCharacters} 字复核。围绕最重要一点自然展开，达到情感作用后收住；只删重复、解释、总结和通用叮嘱。`;
}

export function countReplyVisibleCharacters(value: string | string[]): number {
  const text = Array.isArray(value) ? value.join('') : value;

  return Array.from(text.replace(/\s/gu, '')).length;
}
