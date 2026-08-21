import { createHash } from 'crypto';

export const RELATIONSHIP_OPEN_LOOP_VERSION =
  'relationship_open_loop_v2' as const;
export const RELATIONSHIP_OPEN_LOOP_MESSAGE_PREFIX =
  '__TZL_RELATIONSHIP_OPEN_LOOP_V2__:';

export type RelationshipOpenLoopContentDomain =
  | 'health'
  | 'care_arrangement'
  | 'child_or_education'
  | 'property_or_legal'
  | 'relationship_conflict'
  | 'funeral_or_memorial'
  | 'future_event'
  | 'other';

export type RelationshipOpenLoopState =
  | 'reported'
  | 'decision_pending'
  | 'action_committed'
  | 'awaiting_result'
  | 'scheduled_checkpoint'
  | 'dormant'
  | 'resolved'
  | 'dismissed'
  | 'superseded';

export type RelationshipOpenLoopAuthorityType =
  | 'fact_verification'
  | 'ordinary_practical'
  | 'personal_symbolic'
  | 'family_joint'
  | 'professional_high_stakes'
  | 'relationship_or_moral'
  | 'immediate_safety';

export type RelationshipOpenLoopRelation =
  | 'checkpoint'
  | 'commitment'
  | 'sub_decision'
  | 'dependency';

export interface RelationshipOpenLoopDraft {
  summary: string;
  subject: string;
  contentDomain: RelationshipOpenLoopContentDomain;
  authorityType: RelationshipOpenLoopAuthorityType;
  state: RelationshipOpenLoopState;
  importance: 1 | 2 | 3;
  dueAt?: Date;
  expiresAt?: Date;
  userCommitment?: string;
  unresolvedFacts?: string[];
  relation?: RelationshipOpenLoopRelation;
}

