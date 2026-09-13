import { createHash } from 'crypto';

/**
 * 事件组合的纯逻辑：决定"这句话是并入已有的某件事，还是开一件新的"。
 * 这里只做确定性判断，不调用模型、不依赖存储，便于单测与重建一致性。
 *
 * 判定标准（已定）：同一个主体 + 同一话题 + 生命周期连续 = 一件事。
 * 宁可少聚，不可错聚：拿不准就不并。
 */

/** 同一件事的成员之间允许的最大间隔：超过这个跨度就当成"重新开始的一件事"。 */
export const EVENT_GROUP_MAX_GAP_MS = 45 * 24 * 60 * 60 * 1000;

export interface EventGroupCandidate {
  groupId: string;
  topicKey: string;
  subjectRef?: string;
  spanTo: Date;
}

export interface GroupAssignmentInput {
  topicKey: string;
  subjectRef?: string;
  occurredAt: Date;
  candidates: EventGroupCandidate[];
  maxGapMs?: number;
}

export type GroupAssignment =
  | { action: 'join'; groupId: string }
  | { action: 'create' };

/**
 * 并入条件：话题相同、主体一致（都没传视为一致）、
 * 时间上距候选组合的最后一个成员不超过上限。
 * 候选按 spanTo 由近到远比较，最近的优先。
 */
export function resolveGroupAssignment(
  input: GroupAssignmentInput
): GroupAssignment {
  const maxGapMs = input.maxGapMs ?? EVENT_GROUP_MAX_GAP_MS;
  const ordered = input.candidates
    .filter(candidate => candidate.topicKey === input.topicKey)
    .filter(
      candidate =>
        normalizeSubject(candidate.subjectRef) ===
        normalizeSubject(input.subjectRef)
    )
    .sort((left, right) => right.spanTo.getTime() - left.spanTo.getTime());

  for (const candidate of ordered) {
    const gap = input.occurredAt.getTime() - candidate.spanTo.getTime();
    if (gap < 0) continue; // 候选比当前这句还新，说明顺序不对，谨慎不并
    if (gap <= maxGapMs) return { action: 'join', groupId: candidate.groupId };
  }

  return { action: 'create' };
}

/** 事件去重的稳定键：跨重建保持一致，才能幂等。 */
export function buildGroupKey(options: {
  engine: string;
  userId: string;
  topicKey: string;
  subjectRef?: string;
  spanFrom: Date;
}): string {
  return hash(
    [
      options.engine,
      options.userId,
      options.topicKey,
      normalizeSubject(options.subjectRef) || '-',
      options.spanFrom.toISOString().slice(0, 10),
    ].join('|')
  );
}

/** 未了结条目的稳定指纹：同一用户 + 同一话题 + 同一主体 + 同一时间片。 */
export function buildOpenItemFingerprint(options: {
  engine: string;
  userId: string;
  topicKey: string;
  subjectRef?: string;
  occurredAt: Date;
}): string {
  const day = options.occurredAt.toISOString().slice(0, 10);
  return hash(
    [
      options.engine,
      options.userId,
      options.topicKey,
      normalizeSubject(options.subjectRef) || '-',
      day,
    ].join('|')
  );
}

/** 组合标题：只能当背景，不可作为事实断言。 */
export function buildGroupTitle(options: {
  topicKey: string;
  subjectRef?: string;
  memberCount: number;
}): string {
  const subject = options.subjectRef ? `${options.subjectRef}的` : '';
  return `${subject}${options.topicKey}（${options.memberCount} 条原话）`;
}

/** 原话指纹，用于幂等与审计。 */
export function hashMessageText(text: string): string {
  return hash((text || '').trim());
}

function normalizeSubject(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
