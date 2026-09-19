/**
 * P02 本地原型：把模型提出的操作应用到原型自己维护的事件快照上。
 *
 * 为什么不直接用 return-extract-v2/lifecycle.ts：
 * 1) 旧引擎把"拒谈"当成条目终态 dismissed，和"完成"共用同一条状态轴；本原型要求
 *    "拒谈限制独立于完成状态"，且分"当前轮可回应 / 今后可否主动问"。
 * 2) 旧引擎没有"背景"与"当前轮意图"分层，会把不收的诉求挤进待办枚举。
 * 3) 旧引擎的 create 由引擎现造 `new:opId`，且按"证据包含"判重，会把同证据的不同事件
 *    误当成同一件事；本原型要由程序持久分配 ID，并只按"完全一致的操作"判重复执行。
 *
 * 确定性规则（不替模型做语义判断）：
 * - 事件归属只认模型显式引用的 eventId；不用证据重叠或相似词推断。
 * - 重复执行只按"完全一致操作"的稳定签名判定；同一证据可以支撑多个不同事件。
 * - update 只改状态/细节/不确定性/显式权限，不改 status；完成后的新证据只追加，不自动重开。
 * - restrict 必须关联到 operation.eventId 对应的事件；已有同范围限制复用到新目标时也要关联。
 * - 有效主动权限 = 声明权限 && 未命中生效限制；完成不等于永远不能再提（另用 pendingFollowUp 区分）。
 * - unclear / unresolved 单独保存，不覆盖任何已确定事件。
 */
import { createHash } from 'crypto';
import type {
  ReplayOperation,
  ReplayParseResult,
  ReplaySnapshot,
  ReplayEvent,
  ReplayRestriction,
  ReplayKind,
} from './protocol';

export interface ApplyOptions {
  messageTimes: Record<string, string>;
  allowedMessageIds: string[];
  eventIdFactory: () => string;
  restrictionIdFactory: () => string;
  /** 跨检查点持久：完全一致的操作只应用一次。 */
  appliedOperationSignatures?: Set<string>;
}

export interface ApplyOutcome {
  opId: string;
  action: string;
  applied: boolean;
  reason?: string;
  eventId?: string;
  restrictionId?: string;
  signature?: string;
}

export interface ApplyResult {
  snapshot: ReplaySnapshot;
  outcomes: ApplyOutcome[];
  /** 当前轮意图：只在检查点记录里保留，绝不进入持久事件快照。 */
  currentTurnIntents: Array<{ opId: string; text: string; evidenceIds: string[] }>;
  rejected: Array<{ opId?: string; reason: string; detail?: string }>;
  appliedOperationSignatures: string[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 稳定操作签名：字段与证据逐字一致才算"同一操作"。证据顺序无关。 */
export function operationSignature(operation: ReplayOperation): string {
  return sha256(
    JSON.stringify({
      action: operation.action,
      eventId: operation.eventId,
      kind: operation.kind,
      subject: operation.subject,
      state: operation.state,
      details: [...operation.details].sort(),
      evidence: operation.evidence
        .map(item => `${item.messageId}#${(item.quote || '').trim()}`)
        .sort(),
      uncertainty: operation.uncertainty,
      restrictionScope: operation.restrictionScope,
      inheritsRestriction: operation.inheritsRestriction,
      proactiveAllowed: operation.proactiveAllowed,
      initialStatus: operation.initialStatus,
    })
  );
}

function cloneSnapshot(snapshot: ReplaySnapshot): ReplaySnapshot {
  return {
    events: snapshot.events.map(event => ({
      ...event,
      details: [...event.details],
      evidenceIds: [...event.evidenceIds],
      evidenceKeys: [...event.evidenceKeys],
      restrictionRefs: [...event.restrictionRefs],
      stateHistory: event.stateHistory.map(item => ({ ...item })),
    })),
    restrictions: snapshot.restrictions.map(restriction => ({
      ...restriction,
      evidenceIds: [...restriction.evidenceIds],
      history: restriction.history.map(item => ({ ...item })),
    })),
    unresolved: snapshot.unresolved.map(item => ({
      messageIds: [...item.messageIds],
      reason: item.reason,
    })),
  };
}

function initialStatus(
  kind: ReplayKind,
  declared: ReplayOperation['initialStatus']
): ReplayEvent['status'] {
  if (declared) return declared;
  return kind === 'open_event' ? 'open' : 'fact';
}

function recomputePermissions(state: ReplaySnapshot): void {
  const active = new Set(
    state.restrictions
      .filter(restriction => restriction.active)
      .map(restriction => restriction.restrictionId)
  );
  for (const event of state.events) {
    const restricted = event.restrictionRefs.some(id => active.has(id));
    event.effectiveProactiveAllowed = event.proactiveAllowed && !restricted;
    event.pendingFollowUpAllowed =
      event.status === 'open' && event.effectiveProactiveAllowed;
  }
}

export function emptySnapshot(): ReplaySnapshot {
  return { events: [], restrictions: [], unresolved: [] };
}

export function applyReplayOperations(
  snapshot: ReplaySnapshot,
  parse: ReplayParseResult,
  options: ApplyOptions
): ApplyResult {
  const state = cloneSnapshot(snapshot);
  const outcomes: ApplyOutcome[] = [];
  const currentTurnIntents: ApplyResult['currentTurnIntents'] = [];
  const allowed = new Set(options.allowedMessageIds);
  const signatures = options.appliedOperationSignatures || new Set<string>();

  for (const operation of parse.operations) {
    if (operation.currentTurnIntent) {
      currentTurnIntents.push({
        opId: operation.opId,
        text: operation.currentTurnIntent,
        evidenceIds: operation.evidence.map(item => item.messageId),
      });
    }
    if (operation.action === 'no_change') {
      outcomes.push({
        opId: operation.opId,
        action: 'no_change',
        applied: false,
        reason: 'explicit_no_change',
      });
      continue;
    }

    const evidenceIds = operation.evidence.map(item => item.messageId);
    if (evidenceIds.some(id => !allowed.has(id))) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'evidence_not_allowed',
      });
      continue;
    }