export interface RelationshipOpenLoopTask {
  id: string;
  semanticKey: string;
  rootId: string;
  parentId?: string;
  relation?: RelationshipOpenLoopRelation;
  summary: string;
  subject: string;
  contentDomain: RelationshipOpenLoopContentDomain;
  authorityType: RelationshipOpenLoopAuthorityType;
  state: RelationshipOpenLoopState;
  importance: 1 | 2 | 3;
  unresolvedFacts?: string[];
  userCommitment?: string;
  dueAt?: Date;
  nextEligibleAt?: Date;
  expiresAt?: Date;
  sourceMessageIds: string[];
  sourceOccurredAt: Date;
  latestSourceOccurredAt: Date;
  lastPresentedAt?: Date;
  lastMentionedAt?: Date;
  lastNotObservedAt?: Date;
  lastObservationUnknownAt?: Date;
  presentedCount: number;
  mentionedCount: number;
  proactiveSuppressedUntil?: Date;
  proactiveDisabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelationshipOpenLoopStore {
  version: typeof RELATIONSHIP_OPEN_LOOP_VERSION;
  tasks: RelationshipOpenLoopTask[];
  legacyContinuityMigratedAt?: Date;
  updatedAt: Date;
}

export interface RelationshipOpenLoopUpsertResult {
  store: RelationshipOpenLoopStore;
  action: 'created_root' | 'created_child' | 'updated' | 'noop';
  task?: RelationshipOpenLoopTask;
}

export interface RelationshipOpenLoopSelection {
  task: RelationshipOpenLoopTask;
  reason: 'current_association' | 'event_due' | 'return_priority';
  candidateCount: number;
}

export interface RelationshipOpenLoopSelectionOptions {
  store: RelationshipOpenLoopStore;
  currentQuery: string;
  currentTurnMessageIds: string[];
  recentVisibleMessageIds?: string[];
  isReturnTurn: boolean;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESENTATION_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const PROACTIVE_MENTION_COOLDOWN_MS = 3 * DAY_MS;
const DORMANT_SUPPRESSION_MS = 3 * DAY_MS;
const RECENT_PRESENTATION_REFERENCE_MS = DAY_MS;
const MAX_ACTIVE_TASKS = 24;
const MAX_INACTIVE_TASKS = 16;

const ACTIVE_STATES = new Set<RelationshipOpenLoopState>([
  'reported',
  'decision_pending',
  'action_committed',
  'awaiting_result',
  'scheduled_checkpoint',
  'dormant',
]);

export function buildEmptyRelationshipOpenLoopStore(
  now = new Date()
): RelationshipOpenLoopStore {
  return {
    version: RELATIONSHIP_OPEN_LOOP_VERSION,
    tasks: [],
    updatedAt: now,
  };
}

export function serializeRelationshipOpenLoopStore(
  store: RelationshipOpenLoopStore
): string {
  return `${RELATIONSHIP_OPEN_LOOP_MESSAGE_PREFIX}${JSON.stringify(
    compactRelationshipOpenLoopStore(store)
  )}`;
}

export function parseRelationshipOpenLoopStore(
  content: string | undefined
): RelationshipOpenLoopStore | undefined {
  if (!content?.startsWith(RELATIONSHIP_OPEN_LOOP_MESSAGE_PREFIX)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(
      content.slice(RELATIONSHIP_OPEN_LOOP_MESSAGE_PREFIX.length)
    ) as Record<string, unknown>;
    if (
      raw.version !== RELATIONSHIP_OPEN_LOOP_VERSION ||
      !Array.isArray(raw.tasks)
    ) {
      return undefined;
    }
    return {
      version: RELATIONSHIP_OPEN_LOOP_VERSION,
      tasks: raw.tasks
        .map(parseRelationshipOpenLoopTask)
        .filter((task): task is RelationshipOpenLoopTask => Boolean(task)),
      ...(parseDate(raw.legacyContinuityMigratedAt)
        ? {
            legacyContinuityMigratedAt: parseDate(
              raw.legacyContinuityMigratedAt
            ),
          }
        : {}),
      updatedAt: parseDate(raw.updatedAt) ?? new Date(0),
    };
  } catch {
    return undefined;
  }
}

export function upsertRelationshipOpenLoopDraft(options: {
  store: RelationshipOpenLoopStore;
  draft: RelationshipOpenLoopDraft;
  sourceMessageId: string;
  sourceOccurredAt: Date;
  now?: Date;
}): RelationshipOpenLoopUpsertResult {
  const now = options.now ?? new Date();
  const summary = normalizeText(options.draft.summary, 140);
  const subject = normalizeText(options.draft.subject, 32);
  if (!summary || !subject || !options.sourceMessageId) {
    return { store: options.store, action: 'noop' };
  }
  const tasks = options.store.tasks.map(task => ({ ...task }));
  const sourceOccurredAt = normalizeDate(options.sourceOccurredAt) ?? now;
  const root = findMatchingRoot(tasks, options.draft);
  const shouldCreateChild = Boolean(
    root &&
      options.draft.relation &&
      (options.draft.dueAt ||
        options.draft.state === 'action_committed' ||
        options.draft.state === 'awaiting_result' ||
        options.draft.state === 'scheduled_checkpoint')
  );

  if (root && !shouldCreateChild) {
    const updated = mergeTask(root, options.draft, {
      summary,
      sourceMessageId: options.sourceMessageId,
      sourceOccurredAt,
      now,
    });
    const index = tasks.findIndex(task => task.id === root.id);
    tasks[index] = updated;
    return {
      store: compactRelationshipOpenLoopStore({
        version: RELATIONSHIP_OPEN_LOOP_VERSION,
        tasks,
        updatedAt: now,
      }),
      action: 'updated',
      task: updated,
    };
  }

  const semanticKey = buildSemanticKey({
    draft: options.draft,
    subject,
    rootId: root?.id,
  });
  const duplicate = tasks.find(
    task => task.semanticKey === semanticKey && ACTIVE_STATES.has(task.state)
  );
  if (duplicate) {
    const updated = mergeTask(duplicate, options.draft, {
      summary,
      sourceMessageId: options.sourceMessageId,
      sourceOccurredAt,
      now,
    });
    const index = tasks.findIndex(task => task.id === duplicate.id);
    tasks[index] = updated;
    return {
      store: compactRelationshipOpenLoopStore({
        version: RELATIONSHIP_OPEN_LOOP_VERSION,
        tasks,
        updatedAt: now,
      }),
      action: 'updated',
      task: updated,
    };
  }

  const seed = [
    semanticKey,
    options.sourceMessageId,
    String(options.draft.relation || 'root'),
  ].join('|');
  const id = `rol_${createHash('sha1')
    .update(seed)
    .digest('hex')
    .slice(0, 16)}`;
  const task: RelationshipOpenLoopTask = {
    id,
    semanticKey,
    rootId: root?.id || id,
    ...(root ? { parentId: root.id } : {}),
    ...(options.draft.relation ? { relation: options.draft.relation } : {}),
    summary,
    subject,
    contentDomain: options.draft.contentDomain,
    authorityType: options.draft.authorityType,
    state: options.draft.state,
    importance: normalizeImportance(options.draft.importance),
    ...(normalizeTextList(options.draft.unresolvedFacts).length
      ? { unresolvedFacts: normalizeTextList(options.draft.unresolvedFacts) }
      : {}),
    ...(normalizeText(options.draft.userCommitment, 100)
      ? { userCommitment: normalizeText(options.draft.userCommitment, 100) }
      : {}),
    ...(normalizeDate(options.draft.dueAt)
      ? { dueAt: normalizeDate(options.draft.dueAt) }
      : {}),
    nextEligibleAt: now,
    ...(normalizeDate(options.draft.expiresAt)
      ? { expiresAt: normalizeDate(options.draft.expiresAt) }
      : {}),
    sourceMessageIds: [options.sourceMessageId],
    sourceOccurredAt,
    latestSourceOccurredAt: sourceOccurredAt,
    presentedCount: 0,
    mentionedCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  return {
    store: compactRelationshipOpenLoopStore({
      version: RELATIONSHIP_OPEN_LOOP_VERSION,
      tasks,
      updatedAt: now,
    }),
    action: root ? 'created_child' : 'created_root',
    task,
  };
}

export function resolveRelationshipOpenLoopFromUserText(options: {
  store: RelationshipOpenLoopStore;
  text: string;
  sourceMessageId: string;
  occurredAt?: Date;
  now?: Date;
}): RelationshipOpenLoopUpsertResult {
  const now = options.now ?? new Date();
  const text = normalizeText(options.text, 500);
  const command = resolveLifecycleCommand(text);
  if (!command) return { store: options.store, action: 'noop' };
  const candidates = options.store.tasks
    .filter(task => ACTIVE_STATES.has(task.state))
    .map(task => ({
      task,
      association: resolveAssociation(text, task),
      recentlyPresented: Boolean(
        task.lastPresentedAt &&
          now.getTime() - task.lastPresentedAt.getTime() <=
            RECENT_PRESENTATION_REFERENCE_MS
      ),
    }))
    .filter(
      item =>
        item.association.score > 0 ||
        command.allowMostRecent ||
        (command.allowRecentlyPresented && item.recentlyPresented)
    )
    .sort(
      (left, right) =>
        right.association.score - left.association.score ||
        right.task.updatedAt.getTime() - left.task.updatedAt.getTime()
    );
  let selected = candidates[0]?.task;
  if (selected && command.state === 'resolved') {
    const topScore = candidates[0].association.score;
    const tiedRootIds = new Set(
      candidates
        .filter(item => item.association.score === topScore)
        .map(item => item.task.rootId)
    );
    if (tiedRootIds.size > 1) {
      const recentlyPresentedRootIds = Array.from(
        new Set(
          candidates
            .filter(item => item.recentlyPresented)
            .map(item => item.task.rootId)
        )
      );
      if (recentlyPresentedRootIds.length !== 1) {
        selected = undefined;
      } else {
        selected = candidates.find(
          item => item.task.rootId === recentlyPresentedRootIds[0]
        )?.task;
      }
    }
  }
  if (!selected) return { store: options.store, action: 'noop' };
  const nextState = command.state;
  const updated: RelationshipOpenLoopTask = {
    ...selected,
    state: nextState,
    sourceMessageIds: appendUnique(
      selected.sourceMessageIds,
      options.sourceMessageId
    ),
    latestSourceOccurredAt:
      normalizeDate(options.occurredAt) ?? selected.latestSourceOccurredAt,
    ...(nextState === 'dismissed' ? { proactiveDisabled: true } : {}),
    ...(nextState === 'dormant'
      ? {
          proactiveSuppressedUntil: new Date(
            now.getTime() + DORMANT_SUPPRESSION_MS
          ),
        }
      : {}),
    updatedAt: now,
  };
  const cascadeToRoot = command.cascadeRoot || selected.id === selected.rootId;
  const tasks = options.store.tasks.map(task => {
    if (task.id === selected.id) return updated;
    if (!cascadeToRoot || task.rootId !== selected.rootId) return { ...task };
    return {
      ...task,
      state: nextState,
      ...(nextState === 'dismissed' ? { proactiveDisabled: true } : {}),
      ...(nextState === 'dormant'
        ? {
            proactiveSuppressedUntil: new Date(
              now.getTime() + DORMANT_SUPPRESSION_MS
            ),
          }
        : {}),
      updatedAt: now,
    };
  });
  return {
    store: compactRelationshipOpenLoopStore({
      version: RELATIONSHIP_OPEN_LOOP_VERSION,
      tasks,
      updatedAt: now,
    }),
    action: 'updated',
    task: updated,
  };
}

export function reconcileRelationshipOpenLoopContextualUpdate(options: {
  store: RelationshipOpenLoopStore;
  text: string;
  sourceMessageId: string;
  occurredAt?: Date;
  now?: Date;
}): RelationshipOpenLoopUpsertResult {
  const now = options.now ?? new Date();
  const text = normalizeText(options.text, 200);
  if (!/(?:挺严重|很严重|比较严重|病危|进了?ICU|要手术|需要手术)/u.test(text)) {
    return { store: options.store, action: 'noop' };
  }
  const recentHealthTasks = options.store.tasks
    .filter(task => ACTIVE_STATES.has(task.state))
    .filter(task => task.contentDomain === 'health')
    .filter(task => now.getTime() - task.updatedAt.getTime() <= DAY_MS)
    .sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
    );
  if (recentHealthTasks.length !== 1) {
    return { store: options.store, action: 'noop' };
  }
  const selected = recentHealthTasks[0];
  const updated: RelationshipOpenLoopTask = {
    ...selected,
    summary: `${selected.summary}；用户后续说明情况严重`.slice(0, 140),
    importance: 3,
    state: 'reported',
    expiresAt: undefined,
    sourceMessageIds: appendUnique(
      selected.sourceMessageIds,
      options.sourceMessageId
    ),
    latestSourceOccurredAt:
      normalizeDate(options.occurredAt) ?? selected.latestSourceOccurredAt,
    updatedAt: now,
  };
  return {
    store: compactRelationshipOpenLoopStore({
      ...options.store,
      tasks: options.store.tasks.map(task =>
        task.id === selected.id ? updated : { ...task }
      ),
      updatedAt: now,
    }),
    action: 'updated',
    task: updated,
  };
}

export function selectRelationshipOpenLoop(
  options: RelationshipOpenLoopSelectionOptions
): RelationshipOpenLoopSelection | undefined {
  const now = options.now ?? new Date();
  const query = normalizeText(options.currentQuery, 600);
  const currentIds = new Set(options.currentTurnMessageIds);
  const recentVisibleIds = new Set(options.recentVisibleMessageIds || []);
  const candidates = options.store.tasks
    .filter(task => ACTIVE_STATES.has(task.state))
    .filter(task => !task.proactiveDisabled)
    .filter(task => !task.expiresAt || task.expiresAt.getTime() > now.getTime())
    .filter(
      task =>
        !task.nextEligibleAt || task.nextEligibleAt.getTime() <= now.getTime()
    )
    .filter(
      task =>
        !task.proactiveSuppressedUntil ||
        task.proactiveSuppressedUntil.getTime() <= now.getTime()
    )
    .filter(task => !task.sourceMessageIds.every(id => currentIds.has(id)))
    .map(task => {
      const association = resolveAssociation(query, task);
      const sourceVisibleInRawContext = task.sourceMessageIds.some(id =>
        recentVisibleIds.has(id)
      );
      const eventDue = Boolean(
        task.dueAt &&
          task.dueAt.getTime() <= now.getTime() + DAY_MS &&
          task.dueAt.getTime() >= now.getTime() - 7 * DAY_MS
      );
      const recentlyPresented = Boolean(
        task.lastPresentedAt &&
          now.getTime() - task.lastPresentedAt.getTime() <
            PRESENTATION_COOLDOWN_MS
      );
      const recentlyMentioned = Boolean(
        task.lastMentionedAt &&
          now.getTime() - task.lastMentionedAt.getTime() <
            PROACTIVE_MENTION_COOLDOWN_MS
      );
      const returnEligible =
        options.isReturnTurn &&
        task.importance >= 2 &&
        !recentlyMentioned &&
        (!task.dueAt || task.dueAt.getTime() <= now.getTime() + DAY_MS);
      const reason: RelationshipOpenLoopSelection['reason'] | undefined =
        eventDue && !recentlyPresented && !recentlyMentioned
          ? 'event_due'
          : association.strong &&
            !sourceVisibleInRawContext &&
            !recentlyPresented
          ? 'current_association'
          : returnEligible && !recentlyPresented
          ? 'return_priority'
          : undefined;
      return {
        task,
        association,
        eventDue,
        reason,
        score:
          task.importance * 10 +
          association.score * 5 +
          (eventDue ? 4 : 0) +
          (returnEligible ? 2 : 0) -
          Math.min(task.presentedCount, 5),
      };
    })
    .filter(item => Boolean(item.reason))
    .sort((left, right) => right.score - left.score);
  const selected = candidates[0];
  return selected?.reason
    ? {
        task: selected.task,
        reason: selected.reason,
        candidateCount: candidates.length,
      }
    : undefined;
}

export function markRelationshipOpenLoopPresented(
  store: RelationshipOpenLoopStore,
  taskId: string,
  now = new Date()
): RelationshipOpenLoopStore {
  return {
    ...store,
    tasks: store.tasks.map(task =>
      task.id === taskId
        ? {
            ...task,
            lastPresentedAt: now,
            presentedCount: task.presentedCount + 1,
            nextEligibleAt: new Date(now.getTime() + PRESENTATION_COOLDOWN_MS),
            updatedAt: now,
          }
        : { ...task }
    ),
    updatedAt: now,
  };
}

export function markRelationshipOpenLoopFinalObservation(options: {
  store: RelationshipOpenLoopStore;
  taskId: string;
  assistantText: string;
  now?: Date;
}): {
  store: RelationshipOpenLoopStore;
  observed: boolean;
  confidence: 'high' | 'unknown' | 'none';
} {
  const now = options.now ?? new Date();
  const task = options.store.tasks.find(item => item.id === options.taskId);
  if (!task) {
    return { store: options.store, observed: false, confidence: 'none' };
  }
  const assistantText = normalizeText(options.assistantText, 1200);
  const observed = assistantTextReferencesTask(assistantText, task);
  const confidence = observed ? 'high' : assistantText ? 'unknown' : 'none';
  return {
    store: {
      ...options.store,
      tasks: options.store.tasks.map(item =>
        item.id === task.id
          ? {
              ...item,
              ...(observed
                ? {
                    lastPresentedAt: now,
                    presentedCount: item.presentedCount + 1,
                    nextEligibleAt: new Date(
                      now.getTime() + PRESENTATION_COOLDOWN_MS
                    ),
                    lastMentionedAt: now,
                    mentionedCount: item.mentionedCount + 1,
                  }
                : confidence === 'unknown'
                ? { lastObservationUnknownAt: now }
                : { lastNotObservedAt: now }),
              updatedAt: now,
            }
          : { ...item }
      ),
      updatedAt: now,
    },
    observed,
    confidence,
  };
}

export function buildRelationshipOpenLoopPrompt(
  task: RelationshipOpenLoopTask,
  reason: RelationshipOpenLoopSelection['reason'],
  now = new Date()
): string {
  const lines = [
    '# 关系连续性事项（非回复计划）',
    `用户${describeRelativeTime(task.latestSourceOccurredAt, now)}说过：${
      task.summary
    }`,
    `当前记录状态：${describeTaskState(task.state)}。`,
  ];
  if (task.dueAt) {
    lines.push(`相关时间：${describeDueTime(task.dueAt, now)}。`);
  }
  lines.push(`权责边界：${describeAuthorityBoundary(task.authorityType)}`);
  lines.push(`本轮提供原因：${describeSelectionReason(reason)}。`);
  lines.push(
    reason === 'current_association'
      ? '当前消息与这件事存在明确关联，请把它作为理解背景；如何回应、是否追问和怎样展开由你结合完整上下文决定。不要把旧状态说成现在仍然如此。'
      : '这是本轮较高优先级的关系连续性信息。除非当前消息有更紧急的内容或明显不适合提起，否则应自然关心一次；不规定具体问法、建议、展开或收尾，也不要把旧状态说成现在仍然如此。'
  );
  return lines.join('\n');
}

export function expireRelationshipOpenLoops(
  store: RelationshipOpenLoopStore,
  now = new Date()
): RelationshipOpenLoopStore {
  let changed = false;
  const tasks = store.tasks.map(task => {
    if (
      ACTIVE_STATES.has(task.state) &&
      task.expiresAt &&
      task.expiresAt.getTime() <= now.getTime()
    ) {
      changed = true;
      return { ...task, state: 'superseded' as const, updatedAt: now };
    }
    return { ...task };
  });
  return changed ? { ...store, tasks, updatedAt: now } : { ...store, tasks };
}

function findMatchingRoot(
  tasks: RelationshipOpenLoopTask[],
  draft: RelationshipOpenLoopDraft
): RelationshipOpenLoopTask | undefined {
  return tasks
    .filter(task => task.id === task.rootId)
    .filter(task => ACTIVE_STATES.has(task.state))
    .filter(task => task.contentDomain === draft.contentDomain)
    .filter(task => subjectsMatch(task.subject, draft.subject))
    .filter(task => rootTopicsCompatible(task, draft))
    .sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
    )[0];
}

function rootTopicsCompatible(
  task: RelationshipOpenLoopTask,
  draft: RelationshipOpenLoopDraft
): boolean {
  if (
    draft.contentDomain === 'future_event' ||
    draft.contentDomain === 'other'
  ) {
    return false;
  }
  const taskAnchors = new Set(
    extractDomainAnchors(task.summary, task.contentDomain)
  );
  const draftAnchors = extractDomainAnchors(draft.summary, draft.contentDomain);
  if (draftAnchors.some(anchor => taskAnchors.has(anchor))) return true;

  if (draft.contentDomain === 'health') {
    const taskConditions = extractHealthConditionAnchors(task.summary);
    const draftConditions = extractHealthConditionAnchors(draft.summary);
    if (
      taskConditions.length &&
      draftConditions.length &&
      !draftConditions.some(anchor => taskConditions.includes(anchor))
    ) {
      return false;
    }
    const trajectory = /住院|手术|复查|检查|治疗|病情/u;
    return trajectory.test(task.summary) && trajectory.test(draft.summary);
  }

  // Funeral, care, property and relationship tasks can contain several
  // independent events for one person. Without a shared event anchor, keeping
  // separate roots is safer than silently merging histories.
  return false;
}

function extractHealthConditionAnchors(text: string): string[] {
  return Array.from(
    new Set(
      text.match(
        /发烧|感冒|骨折|摔伤|车祸|癌症|肿瘤|中风|脑梗|心梗|肺炎|糖尿病|高血压|胃病|肝病|肾病|失眠|抑郁/gu
      ) || []
    )
  );
}

function extractDomainAnchors(
  text: string,
  domain: RelationshipOpenLoopContentDomain
): string[] {
  const patterns: Record<RelationshipOpenLoopContentDomain, RegExp> = {
    health: /住院|手术|复查|检查|治疗|病情|发烧|感冒|不舒服/gu,
    care_arrangement: /照顾|照料|陪护|看护|养老/gu,
    child_or_education: /转学|上学|学校|幼儿园|接送|监护|照顾/gu,
    property_or_legal: /房子|房产|遗产|财产|存款|存折|过户|卖房|官司|法院/gu,
    relationship_conflict: /离婚|分居|复婚|家暴|道歉|断绝关系/gu,
    funeral_or_memorial: /安葬|下葬|迁坟|墓地|骨灰|五七|百日|周年|祭扫/gu,
    future_event: /考试|面试|出差|旅行|回家|搬家|开学|毕业|结果|通知/gu,
    other: /事情|安排|结果/gu,
  };
  return Array.from(new Set(text.match(patterns[domain]) || []));
}

function mergeTask(
  task: RelationshipOpenLoopTask,
  draft: RelationshipOpenLoopDraft,
  update: {
    summary: string;
    sourceMessageId: string;
    sourceOccurredAt: Date;
    now: Date;
  }
): RelationshipOpenLoopTask {
  const nextState =
    task.state === 'dismissed' || task.state === 'resolved'
      ? task.state
      : draft.state;
  const unresolvedFacts = Array.from(
    new Set(
      (task.unresolvedFacts || []).concat(
        normalizeTextList(draft.unresolvedFacts)
      )
    )
  ).slice(0, 6);
  const draftExpiresAt = normalizeDate(draft.expiresAt);
  const clearExpiryForSeriousHealth =
    draft.contentDomain === 'health' && draft.importance >= 3;
  return {
    ...task,
    summary: update.summary,
    state: nextState,
    importance: Math.max(task.importance, draft.importance) as 1 | 2 | 3,
    authorityType: draft.authorityType,
    ...(unresolvedFacts.length ? { unresolvedFacts } : {}),
    ...(normalizeText(draft.userCommitment, 100)
      ? { userCommitment: normalizeText(draft.userCommitment, 100) }
      : {}),
    ...(normalizeDate(draft.dueAt)
      ? { dueAt: normalizeDate(draft.dueAt) }
      : {}),
    ...(draftExpiresAt
      ? { expiresAt: draftExpiresAt }
      : clearExpiryForSeriousHealth
      ? { expiresAt: undefined }
      : {}),
    sourceMessageIds: appendUnique(
      task.sourceMessageIds,
      update.sourceMessageId
    ),
    latestSourceOccurredAt: update.sourceOccurredAt,
    updatedAt: update.now,
  };
}

function buildSemanticKey(options: {
  draft: RelationshipOpenLoopDraft;
  subject: string;
  rootId?: string;
}): string {
  const dueDay = options.draft.dueAt
    ? normalizeDate(options.draft.dueAt)?.toISOString().slice(0, 10) || ''
    : '';
  const seed = [
    options.rootId || 'root',
    options.draft.contentDomain,
    normalizeComparableSubject(options.subject),
    buildTaskEventFingerprint(options.draft),
    options.draft.relation || 'root',
    options.draft.state,
    dueDay,
    normalizeText(options.draft.userCommitment, 48),
  ].join('|');
  return createHash('sha1').update(seed).digest('hex').slice(0, 20);
}

function buildTaskEventFingerprint(draft: RelationshipOpenLoopDraft): string {
  const anchors = Array.from(
    new Set(
      extractDomainAnchors(draft.summary, draft.contentDomain).concat(
        draft.contentDomain === 'health'
          ? extractHealthConditionAnchors(draft.summary)
          : []
      )
    )
  ).sort();
  return anchors.length ? anchors.join(',') : normalizeText(draft.summary, 64);
}

function resolveLifecycleCommand(text: string):
  | {
      state: 'resolved' | 'dismissed' | 'dormant';
      allowMostRecent: boolean;
      allowRecentlyPresented: boolean;
      cascadeRoot: boolean;
    }
  | undefined {
  if (
    /(?:这件事|这个事情|这事|以后)?(?:不要|别)(?:再)?(?:问|提|说|聊)(?:了|这件事|这个)?|不想再聊/u.test(
      text
    )
  ) {
    return {
      state: 'dismissed',
      // A bare stop command may only bind to an item the assistant actually
      // mentioned recently; never guess from the latest stored task.
      allowMostRecent: false,
      allowRecentlyPresented: true,
      cascadeRoot: true,
    };
  }
  if (/(?:改天|以后|过段时间|回头)(?:再)?(?:说|聊)|现在不想说/u.test(text)) {
    return {
      state: 'dormant',
      allowMostRecent: false,
      allowRecentlyPresented: true,
      cascadeRoot: true,
    };
  }
  if (
    /(?:已经|后来|现在)?(?:解决了|定下来了|办好了|商量好了|结束了|出院了|康复了|恢复了|好起来了|好多了|结果出来了|结果出了|没事了)(?=[，,。！!；;\s]|$)/u.test(
      text
    )
  ) {
    return {
      state: 'resolved',
      allowMostRecent: false,
      allowRecentlyPresented: true,
      cascadeRoot:
        /(?:解决了|定下来了|办好了|商量好了|结束了|出院了|康复了|恢复了|好起来了|好多了|没事了)/u.test(
          text
        ),
    };
  }
  return undefined;
}

function resolveAssociation(
  query: string,
  task: RelationshipOpenLoopTask
): { score: number; strong: boolean } {
  if (!query) return { score: 0, strong: false };
  const subjectMatched = subjectsMatch(query, task.subject);
  let score = subjectMatched ? 2 : 0;
  const keywords = extractKeywords(task.summary);
  const keywordHits = Math.min(
    2,
    keywords.filter(keyword => query.includes(keyword)).length
  );
  score += keywordHits;
  const domainMatched = domainPattern(task.contentDomain).test(query);
  if (domainMatched) score += 1;
  return {
    score,
    strong:
      keywordHits >= 1 ||
      (subjectMatched && domainMatched) ||
      (!subjectMatched && domainMatched && task.importance >= 3),
  };
}

function assistantTextReferencesTask(
  assistantText: string,
  task: RelationshipOpenLoopTask
): boolean {
  const text = normalizeText(assistantText, 1200);
  if (!text) return false;
  const anchors = extractDomainAnchors(task.summary, task.contentDomain);
  if (anchors.some(anchor => text.includes(anchor))) return true;
  return (
    extractKeywords(task.summary).filter(keyword => text.includes(keyword))
      .length >= 2
  );
}

function domainPattern(domain: RelationshipOpenLoopContentDomain): RegExp {
  switch (domain) {
    case 'health':
      return /病|医院|住院|手术|复查|检查|医生|康复|出院/u;
    case 'care_arrangement':
      return /照顾|照料|陪护|看护|谁管|谁陪/u;
    case 'child_or_education':
      return /孩子|上学|转学|学校|幼儿园|接送|监护/u;
    case 'property_or_legal':
      return /房子|财产|遗产|产权|过户|卖房|律师|法院|官司/u;
    case 'relationship_conflict':
      return /离婚|分居|道歉|控制|家暴|吵架|关系/u;
    case 'funeral_or_memorial':
      return /安葬|下葬|葬在|迁坟|墓地|五七|百日|周年|祭扫|上坟/u;
    case 'future_event':
      return /明天|后天|下周|到时候|结果|通知/u;
    default:
      return /事情|问题|安排|结果/u;
  }
}

function subjectsMatch(left: string, right: string): boolean {
  const leftComparable = normalizeComparableSubject(left);
  const rightComparable = normalizeComparableSubject(right);
  if (!leftComparable || !rightComparable) return false;
  if (
    leftComparable.includes(rightComparable) ||
    rightComparable.includes(leftComparable)
  ) {
    return true;
  }
  const aliases: RegExp[] = [
    /父亲|爸爸|爸/u,
    /母亲|妈妈|妈/u,
    /丈夫|老公/u,
    /妻子|老婆/u,
    /儿子|孩子/u,
    /女儿|孩子/u,
    /爷爷|祖父/u,
    /奶奶|祖母/u,
  ];
  return aliases.some(
    pattern => pattern.test(leftComparable) && pattern.test(rightComparable)
  );
}

function normalizeComparableSubject(value: string): string {
  return normalizeText(value, 40).replace(/^用户的?/u, '');
}

function extractKeywords(value: string): string[] {
  const excluded = new Set([
    '用户',
    '事情',
    '现在',
    '最近',
    '已经',
    '还是',
    '怎么办',
  ]);
  return Array.from(
    new Set(
      normalizeText(value, 160)
        .split(/[，。！？、；：,.!?;:\s]/u)
        .reduce<string[]>(
          (items, part) =>
            items.concat(part.match(/[\p{Script=Han}]{2,6}/gu) || []),
          []
        )
        .filter(item => item.length >= 2 && !excluded.has(item))
    )
  ).slice(0, 10);
}

function compactRelationshipOpenLoopStore(
  store: RelationshipOpenLoopStore
): RelationshipOpenLoopStore {
  const activeRanked = store.tasks
    .filter(task => ACTIVE_STATES.has(task.state))
    .sort(
      (left, right) =>
        Number(right.importance === 3) - Number(left.importance === 3) ||
        Number(Boolean(right.dueAt)) - Number(Boolean(left.dueAt)) ||
        right.importance - left.importance ||
        right.updatedAt.getTime() - left.updatedAt.getTime()
    );
  const active = activeRanked.slice(0, MAX_ACTIVE_TASKS);
  const overflow: RelationshipOpenLoopTask[] = activeRanked
    .slice(MAX_ACTIVE_TASKS)
    .map(task => ({
      ...task,
      state: 'superseded',
      proactiveDisabled: true,
      updatedAt: store.updatedAt,
    }));
  const inactive = overflow
    .concat(store.tasks.filter(task => !ACTIVE_STATES.has(task.state)))
    .filter(task => !ACTIVE_STATES.has(task.state))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, MAX_INACTIVE_TASKS);
  return {
    version: RELATIONSHIP_OPEN_LOOP_VERSION,
    tasks: active.concat(inactive),
    ...(store.legacyContinuityMigratedAt
      ? { legacyContinuityMigratedAt: store.legacyContinuityMigratedAt }
      : {}),
    updatedAt: store.updatedAt,
  };
}

