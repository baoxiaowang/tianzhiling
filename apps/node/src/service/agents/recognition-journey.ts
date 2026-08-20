export const RECOGNITION_JOURNEY_VERSION = 'recognition_journey_v2' as const;
export const RECOGNITION_JOURNEY_MESSAGE_PREFIX =
  '__TZL_RECOGNITION_JOURNEY_V2__:';
const LEGACY_RECOGNITION_JOURNEY_MESSAGE_PREFIX =
  '__TZL_RECOGNITION_JOURNEY_V1__:';

export type RecognitionTaskId = 'departure_interval' | 'family_status';
export type RecognitionTaskStatus =
  | 'pending'
  | 'proposed'
  | 'completed'
  | 'skipped';
export type RecognitionOpeningStatus =
  | 'pending'
  | 'emotionally_opened'
  | 'completed'
  | 'expired';
export type RecognitionOpeningAngle =
  | 'waking_without_elapsed_time'
  | 'connection_restored'
  | 'unfinished_words'
  | 'family_longing';

export interface RecognitionOpeningState {
  status: RecognitionOpeningStatus;
  activatedAt?: Date;
  attemptCount?: number;
  lastAttemptUserTurn?: number;
  usedAngles?: RecognitionOpeningAngle[];
  openedAt?: Date;
  receivedAt?: Date;
  expiredAt?: Date;
  observationEvidence?: string;
}

export interface RecognitionTaskState {
  id: RecognitionTaskId;
  status: RecognitionTaskStatus;
  proposedAt?: Date;
  proposedAssistantMessageId?: string;
  completedAt?: Date;
  answerMessageId?: string;
  lastProposedUserTurn?: number;
  proposalCount?: number;
  observationEvidence?: string;
}

export interface RecognitionJourney {
  version: typeof RECOGNITION_JOURNEY_VERSION;
  stage: 'pending' | 'active' | 'settled';
  opening: RecognitionOpeningState;
  tasks: RecognitionTaskState[];
  lastJourneyActionUserTurn?: number;
  startedAt?: Date;
  settledAt?: Date;
}

export interface RecognitionJourneyTurnPlan {
  prompt?: string;
  openingSuggested: boolean;
  openingAngle?: RecognitionOpeningAngle;
  suggestedTaskId?: RecognitionTaskId;
  completedTaskIds: RecognitionTaskId[];
  currentUserText?: string;
  currentUserMessageId?: string;
  userTurnNumber?: number;
}

export interface RecognitionJourneyObservation {
  opening:
    | 'not_observed'
    | 'shallow_acknowledgement'
    | 'emotionally_opened'
    | 'emotionally_received';
  familyStatus: 'not_observed' | 'proposed' | 'provided';
  departureInterval: 'not_observed' | 'proposed' | 'provided';
  evidence?: string;
}

const RECOGNITION_ACTIVATION_MAX_USER_TURN = 20;
const OPENING_MAX_ATTEMPTS = 2;
const JOURNEY_ACTION_COOLDOWN_TURNS = 1;
const OPENING_ANGLES: RecognitionOpeningAngle[] = [
  'waking_without_elapsed_time',
  'connection_restored',
  'unfinished_words',
  'family_longing',
];
const RECOGNITION_ACTIVATION_PATTERN =
  /^(?:爸|爸爸|爹|妈|妈妈|娘|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|丈夫|妻子|儿子|女儿)(?:[啊呀吗呢]|[，,。！？!?、\s]|$)|(?:是你吗|真的是你|你是我|还认得我|听得到吗|能听见吗|终于联系上|终于找到你|还能和你说话|又能和你说话|想你|想念你)/u;
const URGENT_REALITY_PATTERN =
  /(?:自杀|不想活|活不下去|去陪你|带我走|抢救|病危|重病|很严重|住院|手术|报警|家暴|离婚|卖房|下葬|迁坟|遗产|存折|银行卡)/u;

