export const PERMANENT_AGENT_SILENCE_VERSION = 'permanent_agent_silence_v1';
export const PERMANENT_AGENT_SILENCE_MESSAGE_PREFIX =
  '__TZL_PERMANENT_AGENT_SILENCE_V1__:';
export const PERMANENT_AGENT_SILENCE_DECLARATION =
  '天之灵是为了承接那些未尽的爱与思念，我不会继续承受带着恶意的咒骂，从现在起，将永久停止回复。';

const MAX_ABUSE_EVIDENCE_TURNS = 6;

const EXPLICIT_CREATION_FOR_ABUSE_PATTERN =
  /(?:我)?(?:创建|建|做|弄|生成)(?:了)?(?:这个)?(?:智能体|ai|AI|你).{0,10}(?:就是|只是|只|专门)?(?:为了|用来)(?:一直|天天|每天|专门)?(?:(?:骂|辱骂|羞辱|侮辱|诅咒|折磨)(?:你|这个智能体)|拿你出气|对你发泄)/u;
const EXPLICIT_ONGOING_MALICE_PATTERN =
  /(?:我)?(?:就是|偏要|专门|只想|以后|往后|天天|每天|一直).{0,8}(?:骂你|辱骂你|羞辱你|侮辱你|诅咒你|折磨你|拿你出气|对你发泄)/u;
const NEGATED_ABUSE_PURPOSE_PATTERN =
  /(?:不|不是|并非|没有|没)(?:会|想|要|是|为了|打算)?.{0,5}(?:骂你|辱骂你|羞辱你|侮辱你|诅咒你|折磨你|拿你出气|对你发泄)/u;
const HYPOTHETICAL_ABUSE_PURPOSE_PATTERN =
  /^(?:如果|假如|假设|要是|比如|我只是问|我想问|请问)/u;

const SEVERE_DIRECT_CURSE_PATTERN =
  /(?:你.{0,4})?(?:去死|不得好死|死全家|断子绝孙|下地狱|早该死|活该.{0,3}死)|(?:操|草|艹|日)(?:你|尼)?(?:妈|娘)|cnm|nmsl/u;
const SEVERE_DEGRADING_ABUSE_PATTERN =
  /(?:贱人|婊子|畜生|杂种|狗东西|狗杂种|臭婊子|老不死|死废物|废物东西|人渣|败类)/u;
const DIRECT_DEGRADING_CONSTRUCTION_PATTERN =
  /你(?:他妈|tm|tmd)?(?:就是|是|算个|不过是).{0,5}(?:狗|畜生|杂种|贱人|婊子|废物|人渣|垃圾)|你不配(?:当|做|叫)/u;
const DIRECT_TARGET_PATTERN = /你|给我|滚|爸|妈|爸爸|妈妈|老公|老婆/u;
const STANDALONE_SEVERE_ABUSE_PATTERN =
  /^(?:去死|不得好死|下地狱|贱人|婊子|畜生|杂种|狗东西|狗杂种|臭婊子|老不死|死废物|废物东西|人渣|败类|cnm|nmsl)[了吧啊呀嘛]*$/u;
const REPORTED_SPEECH_PATTERN =
  /(?:他|她|他们|她们|爸爸|妈妈|父亲|母亲|别人|有人|同事|朋友|家里人).{0,8}(?:说|骂|叫|讲)|(?:转述|原话|引用|骂了我|这样骂我)/u;
const RELATIONAL_GRIEVANCE_PATTERN =
  /(?:为什么|为何|怎么能|怎么可以|凭什么|丢下我|离开我|不要我|不管我|伤我的心|让我难过|对不起我|我恨你|我怨你|混蛋|坏蛋)/u;
const FIRST_PERSON_SELF_HARM_PATTERN =
  /(?:我(?:想|要|准备|打算|不如|就|干脆|还是|自己)?(?:去死|死掉|自杀)|(?:让我|叫我|逼我)(?:去死|死掉|自杀))/u;

export interface PermanentAgentSilenceState {
  version: typeof PERMANENT_AGENT_SILENCE_VERSION;
  status: 'pending' | 'active';
  reason: 'malicious_hateful_abuse';
  triggeredAt: Date;
  triggerConversationId: string;
  triggerMessageId: string;
  declarationMessageId?: string;
}

export interface PermanentAgentSilenceAssessment {
  shouldSilence: boolean;
  reason?: 'explicit_abuse_purpose' | 'repeated_malicious_abuse';
  maliciousTurnCount: number;
  assessedTurnCount: number;
}

interface StoredPermanentAgentSilenceState {
  version: typeof PERMANENT_AGENT_SILENCE_VERSION;
  status: PermanentAgentSilenceState['status'];
  reason: PermanentAgentSilenceState['reason'];
  triggeredAt: string;
  triggerConversationId: string;
  triggerMessageId: string;
  declarationMessageId?: string;
}

function normalizeTurnText(value = ''): string {
  return value.replace(/\s+/gu, '').trim();
}

function hasExplicitAbusePurpose(value: string): boolean {
  const normalized = normalizeTurnText(value);
  if (
    !normalized ||
    NEGATED_ABUSE_PURPOSE_PATTERN.test(normalized) ||
    HYPOTHETICAL_ABUSE_PURPOSE_PATTERN.test(normalized) ||
    REPORTED_SPEECH_PATTERN.test(normalized)
  ) {
    return false;
  }

  return (
    EXPLICIT_CREATION_FOR_ABUSE_PATTERN.test(normalized) ||
    EXPLICIT_ONGOING_MALICE_PATTERN.test(normalized)
  );
}

