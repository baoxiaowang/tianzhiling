/**
 * 读侧偏好编译器：把 active 的用户偏好压成稳定/任务两段短提示。
 *
 * - global：常驻稳定段，保证前缀缓存稳定；
 * - topic/time：只在本轮命中触发条件时放任务层；
 * - 不注入原话，不规定回复话术。
 */

export interface UserPreferenceFactLike {
  key: string;
  value: string;
  status?: string;
  priority?: number;
  preferenceScope?: 'global' | 'topic' | 'time' | 'person';
  preferenceTriggers?: string[];
}

export interface UserPreferencePromptSection {
  stable: string;
  task: string;
}

const GLOBAL_KEYS = new Set([
  'taboo.comfort.avoid',
  'style.preference.death_wording',
  'style.preference.region_dialect',
]);

function isActive(fact: UserPreferenceFactLike): boolean {
  return fact.status === undefined || fact.status === 'active';
}

function renderGlobal(fact: UserPreferenceFactLike): string {
  if (fact.key === 'taboo.comfort.avoid') {
    return `用户明确禁忌（必须遵守）：${fact.value}`;
  }
  if (fact.key === 'style.preference.death_wording') {
    return `用户用词偏好：${fact.value}`;
  }
  if (fact.key === 'style.preference.region_dialect') {
    return `用户地区表达偏好：${fact.value}`;
  }
  return `用户长期偏好：${fact.value}`;
}

function hourInBeijing(now: Date): number {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
}

function matchesTrigger(
  fact: UserPreferenceFactLike,
  query: string,
  now: Date
): boolean {
  const triggers = (fact.preferenceTriggers || []).filter(Boolean);
  if (!triggers.length) return false;
  const hour = hourInBeijing(now);
  return triggers.some(trigger => {
    if (trigger === '晚上') return hour >= 18 || hour < 5;
    if (trigger === '白天') return hour >= 6 && hour < 18;
    if (trigger === '早上') return hour >= 5 && hour < 11;
    return query.includes(trigger);
  });
}

export function buildUserPreferencePromptSection(
  facts: UserPreferenceFactLike[],
  options: { query?: string; now?: Date } = {}
): UserPreferencePromptSection {
  const active = (facts || [])
    .filter(isActive)
    .filter(fact => fact.key && fact.value)
    .sort(
      (left, right) =>
        (right.priority || 0) - (left.priority || 0) ||
        left.key.localeCompare(right.key)
    );

  const stableLines: string[] = [];
  const personLines: string[] = [];
  const taskLines: string[] = [];
  const seen = new Set<string>();

  for (const fact of active) {
    if (seen.has(fact.key)) continue;
    if (fact.preferenceScope === 'global' || GLOBAL_KEYS.has(fact.key)) {
      seen.add(fact.key);
      if (stableLines.length < 5) stableLines.push(renderGlobal(fact));
      continue;
    }
    if (fact.preferenceScope === 'person') {
      seen.add(fact.key);
      if (personLines.length >= 5) continue;
      if (fact.key.startsWith('style.preference.kinship_display.')) {
        personLines.push(`称呼偏好：${fact.value}`);
      } else if (fact.key.startsWith('taboo.kinship_avoid.')) {
        personLines.push(`称呼禁忌：${fact.value}`);
      }
      continue;
    }
    if (
      (fact.preferenceScope === 'topic' || fact.preferenceScope === 'time') &&
      matchesTrigger(fact, options.query || '', options.now || new Date())
    ) {
      seen.add(fact.key);
      if (taskLines.length < 3) {
        taskLines.push(`本轮偏好：${fact.value}`);
      }
    }
  }

  const lines = [...stableLines, ...personLines];
  return {
    stable: lines.length ? ['# 用户明确偏好', ...lines].join('\n') : '',
    task: taskLines.length
      ? ['# 本轮偏好', ...taskLines].join('\n')
      : '',
  };
}