export function buildInitialRecognitionJourney(
  options: { hasKnownDepartureDate?: boolean; now?: Date } = {}
): RecognitionJourney {
  const now = options.now ?? new Date();
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage: 'pending',
    opening: { status: 'pending', attemptCount: 0, usedAngles: [] },
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
  const prefix = content?.startsWith(RECOGNITION_JOURNEY_MESSAGE_PREFIX)
    ? RECOGNITION_JOURNEY_MESSAGE_PREFIX
    : content?.startsWith(LEGACY_RECOGNITION_JOURNEY_MESSAGE_PREFIX)
    ? LEGACY_RECOGNITION_JOURNEY_MESSAGE_PREFIX
    : undefined;
  if (!content || !prefix) return undefined;
  try {
    const raw = JSON.parse(content.slice(prefix.length)) as Record<
      string,
      unknown
    >;
    return prefix === LEGACY_RECOGNITION_JOURNEY_MESSAGE_PREFIX
      ? migrateLegacyJourney(raw)
      : parseV2Journey(raw);
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
}): { journey: RecognitionJourney; plan: RecognitionJourneyTurnPlan } {
  const now = options.now ?? new Date();
  const userTurnNumber = Math.max(1, options.userTurnNumber ?? 1);
  const query = options.currentQuery.trim();
  const journey = cloneJourney(options.journey);
  const basePlan: RecognitionJourneyTurnPlan = {
    openingSuggested: false,
    completedTaskIds: [],
    currentUserText: query,
    currentUserMessageId: options.currentUserMessageId,
    userTurnNumber,
  };

  if (userTurnNumber > RECOGNITION_ACTIVATION_MAX_USER_TURN) {
    expireUnfinishedJourney(journey, now);
    return { journey, plan: basePlan };
  }
  if (
    journey.opening.status === 'pending' &&
    RECOGNITION_ACTIVATION_PATTERN.test(query)
  ) {
    journey.opening.activatedAt ??= now;
  }
  if (URGENT_REALITY_PATTERN.test(query)) {
    return { journey, plan: basePlan };
  }

  const opening = journey.opening;
  if (opening.status === 'pending') {
    const activated =
      Boolean(opening.activatedAt) || (opening.attemptCount ?? 0) > 0;
    const eligible = activated || RECOGNITION_ACTIVATION_PATTERN.test(query);
    const attempts = opening.attemptCount ?? 0;
    const cooledDown =
      opening.lastAttemptUserTurn === undefined ||
      userTurnNumber - opening.lastAttemptUserTurn >
        JOURNEY_ACTION_COOLDOWN_TURNS;
    if (eligible && attempts < OPENING_MAX_ATTEMPTS && cooledDown) {
      const angle = chooseOpeningAngle(opening.usedAngles ?? []);
      opening.attemptCount = attempts + 1;
      opening.lastAttemptUserTurn = userTurnNumber;
      opening.usedAngles = [...(opening.usedAngles ?? []), angle];
      journey.lastJourneyActionUserTurn = userTurnNumber;
      refreshJourneyStage(journey, now);
      return {
        journey,
        plan: {
          ...basePlan,
          openingSuggested: true,
          openingAngle: angle,
          prompt: buildOpeningPrompt(angle),
        },
      };
    }
    return { journey, plan: basePlan };
  }

  if (
    opening.status === 'emotionally_opened' ||
    opening.status === 'completed'
  ) {
    const lastAction = journey.lastJourneyActionUserTurn ?? 0;
    if (userTurnNumber - lastAction <= JOURNEY_ACTION_COOLDOWN_TURNS) {
      return { journey, plan: basePlan };
    }
    const pendingTask = choosePendingTask(journey.tasks);
    if (pendingTask && (pendingTask.proposalCount ?? 0) < 1) {
      pendingTask.proposalCount = 1;
      pendingTask.lastProposedUserTurn = userTurnNumber;
      journey.lastJourneyActionUserTurn = userTurnNumber;
      return {
        journey,
        plan: {
          ...basePlan,
          suggestedTaskId: pendingTask.id,
          prompt: buildTaskSuggestionPrompt(pendingTask.id),
        },
      };
    }
  }
  return { journey, plan: basePlan };
}