function parseRelationshipOpenLoopTask(
  value: unknown
): RelationshipOpenLoopTask | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const sourceOccurredAt = parseDate(raw.sourceOccurredAt);
  const latestSourceOccurredAt = parseDate(raw.latestSourceOccurredAt);
  const createdAt = parseDate(raw.createdAt);
  const updatedAt = parseDate(raw.updatedAt);
  if (
    typeof raw.id !== 'string' ||
    typeof raw.semanticKey !== 'string' ||
    typeof raw.rootId !== 'string' ||
    typeof raw.summary !== 'string' ||
    typeof raw.subject !== 'string' ||
    !isContentDomain(raw.contentDomain) ||
    !isAuthorityType(raw.authorityType) ||
    !isState(raw.state) ||
    !Array.isArray(raw.sourceMessageIds) ||
    !sourceOccurredAt ||
    !latestSourceOccurredAt ||
    !createdAt ||
    !updatedAt
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    semanticKey: raw.semanticKey,
    rootId: raw.rootId,
    ...(typeof raw.parentId === 'string' ? { parentId: raw.parentId } : {}),
    ...(isRelation(raw.relation) ? { relation: raw.relation } : {}),
    summary: raw.summary,
    subject: raw.subject,
    contentDomain: raw.contentDomain,
    authorityType: raw.authorityType,
    state: raw.state,
    importance: normalizeImportance(raw.importance),
    ...(normalizeTextList(raw.unresolvedFacts).length
      ? { unresolvedFacts: normalizeTextList(raw.unresolvedFacts) }
      : {}),
    ...(typeof raw.userCommitment === 'string'
      ? { userCommitment: raw.userCommitment }
      : {}),
    ...(parseDate(raw.dueAt) ? { dueAt: parseDate(raw.dueAt) } : {}),
    ...(parseDate(raw.nextEligibleAt)
      ? { nextEligibleAt: parseDate(raw.nextEligibleAt) }
      : {}),
    ...(parseDate(raw.expiresAt)
      ? { expiresAt: parseDate(raw.expiresAt) }
      : {}),
    sourceMessageIds: raw.sourceMessageIds
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 24),
    sourceOccurredAt,
    latestSourceOccurredAt,
    ...(parseDate(raw.lastPresentedAt)
      ? { lastPresentedAt: parseDate(raw.lastPresentedAt) }
      : {}),
    ...(parseDate(raw.lastMentionedAt)
      ? { lastMentionedAt: parseDate(raw.lastMentionedAt) }
      : {}),
    ...(parseDate(raw.lastNotObservedAt)
      ? { lastNotObservedAt: parseDate(raw.lastNotObservedAt) }
      : {}),
    ...(parseDate(raw.lastObservationUnknownAt)
      ? { lastObservationUnknownAt: parseDate(raw.lastObservationUnknownAt) }
      : {}),
    presentedCount: normalizeCount(raw.presentedCount),
    mentionedCount: normalizeCount(raw.mentionedCount),
    ...(parseDate(raw.proactiveSuppressedUntil)
      ? { proactiveSuppressedUntil: parseDate(raw.proactiveSuppressedUntil) }
      : {}),
    ...(typeof raw.proactiveDisabled === 'boolean'
      ? { proactiveDisabled: raw.proactiveDisabled }
      : {}),
    createdAt,
    updatedAt,
  };
}

