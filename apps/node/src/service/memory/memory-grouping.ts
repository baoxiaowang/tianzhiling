import { createHash } from 'crypto';

/**
 * 事件组合的纯逻辑：决定"这句话是并入已有的某件事，还是开一件新的"。
 * 这里只做确定性判断，不调用模型、不依赖存储，便于单测与重建一致性。
 *
 * 判定标准（已定）：同一个主体 + 同一话题 + 生命周期连续 = 一件事。
 * 宁可少聚，不可错聚：拿不准就不并。
 */

/**
 * 同一件事的成员之间允许的最大间隔。
 * 场次制（episode）之前用于 join 判定；现在只作为"链查询的相关性窗口"：
 * 超过这个跨度的历史组不再参与链化。join 改用场次间隔（EPISODE_GAP_MS）。
 */
export const EVENT_GROUP_MAX_GAP_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * 场次间隔：同一会话内、相邻成员不超过该间隔才算同一场。
 * 默认 2 小时（可用 NODE_MEMORY_EPISODE_GAP_MS 调整，毫秒）。
 * 场次制：一次集中叙事 = 一个包；下次再说 = 新包；包间靠链关联。
 */
export function resolveEpisodeGapMs(): number {
  const raw = Number(process.env.NODE_MEMORY_EPISODE_GAP_MS);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : 2 * 60 * 60 * 1000;
}

export interface EventGroupCandidate {
  groupId: string;
  topicKey: string;
  subjectRef?: string;
  /** 场次制：join 只发生在同一会话内。 */
  conversationId?: string;
  spanTo: Date;
}

export interface GroupAssignmentInput {
  topicKey: string;
  subjectRef?: string;
  /** 当前消息所属会话。 */
  conversationId?: string;
  occurredAt: Date;
  candidates: EventGroupCandidate[];
  maxGapMs?: number;
}

export type GroupAssignment =
  | { action: 'join'; groupId: string }
  | { action: 'create' };

/**
 * 并入条件（场次制）：话题相同、主体一致（都没传视为一致）、
 * 同一会话、且距候选组合最后一个成员不超过场次间隔。
 * 换会话/隔场一律开新包——跨场的纵向关联交给链，不靠合并。
 * 候选按 spanTo 由近到远比较，最近的优先。
 */
export function resolveGroupAssignment(
  input: GroupAssignmentInput
): GroupAssignment {
  const maxGapMs = input.maxGapMs ?? resolveEpisodeGapMs();
  const ordered = input.candidates
    .filter(candidate => candidate.topicKey === input.topicKey)
    .filter(
      candidate =>
        normalizeSubject(candidate.subjectRef) ===
        normalizeSubject(input.subjectRef)
    )
    .filter(
      candidate =>
        !input.conversationId ||
        !candidate.conversationId ||
        candidate.conversationId === input.conversationId
    )
    .sort((left, right) => right.spanTo.getTime() - left.spanTo.getTime());

  for (const candidate of ordered) {
    const gap = input.occurredAt.getTime() - candidate.spanTo.getTime();
    if (gap < 0) continue; // 候选比当前这句还新，说明顺序不对，谨慎不并
    if (gap <= maxGapMs) return { action: 'join', groupId: candidate.groupId };
  }

  return { action: 'create' };
}

/**
 * 事件去重的稳定键：跨重建保持一致，才能幂等。
 * 场次制：spanFrom 粒度到分钟——同一天同话题的多场（早晚各一段）不撞键。
 */
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
      options.spanFrom.toISOString().slice(0, 16),
    ].join('|')
  );
}

/**
 * 未了结条目的稳定指纹：同一用户 + 同一话题 + 同一主体 + 这件事说的是什么，**不含日期**。
 * 早先指纹里带了来源日期，于是"我刚做完手术"隔两天再说一次就成了第二条：
 * 两条各有各的 3 天冷却，模型就会把同一件事反复端上来问。
 * 日期是这件事什么时候说的，不是它是不是同一件事。
 * 内容必须参与：日子类的（三七、五七、百天、中元节）本来就是一件一件不同的日子，
 * 只看话题+主体会把它们并成一条，等于把日子丢了。
 */
