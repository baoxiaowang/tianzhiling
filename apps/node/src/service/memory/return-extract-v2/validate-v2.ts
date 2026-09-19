/**
 * R02 候选：新协议的校验与映射（逻辑输出 → 可入库操作）。
 * 原则：只做确定性校验，不做语义审批；引文必须逐字出现在声明的消息里，不猜、不改源。
 */
export type V2Action =
  | 'create'
  | 'update'
  | 'resolve'
  | 'cancel'
  | 'dismiss'
  | 'uncertain';
export type V2Kind = 'open_event' | 'meaningful_update' | 'calendar';
export type V2Precision = 'day' | 'week' | 'month' | 'unknown';

export interface V2Operation {
  opId: string;
  action: V2Action;
  targetItemId: string | null;
  kind: V2Kind;
  description: string;
  subject: { sourceLabel: string | null };
  phase: string | null;
  evidence: Array<{ messageId: string; quote: string }>;
  eventTime: {
    rawText: string | null;
    anchorMessageId: string | null;
    precision: V2Precision;
  };
  uncertainty: string | null;
  reason: string;
}

export interface V2ParseResult {
  operations: V2Operation[];
  unresolvedReferences: Array<{ messageIds: string[]; reason: string }>;
  rejected: Array<{ reason: string; opId?: string }>;
  rawOperationCount: number;
  truncated: boolean;
  normalizedActions: number;
}

const ACTIONS: V2Action[] = [
  'create',
  'update',
  'resolve',
  'cancel',
  'dismiss',
  'uncertain',
];
/** 明确的同义动作（模型偶发；语义无歧义才归一，并记录 normalizedAction）。 */
const ACTION_SYNONYMS: Record<string, V2Action> = {
  add: 'create',
  new: 'create',
  insert: 'create',
  complete: 'resolve',
  completed: 'resolve',
  close: 'resolve',
  closed: 'resolve',
  withdrawn: 'cancel',
  withdraw: 'cancel',
  refuse: 'dismiss',
  rejected: 'dismiss',
  unsure: 'uncertain',
  unknown: 'uncertain',
};
const KINDS: V2Kind[] = ['open_event', 'meaningful_update', 'calendar'];
const PRECISIONS: V2Precision[] = ['day', 'week', 'month', 'unknown'];