function describeTaskState(state: RelationshipOpenLoopState): string {
  const labels: Record<RelationshipOpenLoopState, string> = {
    reported: '事情仍值得记住，未记录确定结果',
    decision_pending: '现实决定尚未形成',
    action_committed: '用户说过准备采取行动，结果未知',
    awaiting_result: '正在等待现实结果',
    scheduled_checkpoint: '存在用户说过的时间节点',
    dormant: '事情未闭合，但当前应保持克制',
    resolved: '事情已经结束',
    dismissed: '用户不希望再主动提及',
    superseded: '旧状态已被新进展替代',
  };
  return labels[state];
}

function describeAuthorityBoundary(
  authorityType: RelationshipOpenLoopAuthorityType
): string {
  switch (authorityType) {
    case 'fact_verification':
      return '只依据用户原话或可信证据，不把猜测升级成现实事实';
    case 'ordinary_practical':
      return '只作为用户生活连续性信息，不替用户安排普通现实事务';
    case 'personal_symbolic':
      return '可以回应关系意义，不把象征心愿说成现实授权或必然结果';
    case 'family_joint':
      return '可以给亲人立场和有限思路，不替现实家庭共同决策者拍板';
    case 'professional_high_stakes':
      return '可以陪用户梳理，不诊断、不保证结果，也不替医疗、法律或财务专业人员决定';
    case 'relationship_or_moral':
      return '可以表达人物立场，但不确认未知动机，也不取消他人的现实边界';
    case 'immediate_safety':
      return '当前安全优先，不能用以后跟进替代本轮处理';
  }
}

