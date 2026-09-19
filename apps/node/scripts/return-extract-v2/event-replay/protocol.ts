/**
 * P02 本地原型：连续事件回放协议（event_replay_v1）的解析与严格校验。
 *
 * 与既有 return-extract-v2 的关系：
 * - 复用同样的原则（只做确定性校验、引文必须逐字出现在声明的消息里、不猜不改源）。
 * - 但不复用 `validate-v2.ts` 的协议：本原型需要"从快照做增量维护"的新操作
 *   （correct / restrict / no_change / unclear）与"背景 / 当前轮意图"分层，
 *   旧协议是"一次性抽取"，字段不自洽。`locateVerbatim` 与旧模块同构，故本地保留一份。
 *
 * 校验不替模型做语义判断：不判断话题是否相同、不按关键词猜关联；只检查
 * 引用消息是否可见、目标事件是否存在、字段是否有效、引文是否逐字来源。
 */
export const REPLAY_SCHEMA = 'event_replay_output_v1';
export const REPLAY_PROTOCOL = 'event_replay_v1';

export type ReplayAction =
  | 'create'
  | 'update'
  | 'correct'
  | 'resolve'
  | 'restrict'
  | 'no_change'
  | 'unclear';
export type ReplayKind =
  | 'open_event'
  | 'meaningful_update'
  | 'calendar'
  | 'background';

export interface ReplayEvidence {
  messageId: string;
  quote: string;
}

export interface ReplayOperation {
  opId: string;
  action: ReplayAction;
  eventId: string | null;
  kind: ReplayKind | null;
  subject: string | null;
  state: string | null;
  details: string[];
  evidence: ReplayEvidence[];
  uncertainty: string | null;
  reason: string;
  /** 模型显式声明"这条新安排继承某个尚未解除的限制"；程序按显式引用执行。 */
  inheritsRestriction: string | null;
  /** restrict 用：限制范围（由模型有据给出，不做关键词泛化）。 */
  restrictionScope: string | null;
  /** 当前轮对话意图（不进持久快照，只进检查点记录）。 */
  currentTurnIntent: string | null;
  /** null 表示按 kind 默认；显式 false 表示不可主动使用。 */
  proactiveAllowed: boolean | null;
  /** 首次看到就已完成的事实，用经过校验的初始状态表达；仅 create 可用。 */
  initialStatus: 'open' | 'completed' | 'fact' | null;
}

export interface ReplayEvent {
  eventId: string;
  kind: ReplayKind;
  subject: string | null;
  state: string;
  status: 'open' | 'completed' | 'fact';
  details: string[];
  evidenceIds: string[];
  evidenceKeys: string[];
  uncertainty: string | null;
  proactiveAllowed: boolean;
  restrictionRefs: string[];
  /** 有效权限 = 声明值 && 未命中任何仍生效的限制。 */
  effectiveProactiveAllowed: boolean;
  /** 只有"开放且未受限"才允许主动追问待完成结果；完成或受限都为 false。 */
  pendingFollowUpAllowed: boolean;
  stateHistory: Array<{ state: string; at?: string; opId?: string }>;
  factAt?: string;
  changeAt?: string;
}

export interface ReplayRestriction {
  restrictionId: string;
  scope: string;
  futureProactiveAllowed: false;
  currentTurnResponseAllowed: true;
  active: boolean;
  evidenceIds: string[];
  reason: string;
  history: Array<{ at?: string; opId?: string; note: string }>;
}

export interface ReplayUnresolved {
  messageIds: string[];
  reason: string;
}

export interface ReplaySnapshot {
  events: ReplayEvent[];
  restrictions: ReplayRestriction[];
  unresolved: ReplayUnresolved[];
}

export interface VisibleMessage {
  messageId: string;
  role: string;
  content: string;
  at?: string;
  index?: number;
}

export interface ReplayParseResult {
  operations: ReplayOperation[];
  unresolved: ReplayUnresolved[];
  rejected: Array<{ opId?: string; reason: string; detail?: string }>;
  rawOperationCount: number;
}