function normalize(value: string): string {
  return (value || '')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

function locateVerbatim(content: string, quote: string): string | undefined {
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

export function parseExtractionOutputV2(
  rawContent: string,
  messages: Array<{ messageId: string; content: string; role?: string }>,
  existingItemIds: string[]
): V2ParseResult {
  const rejected: V2ParseResult['rejected'] = [];
  const operations: V2Operation[] = [];
  let normalizedActions = 0;
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
      unresolvedReferences: [],
      rejected: [{ reason: 'invalid_json' }],
      rawOperationCount: 0,
      truncated: false,
      normalizedActions,
    };
  }
  const rows = Array.isArray(parsed?.operations) ? parsed.operations : null;
  if (!rows) {
    return {
      operations,
      unresolvedReferences: [],
      rejected: [{ reason: 'missing_operations' }],
      rawOperationCount: 0,
      truncated: false,
      normalizedActions,
    };
  }
  const byId = new Map(messages.map(message => [message.messageId, message]));
  const known = new Set(existingItemIds);
  const seenOpIds = new Set<string>();

  for (const row of rows) {
    const record = (row || {}) as Record<string, any>;
    const opId = String(record.opId || '').trim();
    const rawAction = String(record.action || '').trim();
    const normalizedAction = ACTION_SYNONYMS[rawAction.toLowerCase()];
    const action = (normalizedAction || rawAction) as V2Action;
    const kind = String(record.kind || '').trim() as V2Kind;
    if (!opId || seenOpIds.has(opId)) {
      rejected.push({ reason: 'missing_or_duplicate_opId', opId });
      continue;
    }
    if (normalizedAction) normalizedActions += 1;
    if (ACTIONS.indexOf(action) === -1) {
      rejected.push({ reason: 'invalid_action', opId });
      continue;
    }
    if (KINDS.indexOf(kind) === -1) {
      rejected.push({ reason: 'invalid_kind', opId });
      continue;
    }
    const targetItemId =
      record.targetItemId == null ? null : String(record.targetItemId);
    if (action === 'create' && targetItemId) {
      rejected.push({ reason: 'create_must_have_null_target', opId });
      continue;
    }
    if (action !== 'create' && action !== 'uncertain') {
      if (!targetItemId || !known.has(targetItemId)) {
        rejected.push({ reason: 'unknown_target_item', opId });
        continue;
      }
    }
    const description = String(record.description || '').trim();
    if (description.length < 2) {
      rejected.push({ reason: 'missing_description', opId });
      continue;
    }
    const evidenceRows = Array.isArray(record.evidence) ? record.evidence : [];
    if (!evidenceRows.length) {
      rejected.push({ reason: 'missing_evidence', opId });
      continue;
    }
    const evidence: Array<{ messageId: string; quote: string }> = [];
    let evidenceFailed = false;
    for (const item of evidenceRows) {
      const messageId = String(item?.messageId || '').trim();
      const quote = String(item?.quote || '').trim();
      const message = byId.get(messageId);
      if (!message) {
        rejected.push({ reason: 'unknown_evidence_message', opId });
        evidenceFailed = true;
        break;
      }
      const verbatim = locateVerbatim(message.content, quote);
      if (!verbatim) {
        rejected.push({ reason: 'evidence_source_mismatch', opId });
        evidenceFailed = true;
        break;
      }
      evidence.push({ messageId, quote: verbatim });
    }
    if (evidenceFailed) continue;

    const rawPrecision = String(record.eventTime?.precision || 'unknown');
    const precision = (
      PRECISIONS.indexOf(rawPrecision as V2Precision) >= 0
        ? rawPrecision
        : 'unknown'
    ) as V2Precision;
    operations.push({
      opId,
      action,
      targetItemId: action === 'create' ? null : targetItemId,
      kind,
      description,
      subject: {
        sourceLabel: record.subject?.sourceLabel
          ? String(record.subject.sourceLabel)
          : null,
      },
      phase: record.phase ? String(record.phase).slice(0, 40) : null,
      evidence,
      eventTime: {
        rawText: record.eventTime?.rawText
          ? String(record.eventTime.rawText).slice(0, 30)
          : null,
        anchorMessageId: record.eventTime?.anchorMessageId
          ? String(record.eventTime.anchorMessageId)
          : null,
        precision,
      },
      uncertainty: record.uncertainty
        ? String(record.uncertainty).slice(0, 60)
        : null,
      reason: String(record.reason || '').slice(0, 120),
    });
    seenOpIds.add(opId);
  }

  const unresolved = Array.isArray(parsed?.unresolvedReferences)
    ? parsed.unresolvedReferences.map((item: any) => ({
        messageIds: Array.isArray(item?.messageIds)
          ? item.messageIds.map(String)
          : [],
        reason: String(item?.reason || '').slice(0, 80),
      }))
    : [];

  return {
    operations,
    unresolvedReferences: unresolved,
    rejected,
    rawOperationCount: rows.length,
    truncated: rows.length > operations.length + rejected.length ? true : false,
    normalizedActions,
  };
}

/** 把 v2 操作映射成打分用的候选形状（便于与 R00/R01 指标对照）。 */
export function operationsToScorable(operations: V2Operation[]) {
  return operations.map(operation => ({
    messageId: operation.evidence[0]?.messageId || '',
    topicKey:
      operation.kind === 'calendar'
        ? '纪念日'
        : operation.kind === 'meaningful_update'
        ? '近况'
        : '待跟进',
    state:
      operation.action === 'resolve' ||
      operation.action === 'cancel' ||
      operation.action === 'dismiss'
        ? operation.action
        : operation.kind === 'calendar'
        ? 'awaiting_result'
        : 'awaiting_result',
    quote: operation.description,
    action: operation.action,
    targetItemId: operation.targetItemId,
    kind: operation.kind,
    _v2: operation,
  }));
}
