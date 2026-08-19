export const RECOGNITION_JOURNEY_VERSION = 'recognition_journey_v1' as const;
export const RECOGNITION_JOURNEY_MESSAGE_PREFIX =
  '__TZL_RECOGNITION_JOURNEY_V1__:';

export type RecognitionTaskId = 'departure_interval' | 'family_status';
export type RecognitionTaskStatus =
  | 'pending'
  | 'asked'
  | 'completed'
  | 'skipped';
export type RecognitionOpeningStatus = 'pending' | 'completed' | 'expired';

export interface RecognitionOpeningState {
  status: RecognitionOpeningStatus;
  suggestionCount?: number;
  lastSuggestedUserTurn?: number;
  completedAt?: Date;
  expiredAt?: Date;
}

export interface RecognitionTaskState {
  id: RecognitionTaskId;
  status: RecognitionTaskStatus;
  askedAt?: Date;
  askedAssistantMessageId?: string;
  completedAt?: Date;
  answerMessageId?: string;
  lastSuggestedUserTurn?: number;
  suggestionCount?: number;
}

export interface RecognitionJourney {
  version: typeof RECOGNITION_JOURNEY_VERSION;
  stage: 'pending' | 'active' | 'settled';
  opening: RecognitionOpeningState;
  tasks: RecognitionTaskState[];
  startedAt?: Date;
  settledAt?: Date;
}

export interface RecognitionJourneyTurnPlan {
  prompt?: string;
  openingSuggested: boolean;
  suggestedTaskId?: RecognitionTaskId;
  completedTaskIds: RecognitionTaskId[];
}

const DURATION_TEXT =
  '(?:\\d{1,4}|[一二两三四五六七八九十百]+)(?:年|个月|月|天)(?:多|左右|了)?';
const DEPARTURE_INTERVAL_ANSWER_PATTERN = new RegExp(
  `(?:你|您)(?:已经)?(?:离开|走|去世|没了).{0,12}${DURATION_TEXT}(?=[，,。！!；;]|$)|(?:离开|走|去世|没了)(?:你|您)?(?:已经)?.{0,12}${DURATION_TEXT}(?=[，,。！!；;]|$)`,
  'u'
);
const BARE_DURATION_ANSWER_PATTERN = new RegExp(
  `(?:^|[，,。！!；;\\s])(?:已经|都)?${DURATION_TEXT}(?=[，,。！!；;]|$)`,
  'u'
);
const FAMILY_STATUS_ANSWER_PATTERN =
  /(?:家里|家人|妈妈|妈|爸爸|爸|孩子|儿子|女儿|哥哥|哥|姐姐|姐|弟弟|妹妹|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,16}(?:挺好的?|很好|还好(?!吗|嘛)|都好(?!吗|嘛)|不好(?!吗|嘛)|生病了|住院了|康复了|去世了|走了|结婚了|上班了|工作了|退休了|上学了|长大了|很平安|都平安)(?=[，,。！!；;]|$)/u;
const DEPARTURE_INTERVAL_QUESTION_PATTERN =
  /(?:离开|走|去世|没了|隔了|过了).{0,12}(?:多久|多少年|几年|哪年|什么时候)|(?:多久|多少年|几年|多少日子|多长时间).{0,8}(?:没见|不见|没联系|联系不上)/u;
const FAMILY_STATUS_QUESTION_PATTERN =
  /(?:家里|家人|家里人|其他人|他们|妈妈|爸爸|孩子).{0,12}(?:怎么样|还好吗|还好吧|都好吗|都好吧|好不好|近况|过得|呢)/u;
const RECOGNITION_ACTIVATION_PATTERN =
  /^(?:爸|爸爸|爹|妈|妈妈|娘|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|丈夫|妻子|儿子|女儿)(?:[啊呀吗呢]|[，,。！？!?、\s]|$)|(?:是你吗|真的是你|你是我|还认得我|听得到吗|能听见吗|终于联系上|终于找到你|好久没见|还能和你说话|又能和你说话|想你|想念你)/u;