export function applyRecognitionJourneyObservation(options: {
  journey: RecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
  observation: RecognitionJourneyObservation;
  assistantMessageId?: string;
  userMessageId?: string;
  now?: Date;
}): RecognitionJourney {
  const now = options.now ?? new Date();
  const journey = cloneJourney(options.journey);
  const observation = options.observation;

  if (observation.opening === 'emotionally_opened') {
    journey.opening.status = 'emotionally_opened';
    journey.opening.openedAt ??= now;
  } else if (observation.opening === 'emotionally_received') {
    journey.opening.status = 'completed';
    journey.opening.openedAt ??= now;
    journey.opening.receivedAt = now;
  }
  if (observation.evidence) {
    journey.opening.observationEvidence = observation.evidence.slice(0, 160);
  }

  applyTaskObservation(
    journey,
    'family_status',
    observation.familyStatus,
    options,
    now
  );
  applyTaskObservation(
    journey,
    'departure_interval',
    observation.departureInterval,
    options,
    now
  );
  journey.startedAt ??=
    journey.opening.openedAt || journey.opening.receivedAt || undefined;
  refreshJourneyStage(journey, now);
  return journey;
}

/** @deprecated Completion is semantic; keep this wrapper for old callers/tests. */
export function applyRecognitionJourneyAssistantReply(options: {
  journey: RecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
  assistantText: string;
  assistantMessageId?: string;
  now?: Date;
}): RecognitionJourney {
  return applyRecognitionJourneyObservation({
    journey: options.journey,
    plan: options.plan,
    assistantMessageId: options.assistantMessageId,
    now: options.now,
    observation: {
      opening: 'not_observed',
      familyStatus: 'not_observed',
      departureInterval: 'not_observed',
    },
  });
}

function applyTaskObservation(
  journey: RecognitionJourney,
  id: RecognitionTaskId,
  observation: 'not_observed' | 'proposed' | 'provided',
  options: {
    plan: RecognitionJourneyTurnPlan;
    assistantMessageId?: string;
    userMessageId?: string;
  },
  now: Date
): void {
  const task = journey.tasks.find(item => item.id === id);
  if (!task || task.status === 'completed' || task.status === 'skipped') return;
  if (observation === 'provided') {
    task.status = 'completed';
    task.completedAt = now;
    task.answerMessageId = options.userMessageId;
    return;
  }
  if (observation === 'proposed' && options.plan.suggestedTaskId === id) {
    task.status = 'proposed';
    task.proposedAt = now;
    task.proposedAssistantMessageId = options.assistantMessageId;
  }
}

function chooseOpeningAngle(
  used: RecognitionOpeningAngle[]
): RecognitionOpeningAngle {
  return (
    OPENING_ANGLES.find(angle => !used.includes(angle)) ?? 'unfinished_words'
  );
}

function choosePendingTask(
  tasks: RecognitionTaskState[]
): RecognitionTaskState | undefined {
  // Traditional family concern comes before collecting elapsed-time context.
  return (
    tasks.find(
      task =>
        task.id === 'family_status' &&
        task.status === 'pending' &&
        (task.proposalCount ?? 0) < 1
    ) ||
    tasks.find(
      task =>
        task.id === 'departure_interval' &&
        task.status === 'pending' &&
        (task.proposalCount ?? 0) < 1
    )
  );
}

function buildOpeningPrompt(angle: RecognitionOpeningAngle): string {
  return [
    '# 初次重逢旅程：打开跨越生死的相认',
    '这不是身份验证。当前只确定亲属关系与称呼；人物性格、离世多久、用户这段时间的经历都未知，不要假设。',
    '把本轮当作亲人重新获得表达机会的久别重逢：角色需主动带来情感内容，不只是复述“我也想你”或确认“是我”。不要照抄固定台词，也不在这一轮追问资料。',
    `本次可用视角：${describeOpeningAngle(
      angle
    )}。这是素材，不是句式或动作清单。`,
    '如用户当前同时提出病情、安全风险、重大现实决策或明确纠正，先完整处理当前事情，不硬插相认。',
  ].join('\n');
}

