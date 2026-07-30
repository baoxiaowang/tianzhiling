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
}

export interface BuildReplyLengthPlanOptions {
  currentQuery: string;
  mode: string;
  scene?: string;
  replyMoveCount?: number;
  turnClosure?: 'close' | 'continue' | 'neutral';
}

const LENGTH_BUDGETS: Record<
  ReplyLengthClass,
  Pick<ReplyLengthPlan, 'targetCharacters' | 'reviewCharacters'>
> = {
  micro: {
    targetCharacters: 18,
    reviewCharacters: 24,
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
    targetCharacters: 60,
    reviewCharacters: 85,
  },
  deep: {
    targetCharacters: 90,
    reviewCharacters: 125,
  },
};

const BRIEF_MODES = new Set([
  'memory_control',
  'boundary',
  'platform',
  'general',
]);

const STANDARD_MODES = new Set(['relationship', 'family', 'memory']);

export function buildReplyLengthPlan(
  options: BuildReplyLengthPlanOptions
): ReplyLengthPlan {
  const queryCharacters = countReplyVisibleCharacters(options.currentQuery);
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  let lengthClass: ReplyLengthClass;

  if (
    options.turnClosure === 'close' ||
    options.mode === 'daily' ||
    options.mode === 'status' ||
    options.scene === 'smalltalk' ||
    options.scene === 'daily_update'
  ) {
    lengthClass = 'micro';
  } else if (options.scene === 'correction') {
    lengthClass = 'brief';
  } else if (queryCharacters >= 100) {
    lengthClass = 'deep';
  } else if (
    queryCharacters >= 45 ||
    replyMoveCount >= 3 ||
    options.mode === 'emotional'
  ) {
    lengthClass = 'extended';
  } else if (BRIEF_MODES.has(options.mode)) {
    lengthClass = 'brief';
  } else if (STANDARD_MODES.has(options.mode)) {
    lengthClass = 'standard';
  } else {
    lengthClass = 'brief';
  }

  return {
    lengthClass,
    ...LENGTH_BUDGETS[lengthClass],
  };
}

export function buildReplyLengthPlanPrompt(plan: ReplyLengthPlan): string {
  return `整次回复所有气泡合计目标约 ${plan.targetCharacters} 字，超过 ${plan.reviewCharacters} 字必须压缩。只保留当前最重要的回应，删除同义安慰、解释、总结和通用叮嘱；不要为显得用心而扩写。`;
}

export function countReplyVisibleCharacters(value: string | string[]): number {
  const text = Array.isArray(value) ? value.join('') : value;

  return Array.from(text.replace(/\s/gu, '')).length;
}
