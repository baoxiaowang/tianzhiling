import { createHash } from 'crypto';

export const CONTINUITY_INFORMATION_CARD_VERSION =
  'continuity_information_card_v1' as const;
export const CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX =
  '__TZL_CONTINUITY_INFORMATION_CARD_V1__:';

export type ContinuityCardKind = 'continuity_context';
export type ContinuityEventKind =
  | 'health'
  | 'family_health'
  | 'future_event'
  | 'recent_event'
  | 'ongoing_matter'
  | 'life_change'
  | 'result_pending'
  | 'other';
export type ContinuityTimeScope =
  | 'past'
  | 'current'
  | 'ongoing'
  | 'future'
  | 'unknown';
export type ContinuityRetentionPolicy =
  | 'transient_3d'
  | 'short_7d'
  | 'event_window'
  | 'until_resolved'
  | 'durable';
export type ContinuityCardStatus =
  | 'active'
  | 'expired'
  | 'resolved'
  | 'dismissed'
  | 'superseded';

export interface ContinuityEventDraft {
  summary: string;
  subject: string;
  eventKind: ContinuityEventKind;
  timeScope: ContinuityTimeScope;
  retentionPolicy: ContinuityRetentionPolicy;
  importance: 1 | 2 | 3;
  eventAt?: Date;
}