    if (operation.action === 'unclear') {
      const exists = state.unresolved.some(
        row =>
          row.reason === (operation.reason || 'attribution_unclear') &&
          row.messageIds.slice().sort().join('|') ===
            [...new Set(evidenceIds)].sort().join('|')
      );
      if (exists) {
        outcomes.push({
          opId: operation.opId,
          action: 'unclear',
          applied: false,
          reason: 'duplicate_noop',
        });
        continue;
      }
      state.unresolved.push({
        messageIds: [...new Set(evidenceIds)],
        reason: operation.reason || 'attribution_unclear',
      });
      outcomes.push({
        opId: operation.opId,
        action: 'unclear',
        applied: true,
        reason: 'kept_as_unresolved',
      });
      continue;
    }

    const signature = operationSignature(operation);
    if (signatures.has(signature)) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'duplicate_operation_noop',
        signature,
      });
      continue;
    }

    if (operation.action === 'create') {
      const kind = (operation.kind || 'open_event') as ReplayKind;
      const inherited = operation.inheritsRestriction
        ? state.restrictions.find(
            item =>
              item.restrictionId === operation.inheritsRestriction &&
              item.active
          )
        : undefined;
      const eventId = options.eventIdFactory();
      const times = evidenceIds
        .map(id => options.messageTimes[id])
        .filter(Boolean)
        .sort();
      const event: ReplayEvent = {
        eventId,
        kind,
        subject: operation.subject,
        state: operation.state || operation.reason || '',
        status: initialStatus(kind, operation.initialStatus),
        details: [...operation.details],
        evidenceIds: [...new Set(evidenceIds)],
        evidenceKeys: operation.evidence.map(
          item => `${item.messageId}#${(item.quote || '').trim()}`
        ),
        uncertainty: operation.uncertainty,
        // 背景默认不可主动使用；显式继承限制时也强制 false。
        proactiveAllowed:
          inherited || kind === 'background'
            ? false
            : operation.proactiveAllowed !== false,
        restrictionRefs: inherited ? [inherited.restrictionId] : [],
        effectiveProactiveAllowed: true,
        pendingFollowUpAllowed: true,
        stateHistory: [
          { state: 'created', at: times[0], opId: operation.opId },
        ],
        factAt: times[0],
        changeAt: times[times.length - 1],
      };
      state.events.push(event);
      signatures.add(signature);
      outcomes.push({
        opId: operation.opId,
        action: 'create',
        applied: true,
        eventId,
        signature,
        reason: inherited ? 'created_with_inherited_restriction' : undefined,
      });
      continue;
    }

    if (operation.action === 'restrict') {
      const target = state.events.find(
        event => event.eventId === operation.eventId
      );
      if (!target) {
        outcomes.push({
          opId: operation.opId,
          action: 'restrict',
          applied: false,
          reason: 'target_not_found',
        });
        continue;
      }
      const scope = operation.restrictionScope || 'unspecified';
      const times = evidenceIds
        .map(id => options.messageTimes[id])
        .filter(Boolean)
        .sort();
      let restriction = state.restrictions.find(item => item.scope === scope);
      let reason = 'restriction_added';
      if (restriction) {
        restriction.active = true;
        restriction.evidenceIds = [
          ...new Set([...restriction.evidenceIds, ...evidenceIds]),
        ];
        restriction.history.push({
          at: times[times.length - 1],
          opId: operation.opId,
          note: 'restriction_reinforced',
        });
        reason = 'restriction_reinforced_and_linked';
      } else {
        restriction = {
          restrictionId: options.restrictionIdFactory(),
          scope,
          futureProactiveAllowed: false,
          currentTurnResponseAllowed: true,
          active: true,
          evidenceIds: [...new Set(evidenceIds)],
          reason: operation.reason || '',
          history: [
            {
              at: times[times.length - 1],
              opId: operation.opId,
              note: 'restriction_added',
            },
          ],
        };
        state.restrictions.push(restriction);
      }
      // 关键：限制必须挂到明确目标事件，并关闭该事件的主动使用。
      if (!target.restrictionRefs.includes(restriction.restrictionId)) {
        target.restrictionRefs = [
          ...target.restrictionRefs,
          restriction.restrictionId,
        ];
      }
      target.proactiveAllowed = false;
      target.changeAt = times[times.length - 1] || target.changeAt;
      target.stateHistory.push({
        state: 'restriction_linked',
        at: times[times.length - 1],
        opId: operation.opId,
      });
      signatures.add(signature);
      outcomes.push({
        opId: operation.opId,
        action: 'restrict',
        applied: true,
        restrictionId: restriction.restrictionId,
        eventId: target.eventId,
        signature,
        reason,
      });
      continue;
    }

    const target = state.events.find(
      event => event.eventId === operation.eventId
    );
    if (!target) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'target_not_found',
      });
      continue;
    }

    const newEvidenceKeys = operation.evidence
      .map(item => `${item.messageId}#${(item.quote || '').trim()}`)
      .filter(key => !target.evidenceKeys.includes(key));
    const newEvidenceIds = evidenceIds.filter(
      id => !target.evidenceIds.includes(id)
    );
    const hasFieldChange =
      (operation.state !== null && operation.state !== target.state) ||
      (operation.subject !== null && operation.subject !== target.subject) ||
      (operation.uncertainty !== null &&
        operation.uncertainty !== target.uncertainty) ||
      operation.details.some(detail => !target.details.includes(detail)) ||
      operation.proactiveAllowed !== null;
    // 重叠证据但有新细节，仍然是有效更新；只有完全无变化才算重复。
    if (
      (operation.action === 'update' || operation.action === 'correct') &&
      !hasFieldChange &&
      newEvidenceKeys.length === 0
    ) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'duplicate_noop',
        eventId: target.eventId,
      });
      continue;
    }

    const times = evidenceIds
      .map(id => options.messageTimes[id])
      .filter(Boolean)
      .sort();
    const changeAt = times[times.length - 1];
    target.evidenceIds = [...new Set([...target.evidenceIds, ...newEvidenceIds])];
    target.evidenceKeys = [...new Set([...target.evidenceKeys, ...newEvidenceKeys])];
    target.changeAt = changeAt || target.changeAt;

    if (operation.action === 'update' || operation.action === 'correct') {
      if (operation.state !== null) target.state = operation.state;
      if (operation.subject !== null) target.subject = operation.subject;
      if (operation.uncertainty !== null) target.uncertainty = operation.uncertainty;
      for (const detail of operation.details) {
        if (!target.details.includes(detail)) target.details.push(detail);
      }
      if (operation.proactiveAllowed !== null) {
        target.proactiveAllowed = operation.proactiveAllowed;
      }
      target.stateHistory.push({
        state:
          operation.action === 'correct'
            ? 'corrected'
            : target.status === 'completed'
            ? 'post_completion_update'
            : 'updated',
        at: changeAt,
        opId: operation.opId,
      });
      signatures.add(signature);
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: true,
        eventId: target.eventId,
        signature,
        reason:
          target.status === 'completed'
            ? 'post_completion_update_kept_completed'
            : undefined,
      });
      continue;
    }

    if (operation.action === 'resolve') {
      if (target.status === 'completed') {
        outcomes.push({
          opId: operation.opId,
          action: 'resolve',
          applied: false,
          reason: 'already_in_state',
          eventId: target.eventId,
        });
        continue;
      }
      target.status = 'completed';
      if (operation.state !== null) target.state = operation.state;
      if (operation.subject !== null) target.subject = operation.subject;
      if (operation.uncertainty !== null) target.uncertainty = operation.uncertainty;
      if (operation.proactiveAllowed !== null) {
        target.proactiveAllowed = operation.proactiveAllowed;
      }
      target.stateHistory.push({
        state: 'resolved',
        at: changeAt,
        opId: operation.opId,
      });
      signatures.add(signature);
      outcomes.push({
        opId: operation.opId,
        action: 'resolve',
        applied: true,
        eventId: target.eventId,
        signature,
      });
      continue;
    }

    outcomes.push({
      opId: operation.opId,
      action: operation.action,
      applied: false,
      reason: 'unsupported_action',
    });
  }

  for (const item of parse.unresolved) {
    const exists = state.unresolved.some(
      row =>
        row.reason === item.reason &&
        row.messageIds.slice().sort().join('|') ===
          item.messageIds.slice().sort().join('|')
    );
    if (!exists) {
      state.unresolved.push({ ...item, messageIds: [...item.messageIds] });
    }
  }

  recomputePermissions(state);

  return {
    snapshot: state,
    outcomes,
    currentTurnIntents,
    rejected: parse.rejected,
    appliedOperationSignatures: [...signatures],
  };
}