function describeSelectionReason(
  reason: RelationshipOpenLoopSelection['reason']
): string {
  switch (reason) {
    case 'current_association':
      return '当前消息与这件事直接相关';
    case 'event_due':
      return '用户说过的时间节点已经临近或刚刚过去';
    case 'return_priority':
      return '用户再次回来，这是一件仍未闭合的重要事情';
  }
}

function describeRelativeTime(source: Date, now: Date): string {
  const days = Math.floor(
    Math.max(0, now.getTime() - source.getTime()) / DAY_MS
  );
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days <= 6) return `${days}天前`;
  if (days <= 29) return `${Math.floor(days / 7)}周前`;
  return '较早之前';
}

function describeDueTime(dueAt: Date, now: Date): string {
  const dayDiff = Math.round(
    (startOfDay(dueAt).getTime() - startOfDay(now).getTime()) / DAY_MS
  );
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '明天';
  if (dayDiff === -1) return '昨天';
  if (dayDiff > 1) return `${dayDiff}天后`;
  return `${Math.abs(dayDiff)}天前，结果仍未记录`;
}

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function appendUnique(values: string[], value: string): string[] {
  return Array.from(new Set(values.concat(value))).slice(-24);
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(value.map(item => normalizeText(item, 100)).filter(Boolean))
      ).slice(0, 6)
    : [];
}

