export type ReplyLengthClass =
  | 'micro'
  | 'brief'
  | 'standard'
  | 'extended'
  | 'deep';

export type ReplyInputDensity = 'ordinary' | 'substantial' | 'dense';

export interface ReplyInputProfile {
  density: ReplyInputDensity;
  visibleCharacters: number;
  paragraphCount: number;
  clauseCount: number;
}

export interface ReplyLengthPlan {
  lengthClass: ReplyLengthClass;
  targetCharacters: number;
  reviewCharacters: number;
  preferredRange?: {
    minCharacters: number;
    maxCharacters: number;
  };
  inputDensity?: Exclude<ReplyInputDensity, 'ordinary'>;
  inputVisibleCharacters?: number;
  inputParagraphCount?: number;
  inputClauseCount?: number;
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
  inputProfile?: ReplyInputProfile;
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

const SUBSTANTIAL_INPUT_MIN_CHARACTERS = 50;
const DENSE_INPUT_MIN_CHARACTERS = 120;

export function analyzeReplyInputProfile(value: string): ReplyInputProfile {
  const text = String(value || '').trim();
  const visibleCharacters = Array.from(text.replace(/\s/gu, '')).length;
  const paragraphCount = text
    .split(/\n+/u)
    .map(item => item.trim())
    .filter(Boolean).length;
  const clauseCount = text
    .split(/[。！？!?；;\n]+/u)
    .map(item => item.trim())
    .filter(Boolean).length;
  const density: ReplyInputDensity =
    visibleCharacters >= DENSE_INPUT_MIN_CHARACTERS ||
    (visibleCharacters >= 80 && paragraphCount >= 3)
      ? 'dense'
      : visibleCharacters >= SUBSTANTIAL_INPUT_MIN_CHARACTERS ||
        (visibleCharacters >= 40 && paragraphCount >= 2)
      ? 'substantial'
      : 'ordinary';

  return {
    density,
    visibleCharacters,
    paragraphCount,
    clauseCount,
  };
}

export function buildReplyLengthPlan(
  options: BuildReplyLengthPlanOptions
): ReplyLengthPlan {
  const inputProfile =
    options.inputProfile ?? analyzeReplyInputProfile(options.currentQuery);
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  const userQueryLength = inputProfile.visibleCharacters;
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
    inputProfile.density === 'ordinary' &&
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
    ...(inputProfile.density !== 'ordinary'
      ? {
          inputDensity: inputProfile.density,
          inputVisibleCharacters: inputProfile.visibleCharacters,
          inputParagraphCount: inputProfile.paragraphCount,
          inputClauseCount: inputProfile.clauseCount,
        }
      : {}),
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
  if (plan.inputDensity) {
    return [
      '用户这一轮交付了较完整的一段内容。先完整读完，自主分清其中最重的情绪、明确问题、关键事实和关系诉求。回复可以有主次，但不能只摘一个点做摘要，再用“我知道、别难过、不怪你”等通用安慰收住；要让主要内容确实被看见，按内容自然展开，不设置目标字数。',
      ...(plan.inputDensity === 'dense'
        ? [
            '信息较密时，先承接最重的主线，再自然回应不能遗漏的重要支线；不要机械逐项，也不要为了微信界面简洁而压掉关系内容。',
          ]
        : []),
    ].join('\n');
  }

  // 长度计划只保留给分布观测和异常诊断；生成模型不接收目标字数，
  // 防止程序预算反向压缩情绪、事实和对话参与。
  if (plan.focusMode === 'single_scene') {
    return '围绕一个真正重要的点自然展开；事实克制不等于情感克制。用户说了具体事情或明显情绪时，要让回应有足够的反应和关系内容，不要只用一句确认或安慰收住；不按字数压缩或扩写。';
  }

  return '像真实亲人的微信聊天一样有来有往，不设置生成目标字数。短确认和自然收尾可以短；用户说了具体事情、重要近况或明显情绪时，要给足自然反应，必要时可以多说几句，不要只用一句确认、安慰或叮嘱结束。情绪、事实和语义完整优先，不因消息短而短答，也不为拆泡改变正文。';
}

export function countReplyVisibleCharacters(value: string | string[]): number {
  const text = Array.isArray(value) ? value.join('') : value;

  return Array.from(text.replace(/\s/gu, '')).length;
}