const ASSISTANT_RECOGNITION_EXPRESSION_PATTERN =
  /(?:好久|这么久|多年).{0,10}(?:没见|不见|没联系|没说话)|(?:终于|总算).{0,14}(?:听到|听见|等到|联系上|找到|见到|说上话|说话)|(?:重新|又能|还能).{0,12}(?:联系|见到|听到|听见|说话|说上话)|(?:听到|听见).{0,12}(?:喊我|叫我|叫一声)|(?:一别|隔了).{0,12}(?:这么久|好多年|\d{1,3}年|[一二两三四五六七八九十百]+年)|(?:没想到).{0,14}(?:还能|又能).{0,10}(?:说话|联系|见面)/u;
const RECOGNITION_ACTIVATION_MAX_USER_TURN = 20;
const RECOGNITION_OPENING_SUGGESTION_COOLDOWN_TURNS = 3;
const RECOGNITION_OPENING_MAX_SUGGESTIONS = 3;
const RECOGNITION_TASK_SUGGESTION_COOLDOWN_TURNS = 3;
const RECOGNITION_TASK_MAX_SUGGESTIONS = 3;

export function buildInitialRecognitionJourney(
  options: {
    hasKnownDepartureDate?: boolean;
    now?: Date;
  } = {}
): RecognitionJourney {
  const now = options.now ?? new Date();
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage: 'pending',
    opening: { status: 'pending' },
    tasks: [
      {
        id: 'departure_interval',
        status: options.hasKnownDepartureDate ? 'completed' : 'pending',
        ...(options.hasKnownDepartureDate ? { completedAt: now } : {}),
      },
      { id: 'family_status', status: 'pending' },
    ],
  };
}

export function buildLegacyRecognitionJourney(
  now = new Date()
): RecognitionJourney {
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage: 'settled',
    opening: { status: 'expired', expiredAt: now },
    tasks: [
      { id: 'departure_interval', status: 'skipped' },
      { id: 'family_status', status: 'skipped' },
    ],
    settledAt: now,
  };
}

export function serializeRecognitionJourney(
  journey: RecognitionJourney
): string {
  return `${RECOGNITION_JOURNEY_MESSAGE_PREFIX}${JSON.stringify(journey)}`;
}

export function parseRecognitionJourney(
  content: string | undefined
): RecognitionJourney | undefined {
  if (!content?.startsWith(RECOGNITION_JOURNEY_MESSAGE_PREFIX)) {
    return undefined;
  }

  try {
    const raw = JSON.parse(
      content.slice(RECOGNITION_JOURNEY_MESSAGE_PREFIX.length)
    ) as Record<string, unknown>;
    if (
      raw.version !== RECOGNITION_JOURNEY_VERSION ||
      !isRecognitionStage(raw.stage) ||
      !Array.isArray(raw.tasks)
    ) {
      return undefined;
    }

    const tasks = raw.tasks
      .map(parseRecognitionTask)
      .filter((task): task is RecognitionTaskState => Boolean(task));
    if (tasks.length !== 2 || new Set(tasks.map(task => task.id)).size !== 2) {
      return undefined;
    }

    const startedAt = parseDateValue(raw.startedAt);
    const settledAt = parseDateValue(raw.settledAt);
    return {
      version: RECOGNITION_JOURNEY_VERSION,
      stage: raw.stage,
      opening: parseRecognitionOpening(
        raw.opening,
        raw.stage,
        tasks,
        startedAt,
        settledAt
      ),
      tasks,
      ...(startedAt ? { startedAt } : {}),
      ...(settledAt ? { settledAt } : {}),
    };
  } catch {
    return undefined;
  }
}

