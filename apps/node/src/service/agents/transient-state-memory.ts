import { AgentProfileFactType } from '@tzl/entities';

/**
 * 瞬时状态不是长期人物事实。
 *
 * 典型：今天心脏难受、现在在医院、刚才还在路上、这两天睡不着。
 * 这类状态必须带有效期，过期后不能继续作为“现在”的事实调用，
 * 也不能进入父智能体的五段长期画像。
 */
export const TRANSIENT_STATE_TTL_MS = 6 * 60 * 60 * 1000;

const CURRENT_STATE_SIGNAL =
  /(?:今天|今晚|现在|此刻|刚才|刚刚|正在|还在|目前|这两天|这几天|这阵子)/;
const ACUTE_STATE_SIGNAL =
  /(?:心脏|疼|痛|难受|发烧|住院|医院|急诊|路上|失眠|睡不着|头晕|恶心|呕吐|不舒服|情绪|心情|身体|状态不好)/;
const STABLE_STATE_SIGNAL =
  /(?:多年|长期|一直|从小|生前|去世前|离世前|老毛病|慢性|习惯性|性格|脾气|以前|去年|当时|那时候|后来|曾经|过去|小时候|婚后)/;

const TRANSIENT_KEY_PREFIX =
  /^(?:status|state|current|location|emotion|mood|health\.(?:current|today|symptom|pain|fever|hospital|condition)|symptom)\./i;

// 这些是长期画像/身份/关系来源，不是瞬时状态。
const DURABLE_KEY_PREFIX =
  /^(?:profile_source\.|identity\.|relationship\.|style\.|family\.|correction\.|promise\.|keepsake\.|taboo\.|memory\.rejected_assistant)/i;
const RESOLUTION_SIGNAL =
  /(?:现在不|现在没|现在已|现在不再|现在能|已经好转|好转了|康复|出院)/;

export interface TransientStateInput {
  type?: AgentProfileFactType | string;
  key?: string;
  value?: string;
}

export function isTransientStateFact(input: TransientStateInput): boolean {
  const key = (input.key || '').trim();
  const value = (input.value || '').trim();
  if (!key || !value) return false;
  if (input.type && input.type !== AgentProfileFactType.memory) return false;
  if (DURABLE_KEY_PREFIX.test(key)) return false;
  if (RESOLUTION_SIGNAL.test(value)) return false;
  if (TRANSIENT_KEY_PREFIX.test(key)) return true;
  if (STABLE_STATE_SIGNAL.test(value)) return false;
  return CURRENT_STATE_SIGNAL.test(value) && ACUTE_STATE_SIGNAL.test(value);
}

export function transientStateValidUntil(
  now = new Date(),
  ttlMs = TRANSIENT_STATE_TTL_MS
): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}
