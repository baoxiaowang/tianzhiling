/**
 * 节日日期触发器：把“清明/中元/寒衣/春节”变成具体日期。
 *
 * - 清明：二十四节气，用 21 世纪通用公式计算（4/4 或 4/5）；
 * - 中元：农历七月十五；
 * - 寒衣：农历十月初一；
 * - 春节：农历正月初一。
 * 农历换算用 Intl 的中国历法，不引入第三方历法库；结果按年缓存。
 *
 * 只输出“今年这个节日是哪天”的事实，不输出回复话术。
 */

export type FestivalKey = 'qingming' | 'zhongyuan' | 'hanyi' | 'chunjie';

export interface FestivalDefinition {
  key: FestivalKey;
  label: string;
  aliases: string[];
}

export const FESTIVALS: FestivalDefinition[] = [
  { key: 'qingming', label: '清明', aliases: ['清明'] },
  { key: 'zhongyuan', label: '中元', aliases: ['中元', '七月半', '鬼节'] },
  { key: 'hanyi', label: '寒衣', aliases: ['寒衣'] },
  { key: 'chunjie', label: '春节', aliases: ['春节', '过年'] },
];

const lunarCache = new Map<string, string | undefined>();

function beijingDateKey(value: Date): string {
  const beijing = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijing.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateOnly(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0'
  )}`;
}

/** 清明：21 世纪公式，结果通常是 4/4 或 4/5。 */
export function resolveQingmingDate(year: number): string {
  const y = year % 100;
  const day = Math.floor(y * 0.2422 + 4.81) - Math.floor(y / 4);
  return dateOnly(year, 4, day);
}

/**
 * 农历月日 → 公历日期。遍历该公历年，用 Intl 中国历法匹配。
 * 闰月会带“闰”字，直接跳过；找不到返回 undefined。
 */
export function resolveLunarDate(
  year: number,
  lunarMonth: number,
  lunarDay: number
): string | undefined {
  const cacheKey = `${year}:${lunarMonth}:${lunarDay}`;
  if (lunarCache.has(cacheKey)) return lunarCache.get(cacheKey);

  const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
  });
  const target = `${lunarMonth}-${lunarDay}`;
  for (let offset = 0; offset < 366; offset += 1) {
    const date = new Date(Date.UTC(year, 0, 1 + offset));
    const formatted = formatter.format(date);
    if (formatted.includes('闰')) continue;
    if (formatted.replace(/月/g, '').trim() === target) {
      const result = dateOnly(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate()
      );
      lunarCache.set(cacheKey, result);
      return result;
    }
  }
  lunarCache.set(cacheKey, undefined);
  return undefined;
}

export function resolveFestivalDate(
  key: FestivalKey,
  year: number
): string | undefined {
  switch (key) {
    case 'qingming':
      return resolveQingmingDate(year);
    case 'zhongyuan':
      return resolveLunarDate(year, 7, 15);
    case 'hanyi':
      return resolveLunarDate(year, 10, 1);
    case 'chunjie':
      return resolveLunarDate(year, 1, 1);
    default:
      return undefined;
  }
}

function daysUntil(dateKey: string, now: Date): number {
  const target = Date.parse(`${dateKey}T00:00:00Z`);
  const today = Date.parse(`${beijingDateKey(now)}T00:00:00Z`);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return NaN;
  return Math.round((target - today) / 86_400_000);
}

export interface FestivalTrigger {
  key: FestivalKey;
  label: string;
  date: string;
  daysUntil: number;
  prompt: string;
}

/**
 * 用户明确提到节日时，给出今年（或临近的下一年）的日期。
 * 不主动按日期注入，避免每轮都多一段。
 */
export function resolveFestivalTrigger(options: {
  query: string;
  now?: Date;
}): FestivalTrigger | undefined {
  const query = (options.query || '').trim();
  if (!query) return undefined;
  const festival = FESTIVALS.find(item =>
    item.aliases.some(alias => query.includes(alias))
  );
  if (!festival) return undefined;

  const now = options.now || new Date();
  const year = Number(beijingDateKey(now).slice(0, 4));
  let date = resolveFestivalDate(festival.key, year);
  if (!date) return undefined;
  // 如果今年的节日已经过去很久，用户更可能在问明年的。
  if (daysUntil(date, now) < -30) {
    date = resolveFestivalDate(festival.key, year + 1) || date;
  }
  const delta = daysUntil(date, now);
  const relative =
    delta === 0
      ? '就是今天'
      : delta > 0
      ? `还有 ${delta} 天`
      : `已经过去 ${Math.abs(delta)} 天`;
  const yearLabel = date.startsWith(String(year)) ? '今年' : '下一次';
  return {
    key: festival.key,
    label: festival.label,
    date,
    daysUntil: delta,
    prompt: `${yearLabel}${festival.label}是 ${date}（${relative}）。`,
  };
}

export function buildFestivalTriggerPrompt(
  trigger: FestivalTrigger | undefined
): string {
  return trigger?.prompt?.trim() || '';
}