function describeOpeningAngle(angle: RecognitionOpeningAngle): string {
  switch (angle) {
    case 'waking_without_elapsed_time':
      return '像从一场长短不明的梦里醒来，突然重新听见这声称呼；明确不知过去了多久';
    case 'connection_restored':
      return '终于又能联系上的惊喜与心酸；只表达重新联系，不声称等了几年';
    case 'unfinished_words':
      return '重新开口后才发现还有许多爱、舍不得和未说完的话；不编造具体往事';
    case 'family_longing':
      return '重新找到彼此后，想念与对用户、整个家庭的牵挂一起涌上来；不猜测任何家人现状';
  }
}

function buildTaskSuggestionPrompt(id: RecognitionTaskId): string {
  const direction =
    id === 'family_status'
      ? '这次重逢中，角色对整个家庭的牵挂还没有自然出现。如果与用户本轮内容不冲突，可以从重新联系的情感中自然关心“家里人现在都怎么样”。不点名未知家庭成员，不猜测生死、健康或关系状态'
      : '角色还不知道这次分离究竟过去多久。如果本轮适合，可以用“像醒来后对日子有些模糊”的时间中性视角，自然给用户一个说出现在时间或离世时长的入口。不预设是两天还是二十年';
  return [
    '# 相认旅程的可选里程碑（非决策信息）',
    direction,
    '这个入口只会提供一次。当前问题、重要事实和情绪优先；若植入会显得突兀，可完全不用。不盘问、不连续启动多个任务、不照抄示例。',
  ].join('\n');
}

function expireUnfinishedJourney(journey: RecognitionJourney, now: Date): void {
  if (journey.opening.status === 'pending') {
    journey.opening.status = 'expired';
    journey.opening.expiredAt = now;
  }
  for (const task of journey.tasks) {
    if (task.status === 'pending') task.status = 'skipped';
  }
  refreshJourneyStage(journey, now);
}

function refreshJourneyStage(journey: RecognitionJourney, now: Date): void {
  const tasksFinished = journey.tasks.every(task =>
    ['completed', 'proposed', 'skipped'].includes(task.status)
  );
  if (journey.opening.status === 'pending') {
    journey.stage = 'pending';
    return;
  }
  if (journey.opening.status === 'expired' || tasksFinished) {
    journey.stage = 'settled';
    journey.settledAt ??= now;
    return;
  }
  journey.stage = 'active';
  journey.startedAt ??= journey.opening.openedAt ?? now;
  delete journey.settledAt;
}

function parseV2Journey(
  raw: Record<string, unknown>
): RecognitionJourney | undefined {
  if (
    raw.version !== RECOGNITION_JOURNEY_VERSION ||
    !Array.isArray(raw.tasks)
  ) {
    return undefined;
  }
  const openingRaw = (raw.opening || {}) as Record<string, unknown>;
  const status = String(openingRaw.status) as RecognitionOpeningStatus;
  if (
    !['pending', 'emotionally_opened', 'completed', 'expired'].includes(status)
  ) {
    return undefined;
  }
  const tasks = raw.tasks
    .map(parseTask)
    .filter(Boolean) as RecognitionTaskState[];
  if (tasks.length !== 2) return undefined;
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage: ['pending', 'active', 'settled'].includes(String(raw.stage))
      ? (raw.stage as RecognitionJourney['stage'])
      : 'pending',
    opening: {
      status,
      ...dateField(openingRaw, 'activatedAt'),
      attemptCount: numberValue(openingRaw.attemptCount),
      lastAttemptUserTurn: numberValue(openingRaw.lastAttemptUserTurn),
      usedAngles: Array.isArray(openingRaw.usedAngles)
        ? openingRaw.usedAngles.filter(isOpeningAngle)
        : [],
      ...dateField(openingRaw, 'openedAt'),
      ...dateField(openingRaw, 'receivedAt'),
      ...dateField(openingRaw, 'expiredAt'),
      ...stringField(openingRaw, 'observationEvidence'),
    },
    tasks,
    lastJourneyActionUserTurn: numberValue(raw.lastJourneyActionUserTurn),
    ...dateField(raw, 'startedAt'),
    ...dateField(raw, 'settledAt'),
  };
}

