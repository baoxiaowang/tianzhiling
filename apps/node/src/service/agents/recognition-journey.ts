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
  suggestionMissCount?: number;
  lastSuggestedUserTurn?: number;
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
  taskSuggestionAttemptCount?: number;
  lastTaskSuggestionAttemptUserTurn?: number;
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
  eligibleTaskIds?: RecognitionTaskId[];
  observedTaskId?: RecognitionTaskId;
  observedTaskIds?: RecognitionTaskId[];
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
const SECOND_MILESTONE_GAP_TURNS = 3;
const OPENING_ANGLES: RecognitionOpeningAngle[] = [
  'waking_without_elapsed_time',
  'connection_restored',
  'unfinished_words',
  'family_longing',
];
const RECOGNITION_TASK_EXPLICIT_DEFER_PATTERN =
  /(?:先别问(?:了)?|别问了|不要(?:再)?问|别再问|我不想回答|(?:这个|这事|这件事)我?不想说|别提这个|不要提这个|先听我说(?:完)?|听我说完)/u;

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

  if (journey.opening.status === 'user_received') {
    journey.opening.status = 'settled_success';
    refreshJourneyStage(journey, now);
  }

  // A task already asked remains answerable after the 20-turn activation
  // window. During the window, a user may also volunteer the information
  // before it is asked; observe the source message instead of asking again.
  const observedTaskIds = journey.tasks
    .filter(task =>
      task.status === 'proposed'
        ? shouldObserveTaskResponse(task.id, query)
        : userTurnNumber <= RECOGNITION_ACTIVATION_MAX_USER_TURN &&
          task.status === 'pending' &&
          shouldObserveTaskResponse(task.id, query)
    )
    .map(task => task.id);

  if (userTurnNumber > RECOGNITION_ACTIVATION_MAX_USER_TURN) {
    if (observedTaskIds.length) {
      return {
        journey,
        plan: {
          ...basePlan,
          phase: 'task_response',
          observerCheckpoint: 'task_response',
          observedTaskId: observedTaskIds[0],
          observedTaskIds,
        },
      };
    }
    expireUnfinishedJourney(journey, now);
    return { journey, plan: basePlan };
  }

  // Only an explicit conversational refusal suppresses task presentation here.
  // The main model sees the complete turn and owns ordinary judgments about
  // urgency, emotional weight and whether a journey question would interrupt.
  if (RECOGNITION_TASK_EXPLICIT_DEFER_PATTERN.test(query)) {
    return observedTaskIds.length
      ? {
          journey,
          plan: {
            ...basePlan,
            phase: 'task_response',
            observerCheckpoint: 'task_response',
            observedTaskId: observedTaskIds[0],
            observedTaskIds,
          },
        }
      : { journey, plan: basePlan };
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

  const eligibleTaskIds = resolveEligibleTaskIds({
    journey,
    observedTaskIds,
    userTurnNumber,
  });
  if (
    eligibleTaskIds.length &&
    canSuggestRecognitionTask(journey, userTurnNumber)
  ) {
    const suggestedTaskId = chooseRecognitionTaskId({
      journey,
      eligibleTaskIds,
      query,
    });
    const task = journey.tasks.find(item => item.id === suggestedTaskId);
    return {
      journey,
      plan: {
        ...basePlan,
        phase: 'task_proposal',
        observerCheckpoint: 'task_proposal',
        suggestedTaskId,
        eligibleTaskIds: [suggestedTaskId],
        ...(observedTaskIds.length
          ? {
              observedTaskId: observedTaskIds[0],
              observedTaskIds,
            }
          : {}),
        prompt: buildTaskSuggestionPrompt(
          suggestedTaskId,
          ['opening_attempted', 'emotionally_opened'].includes(opening.status),
          task?.suggestionMissCount ?? 0
        ),
      },
    };
  }

  if (observedTaskIds.length) {
    return {
      journey,
      plan: {
        ...basePlan,
        phase: 'task_response',
        observerCheckpoint: 'task_response',
        observedTaskId: observedTaskIds[0],
        observedTaskIds,
      },
    };
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
  const observesOpening =
    options.plan.observerCheckpoint?.startsWith('opening') ||
    (options.plan.observerCheckpoint === 'task_proposal' &&
      ['opening_attempted', 'emotionally_opened'].includes(
        journey.opening.status
      ));
  if (observesOpening) {
    journey.opening.observerUnavailableCount =
      (journey.opening.observerUnavailableCount ?? 0) + 1;
    journey.opening.lastObserverUnavailableUserTurn =
      options.plan.userTurnNumber;
  }
  if (
    options.plan.observerCheckpoint === 'task_proposal' &&
    (options.plan.eligibleTaskIds?.length || options.plan.suggestedTaskId)
  ) {
    const eligibleTaskIds = options.plan.suggestedTaskId
      ? [options.plan.suggestedTaskId]
      : options.plan.eligibleTaskIds || [];
    for (const task of journey.tasks.filter(item =>
      eligibleTaskIds.includes(item.id)
    )) {
      task.observerUnavailableCount = (task.observerUnavailableCount ?? 0) + 1;
      task.lastObserverUnavailableUserTurn = options.plan.userTurnNumber;
      task.lastSuggestedUserTurn = options.plan.userTurnNumber;
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

  const observesOpening =
    options.plan.observerCheckpoint === 'opening_delivery' ||
    options.plan.observerCheckpoint === 'opening_exchange' ||
    (options.plan.observerCheckpoint === 'task_proposal' &&
      ['opening_attempted', 'emotionally_opened'].includes(
        journey.opening.status
      ));
  if (observesOpening) {
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
    (options.plan.observerCheckpoint === 'opening_exchange' ||
      options.plan.observerCheckpoint === 'task_proposal')
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
  if (observation.evidence && observesOpening) {
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
  const observedTaskIds =
    options.plan.observedTaskIds ||
    (options.plan.observedTaskId ? [options.plan.observedTaskId] : []);
  const eligibleTaskIds =
    options.plan.eligibleTaskIds ||
    (options.plan.suggestedTaskId ? [options.plan.suggestedTaskId] : []);
  if (
    observation === 'provided' &&
    ['pending', 'proposed'].includes(task.status) &&
    ['task_response', 'task_proposal'].includes(
      options.plan.observerCheckpoint || ''
    ) &&
    observedTaskIds.includes(id)
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
    eligibleTaskIds.includes(id)
  ) {
    task.status = 'proposed';
    task.proposedAt = now;
    task.proposedAssistantMessageId = options.assistantMessageId;
    task.proposalCount = (task.proposalCount ?? 0) + 1;
    task.suggestionMissCount = 0;
    task.lastSuggestedUserTurn = options.plan.userTurnNumber;
    task.lastProposedUserTurn = options.plan.userTurnNumber;
    task.observerUnavailableCount = 0;
    delete task.lastObserverUnavailableUserTurn;
    journey.lastJourneyActionUserTurn = options.plan.userTurnNumber;
    journey.taskSuggestionAttemptCount =
      (journey.taskSuggestionAttemptCount ?? 0) + 1;
    journey.lastTaskSuggestionAttemptUserTurn = options.plan.userTurnNumber;
    return;
  }
  if (
    observation === 'not_observed' &&
    task.status === 'pending' &&
    options.plan.observerCheckpoint === 'task_proposal' &&
    eligibleTaskIds.includes(id)
  ) {
    task.suggestionMissCount = (task.suggestionMissCount ?? 0) + 1;
    task.lastSuggestedUserTurn = options.plan.userTurnNumber;
    task.observationEvidence = 'suggested_but_not_delivered';
  }
}

function chooseOpeningAngle(
  used: RecognitionOpeningAngle[]
): RecognitionOpeningAngle {
  return (
    OPENING_ANGLES.find(angle => !used.includes(angle)) ?? 'unfinished_words'
  );
}

function resolveEligibleTaskIds(options: {
  journey: RecognitionJourney;
  observedTaskIds: RecognitionTaskId[];
  userTurnNumber: number;
}): RecognitionTaskId[] {
  const waitingTaskStillOwnsTheQuestionSlot = options.journey.tasks
    .filter(task => task.status === 'proposed')
    .some(
      task =>
        options.userTurnNumber - (task.lastProposedUserTurn ?? 0) <=
        SECOND_MILESTONE_GAP_TURNS
    );
  if (waitingTaskStillOwnsTheQuestionSlot) return [];

  return options.journey.tasks
    .filter(task => task.status === 'pending')
    .filter(task => !options.observedTaskIds.includes(task.id))
    .filter(task => (task.proposalCount ?? 0) < 1)
    .map(task => task.id);
}

function canSuggestRecognitionTask(
  journey: RecognitionJourney,
  userTurnNumber: number
): boolean {
  if (
    ![
      'opening_attempted',
      'emotionally_opened',
      'user_received',
      'settled_success',
    ].includes(journey.opening.status)
  ) {
    return false;
  }
  return journey.tasks.some(
    task =>
      task.status === 'pending' &&
      (task.lastSuggestedUserTurn === undefined ||
        userTurnNumber > task.lastSuggestedUserTurn)
  );
}

function chooseRecognitionTaskId(options: {
  journey: RecognitionJourney;
  eligibleTaskIds: RecognitionTaskId[];
  query: string;
}): RecognitionTaskId {
  const eligible = new Set(options.eligibleTaskIds);
  const familyAssociated =
    eligible.has('family_status') &&
    /(?:家里|家人|大家|他们|她们|爸爸|妈妈|爸妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|儿子|女儿|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹)/u.test(
      options.query
    );
  const departureAssociated =
    eligible.has('departure_interval') &&
    /(?:离开|走了|去世|过世|离世|多久|几年|时间|那年|哪年)/u.test(
      options.query
    );
  if (familyAssociated && !departureAssociated) return 'family_status';
  if (departureAssociated && !familyAssociated) return 'departure_interval';

  return options.journey.tasks
    .filter(task => eligible.has(task.id))
    .sort(
      (left, right) =>
        (right.suggestionMissCount ?? 0) - (left.suggestionMissCount ?? 0) ||
        (left.lastSuggestedUserTurn ?? -1) -
          (right.lastSuggestedUserTurn ?? -1) ||
        (left.id === 'departure_interval' ? -1 : 1)
    )[0].id;
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

function buildTaskSuggestionPrompt(
  taskId: RecognitionTaskId,
  includeOpeningFollowup: boolean,
  suggestionMissCount: number
): string {
  const direction =
    taskId === 'family_status'
      ? '家庭近况：从久别后的牵挂出发，自然了解家里其他人现在怎么样；不点名未知成员，不猜测生死、健康或关系状态。'
      : '离世时间差：从离开后时间模糊的感受出发，自然了解角色离开人世到现在过了多久；不要问成普通的“多久没见”，也不要改问用户年龄，不预设具体年数。';
  return [
    '# 初次相认旅程：本轮需要实际推进一个信息里程碑',
    ...(includeOpeningFollowup
      ? [
          '此前已经发出久别重逢的开场。先真切承接用户本轮，再让这段关系从重逢自然走向离开后的生活。',
        ]
      : ['相认不只是一句开场，还需要逐渐了解离开后发生了什么。']),
    '这是前20轮内需要推进的明确产品任务。先回应用户当前消息，再自然问一句下面这个方向；系统不规定具体句式，也不要机械追加在正文末尾。',
    `本轮唯一方向：${direction}`,
    '只有用户正在讲重病抢救、刚发生的丧失、激烈冲突、重大现实抉择等明显需要优先承接的处境，或用户明确拒绝这类问题时，才可以延后。普通情绪、寒暄和一般话题不能作为略过理由。',
    ...(suggestionMissCount >= 2
      ? [
          '这个里程碑此前已连续两次没有实际问出，本轮提高优先级：除上述重大处境或明确拒绝外，回应当前消息后要真正自然问出。',
        ]
      : []),
    '只问这一个方向，不照抄说明，不像登记资料，不规定篇幅。用户本轮已经提供答案时直接接住，不重复询问。',
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
    if (task.status === 'pending') {
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
    const hasAskedTaskWaiting = journey.tasks.some(
      task => task.status === 'proposed'
    );
    journey.stage = hasAskedTaskWaiting ? 'active' : 'settled';
    if (hasAskedTaskWaiting) delete journey.settledAt;
    else journey.settledAt ??= now;
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
    taskSuggestionAttemptCount: numberValue(raw.taskSuggestionAttemptCount),
    lastTaskSuggestionAttemptUserTurn: numberValue(
      raw.lastTaskSuggestionAttemptUserTurn
    ),
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
      suggestionMissCount: 0,
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
    suggestionMissCount: numberValue(raw.suggestionMissCount),
    lastSuggestedUserTurn: numberValue(raw.lastSuggestedUserTurn),
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
