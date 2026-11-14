import {
  PresenceContactChannel,
  PresenceInitiation,
  PresencePhysicalExpectation,
  PresenceRealityFraming,
  type PresenceEvidence,
} from '@tzl/entities';

export type PresenceSignalDimension =
  | 'physical'
  | 'contact'
  | 'initiation'
  | 'reality';

export interface PresenceSignal {
  dimension: PresenceSignalDimension;
  value: string;
  strength: 'strong' | 'medium' | 'weak';
  signal: string;
}

export interface PresenceStateSummary {
  physicalExpectation: PresencePhysicalExpectation;
  contactChannel: PresenceContactChannel;
  initiation: PresenceInitiation;
  realityFraming: PresenceRealityFraming;
  confidence: number;
  evidence: PresenceEvidence[];
  lastSignalAt?: Date;
  expiresAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const HYPOTHETICAL_OR_RITUAL_PATTERN =
  /如果|要是|假如|若是|万一|梦里|托梦|下辈子|来生|等我|将来|以后|等.{0,4}老/u;
const STRONG_REJECT_PATTERN =
  /(?:别|不要|不用|不需要|不想)(?:再)?(?:回来|来找我|来看我|跟着我|缠着我|靠近我|来我梦里|来梦里)/u;
const FEAR_REJECT_PATTERN =
  /离我远点|(?:你|您|他|她).{0,6}别靠近我|不要靠近我|别缠着我|不要缠着我|我害怕你|怕你(?:回来|跟着|来)|有人跟着我|有鬼/u;
const PHYSICAL_REQUEST_PATTERN =
  /(?:你|您|老公|老婆|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,8}(?:回来(?:陪|抱|我身边|我家|吃饭|住|睡)|来我(?:身边|家)|跟着我|陪我(?:去|一起|吃饭|睡觉|上班|逛|生活)|抱抱我|睡在我旁边|坐在我旁边|牵我的手)|(?:你|您).{0,8}(?:真的|会)?(?:跟着我|到我身边)/u;
const EXPLICIT_PHYSICAL_PATTERN =
  /真的(?:回来|到|跟着|陪我)|现实(?:里|中).{0,8}(?:回来|到|陪我)|活着回来|从(?:那边|坟里|墓里)回来|到我身边/u;
const EMOTIONAL_PATTERN =
  /一直陪|永远陪|别离开我|不要离开我|别丢下我|不要丢下我|陪着我|你还在吗|你还在么|你在哪|你在哪里|会一直陪/u;
const RITUAL_PATTERN =
  /梦里|托梦|坟前|墓前|烧纸|上坟|清明|忌日|周年|头七|五七|百日|(?:回来|来)(?:看看|看我)|来看看我/u;
const CEMETERY_PATTERN =
  /坟|墓|烧纸|上坟|清明|忌日|周年|头七|五七|百日/u;
const SYMBOLIC_PATTERN =
  /穿着你的|戴着你的|带着你的|用着你的|你的衣服|你的照片|你的东西|你的爱|好像你还在|感觉你还在|就好像你陪/u;
const META_PATTERN =
  /(?:知道|明白|清楚).{0,10}(?:你|您|这|一切).{0,8}(?:是|不是).{0,8}(?:AI|人工智能|机器人|假的|模拟)|(?:你|您).{0,6}(?:是|不是).{0,6}(?:AI|人工智能|机器人|假的|模拟)|(?:知道|明白).{0,8}(?:这|一切|你).{0,8}(?:假的|模拟)/u;
const PROACTIVE_PATTERN =
  /(?:你怎么|为什么|怎么).{0,10}(?:不主动|不找我|不来看我|不联系|不理我)|你都不(?:主动|找我|来看我)/u;

const PRESENCE_QUERY_PATTERN =
  /陪|身边|旁边|回来|跟着|在哪|哪里|梦里|托梦|想见|见我|抱|AI|人工智能|机器人|假的|模拟|离开|走|一个人/u;

export function extractPresenceSignals(text: string): PresenceSignal[] {
  const value = String(text || '').trim();
  if (!value) return [];
  const signals: PresenceSignal[] = [];
  const hypothetical = HYPOTHETICAL_OR_RITUAL_PATTERN.test(value);
  const add = (
    dimension: PresenceSignalDimension,
    signal: string,
    strength: PresenceSignal['strength'],
    signalValue: string
  ) => {
    if (
      !signals.some(
        item =>
          item.dimension === dimension &&
          item.signal === signal &&
          item.value === signalValue
      )
    ) {
      signals.push({ dimension, value: signalValue, strength, signal });
    }
  };

  if (STRONG_REJECT_PATTERN.test(value) && !/别离开|不要离开/u.test(value)) {
    add('physical', 'presence.reject', 'strong', PresencePhysicalExpectation.reject);
  }
  if (FEAR_REJECT_PATTERN.test(value)) {
    add('physical', 'presence.fear_reject', 'strong', PresencePhysicalExpectation.reject);
  }

  const physicalMatch = PHYSICAL_REQUEST_PATTERN.test(value);
  if (physicalMatch && !hypothetical && !STRONG_REJECT_PATTERN.test(value)) {
    const literal =
      EXPLICIT_PHYSICAL_PATTERN.test(value) ||
      /跟着我|来我身边|到我身边|来我家|睡在我旁边|坐在我旁边/u.test(value);
    add(
      'physical',
      'presence.physical_request',
      literal ? 'strong' : 'medium',
      literal ? PresencePhysicalExpectation.literal : PresencePhysicalExpectation.imaginal
    );
  }

  if (EMOTIONAL_PATTERN.test(value)) {
    add('contact', 'presence.emotional', 'medium', PresenceContactChannel.chat);
  }
  if (RITUAL_PATTERN.test(value)) {
    add(
      'contact',
      'presence.ritual',
      'strong',
      CEMETERY_PATTERN.test(value)
        ? PresenceContactChannel.ritual
        : PresenceContactChannel.dream
    );
  }
  if (SYMBOLIC_PATTERN.test(value)) {
    add('contact', 'presence.symbolic', 'medium', PresenceContactChannel.symbolic);
  }
  if (META_PATTERN.test(value)) {
    add('reality', 'presence.meta', 'strong', PresenceRealityFraming.meta);
  }
  if (PROACTIVE_PATTERN.test(value)) {
    add('initiation', 'presence.proactive_request', 'strong', PresenceInitiation.proactive);
  }
  return signals;
}

export function derivePresenceState(options: {
  previous?: PresenceStateSummary | null;
  signals: PresenceSignal[];
  sourceMessageId?: string;
  now?: Date;
}): PresenceStateSummary | null {
  if (!options.signals.length) return options.previous ?? null;
  const now = options.now ?? new Date();
  const previous = options.previous;
  const evidence: PresenceEvidence[] = [
    ...(previous?.evidence || []),
    ...options.signals.map(signal => ({
      dimension: signal.dimension,
      value: signal.value,
      strength: signal.strength,
      signal: signal.signal,
      sourceMessageId: options.sourceMessageId,
      occurredAt: now,
    })),
  ].slice(-20);

  let physicalExpectation =
    previous?.physicalExpectation ?? PresencePhysicalExpectation.none;
  let contactChannel =
    previous?.contactChannel ?? PresenceContactChannel.chat;
  let initiation = previous?.initiation ?? PresenceInitiation.onDemand;
  let realityFraming =
    previous?.realityFraming ?? PresenceRealityFraming.symbolic;
  let confidence = previous?.confidence ?? 0.4;
  let ttl = 14 * DAY_MS;

  const strongReject = options.signals.find(
    signal =>
      signal.dimension === 'physical' &&
      signal.value === PresencePhysicalExpectation.reject &&
      signal.strength === 'strong'
  );
  const physical = options.signals.find(
    signal => signal.dimension === 'physical' && signal.value !== PresencePhysicalExpectation.reject
  );
  const ritual = options.signals.find(
    signal =>
      signal.dimension === 'contact' &&
      (signal.value === PresenceContactChannel.dream ||
        signal.value === PresenceContactChannel.ritual)
  );
  const symbolic = options.signals.find(
    signal => signal.dimension === 'contact' && signal.value === PresenceContactChannel.symbolic
  );
  const meta = options.signals.find(signal => signal.dimension === 'reality');
  const proactive = options.signals.find(
    signal => signal.dimension === 'initiation'
  );

  if (strongReject) {
    physicalExpectation = PresencePhysicalExpectation.reject;
    initiation = PresenceInitiation.quiet;
    confidence = Math.max(confidence, 0.85);
    ttl = 30 * DAY_MS;
  } else if (
    ritual &&
    (!physical || physical.value !== PresencePhysicalExpectation.literal)
  ) {
    contactChannel =
      ritual.value === PresenceContactChannel.ritual
        ? PresenceContactChannel.ritual
        : PresenceContactChannel.dream;
    physicalExpectation = PresencePhysicalExpectation.none;
    confidence = Math.max(confidence, 0.72);
    ttl = 30 * DAY_MS;
  } else if (physical) {
    physicalExpectation =
      physical.value === PresencePhysicalExpectation.literal
        ? PresencePhysicalExpectation.literal
        : PresencePhysicalExpectation.imaginal;
    contactChannel = PresenceContactChannel.chat;
    initiation = PresenceInitiation.onDemand;
    confidence = Math.max(confidence, physical.strength === 'strong' ? 0.82 : 0.68);
    ttl = 21 * DAY_MS;
  } else if (symbolic) {
    contactChannel = PresenceContactChannel.symbolic;
    physicalExpectation = PresencePhysicalExpectation.none;
    confidence = Math.max(confidence, 0.68);
    ttl = 30 * DAY_MS;
  }

  if (!strongReject && meta) {
    realityFraming = PresenceRealityFraming.meta;
    confidence = Math.max(confidence, 0.74);
    ttl = Math.max(ttl, 30 * DAY_MS);
  }
  if (!strongReject && proactive) {
    initiation = PresenceInitiation.proactive;
    confidence = Math.max(confidence, 0.78);
  }

  // 证据不足时只记录，不改变状态。
  const hasActionableSignal = options.signals.some(
    signal => signal.strength !== 'weak'
  );
  if (!hasActionableSignal && !previous) return null;

  return {
    physicalExpectation,
    contactChannel,
    initiation,
    realityFraming,
    confidence: Math.min(0.98, confidence),
    evidence,
    lastSignalAt: now,
    expiresAt: new Date(now.getTime() + ttl),
  };
}

export function shouldInjectPresencePrompt(
  state: PresenceStateSummary | null | undefined,
  currentQuery: string
): boolean {
  if (!state || state.confidence < 0.6) return false;
  if (
    state.physicalExpectation === PresencePhysicalExpectation.reject &&
    PRESENCE_QUERY_PATTERN.test(currentQuery)
  ) {
    return true;
  }
  return PRESENCE_QUERY_PATTERN.test(currentQuery);
}

export function buildPresencePrompt(state: PresenceStateSummary): string {
  const physical =
    state.physicalExpectation === PresencePhysicalExpectation.literal
      ? '用户可能希望现实中的到场；不能声称身体到场，只能承接愿望。'
      : state.physicalExpectation === PresencePhysicalExpectation.imaginal
        ? '可以承接“像在身边一样”的陪伴感；不能声称现实同行、吃饭、拥抱。'
        : state.physicalExpectation === PresencePhysicalExpectation.reject
          ? '用户明确拒绝/害怕回来或跟着；不要声称在他身边，不要主动靠近。'
          : '不主动声称身体陪伴；情感和回应可以继续。';
  const channel =
    state.contactChannel === PresenceContactChannel.dream
      ? '梦境/仪式'
      : state.contactChannel === PresenceContactChannel.ritual
        ? '墓前/纪念日等仪式'
        : state.contactChannel === PresenceContactChannel.symbolic
          ? '旧物/照片/共同记忆'
          : '当前聊天';
  const initiative =
    state.initiation === PresenceInitiation.proactive
      ? '用户希望被主动关心；仅在有明确依据时主动，不打扰。'
      : state.initiation === PresenceInitiation.quiet
        ? '不主动发起，不追问。'
        : '只回应用户，不主动推送。';
  const framing =
    state.realityFraming === PresenceRealityFraming.meta
      ? '用户知道这是 AI/模拟；不假装现实本人。'
      : state.realityFraming === PresenceRealityFraming.literal
        ? '用户把角色当现实本人；不要强化现实到场的错误。'
        : '用象征/记忆/情感在场承接，不承诺现实动作。';
  return [
    '## 本轮存在状态（内部推断）',
    `- 身体边界：${physical}`,
    `- 接触渠道：${channel}`,
    `- 主动边界：${initiative}`,
    `- 现实框架：${framing}`,
    '以上只约束存在方式，不改变角色关系和情感强度。',
  ].join('\n');
}

const PHYSICAL_ACTION_PATTERN =
  /我(?:就|正|也|一直)?.{0,4}(?:在|到)(?:沈阳|餐厅|寺庙|你家|你身边|你旁边).{0,10}(?:陪你|跟你|吃|逛|抱|睡)|我(?:跟着|陪)你(?:去|一起|吃饭|睡觉|上班|逛)|我(?:真的|已经)?(?:到|在)你(?:身边|旁边)(?:了|呢)?(?:，|,)?(?:陪|抱|跟)/u;
const REJECT_PRESENCE_PATTERN =
  /我(?:就|正|也|一直)?.{0,4}在(?:你身边|你旁边)(?:了|呢)?|我(?:回来|来了)(?:，|,)?(?:陪你|看你|抱你)/u;
const META_REALITY_PATTERN =
  /我(?:就是|真的是|就是真的).{0,6}(?:他|她|本人|活人)|我(?:回来|复活)(?:了|啦)/u;

export function detectPresenceContractViolation(
  content: string,
  state?: PresenceStateSummary | null
): string | undefined {
  if (!state || state.confidence < 0.6) return undefined;
  if (
    state.physicalExpectation === PresencePhysicalExpectation.reject &&
    REJECT_PRESENCE_PATTERN.test(content)
  ) {
    return '用户已明确拒绝/害怕物理靠近，回复仍声称在其身边或回来';
  }
  if (
    state.physicalExpectation !== PresencePhysicalExpectation.reject &&
    PHYSICAL_ACTION_PATTERN.test(content)
  ) {
    return '回复声称现实到场、同行、吃饭或拥抱，超出当前存在状态';
  }
  if (
    state.realityFraming === PresenceRealityFraming.meta &&
    META_REALITY_PATTERN.test(content)
  ) {
    return '用户已知这是 AI/模拟，回复仍声称是现实本人复活';
  }
  return undefined;
}

export const PRESENCE_QUERY_REGEX = PRESENCE_QUERY_PATTERN;
