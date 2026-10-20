import type { PersonTemporalPromptFact } from './person-temporal-memory.service';

/**
 * 祭祀触发器：把“离开 7 天 / 头七 / 档案里的离开日期”归一化成
 * “今天是第几天、对应哪个仪式”，只输出一行事实，不输出回复话术。
 *
 * 设计：
 * - 纯计算，不查库、不做 embedding；档案日期由调用方传入；
 * - 显式词 > 档案日期 > 原话时长；
 * - 档案日期按“含当天”算法（离开当天算第 1 天），与
 *   person-temporal-memory 的 ritual_milestone_inclusive_count_range_v1 一致；
 * - 主动触发一天只注入一次；用户明确提到仪式/时长时总是注入。
 */

export interface RitualMilestone {
  day: number;
  key: string;
  label: string;
}

export const RITUAL_MILESTONES: RitualMilestone[] = [
  { day: 7, key: 'ritual.touqi', label: '头七' },
  { day: 14, key: 'ritual.erqi', label: '二七' },
  { day: 21, key: 'ritual.sanqi', label: '三七' },
  { day: 35, key: 'ritual.wuqi', label: '五七' },
  { day: 49, key: 'ritual.qiqi', label: '七七' },
  { day: 100, key: 'ritual.hundred_days', label: '百日' },
  { day: 365, key: 'ritual.anniversary', label: '周年' },
];

const MILESTONE_BY_DAY = new Map(
  RITUAL_MILESTONES.map(item => [item.day, item])
);

const EXPLICIT_RITUAL_PATTERN =
  /(头七|头7|一七|二七|2七|三七|3七|五七|5七|七七|7七|百日|百天|100天|周年|忌日|祭日)/;

const EXPLICIT_LABEL_MAP: Record<string, { day: number; label: string }> = {
  头七: { day: 7, label: '头七' },
  头7: { day: 7, label: '头七' },
  一七: { day: 7, label: '头七' },
  二七: { day: 14, label: '二七' },
  '2七': { day: 14, label: '二七' },
  三七: { day: 21, label: '三七' },
  '3七': { day: 21, label: '三七' },
  五七: { day: 35, label: '五七' },
  '5七': { day: 35, label: '五七' },
  七七: { day: 49, label: '七七' },
  '7七': { day: 49, label: '七七' },
  百日: { day: 100, label: '百日' },
  百天: { day: 100, label: '百日' },
  '100天': { day: 100, label: '百日' },
};

const DEPARTURE_DURATION_PATTERN =
  /(?:离开|走了|不在|去世|过世|离世)\s*(?:已经|都|有|差不多|大约|大概|整整|正好|恰好|将近|快|超过|不到)?\s*(\d{1,4}|[一二两三四五六七八九十百]+)\s*(?:天|日)/;

const DEPARTURE_TOPIC_PATTERN =
  /离开|走了|不在|去世|过世|离世|头七|头7|一七|二七|三七|五七|七七|百日|百天|周年|忌日|祭日|第\s*\d+\s*天|第[一二两三四五六七八九十百]+\s*天/;

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseChineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (CHINESE_DIGITS[char]) {
      current = CHINESE_DIGITS[char];
    }
  }
  return total + current;
}