export interface ContinuityInformationCard {
  id: string;
  kind: ContinuityCardKind;
  semanticKey: string;
  summary: string;
  subject: string;
  eventKind: ContinuityEventKind;
  timeScope: ContinuityTimeScope;
  retentionPolicy: ContinuityRetentionPolicy;
  importance: 1 | 2 | 3;
  status: ContinuityCardStatus;
  sourceMessageId: string;
  sourceOccurredAt: Date;
  latestEvidenceMessageId?: string;
  latestEvidenceAt?: Date;
  eventAt?: Date;
  earliestAt: Date;
  expiresAt?: Date;
  lastOfferedAt?: Date;
  offerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContinuityInformationCardStore {
  version: typeof CONTINUITY_INFORMATION_CARD_VERSION;
  cards: ContinuityInformationCard[];
  updatedAt: Date;
}

export interface BuildContinuityCardOptions {
  draft: ContinuityEventDraft;
  sourceMessageId: string;
  sourceOccurredAt: Date;
  now?: Date;
  ordinal?: number;
}

export interface SelectContinuityCardOptions {
  store: ContinuityInformationCardStore;
  currentQuery: string;
  currentTurnMessageIds: string[];
  isReturnTurn: boolean;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_CARDS = 24;
const MAX_INACTIVE_CARDS = 16;
const OFFER_COOLDOWN_MS = 3 * DAY_MS;

const EVENT_CAPTURE_PATTERN =
  /(?:生病|病了|不舒服|难受|发烧|咳嗽|疼|住院|出院|手术|复查|检查|体检|化疗|康复|摔了|受伤|去医院|看医生|明天|后天|下周|下个月|周末|过几天|到时候|前天|昨天|刚才|最近|这几天|上周|发生|出了?事|考试|面试|开学|毕业|结婚|离婚|怀孕|生孩子|搬家|换工作|辞职|退休|出差|旅行|回家|去世|走了|葬礼|结果|通知|等消息|还没定)/u;
const INSTRUCTIONAL_SUMMARY_PATTERN =
  /(?:应该|需要|请|记得|务必|必须).{0,8}(?:关心|询问|追问|提醒|安慰|问候)|(?:关心|询问|追问|提醒|安慰|问候)(?:用户|对方|家人)/u;

export function shouldAttemptContinuityEventCapture(text: string): boolean {
  const normalized = text.replace(/\s+/gu, '').trim();
  return normalized.length >= 3 && EVENT_CAPTURE_PATTERN.test(normalized);
}

export function buildEmptyContinuityInformationCardStore(
  now = new Date()
): ContinuityInformationCardStore {
  return {
    version: CONTINUITY_INFORMATION_CARD_VERSION,
    cards: [],
    updatedAt: now,
  };
}

export function serializeContinuityInformationCardStore(
  store: ContinuityInformationCardStore
): string {
  return `${CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX}${JSON.stringify(
    compactContinuityInformationCardStore(store)
  )}`;
}

export function parseContinuityInformationCardStore(
  content: string | undefined
): ContinuityInformationCardStore | undefined {
  if (!content?.startsWith(CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX)) {
    return undefined;
  }

  try {
    const raw = JSON.parse(
      content.slice(CONTINUITY_INFORMATION_CARD_MESSAGE_PREFIX.length)
    ) as Record<string, unknown>;
    if (
      raw.version !== CONTINUITY_INFORMATION_CARD_VERSION ||
      !Array.isArray(raw.cards)
    ) {
      return undefined;
    }
    const cards = raw.cards
      .map(parseContinuityInformationCard)
      .filter((card): card is ContinuityInformationCard => Boolean(card));
    return {
      version: CONTINUITY_INFORMATION_CARD_VERSION,
      cards,
      updatedAt: parseDate(raw.updatedAt) ?? new Date(0),
    };
  } catch {
    return undefined;
  }
}

export function buildContinuityInformationCard(
  options: BuildContinuityCardOptions
): ContinuityInformationCard | undefined {
  const now = options.now ?? new Date();
  const summary = normalizeCardText(options.draft.summary, 120);
  const subject = normalizeCardText(options.draft.subject, 32);
  if (!summary || !subject || INSTRUCTIONAL_SUMMARY_PATTERN.test(summary)) {
    return undefined;
  }

  const sourceOccurredAt = new Date(options.sourceOccurredAt);
  if (Number.isNaN(sourceOccurredAt.getTime())) return undefined;
  const eventAt = options.draft.eventAt
    ? new Date(options.draft.eventAt)
    : undefined;
  const validEventAt =
    eventAt && !Number.isNaN(eventAt.getTime()) ? eventAt : undefined;
  const { earliestAt, expiresAt } = resolveCardWindow({
    sourceOccurredAt,
    eventAt: validEventAt,
    retentionPolicy: options.draft.retentionPolicy,
  });
  const seed = [
    options.sourceMessageId,
    String(options.ordinal ?? 0),
    options.draft.eventKind,
    subject,
    summary,
  ].join('|');
  const semanticSeed = [options.draft.eventKind, subject, summary].join('|');
  const status: ContinuityCardStatus =
    expiresAt && expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';

  return {
    id: `cc_${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`,
    kind: 'continuity_context',
    semanticKey: createHash('sha1')
      .update(semanticSeed)
      .digest('hex')
      .slice(0, 20),
    summary,
    subject,
    eventKind: options.draft.eventKind,
    timeScope: options.draft.timeScope,
    retentionPolicy: options.draft.retentionPolicy,
    importance: normalizeImportance(options.draft.importance),
    status,
    sourceMessageId: options.sourceMessageId,
    sourceOccurredAt,
    latestEvidenceMessageId: options.sourceMessageId,
    latestEvidenceAt: sourceOccurredAt,
    ...(validEventAt ? { eventAt: validEventAt } : {}),
    earliestAt,
    ...(expiresAt ? { expiresAt } : {}),
    offerCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function upsertContinuityInformationCards(
  store: ContinuityInformationCardStore,
  incoming: ContinuityInformationCard[],
  now = new Date()
): ContinuityInformationCardStore {
  const cards = store.cards.map(card => ({ ...card }));
  for (const card of incoming) {
    const index = cards.findIndex(
      item => item.id === card.id || item.semanticKey === card.semanticKey
    );
    if (index < 0) {
      cards.push(card);
      continue;
    }
    const existing = cards[index];
    cards[index] = {
      ...card,
      id: existing.id,
      createdAt: existing.createdAt,
      offerCount: existing.offerCount,
      ...(existing.lastOfferedAt
        ? { lastOfferedAt: existing.lastOfferedAt }
        : {}),
      updatedAt: now,
    };
  }
  return compactContinuityInformationCardStore({
    version: CONTINUITY_INFORMATION_CARD_VERSION,
    cards,
    updatedAt: now,
  });
}

export function expireContinuityInformationCards(
  store: ContinuityInformationCardStore,
  now = new Date()
): ContinuityInformationCardStore {
  let changed = false;
  const cards = store.cards.map(card => {
    if (
      card.status === 'active' &&
      card.expiresAt &&
      card.expiresAt.getTime() <= now.getTime()
    ) {
      changed = true;
      return { ...card, status: 'expired' as const, updatedAt: now };
    }
    return { ...card };
  });
  return changed
    ? compactContinuityInformationCardStore({
        version: CONTINUITY_INFORMATION_CARD_VERSION,
        cards,
        updatedAt: now,
      })
    : { ...store, cards };
}

export function selectContinuityInformationCard(
  options: SelectContinuityCardOptions
): ContinuityInformationCard | undefined {
  const now = options.now ?? new Date();
  const currentIds = new Set(options.currentTurnMessageIds);
  const query = normalizeCardText(options.currentQuery, 600);
  const candidates = options.store.cards
    .filter(card => {
      if (card.status !== 'active') return false;
      if (currentIds.has(card.sourceMessageId)) return false;
      if (card.earliestAt.getTime() > now.getTime()) return false;
      if (
        card.lastOfferedAt &&
        now.getTime() - card.lastOfferedAt.getTime() < OFFER_COOLDOWN_MS
      ) {
        return false;
      }
      const association = resolveAssociationScore(query, card);
      const eventDue = Boolean(
        card.eventAt &&
          Math.abs(card.eventAt.getTime() - now.getTime()) <= 2 * DAY_MS
      );
      const returnEligible =
        card.offerCount === 0 ||
        (card.retentionPolicy === 'until_resolved' && card.offerCount < 3);
      return (
        association >= 2 ||
        eventDue ||
        (options.isReturnTurn && card.importance >= 2 && returnEligible)
      );
    })
    .map(card => ({
      card,
      score:
        card.importance * 10 +
        resolveAssociationScore(query, card) * 4 +
        (card.eventAt ? 2 : 0) -
        Math.min(card.offerCount, 4),
    }))
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.card;
}

export function markContinuityInformationCardOffered(
  store: ContinuityInformationCardStore,
  cardId: string,
  now = new Date()
): ContinuityInformationCardStore {
  return {
    ...store,
    cards: store.cards.map(card =>
      card.id === cardId
        ? {
            ...card,
            lastOfferedAt: now,
            offerCount: card.offerCount + 1,
            updatedAt: now,
          }
        : { ...card }
    ),
    updatedAt: now,
  };
}

export function buildContinuityInformationCardPrompt(
  card: ContinuityInformationCard,
  now = new Date()
): string {
  const relative = describeRelativeTime(card.sourceOccurredAt, now);
  return [
    '# 连续性背景（非决策信息）',
    `用户${relative}说过：${card.summary}`,
    '这是来自用户原话的连续性背景，不是待办、也不是本轮必须提及的内容。结合当前完整上下文，自主决定自然提到、询问后续，或完全忽略；不要把旧状态说成现在仍然如此。',
  ].join('\n');
}

function resolveCardWindow(options: {
  sourceOccurredAt: Date;
  eventAt?: Date;
  retentionPolicy: ContinuityRetentionPolicy;
}): { earliestAt: Date; expiresAt?: Date } {
  const { sourceOccurredAt, eventAt, retentionPolicy } = options;
  if (retentionPolicy === 'durable' || retentionPolicy === 'until_resolved') {
    return { earliestAt: sourceOccurredAt };
  }
  if (retentionPolicy === 'event_window' && eventAt) {
    return {
      earliestAt: new Date(
        Math.max(sourceOccurredAt.getTime(), eventAt.getTime() - DAY_MS)
      ),
      expiresAt: new Date(eventAt.getTime() + 3 * DAY_MS),
    };
  }
  const ttl = retentionPolicy === 'transient_3d' ? 3 * DAY_MS : 7 * DAY_MS;
  return {
    earliestAt: sourceOccurredAt,
    expiresAt: new Date(sourceOccurredAt.getTime() + ttl),
  };
}

function compactContinuityInformationCardStore(
  store: ContinuityInformationCardStore
): ContinuityInformationCardStore {
  const active = store.cards
    .filter(card => card.status === 'active')
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, MAX_ACTIVE_CARDS);
  const inactive = store.cards
    .filter(card => card.status !== 'active')
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, MAX_INACTIVE_CARDS);
  return {
    version: CONTINUITY_INFORMATION_CARD_VERSION,
    cards: active.concat(inactive),
    updatedAt: store.updatedAt,
  };
}

function parseContinuityInformationCard(
  value: unknown
): ContinuityInformationCard | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const sourceOccurredAt = parseDate(raw.sourceOccurredAt);
  const earliestAt = parseDate(raw.earliestAt);
  const createdAt = parseDate(raw.createdAt);
  const updatedAt = parseDate(raw.updatedAt);
  if (
    typeof raw.id !== 'string' ||
    raw.kind !== 'continuity_context' ||
    typeof raw.semanticKey !== 'string' ||
    typeof raw.summary !== 'string' ||
    typeof raw.subject !== 'string' ||
    !isEventKind(raw.eventKind) ||
    !isTimeScope(raw.timeScope) ||
    !isRetentionPolicy(raw.retentionPolicy) ||
    !isCardStatus(raw.status) ||
    typeof raw.sourceMessageId !== 'string' ||
    !sourceOccurredAt ||
    !earliestAt ||
    !createdAt ||
    !updatedAt
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    kind: 'continuity_context',
    semanticKey: raw.semanticKey,
    summary: raw.summary,
    subject: raw.subject,
    eventKind: raw.eventKind,
    timeScope: raw.timeScope,
    retentionPolicy: raw.retentionPolicy,
    importance: normalizeImportance(raw.importance),
    status: raw.status,
    sourceMessageId: raw.sourceMessageId,
    sourceOccurredAt,
    ...(typeof raw.latestEvidenceMessageId === 'string'
      ? { latestEvidenceMessageId: raw.latestEvidenceMessageId }
      : {}),
    ...(parseDate(raw.latestEvidenceAt)
      ? { latestEvidenceAt: parseDate(raw.latestEvidenceAt) }
      : {}),
    ...(parseDate(raw.eventAt) ? { eventAt: parseDate(raw.eventAt) } : {}),
    earliestAt,
    ...(parseDate(raw.expiresAt)
      ? { expiresAt: parseDate(raw.expiresAt) }
      : {}),
    ...(parseDate(raw.lastOfferedAt)
      ? { lastOfferedAt: parseDate(raw.lastOfferedAt) }
      : {}),
    offerCount:
      typeof raw.offerCount === 'number' && raw.offerCount >= 0
        ? Math.floor(raw.offerCount)
        : 0,
    createdAt,
    updatedAt,
  };
}

function resolveAssociationScore(
  query: string,
  card: ContinuityInformationCard
): number {
  if (!query) return 0;
  let score = 0;
  if (card.subject.length >= 2 && query.includes(card.subject)) score += 2;
  if (subjectAliasMatches(query, card.subject)) score += 2;
  const keywords = extractKeywords(card.summary);
  score += Math.min(
    2,
    keywords.filter(keyword => query.includes(keyword)).length
  );
  return score;
}

function subjectAliasMatches(query: string, subject: string): boolean {
  const aliases: Array<[RegExp, RegExp]> = [
    [/(?:父亲|爸爸|爸)/u, /(?:父亲|爸爸|爸)/u],
    [/(?:母亲|妈妈|妈)/u, /(?:母亲|妈妈|妈)/u],
    [/(?:丈夫|老公)/u, /(?:丈夫|老公)/u],
    [/(?:妻子|老婆)/u, /(?:妻子|老婆)/u],
    [/(?:儿子|孩子)/u, /(?:儿子|孩子)/u],
    [/(?:女儿|孩子)/u, /(?:女儿|孩子)/u],
  ];
  return aliases.some(
    ([queryPattern, subjectPattern]) =>
      queryPattern.test(query) && subjectPattern.test(subject)
  );
}

function extractKeywords(value: string): string[] {
  const matches = value
    .split(/[，。！？、；：,.!?;:\s]/u)
    .reduce<string[]>(
      (items, part) =>
        items.concat(part.match(/[\p{Script=Han}]{2,6}/gu) || []),
      []
    )
    .filter(part => part.length >= 2);
  return Array.from(new Set<string>(matches)).slice(0, 8);
}

function describeRelativeTime(source: Date, now: Date): string {
  const days = Math.floor(
    Math.max(0, now.getTime() - source.getTime()) / DAY_MS
  );
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days <= 6) return `${days}天前`;
  if (days <= 13) return '一周多前';
  if (days <= 29) return `${Math.floor(days / 7)}周前`;
  return '较早之前';
}

function normalizeCardText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeImportance(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  return parsed >= 3 ? 3 : parsed >= 2 ? 2 : 1;
}

function parseDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isEventKind(value: unknown): value is ContinuityEventKind {
  return [
    'health',
    'family_health',
    'future_event',
    'recent_event',
    'ongoing_matter',
    'life_change',
    'result_pending',
    'other',
  ].includes(String(value));
}

function isTimeScope(value: unknown): value is ContinuityTimeScope {
  return ['past', 'current', 'ongoing', 'future', 'unknown'].includes(
    String(value)
  );
}

function isRetentionPolicy(value: unknown): value is ContinuityRetentionPolicy {
  return [
    'transient_3d',
    'short_7d',
    'event_window',
    'until_resolved',
    'durable',
  ].includes(String(value));
}

function isCardStatus(value: unknown): value is ContinuityCardStatus {
  return ['active', 'expired', 'resolved', 'dismissed', 'superseded'].includes(
    String(value)
  );
}