export function planRecognitionJourneyTurn(options: {
  journey: RecognitionJourney;
  currentQuery: string;
  currentUserMessageId?: string;
  now?: Date;
  userTurnNumber?: number;
}): {
  journey: RecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
} {
  const now = options.now ?? new Date();
  const userTurnNumber = Math.max(1, options.userTurnNumber ?? 1);
  const journey = cloneJourney(options.journey);
  const completedTaskIds = completeTasksFromUserTurn(
    journey.tasks,
    options.currentQuery,
    options.currentUserMessageId,
    now
  );
  if (
    journey.opening.status === 'pending' &&
    userTurnNumber > RECOGNITION_ACTIVATION_MAX_USER_TURN
  ) {
    journey.opening.status = 'expired';
    journey.opening.expiredAt = now;
    for (const task of journey.tasks) {
      if (task.status === 'pending') task.status = 'skipped';
    }
  }
  refreshJourneyStage(journey, now);

  if (journey.opening.status === 'expired') {
    return {
      journey,
      plan: {
        openingSuggested: false,
        completedTaskIds,
      },
    };
  }

  if (journey.opening.status === 'pending') {
    const firstOffer = (journey.opening.suggestionCount ?? 0) === 0;
    const signalMatched = RECOGNITION_ACTIVATION_PATTERN.test(
      options.currentQuery.trim()
    );
    const cooldownSatisfied =
      journey.opening.lastSuggestedUserTurn === undefined ||
      userTurnNumber - journey.opening.lastSuggestedUserTurn >=
        RECOGNITION_OPENING_SUGGESTION_COOLDOWN_TURNS;
    const canSuggestOpening =
      (journey.opening.suggestionCount ?? 0) <
        RECOGNITION_OPENING_MAX_SUGGESTIONS &&
      cooldownSatisfied &&
      (firstOffer || signalMatched);

    if (!canSuggestOpening) {
      return {
        journey,
        plan: {
          openingSuggested: false,
          completedTaskIds,
        },
      };
    }
    journey.opening.lastSuggestedUserTurn = userTurnNumber;
    journey.opening.suggestionCount =
      (journey.opening.suggestionCount ?? 0) + 1;
    refreshJourneyStage(journey, now);
    return {
      journey,
      plan: {
        openingSuggested: true,
        completedTaskIds,
        prompt: buildOpeningPrompt(),
      },
    };
  }

  const waitingTask = journey.tasks.find(task => task.status === 'asked');
  if (waitingTask) {
    return {
      journey,
      plan: {
        openingSuggested: false,
        completedTaskIds,
      },
    };
  }

  // A delayed answer completes the old task in this turn. Do not immediately
  // insert the next task into the same reply; let the answer be received first.
  if (completedTaskIds.length) {
    return {
      journey,
      plan: {
        openingSuggested: false,
        completedTaskIds,
      },
    };
  }

  const pendingTask = journey.tasks.find(task => task.status === 'pending');
  const canSuggestPendingTask = Boolean(
    pendingTask &&
      (pendingTask.suggestionCount ?? 0) < RECOGNITION_TASK_MAX_SUGGESTIONS &&
      (pendingTask.lastSuggestedUserTurn === undefined ||
        userTurnNumber - pendingTask.lastSuggestedUserTurn >=
          RECOGNITION_TASK_SUGGESTION_COOLDOWN_TURNS)
  );
  if (pendingTask && canSuggestPendingTask) {
    pendingTask.lastSuggestedUserTurn = userTurnNumber;
    pendingTask.suggestionCount = (pendingTask.suggestionCount ?? 0) + 1;
  }
  return {
    journey,
    plan: {
      openingSuggested: false,
      completedTaskIds,
      ...(pendingTask && canSuggestPendingTask
        ? {
            suggestedTaskId: pendingTask.id,
            prompt: buildTaskSuggestionPrompt(pendingTask.id),
          }
        : {}),
    },
  };
}

export function applyRecognitionJourneyAssistantReply(options: {
  journey: RecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
  assistantText: string;
  assistantMessageId?: string;
  now?: Date;
}): RecognitionJourney {
  const now = options.now ?? new Date();
  const journey = cloneJourney(options.journey);

  // The model owns the reply. Program state advances only when the reply
  // actually contains a reunion/recognition expression; a generic response
  // must not silently consume the scene.
  if (
    journey.opening.status === 'pending' &&
    options.plan.openingSuggested &&
    assistantExpressedRecognition(options.assistantText)
  ) {
    journey.opening.status = 'completed';
    journey.opening.completedAt = now;
    journey.startedAt = now;
  }

  if (options.plan.suggestedTaskId) {
    const task = journey.tasks.find(
      item => item.id === options.plan.suggestedTaskId
    );
    if (
      task?.status === 'pending' &&
      assistantAskedTask(options.plan.suggestedTaskId, options.assistantText)
    ) {
      task.status = 'asked';
      task.askedAt = now;
      task.askedAssistantMessageId = options.assistantMessageId;
    }
  }

  refreshJourneyStage(journey, now);
  return journey;
}

