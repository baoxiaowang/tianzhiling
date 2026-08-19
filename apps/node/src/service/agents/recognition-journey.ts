export const RECOGNITION_JOURNEY_VERSION = 'recognition_journey_v1' as const;
export const RECOGNITION_JOURNEY_MESSAGE_PREFIX =
  '__TZL_RECOGNITION_JOURNEY_V1__:';

export type RecognitionTaskId = 'departure_interval' | 'family_status';
export type RecognitionTaskStatus =
  | 'pending'
  | 'asked'
  | 'completed'
  | 'skipped';

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

const DEPARTURE_INTERVAL_ANSWER_PATTERN =
  /^(?:已经|都)?(?:\d{1,4}|[一二两三四五六七八九十百]+)(?:年|个月|月|天)(?:多|左右|了)?$|(?:你|您|离开|走|去世|没了).{0,12}(?:\d{1,4}|[一二两三四五六七八九十百]+)(?:年|个月|月|天)(?:多|左右|了)?/u;
const FAMILY_STATUS_ANSWER_PATTERN =
  /(?:家里|家人|妈妈|妈|爸爸|爸|孩子|儿子|女儿|哥哥|哥|姐姐|姐|弟弟|妹妹|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,16}(?:挺好|很好|还好|都好|不好|生病|住院|康复|去世|走了|结婚|上班|工作|退休|上学|长大|平安)/u;
const DEPARTURE_INTERVAL_QUESTION_PATTERN =
  /(?:离开|走|去世|没了|隔了|过了).{0,12}(?:多久|多少年|几年|哪年|什么时候)|(?:多久|多少年|几年|多少日子|多长时间).{0,8}(?:没见|不见|没联系|联系不上)/u;
const FAMILY_STATUS_QUESTION_PATTERN =
  /(?:家里|家人|家里人|其他人|他们|妈妈|爸爸|孩子).{0,12}(?:怎么样|还好吗|还好吧|都好吗|都好吧|好不好|近况|过得|呢)/u;
const RECOGNITION_ACTIVATION_PATTERN =
  /^(?:爸|爸爸|爹|妈|妈妈|娘|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|丈夫|妻子|儿子|女儿)[啊呀吗呢]?$|(?:是你吗|真的是你|你是我|还认得我|听得到吗|能听见吗|终于联系上|终于找到你)/u;
const RECOGNITION_ACTIVATION_MAX_USER_TURN = 20;
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

    return {
      version: RECOGNITION_JOURNEY_VERSION,
      stage: raw.stage,
      tasks,
      ...parseOptionalDateField(raw, 'startedAt'),
      ...parseOptionalDateField(raw, 'settledAt'),
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
  settleIfComplete(journey, now);

  if (userTurnNumber > RECOGNITION_ACTIVATION_MAX_USER_TURN) {
    for (const task of journey.tasks) {
      if (task.status === 'pending') task.status = 'skipped';
    }
    if (journey.stage === 'pending') {
      journey.stage = 'settled';
      journey.settledAt ??= now;
    }
    settleIfComplete(journey, now);
  }

  if (journey.stage === 'settled') {
    return {
      journey,
      plan: {
        openingSuggested: false,
        completedTaskIds,
      },
    };
  }

  if (journey.stage === 'pending') {
    if (!RECOGNITION_ACTIVATION_PATTERN.test(options.currentQuery.trim())) {
      return {
        journey,
        plan: {
          openingSuggested: false,
          completedTaskIds,
        },
      };
    }
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

  // The opening is a one-turn opportunity, not a program-owned requirement.
  // Once the model has produced a reply, do not keep injecting the same
  // reunion suggestion merely because it chose a more important user need.
  if (options.plan.openingSuggested && options.assistantText.trim()) {
    journey.stage = 'active';
    journey.startedAt ??= now;
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

  settleIfComplete(journey, now);
  return journey;
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
        ? DEPARTURE_INTERVAL_ANSWER_PATTERN.test(query)
        : FAMILY_STATUS_ANSWER_PATTERN.test(query);
    if (!answered) continue;

    task.status = 'completed';
    task.completedAt = now;
    task.answerMessageId = currentUserMessageId;
    completed.push(task.id);
  }

  return completed;
}

function assistantAskedTask(
  taskId: RecognitionTaskId,
  assistantText: string
): boolean {
  return taskId === 'departure_interval'
    ? DEPARTURE_INTERVAL_QUESTION_PATTERN.test(assistantText)
    : FAMILY_STATUS_QUESTION_PATTERN.test(assistantText);
}

function settleIfComplete(journey: RecognitionJourney, now: Date): void {
  if (
    journey.tasks.every(task => ['completed', 'skipped'].includes(task.status))
  ) {
    journey.stage = 'settled';
    journey.settledAt ??= now;
  }
}

function cloneJourney(journey: RecognitionJourney): RecognitionJourney {
  return {
    ...journey,
    tasks: journey.tasks.map(task => ({ ...task })),
  };
}

function buildOpeningPrompt(): string {
  return [
    '# 首次相认（非决策建议）',
    '这是新建立的亲人会话。用户第一句话可能是在试探能否重新认出彼此；先正面回应本轮内容，再按人物性格自然带出久别重逢的场景感。可以表达“终于又听到你这样叫我”的心情，但不要照抄模板、不要编共同往事，也不要在这一轮启动资料问答。',
    '若用户本轮有明确问题、重要事实或强烈情绪，以它为主；相认感只作为自然关系底色。',
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
