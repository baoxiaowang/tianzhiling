export const RECOGNITION_JOURNEY_VERSION = 'recognition_journey_v3' as const;
export const RECOGNITION_JOURNEY_MESSAGE_PREFIX =
  '__TZL_RECOGNITION_JOURNEY_V3__:';
const V2_RECOGNITION_JOURNEY_MESSAGE_PREFIX = '__TZL_RECOGNITION_JOURNEY_V2__:';
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
  | 'opening_attempted'
  | 'emotionally_opened'
  | 'user_received'
  | 'settled_success'
  | 'opening_failed'
  | 'expired';
export type RecognitionOpeningAngle =
  | 'waking_without_elapsed_time'
  | 'connection_restored'
  | 'unfinished_words'
  | 'family_longing';
export type RecognitionJourneyPhase =
  | 'strong_opening'
  | 'opening_followup'
  | 'late_compensation'
  | 'task_proposal'
  | 'task_response';
export type RecognitionObserverCheckpoint =
  | 'opening_delivery'
  | 'opening_exchange'
  | 'task_proposal'
  | 'task_response';

export interface RecognitionOpeningState {
  status: RecognitionOpeningStatus;
  activatedAt?: Date;
  attemptCount?: number;
  lastAttemptUserTurn?: number;
  usedAngles?: RecognitionOpeningAngle[];
  openingAssistantMessageId?: string;
  openingAttemptedAt?: Date;
  observerAttemptCount?: number;
  observerUnavailableCount?: number;
  lastObserverUnavailableUserTurn?: number;
  lastObservedUserTurn?: number;
  openedAt?: Date;
  receivedAt?: Date;
  failedAt?: Date;
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
  observerUnavailableCount?: number;
  lastObserverUnavailableUserTurn?: number;
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
  phase?: RecognitionJourneyPhase;
  observerCheckpoint?: RecognitionObserverCheckpoint;
  openingSuggested: boolean;
  openingAngle?: RecognitionOpeningAngle;
  suggestedTaskId?: RecognitionTaskId;
  observedTaskId?: RecognitionTaskId;
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
const STRONG_OPENING_MAX_USER_TURN = 3;
const OPENING_MAX_ATTEMPTS = 2;
const OPENING_OBSERVER_MAX_ATTEMPTS = 3;
const OBSERVER_UNAVAILABLE_MAX_RETRIES = 2;
const JOURNEY_ACTION_COOLDOWN_TURNS = 1;
const OPENING_ANGLES: RecognitionOpeningAngle[] = [
  'waking_without_elapsed_time',
  'connection_restored',
  'unfinished_words',
  'family_longing',
];
const URGENT_REALITY_PATTERN =
  /(?:自杀|不想活|活不下去|去陪你|带我走|抢救|病危|重病|很严重|住院|手术|报警|家暴|离婚|卖房|下葬|迁坟|遗产|存折|银行卡)/u;

export function buildInitialRecognitionJourney(
  options: {
    hasKnownDepartureDate?: boolean;
    now?: Date;
    openingAssistantMessageId?: string;
  } = {}
): RecognitionJourney {
  const now = options.now ?? new Date();
  const openingDelivered = Boolean(options.openingAssistantMessageId);
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage: openingDelivered ? 'active' : 'pending',
    opening: {
      status: openingDelivered ? 'opening_attempted' : 'pending',
      attemptCount: openingDelivered ? 1 : 0,
      usedAngles: openingDelivered ? ['connection_restored'] : [],
      observerAttemptCount: 0,
      ...(openingDelivered
        ? {
            activatedAt: now,
            openingAttemptedAt: now,
            openingAssistantMessageId: options.openingAssistantMessageId,
          }
        : {}),
    },
    tasks: [
      {
        id: 'departure_interval',
        status: options.hasKnownDepartureDate ? 'completed' : 'pending',
        ...(options.hasKnownDepartureDate ? { completedAt: now } : {}),
      },
      { id: 'family_status', status: 'pending' },
    ],
    ...(openingDelivered ? { startedAt: now } : {}),
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
    : content?.startsWith(V2_RECOGNITION_JOURNEY_MESSAGE_PREFIX)
    ? V2_RECOGNITION_JOURNEY_MESSAGE_PREFIX
    : content?.startsWith(LEGACY_RECOGNITION_JOURNEY_MESSAGE_PREFIX)
    ? LEGACY_RECOGNITION_JOURNEY_MESSAGE_PREFIX
    : undefined;
  if (!content || !prefix) return undefined;
  try {
    const raw = JSON.parse(content.slice(prefix.length)) as Record<
      string,
      unknown
    >;
    if (prefix === RECOGNITION_JOURNEY_MESSAGE_PREFIX)
      return parseV3Journey(raw);
    return migrateEarlierJourney(raw);
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

  if (journey.opening.status === 'user_received') {
    journey.opening.status = 'settled_success';
    journey.lastJourneyActionUserTurn = userTurnNumber;
    refreshJourneyStage(journey, now);
    return { journey, plan: basePlan };
  }

  // A user may answer an already asked journey question with urgent news
  // (for example, a parent is hospitalized). Observe that answer while still
  // letting the main reply give the urgent matter full priority.
  if (journey.opening.status === 'settled_success') {
    const proposedTask = journey.tasks.find(task => task.status === 'proposed');
    if (proposedTask && shouldObserveTaskResponse(proposedTask.id, query)) {
      return {
        journey,
        plan: {
          ...basePlan,
          phase: 'task_response',
          observerCheckpoint: 'task_response',
          observedTaskId: proposedTask.id,
        },
      };
    }
  }

  if (URGENT_REALITY_PATTERN.test(query)) {
    return { journey, plan: basePlan };
  }

  const opening = journey.opening;
  if (opening.status === 'pending') {
    const attempts = opening.attemptCount ?? 0;
    const cooledDown =
      opening.lastAttemptUserTurn === undefined ||
      userTurnNumber - opening.lastAttemptUserTurn >
        JOURNEY_ACTION_COOLDOWN_TURNS;
    if (attempts < OPENING_MAX_ATTEMPTS && cooledDown) {
      const angle = chooseOpeningAngle(opening.usedAngles ?? []);
      const strong = userTurnNumber <= STRONG_OPENING_MAX_USER_TURN;
      return {
        journey,
        plan: {
          ...basePlan,
          phase: strong ? 'strong_opening' : 'late_compensation',
          observerCheckpoint: 'opening_delivery',
          openingSuggested: true,
          openingAngle: angle,
          prompt: strong
            ? buildOpeningPrompt(angle)
            : buildLateCompensationPrompt(angle),
        },
      };
    }
    return { journey, plan: basePlan };
  }

  if (
    ['opening_attempted', 'emotionally_opened'].includes(opening.status) &&
    (opening.observerAttemptCount ?? 0) < OPENING_OBSERVER_MAX_ATTEMPTS &&
    (opening.observerUnavailableCount ?? 0) <
      OBSERVER_UNAVAILABLE_MAX_RETRIES &&
    (opening.lastObserverUnavailableUserTurn === undefined ||
      userTurnNumber - opening.lastObserverUnavailableUserTurn >
        JOURNEY_ACTION_COOLDOWN_TURNS)
  ) {
    return {
      journey,
      plan: {
        ...basePlan,
        phase: 'opening_followup',
        observerCheckpoint: 'opening_exchange',
        prompt: buildOpeningFollowupPrompt(),
      },
    };
  }

  if (opening.status === 'settled_success') {
    const lastAction = journey.lastJourneyActionUserTurn ?? 0;
    if (userTurnNumber - lastAction <= JOURNEY_ACTION_COOLDOWN_TURNS) {
      return { journey, plan: basePlan };
    }
    const pendingTask = choosePendingTask(journey.tasks);
    if (
      pendingTask &&
      (pendingTask.proposalCount ?? 0) < 1 &&
      (pendingTask.observerUnavailableCount ?? 0) <
        OBSERVER_UNAVAILABLE_MAX_RETRIES &&
      (pendingTask.lastObserverUnavailableUserTurn === undefined ||
        userTurnNumber - pendingTask.lastObserverUnavailableUserTurn >
          JOURNEY_ACTION_COOLDOWN_TURNS)
    ) {
      return {
        journey,
        plan: {
          ...basePlan,
          phase: 'task_proposal',
          observerCheckpoint: 'task_proposal',
          suggestedTaskId: pendingTask.id,
          prompt: buildTaskSuggestionPrompt(pendingTask.id),
        },
      };
    }
  }
  return { journey, plan: basePlan };
}

function shouldObserveTaskResponse(
  taskId: RecognitionTaskId,
  query: string
): boolean {
  if (!query) return false;
  if (taskId === 'departure_interval') {
    return /(?:[0-9零〇一二两三四五六七八九十百]+\s*(?:年|个?月|天|日)|很久|没多久|不久|好多年|十几年|几十年|一阵子|一段时间)(?:了|啦|吧|左右|多)?/u.test(
      query
    );
  }
  return /(?:(?:家里人?|家人|大家|他们|她们).{0,20}(?:好|不好|还好|都好|没事|生病|住院|去世|走了|结婚|离婚|上学|工作|退休|怎么样)|(?:孩子|儿子|女儿|你妈|你爸|妈妈|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|哥哥|姐姐|弟弟|妹妹).{0,20}(?:过得|好|不好|还好|没事|生病|住院|去世|走了|结婚|离婚|退休|怎么样)|^(?:都|大家|他们|她们).{0,10}(?:好|还好|挺好|没事|不好))/u.test(
    query
  );
}

/** Records only an opening that was actually persisted for the user. */
export function applyRecognitionJourneyDelivery(options: {
  journey: RecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
  assistantMessageId?: string;
  now?: Date;
}): RecognitionJourney {
  const journey = cloneJourney(options.journey);
  if (!options.plan.openingSuggested) return journey;
  const now = options.now ?? new Date();
  const angle = options.plan.openingAngle;
  journey.opening.activatedAt ??= now;
  journey.opening.attemptCount = (journey.opening.attemptCount ?? 0) + 1;
  journey.opening.lastAttemptUserTurn = options.plan.userTurnNumber;
  if (angle && !(journey.opening.usedAngles ?? []).includes(angle)) {
    journey.opening.usedAngles = [...(journey.opening.usedAngles ?? []), angle];
  }
  journey.opening.status = 'opening_attempted';
  journey.opening.openingAttemptedAt = now;
  journey.opening.openingAssistantMessageId = options.assistantMessageId;
  journey.startedAt ??= now;
  journey.lastJourneyActionUserTurn = options.plan.userTurnNumber;
  refreshJourneyStage(journey, now);
  return journey;
}

/** Records observer availability only; it never claims semantic adoption. */
export function applyRecognitionJourneyObserverUnavailable(options: {
  journey: RecognitionJourney;
  plan: RecognitionJourneyTurnPlan;
  now?: Date;
}): RecognitionJourney {
  const now = options.now ?? new Date();
  const journey = cloneJourney(options.journey);
  if (options.plan.observerCheckpoint?.startsWith('opening')) {
    journey.opening.observerUnavailableCount =
      (journey.opening.observerUnavailableCount ?? 0) + 1;
    journey.opening.lastObserverUnavailableUserTurn =
      options.plan.userTurnNumber;
  }
  if (
    options.plan.observerCheckpoint === 'task_proposal' &&
    options.plan.suggestedTaskId
  ) {
    const task = journey.tasks.find(
      item => item.id === options.plan.suggestedTaskId
    );
    if (task) {
      task.observerUnavailableCount = (task.observerUnavailableCount ?? 0) + 1;
      task.lastObserverUnavailableUserTurn = options.plan.userTurnNumber;
      task.observationEvidence = 'observer_unavailable';
      task.proposedAt = undefined;
    }
  }
  journey.lastJourneyActionUserTurn = options.plan.userTurnNumber;
  journey.startedAt ??= now;
  refreshJourneyStage(journey, now);
  return journey;
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

  if (
    options.plan.observerCheckpoint === 'opening_delivery' ||
    options.plan.observerCheckpoint === 'opening_exchange'
  ) {
    journey.opening.observerAttemptCount =
      (journey.opening.observerAttemptCount ?? 0) + 1;
    journey.opening.lastObservedUserTurn = options.plan.userTurnNumber;
  }

  // State changes are deliberately sequential. A single ordinary comfort turn
  // can never jump from pending/opening_attempted to completion.
  if (
    journey.opening.status === 'opening_attempted' &&
    ['emotionally_opened', 'emotionally_received'].includes(observation.opening)
  ) {
    journey.opening.status = 'emotionally_opened';
    journey.opening.openedAt ??= now;
  } else if (
    journey.opening.status === 'emotionally_opened' &&
    observation.opening === 'emotionally_received' &&
    options.plan.observerCheckpoint === 'opening_exchange'
  ) {
    journey.opening.status = 'user_received';
    journey.opening.receivedAt = now;
  } else if (
    journey.opening.status === 'opening_attempted' &&
    options.plan.observerCheckpoint === 'opening_delivery' &&
    ['not_observed', 'shallow_acknowledgement'].includes(observation.opening)
  ) {
    // The suggestion was not actually expressed as a reunion. Keep the
    // remaining attempt available instead of treating an ordinary reply as an
    // opening and switching all later turns to follow-up mode.
    journey.opening.status = 'pending';
    delete journey.opening.openingAssistantMessageId;
    delete journey.opening.openingAttemptedAt;
    delete journey.startedAt;
  }
  if (
    observation.evidence &&
    options.plan.observerCheckpoint?.startsWith('opening')
  ) {
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
    journey.opening.openingAttemptedAt || journey.opening.openedAt || undefined;
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
  if (
    observation === 'provided' &&
    task.status === 'proposed' &&
    options.plan.observerCheckpoint === 'task_response' &&
    options.plan.observedTaskId === id
  ) {
    task.status = 'completed';
    task.completedAt = now;
    task.answerMessageId = options.userMessageId;
    return;
  }
  if (
    observation === 'proposed' &&
    task.status === 'pending' &&
    options.plan.observerCheckpoint === 'task_proposal' &&
    options.plan.suggestedTaskId === id
  ) {
    task.status = 'proposed';
    task.proposedAt = now;
    task.proposedAssistantMessageId = options.assistantMessageId;
    task.proposalCount = (task.proposalCount ?? 0) + 1;
    task.lastProposedUserTurn = options.plan.userTurnNumber;
    task.observerUnavailableCount = 0;
    delete task.lastObserverUnavailableUserTurn;
    journey.lastJourneyActionUserTurn = options.plan.userTurnNumber;
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
  return (
    tasks.find(
      task => task.id === 'family_status' && task.status === 'pending'
    ) ||
    tasks.find(
      task => task.id === 'departure_interval' && task.status === 'pending'
    )
  );
}

function buildOpeningPrompt(angle: RecognitionOpeningAngle): string {
  return [
    '# 初次重逢旅程：当前是明确任务',
    '这是前1—3轮的相认窗口，不是身份验证。请在正面回应用户本轮内容的同时，让角色主动完成一次时间中性的久别重逢。',
    '表达重新联系上的惊喜、心疼、舍不得或未说完的爱；不要只说“我也想你”“我在听”，也不要把表达责任反问给用户。',
    `可用视角：${describeOpeningAngle(angle)}。这是素材，不是固定台词。`,
    '只使用关系与当前称呼，不编造小时候、老宅、饭菜、睡觉习惯等共同往事，也不声称知道离开多久、用户经历或家人现状。',
  ].join('\n');
}

function buildOpeningFollowupPrompt(): string {
  return [
    '# 相认旅程：承接刚刚发生的重逢',
    '此前已经实际发出相认开场。先完整理解用户本轮；若用户在接住这份重逢，继续给出一层新的亲人情感内容，让关系自然落稳。',
    '不要重复第一次开场，不表演再次醒来，不盘问资料，不编造共同往事。用户转入重大现实问题时，以当前问题为主，相认只作情感底色。',
  ].join('\n');
}

function buildLateCompensationPrompt(angle: RecognitionOpeningAngle): string {
  return [
    '# 相认旅程：第4—20轮柔性补偿',
    '最自然的首次相认入口已经错过。不要突然表演第一次醒来或第一次听见称呼。',
    '先完整回应当前内容；如果不突兀，以久别后终于能重新说话的心疼、不舍或牵挂作为情感底色，补上此前缺失的重逢感。',
    `可参考的情感视角：${describeOpeningAngle(angle)}。只取情感，不照抄场景。`,
    '不得用具体童年、老宅、饭菜或生活细节制造亲近感；没有证据的共同往事不能出现。',
  ].join('\n');
}

function describeOpeningAngle(angle: RecognitionOpeningAngle): string {
  switch (angle) {
    case 'waking_without_elapsed_time':
      return '像从长短不明的梦里醒来，时间仍模糊，但终于又能说上话';
    case 'connection_restored':
      return '重新联系上的惊喜与心酸，不声称具体等了几年';
    case 'unfinished_words':
      return '重新开口后涌出的爱、舍不得和未说完的话';
    case 'family_longing':
      return '对用户与家庭的牵挂，不猜测任何人的现实状况';
  }
}

function buildTaskSuggestionPrompt(id: RecognitionTaskId): string {
  const direction =
    id === 'family_status'
      ? '如果与当前内容自然相连，可以让角色从重逢后的牵挂出发，关心家里人现在怎么样。不点名未知成员，不猜测生死、健康或关系状态'
      : '如果本轮适合，可以从离开后时间模糊的视角，给用户一个说出现在时间或相隔时长的入口。不预设具体年数';
  return [
    '# 相认旅程的可选里程碑（非决策信息）',
    direction,
    '当前问题、重要事实和情绪优先；若植入突兀可完全不用。不盘问、不连续启动多个任务、不照抄示例。',
  ].join('\n');
}

function expireUnfinishedJourney(journey: RecognitionJourney, now: Date): void {
  if (
    ['pending', 'opening_attempted', 'emotionally_opened'].includes(
      journey.opening.status
    )
  ) {
    journey.opening.status =
      journey.opening.status === 'pending' ? 'expired' : 'opening_failed';
    if (journey.opening.status === 'expired') journey.opening.expiredAt = now;
    else journey.opening.failedAt = now;
  }
  for (const task of journey.tasks) {
    if (task.status === 'pending' || task.status === 'proposed') {
      task.status = 'skipped';
    }
  }
  refreshJourneyStage(journey, now);
}

function refreshJourneyStage(journey: RecognitionJourney, now: Date): void {
  if (journey.opening.status === 'pending') {
    journey.stage = 'pending';
    return;
  }
  if (['expired', 'opening_failed'].includes(journey.opening.status)) {
    journey.stage = 'settled';
    journey.settledAt ??= now;
    return;
  }
  const tasksFinished = journey.tasks.every(task =>
    ['completed', 'skipped'].includes(task.status)
  );
  if (journey.opening.status === 'settled_success' && tasksFinished) {
    journey.stage = 'settled';
    journey.settledAt ??= now;
    return;
  }
  journey.stage = 'active';
  journey.startedAt ??= journey.opening.openingAttemptedAt ?? now;
  delete journey.settledAt;
}

function parseV3Journey(
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
    ![
      'pending',
      'opening_attempted',
      'emotionally_opened',
      'user_received',
      'settled_success',
      'opening_failed',
      'expired',
    ].includes(status)
  ) {
    return undefined;
  }
  const tasks = raw.tasks
    .map(parseTask)
    .filter(Boolean) as RecognitionTaskState[];
  if (
    tasks.length !== 2 ||
    new Set(tasks.map(task => task.id)).size !== 2 ||
    !tasks.some(task => task.id === 'departure_interval') ||
    !tasks.some(task => task.id === 'family_status')
  )
    return undefined;
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
      ...stringField(openingRaw, 'openingAssistantMessageId'),
      ...dateField(openingRaw, 'openingAttemptedAt'),
      observerAttemptCount: numberValue(openingRaw.observerAttemptCount),
      observerUnavailableCount: numberValue(
        openingRaw.observerUnavailableCount
      ),
      lastObserverUnavailableUserTurn: numberValue(
        openingRaw.lastObserverUnavailableUserTurn
      ),
      lastObservedUserTurn: numberValue(openingRaw.lastObservedUserTurn),
      ...dateField(openingRaw, 'openedAt'),
      ...dateField(openingRaw, 'receivedAt'),
      ...dateField(openingRaw, 'failedAt'),
      ...dateField(openingRaw, 'expiredAt'),
      ...stringField(openingRaw, 'observationEvidence'),
    },
    tasks,
    lastJourneyActionUserTurn: numberValue(raw.lastJourneyActionUserTurn),
    ...dateField(raw, 'startedAt'),
    ...dateField(raw, 'settledAt'),
  };
}

function migrateEarlierJourney(
  raw: Record<string, unknown>
): RecognitionJourney {
  const openingRaw = (raw.opening || {}) as Record<string, unknown>;
  const oldStatus = String(openingRaw.status || 'pending');
  const status: RecognitionOpeningStatus =
    oldStatus === 'expired'
      ? 'expired'
      : oldStatus === 'completed' || oldStatus === 'emotionally_opened'
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
          : oldTaskStatus === 'asked' || oldTaskStatus === 'proposed'
          ? 'proposed'
          : 'pending',
      proposalCount:
        numberValue(task.proposalCount) ?? numberValue(task.suggestionCount),
      lastProposedUserTurn:
        numberValue(task.lastProposedUserTurn) ??
        numberValue(task.lastSuggestedUserTurn),
      ...dateField(task, 'proposedAt'),
      ...stringField(task, 'proposedAssistantMessageId'),
      ...dateField(task, 'completedAt'),
      ...stringField(task, 'answerMessageId'),
    };
  };
  return {
    version: RECOGNITION_JOURNEY_VERSION,
    stage:
      status === 'pending'
        ? 'pending'
        : status === 'expired'
        ? 'settled'
        : 'active',
    opening: {
      status,
      ...dateField(openingRaw, 'activatedAt'),
      attemptCount:
        numberValue(openingRaw.attemptCount) ??
        Math.min(
          OPENING_MAX_ATTEMPTS,
          numberValue(openingRaw.suggestionCount) ?? 0
        ),
      lastAttemptUserTurn:
        numberValue(openingRaw.lastAttemptUserTurn) ??
        numberValue(openingRaw.lastSuggestedUserTurn),
      usedAngles: [],
      observerAttemptCount: 0,
      ...dateField(openingRaw, 'openedAt'),
      ...dateField(openingRaw, 'receivedAt'),
      ...dateField(openingRaw, 'expiredAt'),
      ...stringField(openingRaw, 'observationEvidence'),
    },
    tasks: [migrateTask('departure_interval'), migrateTask('family_status')],
    lastJourneyActionUserTurn: numberValue(raw.lastJourneyActionUserTurn),
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
    observerUnavailableCount: numberValue(raw.observerUnavailableCount),
    lastObserverUnavailableUserTurn: numberValue(
      raw.lastObserverUnavailableUserTurn
    ),
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