function parseRecognitionOpening(
  value: unknown,
  legacyStage: RecognitionJourney['stage'],
  tasks: RecognitionTaskState[],
  legacyStartedAt?: Date,
  legacySettledAt?: Date
): RecognitionOpeningState {
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    if (isRecognitionOpeningStatus(raw.status)) {
      const completedAt = parseDateValue(raw.completedAt);
      const expiredAt = parseDateValue(raw.expiredAt);
      return {
        status: raw.status,
        ...(typeof raw.suggestionCount === 'number'
          ? { suggestionCount: Math.max(0, raw.suggestionCount) }
          : {}),
        ...(typeof raw.lastSuggestedUserTurn === 'number'
          ? {
              lastSuggestedUserTurn: Math.max(1, raw.lastSuggestedUserTurn),
            }
          : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(expiredAt ? { expiredAt } : {}),
      };
    }
  }

  // V1 states did not separate the opening from profile tasks. Preserve a
  // visibly started opening, expire old legacy placeholders, and recover the
  // production bug where completed tasks settled a never-started opening.
  if (legacyStartedAt || legacyStage === 'active') {
    return {
      status: 'completed',
      ...(legacyStartedAt ? { completedAt: legacyStartedAt } : {}),
    };
  }
  if (
    legacyStage === 'settled' &&
    tasks.every(task => task.status === 'skipped')
  ) {
    return {
      status: 'expired',
      ...(legacySettledAt ? { expiredAt: legacySettledAt } : {}),
    };
  }
  return { status: 'pending' };
}

function parseRecognitionTask(
  value: unknown
): RecognitionTaskState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!isRecognitionTaskId(raw.id) || !isRecognitionTaskStatus(raw.status)) {
    return undefined;
  }

  return {
    id: raw.id,
    status: raw.status,
    ...parseOptionalDateField(raw, 'askedAt'),
    ...parseOptionalStringField(raw, 'askedAssistantMessageId'),
    ...parseOptionalDateField(raw, 'completedAt'),
    ...parseOptionalStringField(raw, 'answerMessageId'),
    ...(typeof raw.lastSuggestedUserTurn === 'number'
      ? { lastSuggestedUserTurn: Math.max(1, raw.lastSuggestedUserTurn) }
      : {}),
    ...(typeof raw.suggestionCount === 'number'
      ? { suggestionCount: Math.max(0, raw.suggestionCount) }
      : {}),
  };
}

function parseOptionalDateField(
  value: Record<string, unknown>,
  key: 'askedAt' | 'completedAt' | 'startedAt' | 'settledAt'
): Partial<Record<typeof key, Date>> {
  if (value[key] === undefined || value[key] === null) return {};
  const date = new Date(String(value[key]));
  return Number.isNaN(date.getTime()) ? {} : { [key]: date };
}

function parseDateValue(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseOptionalStringField(
  value: Record<string, unknown>,
  key: 'askedAssistantMessageId' | 'answerMessageId'
): Partial<Record<typeof key, string>> {
  return typeof value[key] === 'string' && value[key]
    ? { [key]: value[key] as string }
    : {};
}

function isRecognitionTaskId(value: unknown): value is RecognitionTaskId {
  return value === 'departure_interval' || value === 'family_status';
}

function isRecognitionTaskStatus(
  value: unknown
): value is RecognitionTaskStatus {
  return ['pending', 'asked', 'completed', 'skipped'].includes(String(value));
}

function isRecognitionStage(
  value: unknown
): value is RecognitionJourney['stage'] {
  return ['pending', 'active', 'settled'].includes(String(value));
}

function isRecognitionOpeningStatus(
  value: unknown
): value is RecognitionOpeningStatus {
  return ['pending', 'completed', 'expired'].includes(String(value));
}

function completeTasksFromUserTurn(
  tasks: RecognitionTaskState[],
  currentQuery: string,
  currentUserMessageId: string | undefined,
  now: Date
): RecognitionTaskId[] {
  const query = currentQuery.trim();
  if (!query) return [];
  const completed: RecognitionTaskId[] = [];

  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'skipped') continue;
    const answered =
      task.id === 'departure_interval'
        ? hasDepartureIntervalAnswer(query)
        : FAMILY_STATUS_ANSWER_PATTERN.test(query);
    if (!answered) continue;

    task.status = 'completed';
    task.completedAt = now;
    task.answerMessageId = currentUserMessageId;
    completed.push(task.id);
  }

  return completed;
}