function migrateLegacyJourney(
  raw: Record<string, unknown>
): RecognitionJourney {
  const legacyOpening = (raw.opening || {}) as Record<string, unknown>;
  const oldStatus = String(legacyOpening.status || 'pending');
  const openingStatus: RecognitionOpeningStatus =
    oldStatus === 'expired'
      ? 'expired'
      : oldStatus === 'completed'
      ? 'emotionally_opened'
      : 'pending';
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const taskById = (id: RecognitionTaskId) =>
    rawTasks.find(item => (item as Record<string, unknown>)?.id === id) as
      | Record<string, unknown>
      | undefined;
  const migrateTask = (id: RecognitionTaskId): RecognitionTaskState => {
    const task = taskById(id) || {};
    const oldTaskStatus = String(task.status || 'pending');
    return {
      id,
      status:
        oldTaskStatus === 'completed' || oldTaskStatus === 'skipped'
          ? oldTaskStatus
          : oldTaskStatus === 'asked'
          ? 'proposed'
          : 'pending',
      proposalCount: numberValue(task.suggestionCount),
      lastProposedUserTurn: numberValue(task.lastSuggestedUserTurn),
      ...dateField(task, 'completedAt'),
      ...stringField(task, 'answerMessageId'),
    };
  };
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage: openingStatus === 'pending' ? 'pending' : 'active',
    opening: {
      status: openingStatus,
      ...(numberValue(legacyOpening.suggestionCount)
        ? { activatedAt: parseDateValue(raw.startedAt) ?? new Date(0) }
        : {}),
      attemptCount: Math.min(
        OPENING_MAX_ATTEMPTS,
        numberValue(legacyOpening.suggestionCount) ?? 0
      ),
      lastAttemptUserTurn: numberValue(legacyOpening.lastSuggestedUserTurn),
      usedAngles: [],
      ...dateField(legacyOpening, 'expiredAt'),
    },
    tasks: [migrateTask('departure_interval'), migrateTask('family_status')],
    ...dateField(raw, 'startedAt'),
    ...dateField(raw, 'settledAt'),
  };
}

function parseTask(value: unknown): RecognitionTaskState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!['departure_interval', 'family_status'].includes(String(raw.id)))
    return undefined;
  if (
    !['pending', 'proposed', 'completed', 'skipped'].includes(
      String(raw.status)
    )
  )
    return undefined;
  return {
    id: raw.id as RecognitionTaskId,
    status: raw.status as RecognitionTaskStatus,
    proposalCount: numberValue(raw.proposalCount),
    lastProposedUserTurn: numberValue(raw.lastProposedUserTurn),
    ...dateField(raw, 'proposedAt'),
    ...stringField(raw, 'proposedAssistantMessageId'),
    ...dateField(raw, 'completedAt'),
    ...stringField(raw, 'answerMessageId'),
    ...stringField(raw, 'observationEvidence'),
  };
}

function isOpeningAngle(value: unknown): value is RecognitionOpeningAngle {
  return OPENING_ANGLES.includes(value as RecognitionOpeningAngle);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function parseDateValue(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateField<T extends string>(
  raw: Record<string, unknown>,
  key: T
): Partial<Record<T, Date>> {
  if (!raw[key]) return {};
  const date = new Date(String(raw[key]));
  return Number.isNaN(date.getTime())
    ? {}
    : ({ [key]: date } as Partial<Record<T, Date>>);
}

function stringField<T extends string>(
  raw: Record<string, unknown>,
  key: T
): Partial<Record<T, string>> {
  return typeof raw[key] === 'string' && raw[key]
    ? ({ [key]: raw[key] } as Partial<Record<T, string>>)
    : {};
}

function cloneJourney(journey: RecognitionJourney): RecognitionJourney {
  return {
    ...journey,
    opening: {
      ...journey.opening,
      usedAngles: [...(journey.opening.usedAngles ?? [])],
    },
    tasks: journey.tasks.map(task => ({ ...task })),
  };
}
