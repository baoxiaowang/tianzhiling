/**
 * R06 候选：新协议操作的确定性生命周期（纯函数，本地镜像用）。
 * 规则：
 * - create 新开一条；update 只改阶段与证据、不新建；resolve/cancel/dismiss 落终态并记历史。
 * - uncertain 只留候选，不进入主动材料。
 * - 同一批里重复的 (action,target,证据) 是 noop；同一条证据重放不刷新事实时间。
 * - 终态（resolved/cancelled/dismissed）不得被旧证据复活；只有带新证据的 update 才能重开。
 * - 换新证据但顺序更早的 update 不覆盖更新的状态（按消息时间，不按任务完成顺序）。
 */
import type { V2Operation } from './validate-v2';

export type ItemLifecycleState =
  | 'awaiting_result'
  | 'action_committed'
  | 'calendar'
  /** 有分量的近况：记着可承接，但**不是待办**，不进入"必须问一件"的材料。 */
  | 'meaningful_update'
  | 'resolved'
  | 'cancelled'
  | 'dismissed';

export interface ItemView {
  itemId: string;
  kind: string;
  state: ItemLifecycleState;
  description: string;
  subjectLabel: string | null;
  evidenceIds: string[];
  /** 证据身份（messageId#quote）：用来区分同一消息里的不同事件；外部预置条目可为空。 */
  evidenceKeys?: string[];
  /** 首次事实时间：最早证据的消息时间（重复抽取不刷新）。 */
  factAt?: string;
  /** 本次变化的依据时间：优先用操作声明的 anchor 消息，否则用最新证据。 */
  changeAt?: string;
  /** 最近一次状态变化对应的（时间, 接收序号），用于乱序保护。 */
  stateAt?: string;
  stateSeq?: number;
  stateHistory: Array<{ state: string; at?: string; opId?: string }>;
}

export interface ApplyOptions {
  /** 消息 id -> 发生时间（ISO），用于事实时间与乱序保护。 */
  messageTimes: Record<string, string>;
  /** 消息 id -> 接收顺序（同一时间戳时用来定先后；不依赖模型自报时间）。 */
  messageSeq?: Record<string, number>;
  /** 允许的证据消息集合（归档/删除/跨 scope 的消息不在这里）。 */
  allowedMessageIds?: string[];
}

export interface ApplyOutcome {
  opId: string;
  action: string;
  applied: boolean;
  reason?: string;
}

const TERMINAL: ItemLifecycleState[] = ['resolved', 'cancelled', 'dismissed'];