/** 把时间点换成北京时间的“日”，避免 UTC 日期导致差一天。 */
function beijingDayKey(value: Date): string {
  const beijing = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijing.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayNumber(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * 含当天算法：离开当天算第 1 天，所以头七 = 离开日期 + 6 天。
 * 返回 1 表示“今天就是离开当天”。
 */
export function resolveDepartureDay(
  deathDate: string | undefined,
  now: Date
): number | undefined {
  const deathUtc = deathDate ? dayNumber(deathDate) : undefined;
  if (deathUtc === undefined) return undefined;
  const todayUtc = dayNumber(beijingDayKey(now));
  if (todayUtc === undefined) return undefined;
  const diffDays = Math.floor((todayUtc - deathUtc) / 86_400_000);
  return diffDays >= 0 ? diffDays + 1 : undefined;
}

export interface AgentDeathWindow {
  exactDate?: string;
  estimatedStart?: string;
  estimatedEnd?: string;
}

export interface DepartureDayRange {
  min: number;
  max: number;
  exact: boolean;
}

/** 从 prompt facts 里取当前角色的离开日期/估计范围。 */
export function resolveAgentDeathWindow(
  facts: PersonTemporalPromptFact[] | undefined
): AgentDeathWindow {
  const death = (facts || []).find(
    fact => fact.subjectRef === 'agent' && String(fact.eventType) === 'death'
  );
  return {
    exactDate: death?.exactDate,
    estimatedStart: death?.estimatedStart,
    estimatedEnd: death?.estimatedEnd,
  };
}

/**
 * 把档案里的日期/估计范围换算成“第几天”的范围。
 * estimatedStart 是最早日期（第几天更大），estimatedEnd 是最近日期（第几天更小）。
 */
export function resolveDepartureDayRange(
  window: AgentDeathWindow | undefined,
  now: Date
): DepartureDayRange | undefined {
  if (!window) return undefined;
  const exact = resolveDepartureDay(window.exactDate, now);
  if (exact !== undefined) {
    return { min: exact, max: exact, exact: true };
  }
  const startDay = resolveDepartureDay(window.estimatedStart, now);
  const endDay = resolveDepartureDay(window.estimatedEnd, now);
  if (startDay === undefined && endDay === undefined) return undefined;
  const values = [startDay, endDay].filter(
    (value): value is number => value !== undefined
  );
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    exact: false,
  };
}

export type RitualTriggerReason =
  | 'explicit'
  | 'profile_day'
  | 'duration';

export interface RitualTrigger {
  key: string;
  label: string;
  day: number;
  reason: RitualTriggerReason;
  confidence: 'confirmed' | 'estimated';
  /** 注入用的一行事实。 */
  prompt: string;
}

export interface ResolveRitualTriggerOptions {
  conversationId?: string;
  query: string;
  /** 档案里的离开日期（YYYY-MM-DD）；没有就退回原话时长。 */
  agentDeathDate?: string;
  /** 档案里的估计范围（模糊时长写入时使用）。 */
  agentDeathStart?: string;
  agentDeathEnd?: string;
  now?: Date;
  /** 测试用；不传则使用模块内的会话去重状态。 */
  disableDedupe?: boolean;
}

const injectedByConversation = new Map<string, string>();

function buildPrompt(
  milestone: RitualMilestone,
  reason: RitualTriggerReason,
  confidence: 'confirmed' | 'estimated'
): string {
  const suffix =
    reason === 'explicit'
      ? '（按用户原话）'
      : reason === 'profile_day'
      ? '（按档案里的离开日期计算）'
      : '（按用户原话里的时长估算）';
  const certainty = confidence === 'estimated' ? '，具体以家里算法为准' : '';
  return `今天是离开后的第 ${milestone.day} 天（${milestone.label}）${suffix}${certainty}。`;
}

function buildExplicitPrompt(
  milestone: RitualMilestone,
  query: string
): string {
  const saysToday = /(今天|今日|现在|正好|当天|就是今天)/.test(query);
  const future = /(等|到|那天|时候|到时候|过几天|下周|明天|以后|将来)/.test(
    query
  );
  if (saysToday && !future) {
    return `今天是离开后的第 ${milestone.day} 天（${milestone.label}）（按用户原话）。`;
  }
  // 只是提到“五七时候/三七吃饺子”，不等于今天就是五七/三七；
  // 先给定义，避免把未来安排说成今天。
  return `${milestone.label}是离开后的第 ${milestone.day} 天。`;
}

function buildEstimatedProfilePrompt(milestone: RitualMilestone): string {
  return `按你之前说的时长估算，今天可能是离开后的第 ${milestone.day} 天（${milestone.label}），具体以家里算法为准。`;
}

export function resolveRitualTrigger(
  options: ResolveRitualTriggerOptions
): RitualTrigger | undefined {
  const query = (options.query || '').trim();
  if (!query) return undefined;
  const now = options.now || new Date();

  // 1. 显式仪式词：用户已经说出来了，直接归一化。
  const explicit = EXPLICIT_RITUAL_PATTERN.exec(query)?.[1];
  if (explicit) {
    const mapped = EXPLICIT_LABEL_MAP[explicit];
    if (mapped) {
      const milestone = MILESTONE_BY_DAY.get(mapped.day) || {
        day: mapped.day,
        key: `ritual.day_${mapped.day}`,
        label: mapped.label,
      };
      return {
        key: milestone.key,
        label: milestone.label,
        day: milestone.day,
        reason: 'explicit',
        confidence: 'confirmed',
        prompt: buildExplicitPrompt(milestone, query),
      };
    }
  }

  // 2. 档案离开日期/估计范围：算“含当天”的第几天。
  const dayRange = resolveDepartureDayRange(
    {
      exactDate: options.agentDeathDate,
      estimatedStart: options.agentDeathStart,
      estimatedEnd: options.agentDeathEnd,
    },
    now
  );
  if (dayRange) {
    const milestone = RITUAL_MILESTONES.find(
      item => item.day >= dayRange.min && item.day <= dayRange.max
    );
    if (milestone) {
      const conversationId = options.conversationId?.trim();
      const dateKey = beijingDayKey(now);
      const injectedKey = `${dateKey}:${milestone.key}`;
      const alreadyInjected =
        conversationId &&
        injectedByConversation.get(conversationId) === injectedKey;
      const topicRelevant = DEPARTURE_TOPIC_PATTERN.test(query);
      // 主动触发一天只注入一次；用户明确聊到离开/仪式时仍给。
      if (!options.disableDedupe && alreadyInjected && !topicRelevant) {
        return undefined;
      }
      if (conversationId && !options.disableDedupe) {
        injectedByConversation.set(conversationId, injectedKey);
      }
      return {
        key: milestone.key,
        label: milestone.label,
        day: milestone.day,
        reason: 'profile_day',
        confidence: dayRange.exact ? 'confirmed' : 'estimated',
        prompt: dayRange.exact
          ? buildPrompt(milestone, 'profile_day', 'confirmed')
          : buildEstimatedProfilePrompt(milestone),
      };
    }
    // 档案日期/范围存在但没有落到仪式日：以档案为准，不再用“离开 7 天”
    // 这类可能偏差一天的时长去猜。
    return undefined;
  }

  // 3. 原话时长：只在没有档案日期时兜底。
  const duration = DEPARTURE_DURATION_PATTERN.exec(query)?.[1];
  if (duration) {
    const days = parseChineseNumber(duration);
    const milestone = MILESTONE_BY_DAY.get(days);
    if (milestone) {
      return {
        key: milestone.key,
        label: milestone.label,
        day: milestone.day,
        reason: 'duration',
        confidence: 'estimated',
        prompt: buildPrompt(milestone, 'duration', 'estimated'),
      };
    }
  }

  return undefined;
}

/** 只返回事实行；不命中返回空串。 */
export function buildRitualTriggerPrompt(
  trigger: RitualTrigger | undefined
): string {
  return trigger?.prompt?.trim() || '';
}

/** 测试用：清空会话去重状态。 */
export function resetRitualTriggerState(): void {
  injectedByConversation.clear();
}