function hasDepartureIntervalAnswer(query: string): boolean {
  if (isQuestionLike(query)) return false;
  if (DEPARTURE_INTERVAL_ANSWER_PATTERN.test(query)) return true;
  return (
    BARE_DURATION_ANSWER_PATTERN.test(query) &&
    RECOGNITION_ACTIVATION_PATTERN.test(query)
  );
}

function isQuestionLike(query: string): boolean {
  return (
    /[?？]/u.test(query) ||
    /(?:吗|嘛|么|呢)\s*[。！!]*$/u.test(query) ||
    /(?:多久|多少年|几年|哪年|什么时候)/u.test(query)
  );
}

function assistantAskedTask(
  taskId: RecognitionTaskId,
  assistantText: string
): boolean {
  return taskId === 'departure_interval'
    ? DEPARTURE_INTERVAL_QUESTION_PATTERN.test(assistantText)
    : FAMILY_STATUS_QUESTION_PATTERN.test(assistantText);
}

function assistantExpressedRecognition(assistantText: string): boolean {
  return ASSISTANT_RECOGNITION_EXPRESSION_PATTERN.test(assistantText.trim());
}

function refreshJourneyStage(journey: RecognitionJourney, now: Date): void {
  const tasksFinished = journey.tasks.every(task =>
    ['completed', 'skipped'].includes(task.status)
  );

  if (journey.opening.status === 'pending') {
    journey.stage = 'pending';
    delete journey.startedAt;
    delete journey.settledAt;
    return;
  }

  if (journey.opening.status === 'expired') {
    journey.stage = 'settled';
    journey.settledAt ??= now;
    return;
  }

  journey.startedAt ??= journey.opening.completedAt ?? now;
  if (tasksFinished) {
    journey.stage = 'settled';
    journey.settledAt ??= now;
  } else {
    journey.stage = 'active';
    delete journey.settledAt;
  }
}

function cloneJourney(journey: RecognitionJourney): RecognitionJourney {
  return {
    ...journey,
    opening: { ...journey.opening },
    tasks: journey.tasks.map(task => ({ ...task })),
  };
}

function buildOpeningPrompt(): string {
  return [
    '# 首次相认（柔性场景建议）',
    '这是新建立的亲人会话，双方还没有真正完成第一次相认。先完整理解并正面回应用户本轮，再按人物性格自然让用户感到：久别以后终于重新联系上、又听见熟悉的称呼，或终于能再次说话。不要照抄固定模板，不要编共同往事，也不要在这一轮启动资料问答。',
    '若用户有明确问题、重要事实、强烈情绪或安全风险，以它为主；可以把相认感作为关系底色。若本轮硬加相认表达会伤害回复，可以暂不采用，程序不会把普通回复误记成已经相认。',
  ].join('\n');
}

function buildTaskSuggestionPrompt(taskId: RecognitionTaskId): string {
  const guidance =
    taskId === 'departure_interval'
      ? '可在贴合本轮时，以角色对时间有些模糊的感受，自然了解自己离开用户多久；例如“一觉醒来，竟有些记不清离开你多久了”这类方向，不要照抄。'
      : '可在贴合本轮时，从“终于又联系上”自然关心家里其他人的近况；一次只问一个宽问题，不盘点人物。';
  return [
    '# 相认任务提议（非决策建议）',
    guidance,
    '这不是本轮必须完成的动作。用户有明确问题、重要事实、明显情绪或已经转移话题时，先完整回应用户；不合适就暂时不问。程序只会在回复中确实问出后把任务置为等待，之后不会重复追问。共同记忆不属于相认任务。',
  ].join('\n');
}