export function applyOperations(
  operations: V2Operation[],
  existingItems: ItemView[],
  options: ApplyOptions
): { items: ItemView[]; outcomes: ApplyOutcome[] } {
  const items: ItemView[] = existingItems.map(item => ({
    ...item,
    stateHistory: [...item.stateHistory],
  }));
  const outcomes: ApplyOutcome[] = [];
  const allowed = options.allowedMessageIds
    ? new Set(options.allowedMessageIds)
    : undefined;
  const seen = new Set<string>();

  for (const operation of operations) {
    const evidenceIds = operation.evidence.map(item => item.messageId);
    if (allowed && evidenceIds.some(id => !allowed.has(id))) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'evidence_not_allowed',
      });
      continue;
    }
    // 事件身份用"证据消息 + 引文片段"：同一条消息里的两件事不会被误去重，
    // 同一条引文的重复提交才是 noop。
    const evidenceKey = operation.evidence
      .map(item => `${item.messageId}#${(item.quote || '').trim()}`)
      .sort()
      .join('|');
    const dedupeKey = `${operation.action}|${
      operation.targetItemId || '-'
    }|${evidenceKey}`;
    if (seen.has(dedupeKey)) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'duplicate_noop',
      });
      continue;
    }
    seen.add(dedupeKey);

    if (operation.action === 'uncertain') {
      outcomes.push({
        opId: operation.opId,
        action: 'uncertain',
        applied: false,
        reason: 'kept_as_candidate',
      });
      continue;
    }

    // 变化依据时间：优先操作声明的 anchor 消息（仍在证据里），否则取最新证据；
    // 不采用模型自报的 rawText 去算日期。接收序号用于同一时间戳时排序。
    const anchorId =
      operation.eventTime.anchorMessageId &&
      evidenceIds.includes(operation.eventTime.anchorMessageId)
        ? operation.eventTime.anchorMessageId
        : null;
    const times = evidenceIds
      .map(id => options.messageTimes[id])
      .filter(Boolean);
    const eventAt = anchorId
      ? options.messageTimes[anchorId]
      : times.slice().sort().slice(-1)[0];
    const eventSeq = options.messageSeq
      ? Math.max(...evidenceIds.map(id => options.messageSeq?.[id] ?? 0))
      : undefined;

    if (operation.action === 'create') {
      // 同一批或跨批重放：证据已被某条覆盖（**含终态**）就不再新建。
      // 用户日后用新消息重提同一句话会带新的 messageId，因此不会被这里吞掉。
      const duplicate = items.find(item => {
        if (item.kind !== operation.kind) return false;
        if (!item.evidenceIds.length && !(item.evidenceKeys || []).length)
          return false;
        return operation.evidence.every(evidence => {
          const key = `${evidence.messageId}#${(evidence.quote || '').trim()}`;
          if ((item.evidenceKeys || []).length)
            return item.evidenceKeys!.includes(key);
          return item.evidenceIds.includes(evidence.messageId);
        });
      });
      if (duplicate) {
        outcomes.push({
          opId: operation.opId,
          action: 'create',
          applied: false,
          reason: TERMINAL.includes(duplicate.state)
            ? 'terminal_not_resurrected'
            : 'duplicate_noop',
        });
        continue;
      }
      // meaningful_update 不是待办：单独一个状态，不进入"必须问一件"的材料。
      const initialState: ItemLifecycleState =
        operation.kind === 'calendar'
          ? 'calendar'
          : operation.kind === 'meaningful_update'
          ? 'meaningful_update'
          : 'awaiting_result';
      const firstAt = evidenceIds
        .map(id => options.messageTimes[id])
        .filter(Boolean)
        .sort()[0];
      items.push({
        itemId: `new:${operation.opId}`,
        kind: operation.kind,
        state: initialState,
        description: operation.description,
        subjectLabel: operation.subject.sourceLabel,
        evidenceIds,
        evidenceKeys: operation.evidence.map(
          evidence => `${evidence.messageId}#${(evidence.quote || '').trim()}`
        ),
        factAt: firstAt,
        changeAt: eventAt,
        stateAt: eventAt,
        stateSeq: eventSeq,
        stateHistory: [{ state: 'created', at: eventAt, opId: operation.opId }],
      });
      outcomes.push({ opId: operation.opId, action: 'create', applied: true });
      continue;
    }

    const target = items.find(item => item.itemId === operation.targetItemId);
    if (!target) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'target_not_found',
      });
      continue;
    }
    const newEvidence = evidenceIds.filter(
      id => !target.evidenceIds.includes(id)
    );
    const isTerminal = TERMINAL.includes(target.state);

    // 乱序保护：所有会改状态的动作都要过这一关（不只是 update）。
    const stale = (() => {
      if (!target.stateAt || !eventAt) return false;
      if (eventAt < target.stateAt) return true;
      if (eventAt > target.stateAt) return false;
      if (eventSeq === undefined || target.stateSeq === undefined) return false;
      return eventSeq < target.stateSeq;
    })();
    if (stale) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'stale_evidence_ignored',
      });
      continue;
    }

    if (isTerminal) {
      // 用户明确拒谈：不因为"有新证据的 update"自动重开，先留候选。
      if (target.state === 'dismissed') {
        outcomes.push({
          opId: operation.opId,
          action: operation.action,
          applied: false,
          reason: 'dismissed_requires_explicit_reopen',
        });
        continue;
      }
      // resolved/cancelled：只有"带新证据的 update"能重开；重复 resolve/cancel/dismiss 是 noop
      if (operation.action !== 'update' || !newEvidence.length) {
        outcomes.push({
          opId: operation.opId,
          action: operation.action,
          applied: false,
          reason: 'terminal_not_resurrected',
        });
        continue;
      }
    }

    if (operation.action === 'update') {
      target.description = operation.description;
      target.evidenceIds = [...target.evidenceIds, ...newEvidence];
      target.evidenceKeys = [
        ...(target.evidenceKeys || []),
        ...operation.evidence
          .map(
            evidence => `${evidence.messageId}#${(evidence.quote || '').trim()}`
          )
          .filter(key => !(target.evidenceKeys || []).includes(key)),
      ];
      target.changeAt = eventAt || target.changeAt;
      // 普通 update 也要推进状态时间，否则迟到的旧关闭会覆盖它
      target.stateAt = eventAt || target.stateAt;
      target.stateSeq = eventSeq ?? target.stateSeq;
      if (isTerminal) {
        target.state = 'awaiting_result';
        target.stateHistory = [
          ...target.stateHistory,
          { state: 'reopened', at: eventAt, opId: operation.opId },
        ];
      } else if (
        target.state === 'meaningful_update' &&
        operation.kind !== 'meaningful_update'
      ) {
        target.state = 'awaiting_result';
        target.stateHistory = [
          ...target.stateHistory,
          { state: 'promoted_to_todo', at: eventAt, opId: operation.opId },
        ];
      }
      outcomes.push({ opId: operation.opId, action: 'update', applied: true });
      continue;
    }

    // resolve / cancel / dismiss（动作名与终态名一一对应：resolve→resolved 等）
    const nextState = (
      operation.action === 'resolve'
        ? 'resolved'
        : operation.action === 'cancel'
        ? 'cancelled'
        : 'dismissed'
    ) as ItemLifecycleState;
    if (target.state === nextState) {
      outcomes.push({
        opId: operation.opId,
        action: operation.action,
        applied: false,
        reason: 'already_in_state',
      });
      continue;
    }
    target.state = nextState;
    target.stateAt = eventAt || target.stateAt;
    target.stateSeq = eventSeq ?? target.stateSeq;
    target.evidenceIds = [...target.evidenceIds, ...newEvidence];
    target.stateHistory = [
      ...target.stateHistory,
      { state: target.state, at: eventAt, opId: operation.opId },
    ];
    outcomes.push({
      opId: operation.opId,
      action: operation.action,
      applied: true,
    });
  }

  return { items, outcomes };
}
