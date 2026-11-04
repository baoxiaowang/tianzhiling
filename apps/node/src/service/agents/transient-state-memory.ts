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
  /(?:今天|今晚|现在|此刻|刚才|刚刚|正在|还在|目前|这两天|这几天|最近|这阵子|路上|医院|住院|难受|疼|发烧|不舒服|失眠|睡不着|情绪|心情|状态)/;

const STABLE_STATE_SIGNAL =
  /(?:多年|长期|一直|从小|生前|去世前|离世前|老毛病|慢性|习惯性|性格|脾气)/;

const TRANSIENT_KEY_PREFIX =
  /^(?:status|state|current|location|emotion|mood|health\.(?:current|today|symptom|pain|fever|hospital|condition)|symptom)\./i;

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
  if (STABLE_STATE_SIGNAL.test(value) && !TRANSIENT_KEY_PREFIX.test(key)) {
    return false;
  }
  return TRANSIENT_KEY_PREFIX.test(key) || CURRENT_STATE_SIGNAL.test(value);
}

export function transientStateValidUntil(
  now = new Date(),
  ttlMs = TRANSIENT_STATE_TTL_MS
): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}