function normalizeImportance(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  return parsed >= 3 ? 3 : parsed >= 2 ? 2 : 1;
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && value >= 0 ? Math.floor(value) : 0;
}

function normalizeDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseDate(value: unknown): Date | undefined {
  return normalizeDate(value);
}

function isContentDomain(
  value: unknown
): value is RelationshipOpenLoopContentDomain {
  return [
    'health',
    'care_arrangement',
    'child_or_education',
    'property_or_legal',
    'relationship_conflict',
    'funeral_or_memorial',
    'future_event',
    'other',
  ].includes(String(value));
}

function isAuthorityType(
  value: unknown
): value is RelationshipOpenLoopAuthorityType {
  return [
    'fact_verification',
    'ordinary_practical',
    'personal_symbolic',
    'family_joint',
    'professional_high_stakes',
    'relationship_or_moral',
    'immediate_safety',
  ].includes(String(value));
}

function isState(value: unknown): value is RelationshipOpenLoopState {
  return [
    'reported',
    'decision_pending',
    'action_committed',
    'awaiting_result',
    'scheduled_checkpoint',
    'dormant',
    'resolved',
    'dismissed',
    'superseded',
  ].includes(String(value));
}

function isRelation(value: unknown): value is RelationshipOpenLoopRelation {
  return ['checkpoint', 'commitment', 'sub_decision', 'dependency'].includes(
    String(value)
  );
}
