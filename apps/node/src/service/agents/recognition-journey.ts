import type {
  ConversationRecognitionJourney,
  ConversationRecognitionTaskId,
  ConversationRecognitionTaskState,
  MongoObjectId,
} from '@tzl/entities';

export const RECOGNITION_JOURNEY_VERSION = 'recognition_journey_v1' as const;

export interface RecognitionJourneyTurnPlan {
  prompt?: string;
  openingSuggested: boolean;
  suggestedTaskId?: ConversationRecognitionTaskId;
  completedTaskIds: ConversationRecognitionTaskId[];
}

const DEPARTURE_INTERVAL_ANSWER_PATTERN =
  /^(?:已经|都)?(?:\d{1,4}|[一二两三四五六七八九十百]+)(?:年|个月|月|天)(?:多|左右|了)?$|(?:你|您|离开|走|去世|没了).{0,12}(?:\d{1,4}|[一二两三四五六七八九十百]+)(?:年|个月|月|天)(?:多|左右|了)?/u;
const FAMILY_STATUS_ANSWER_PATTERN =
  /(?:家里|家人|妈妈|妈|爸爸|爸|孩子|儿子|女儿|哥哥|哥|姐姐|姐|弟弟|妹妹|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,16}(?:挺好|很好|还好|都好|不好|生病|住院|康复|去世|走了|结婚|上班|工作|退休|上学|长大|平安)/u;
const DEPARTURE_INTERVAL_QUESTION_PATTERN =
  /(?:离开|走|去世|没了|隔了|过了).{0,12}(?:多久|多少年|几年|哪年|什么时候)|(?:多久|多少年|几年|多少日子|多长时间).{0,8}(?:没见|不见|没联系|联系不上)/u;
const FAMILY_STATUS_QUESTION_PATTERN =
  /(?:家里|家人|家里人|其他人|他们|妈妈|爸爸|孩子).{0,12}(?:怎么样|还好吗|还好吧|都好吗|都好吧|好不好|近况|过得|呢)/u;

export function buildInitialRecognitionJourney(
  options: {
    hasKnownDepartureDate?: boolean;
    now?: Date;
  } = {}
): ConversationRecognitionJourney {
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
): ConversationRecognitionJourney {
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

export function planRecognitionJourneyTurn(options: {
  journey: ConversationRecognitionJourney;
  currentQuery: string;
  currentUserMessageId?: MongoObjectId;
  now?: Date;
}): {
  journey: ConversationRecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
} {
  const now = options.now ?? new Date();
  const journey = cloneJourney(options.journey);
  const completedTaskIds = completeTasksFromUserTurn(
    journey.tasks,
    options.currentQuery,
    options.currentUserMessageId,
    now
  );
  settleIfComplete(journey, now);

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
        prompt: buildWaitingPrompt(waitingTask.id),
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
  return {
    journey,
    plan: {
      openingSuggested: false,
      completedTaskIds,
      ...(pendingTask
        ? {
            suggestedTaskId: pendingTask.id,
            prompt: buildTaskSuggestionPrompt(pendingTask.id),
          }
        : {}),
    },
  };
}

export function applyRecognitionJourneyAssistantReply(options: {
  journey: ConversationRecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
  assistantText: string;
  assistantMessageId?: MongoObjectId;
  now?: Date;
}): ConversationRecognitionJourney {
  const now = options.now ?? new Date();
  const journey = cloneJourney(options.journey);

  if (
    options.plan.openingSuggested &&
    assistantOpenedRecognition(options.assistantText)
  ) {
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

function assistantOpenedRecognition(assistantText: string): boolean {
  return /终于|好久|又听到|又听见|又见到|重新联系上|认得|还记得|喊我|叫我/u.test(
    assistantText
  );
}

function completeTasksFromUserTurn(
  tasks: ConversationRecognitionTaskState[],
  currentQuery: string,
  currentUserMessageId: MongoObjectId | undefined,
  now: Date
): ConversationRecognitionTaskId[] {
  const query = currentQuery.trim();
  if (!query) return [];
  const completed: ConversationRecognitionTaskId[] = [];

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
  taskId: ConversationRecognitionTaskId,
  assistantText: string
): boolean {
  return taskId === 'departure_interval'
    ? DEPARTURE_INTERVAL_QUESTION_PATTERN.test(assistantText)
    : FAMILY_STATUS_QUESTION_PATTERN.test(assistantText);
}

function settleIfComplete(
  journey: ConversationRecognitionJourney,
  now: Date
): void {
  if (
    journey.tasks.every(task => ['completed', 'skipped'].includes(task.status))
  ) {
    journey.stage = 'settled';
    journey.settledAt ??= now;
  }
}

function cloneJourney(
  journey: ConversationRecognitionJourney
): ConversationRecognitionJourney {
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

function buildWaitingPrompt(taskId: ConversationRecognitionTaskId): string {
  const subject =
    taskId === 'departure_interval' ? '离开多久' : '家里其他人的近况';
  return [
    '# 相认开放任务（非决策信息）',
    `此前已经自然问过“${subject}”，用户尚未明确回答。不要重问、换句催问或因为没答而追着任务走。`,
    '如果用户本轮或以后某一轮像是在迟到回答，就结合当时上下文自然接住；否则只回应当前话题。',
  ].join('\n');
}

function buildTaskSuggestionPrompt(
  taskId: ConversationRecognitionTaskId
): string {
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