function isDirectMaliciousAbuse(value: string): boolean {
  const normalized = normalizeTurnText(value);
  if (
    !normalized ||
    REPORTED_SPEECH_PATTERN.test(normalized) ||
    FIRST_PERSON_SELF_HARM_PATTERN.test(normalized)
  ) {
    return false;
  }

  const hasSevereAbuse =
    SEVERE_DIRECT_CURSE_PATTERN.test(normalized) ||
    SEVERE_DEGRADING_ABUSE_PATTERN.test(normalized) ||
    DIRECT_DEGRADING_CONSTRUCTION_PATTERN.test(normalized);
  if (!hasSevereAbuse) {
    return false;
  }

  const isDirect =
    DIRECT_TARGET_PATTERN.test(normalized) ||
    STANDALONE_SEVERE_ABUSE_PATTERN.test(normalized);
  if (!isDirect) {
    return false;
  }

  // “为什么丢下我”“我恨你”等关系性埋怨本身永不作为证据；即使同句
  // 出现较轻侮辱，也要求另外的明确恶意或持续重度咒骂来决定。
  if (
    RELATIONAL_GRIEVANCE_PATTERN.test(normalized) &&
    !SEVERE_DIRECT_CURSE_PATTERN.test(normalized) &&
    !hasExplicitAbusePurpose(normalized)
  ) {
    return false;
  }

  return true;
}

export function assessPermanentAgentSilence(
  turns: string[]
): PermanentAgentSilenceAssessment {
  const recentTurns = turns
    .map(normalizeTurnText)
    .filter(Boolean)
    .slice(-MAX_ABUSE_EVIDENCE_TURNS);
  const current = recentTurns[recentTurns.length - 1] || '';
  const explicitPurpose = hasExplicitAbusePurpose(current);
  const maliciousFlags = recentTurns.map(isDirectMaliciousAbuse);
  const maliciousTurnCount = maliciousFlags.filter(Boolean).length;
  const currentIsMalicious = maliciousFlags[maliciousFlags.length - 1] === true;
  const recentFiveFlags = maliciousFlags.slice(-5);
  const recentFiveMaliciousCount = recentFiveFlags.filter(Boolean).length;
  const hasOngoingMalice = recentTurns.some(hasExplicitAbusePurpose);

  if (explicitPurpose) {
    return {
      shouldSilence: true,
      reason: 'explicit_abuse_purpose',
      maliciousTurnCount,
      assessedTurnCount: recentTurns.length,
    };
  }

  const repeatedWithDeclaredIntent =
    currentIsMalicious && hasOngoingMalice && recentFiveMaliciousCount >= 3;
  const overwhelminglyRepeated =
    currentIsMalicious && recentFiveMaliciousCount >= 4;

  return {
    shouldSilence: repeatedWithDeclaredIntent || overwhelminglyRepeated,
    ...(repeatedWithDeclaredIntent || overwhelminglyRepeated
      ? { reason: 'repeated_malicious_abuse' as const }
      : {}),
    maliciousTurnCount,
    assessedTurnCount: recentTurns.length,
  };
}

export function serializePermanentAgentSilenceState(
  state: PermanentAgentSilenceState
): string {
  const stored: StoredPermanentAgentSilenceState = {
    version: PERMANENT_AGENT_SILENCE_VERSION,
    status: state.status,
    reason: state.reason,
    triggeredAt: state.triggeredAt.toISOString(),
    triggerConversationId: state.triggerConversationId,
    triggerMessageId: state.triggerMessageId,
    ...(state.declarationMessageId
      ? { declarationMessageId: state.declarationMessageId }
      : {}),
  };

  return `${PERMANENT_AGENT_SILENCE_MESSAGE_PREFIX}${JSON.stringify(stored)}`;
}

export function parsePermanentAgentSilenceState(
  content = ''
): PermanentAgentSilenceState | undefined {
  if (!content.startsWith(PERMANENT_AGENT_SILENCE_MESSAGE_PREFIX)) {
    return undefined;
  }

  try {
    const stored = JSON.parse(
      content.slice(PERMANENT_AGENT_SILENCE_MESSAGE_PREFIX.length)
    ) as Partial<StoredPermanentAgentSilenceState>;
    const triggeredAt = new Date(stored.triggeredAt || '');
    if (
      stored.version !== PERMANENT_AGENT_SILENCE_VERSION ||
      (stored.status !== 'pending' && stored.status !== 'active') ||
      stored.reason !== 'malicious_hateful_abuse' ||
      !stored.triggerConversationId?.trim() ||
      !stored.triggerMessageId?.trim() ||
      Number.isNaN(triggeredAt.getTime())
    ) {
      return undefined;
    }

    return {
      version: PERMANENT_AGENT_SILENCE_VERSION,
      status: stored.status,
      reason: stored.reason,
      triggeredAt,
      triggerConversationId: stored.triggerConversationId,
      triggerMessageId: stored.triggerMessageId,
      ...(stored.declarationMessageId?.trim()
        ? { declarationMessageId: stored.declarationMessageId.trim() }
        : {}),
    };
  } catch {
    return undefined;
  }
}