export function buildOpenItemFingerprint(options: {
  engine: string;
  userId: string;
  topicKey: string;
  subjectRef?: string;
  /** 原话正文，参与指纹；不传时退化为"话题+主体"一条。 */
  content?: string;
  /** 兼容旧调用：不参与指纹。 */
  occurredAt?: Date;
}): string {
  void options.occurredAt;
  return hash(
    [
      options.engine,
      options.userId,
      options.topicKey,
      normalizeSubject(options.subjectRef) || '-',
      openItemContentKey(options.content),
    ].join('|')
  );
}

/**
 * 场次热度（读时计算，烘焙进证据分数用）：
 * 成员数（对数压制）× 新近度 × 未了结加成，钳制 [0.6, 1.5]。
 * 热度只影响"哪场先被看见"，不改变证据的可断言性。
 */
export function heatForGroup(input: {
  memberCount: number;
  spanTo: Date;
  hasActiveOpenItem?: boolean;
  /** 用户回避时刻：14 天内 ×0.6（叠乘后仍受值域钳制）。 */
  lastUserDisengagedAt?: Date;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const ageDays = Math.max(0, (now.getTime() - input.spanTo.getTime()) / 86400000);
  // 新近度：7 天内 1.0，每 30 天衰减 ~8%，半年 ~0.85，两年 ~0.7（下限）。
  const recency = Math.max(0.7, 1 - (ageDays / 730) * 0.3);
  const volume = 1 + 0.15 * Math.log2(1 + Math.max(0, input.memberCount));
  const unresolved = input.hasActiveOpenItem ? 1.3 : 1;
  const disengagedDaysAgo = input.lastUserDisengagedAt
    ? (now.getTime() - input.lastUserDisengagedAt.getTime()) / 86400000
    : Number.POSITIVE_INFINITY;
  const disengagedPenalty = disengagedDaysAgo < 14 ? 0.6 : 1;
  const raw = recency * volume * unresolved * disengagedPenalty;
  return Math.min(1.5, Math.max(0.6, Number(raw.toFixed(4))));
}

/**
 * 回避判定（纯函数，保守）：本轮用户消息全部为短应答且无话题实质，
 * 视为对上一轮注入话题的回避。任一条有实质内容即不算回避。
 */
const DISENGAGEMENT_ACK_PATTERN =
  /^(?:嗯+|哦+|呵+|好|好的|行|可以|知道了|收到|嗯嗯|嗯呢|哦哦|好嘞|好滴|是的|对|没事|算了|先这样)[。.!！~～\s]*$/u;

export function shouldMarkDisengagement(reactionTexts: string[]): boolean {
  const texts = reactionTexts.map(text => String(text || '').trim()).filter(Boolean);
  if (!texts.length) return false;
  return texts.every(
    text => text.length <= 8 && DISENGAGEMENT_ACK_PATTERN.test(text)
  );
}

export interface ChainableGroupLike {
  id: string;
  title: string;
  subjectRef?: string;
  spanFrom: Date;
  spanTo: Date;
  memberCount: number;
}

/**
 * 链视图：给定本场，从同话题的历史场次里选相关前情（同主体优先，
 * 按场次时间倒序取 count 场）。跨场纵向关联——同场合并已被场次制禁止，
 * 前情靠链呈现。
 */
export function buildChainViews(
  current: { subjectRef?: string; spanFrom: Date },
  historical: ChainableGroupLike[],
  count = 2
): Array<{ title: string; spanFrom: string; spanTo: string; memberCount: number }> {
  const subject = normalizeSubject(current.subjectRef);
  return historical
    .filter(group => group.spanTo.getTime() < current.spanFrom.getTime())
    .filter(
      group =>
        !subject ||
        !normalizeSubject(group.subjectRef) ||
        normalizeSubject(group.subjectRef) === subject
    )
    .sort((left, right) => right.spanTo.getTime() - left.spanTo.getTime())
    .slice(0, Math.max(0, count))
    .map(group => ({
      title: group.title,
      spanFrom: group.spanFrom.toISOString(),
      spanTo: group.spanTo.toISOString(),
      memberCount: group.memberCount,
    }));
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

/**
 * 参与指纹的内容键：去掉标点，只取前面一段。
 * 截断是为了让"同一句话被抽取成两条记录"能撞上；要保留的差异都在前半句，
 * 例如"今天是您的三七"和"今天是您的五七"，所以只看前 48 个字就够。
 */
export function openItemContentKey(value?: string): string {
  const text = (value || '')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
  return text ? text.slice(0, 48) : '-';
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
