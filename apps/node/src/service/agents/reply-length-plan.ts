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
  preferredRange?: {
    minCharacters: number;
    maxCharacters: number;
  };
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
  preferTwoSegments?: boolean;
  preferTwentyToThirtyCharacters?: boolean;
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
  'significant_life_matter',
  'reincarnation_inquiry',
  'departure_hatred',
]);

export function buildReplyLengthPlan(
  options: BuildReplyLengthPlanOptions
): ReplyLengthPlan {
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  const userQueryLength = Array.from(
    options.currentQuery.replace(/\s/gu, '')
  ).length;
  const compactSingleFocus =
    Boolean(options.semanticPlan) &&
    Boolean(options.scene && COMPACT_SEMANTIC_SCENES.has(options.scene)) &&
    userQueryLength <= 40;
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
    if (userQueryLength <= 20) {
      lengthClass = 'standard';
    } else if (
      userQueryLength > 40 &&
      /后悔|愧疚|亏欠|撑不住|害怕|对不起|放不下|怎么也|舍不得/.test(
        options.currentQuery
      )
    ) {
      lengthClass = 'deep';
    } else {
      lengthClass = 'extended';
    }
  } else if (options.semanticPlan && replyMoveCount >= 3) {
    lengthClass = 'standard';
  } else if (
    options.scene === 'smalltalk' ||
    options.scene === 'daily_update'
  ) {
    lengthClass = replyMoveCount >= 2 ? 'brief' : 'micro';
  } else if (options.mode === 'daily' || options.mode === 'status') {
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

  const compactPreferredReply = Boolean(
    (options.preferTwoSegments || options.preferTwentyToThirtyCharacters) &&
      !options.hasProtectiveStop &&
      options.continuationGoal !== 'repair' &&
      options.closureReadiness !== 'blocked' &&
      !['emotional', 'memory', 'boundary'].includes(options.mode)
  );

  if (compactPreferredReply) {
    // 普通聊天仅保留总量软偏好；最终展示拆分不反向限制内容。
    lengthClass = 'brief';
  }

  const plan: ReplyLengthPlan = {
    lengthClass,
    ...LENGTH_BUDGETS[lengthClass],
    ...(compactPreferredReply
      ? {
          preferredRange: {
            minCharacters: 20,
            maxCharacters: needsRelationalWarmth ? 40 : 30,
          },
        }
      : {}),
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
  // 长度计划只保留给分布观测和异常诊断；生成模型不接收目标字数，
  // 防止程序预算反向压缩情绪、事实和对话参与。
  if (plan.focusMode === 'single_scene') {
    return '围绕一个真正重要的点自然展开；事实克制不等于情感克制。微信式简洁只是表达风格，情绪、事实和语义完整优先，不按字数压缩或扩写。';
  }

  return '像微信聊天一样自然简洁，但不设置生成目标字数。情绪、事实和语义完整优先；先把当前该回应的内容说好，再自然收住。只有确属重复、空泛解释或通用叮嘱时才自行删减，不因消息短而短答，也不为拆泡改变正文。';
}

export function countReplyVisibleCharacters(value: string | string[]): number {
  const text = Array.isArray(value) ? value.join('') : value;

  return Array.from(text.replace(/\s/gu, '')).length;
}