const ACTIONS: ReplayAction[] = [
  'create',
  'update',
  'correct',
  'resolve',
  'restrict',
  'no_change',
  'unclear',
];
const KINDS: ReplayKind[] = [
  'open_event',
  'meaningful_update',
  'calendar',
  'background',
];
const INITIAL_STATUSES = ['open', 'completed', 'fact'];

function normalize(value: string): string {
  return (value || '')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/** 与 validate-v2.ts 的 locateVerbatim 同构：紧凑匹配后再映射回原文切片。 */
export function locateVerbatim(
  content: string,
  quote: string
): string | undefined {
  if (!content || !quote) return undefined;
  if (content.includes(quote)) return quote;
  const target = normalize(quote);
  if (!target) return undefined;
  const chars = Array.from(content);
  const keep: Array<{ char: string; index: number }> = [];
  chars.forEach((char, index) => {
    if (/[\p{Script=Han}\p{L}\p{N}]/u.test(char))
      keep.push({ char: char.toLowerCase(), index });
  });
  const compact = keep.map(item => item.char).join('');
  const start = compact.indexOf(target);
  if (start === -1) return undefined;
  return content.slice(
    keep[start].index,
    keep[keep.length ? start + target.length - 1 : 0].index + 1
  );
}

export function parseReplayOutput(
  rawContent: string,
  visible: VisibleMessage[],
  knownEventIds: string[],
  knownRestrictionIds: string[]
): ReplayParseResult {
  const rejected: ReplayParseResult['rejected'] = [];
  const operations: ReplayOperation[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(
      (rawContent || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/u, '')
    );
  } catch {
    return {
      operations,
      unresolved: [],
      rejected: [{ reason: 'invalid_json' }],
      rawOperationCount: 0,
    };
  }
  // schemaVersion 不匹配（含缺失）：整批拒绝，不执行任何操作。
  if (parsed?.schemaVersion !== REPLAY_SCHEMA) {
    return {
      operations: [],
      unresolved: [],
      rejected: [
        {
          reason: 'schema_version_mismatch',
          detail: String(parsed?.schemaVersion || 'missing'),
        },
      ],
      rawOperationCount: Array.isArray(parsed?.operations)
        ? parsed.operations.length
        : 0,
    };
  }
  const rows = Array.isArray(parsed?.operations) ? parsed.operations : null;
  if (!rows) {
    return {
      operations,
      unresolved: [],
      rejected: [...rejected, { reason: 'missing_operations' }],
      rawOperationCount: 0,
    };
  }

  const byId = new Map(visible.map(message => [message.messageId, message]));
  const knownEvents = new Set(knownEventIds);
  const knownRestrictions = new Set(knownRestrictionIds);
  const seenOpIds = new Set<string>();

  for (const row of rows) {
    const record = (row || {}) as Record<string, any>;
    const opId = String(record.opId || '').trim();
    const action = String(record.action || '').trim() as ReplayAction;
    if (!opId || seenOpIds.has(opId)) {
      rejected.push({ reason: 'missing_or_duplicate_opId', opId });
      continue;
    }
    if (ACTIONS.indexOf(action) === -1) {
      rejected.push({ reason: 'invalid_action', opId });
      continue;
    }
    seenOpIds.add(opId);

    const kindRaw =
      record.kind == null ? null : (String(record.kind).trim() as ReplayKind);
    if (kindRaw !== null && KINDS.indexOf(kindRaw) === -1) {
      rejected.push({ reason: 'invalid_kind', opId });
      continue;
    }
    const eventId =
      record.eventId == null || record.eventId === ''
        ? null
        : String(record.eventId);
    const inheritsRestriction =
      record.inheritsRestriction == null || record.inheritsRestriction === ''
        ? null
        : String(record.inheritsRestriction);
    if (inheritsRestriction && !knownRestrictions.has(inheritsRestriction)) {
      rejected.push({ reason: 'unknown_inherited_restriction', opId });
      continue;
    }

    if (action === 'create') {
      if (eventId) {
        rejected.push({ reason: 'create_must_have_null_eventId', opId });
        continue;
      }
      if (!kindRaw) {
        rejected.push({ reason: 'create_requires_kind', opId });
        continue;
      }
      if (!String(record.state || '').trim()) {
        rejected.push({ reason: 'create_requires_state', opId });
        continue;
      }
      if (
        record.initialStatus != null &&
        INITIAL_STATUSES.indexOf(String(record.initialStatus)) === -1
      ) {
        rejected.push({ reason: 'invalid_initial_status', opId });
        continue;
      }
    } else if (record.initialStatus != null) {
      rejected.push({ reason: 'initial_status_only_for_create', opId });
      continue;
    } else if (action === 'no_change') {
      if (eventId) {
        rejected.push({ reason: 'no_change_must_have_null_eventId', opId });
        continue;
      }
    } else if (action === 'unclear') {
      if (eventId && !knownEvents.has(eventId)) {
        rejected.push({ reason: 'unknown_target_event', opId });
        continue;
      }
    } else {
      if (!eventId || !knownEvents.has(eventId)) {
        rejected.push({ reason: 'unknown_target_event', opId });
        continue;
      }
      if (action === 'restrict' && !String(record.restrictionScope || '').trim()) {
        rejected.push({ reason: 'restrict_requires_scope', opId });
        continue;
      }
    }

    // 证据：create/update/correct/resolve/restrict/unclear 必须有可见证据；
    // no_change 允许无证据（但可带 currentTurnIntent 解释）。
    const needsEvidence = action !== 'no_change';
    const evidenceRows = Array.isArray(record.evidence) ? record.evidence : [];
    if (needsEvidence && !evidenceRows.length) {
      rejected.push({ reason: 'missing_evidence', opId });
      continue;
    }
    const evidence: ReplayEvidence[] = [];
    let evidenceFailed = false;
    let hasUserEvidence = false;
    for (const item of evidenceRows) {
      const messageId = String(item?.messageId || '').trim();
      const quote = String(item?.quote || '').trim();
      const message = byId.get(messageId);
      if (!message) {
        rejected.push({ reason: 'evidence_not_visible', opId });
        evidenceFailed = true;
        break;
      }
      const verbatim = locateVerbatim(message.content, quote);
      if (!verbatim) {
        rejected.push({ reason: 'evidence_source_mismatch', opId });
        evidenceFailed = true;
        break;
      }
      if (message.role === 'user') hasUserEvidence = true;
      evidence.push({ messageId, quote: verbatim });
    }
    if (evidenceFailed) continue;
    // 助手话可供理解问答，但不能单独作为用户事实的证据。
    if (evidence.length && !hasUserEvidence) {
      rejected.push({ reason: 'assistant_only_evidence', opId });
      continue;
    }

    const details = Array.isArray(record.details)
      ? record.details.map((item: any) => String(item)).filter(Boolean)
      : [];
    operations.push({
      opId,
      action,
      eventId: action === 'create' || action === 'no_change' ? null : eventId,
      kind: kindRaw,
      subject: record.subject ? String(record.subject) : null,
      state: record.state ? String(record.state) : null,
      details,
      evidence,
      uncertainty: record.uncertainty ? String(record.uncertainty).slice(0, 120) : null,
      reason: String(record.reason || '').slice(0, 200),
      inheritsRestriction,
      restrictionScope: record.restrictionScope
        ? String(record.restrictionScope).slice(0, 80)
        : null,
      currentTurnIntent: record.currentTurnIntent
        ? String(record.currentTurnIntent).slice(0, 200)
        : null,
      proactiveAllowed:
        typeof record.proactiveAllowed === 'boolean'
          ? record.proactiveAllowed
          : null,
      initialStatus: record.initialStatus
        ? (String(record.initialStatus) as ReplayOperation['initialStatus'])
        : null,
    });
  }

  const unresolved: ReplayUnresolved[] = [];
  if (Array.isArray(parsed?.unresolved)) {
    for (const item of parsed.unresolved) {
      const messageIds = Array.isArray(item?.messageIds)
        ? item.messageIds.map(String).filter((id: string) => byId.has(id))
        : [];
      if (messageIds.length) {
        unresolved.push({
          messageIds,
          reason: String(item?.reason || '').slice(0, 200),
        });
      }
    }
  }

  return {
    operations,
    unresolved,
    rejected,
    rawOperationCount: rows.length,
  };
}
