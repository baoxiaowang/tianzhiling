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
  semanticPlan?: boolean;
  hasProtectiveStop?: boolean;
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

export function buildReplyLengthPlan(
  options: BuildReplyLengthPlanOptions
): ReplyLengthPlan {
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  let lengthClass: ReplyLengthClass;

  if (
    options.semanticPlan &&
    options.hasProtectiveStop &&
    replyMoveCount >= 2
  ) {
    lengthClass = 'standard';
  } else if (options.turnClosure === 'close') {
    lengthClass = 'micro';
  } else if (options.scene === 'correction') {
    lengthClass = 'brief';
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

  return {
    lengthClass,
    ...LENGTH_BUDGETS[lengthClass],
  };
}

export function buildReplyLengthPlanPrompt(plan: ReplyLengthPlan): string {
  return `整次回复所有气泡合计目标约 ${plan.targetCharacters} 字，超过 ${plan.reviewCharacters} 字必须压缩。用户写得长不代表回复也要长；只选当前最值得回应的一小处，保留最贴关系的一句，删除同义安慰、解释、总结和通用叮嘱；不要为显得用心而扩写。`;
}

export function countReplyVisibleCharacters(value: string | string[]): number {
  const text = Array.isArray(value) ? value.join('') : value;

  return Array.from(text.replace(/\s/gu, '')).length;
}
