/**
 * DeepSeek 计费时段路由：
 * - 高峰：UTC 周一至周五 01:00–04:00、06:00–10:00；
 * - 其余时间（含周末）为低谷；
 * - 中国法定节假日按北京日期排除，由 NODE_CHAT_PEAK_HOLIDAYS 提供。
 *
 * 高峰走豆包，低谷走 DeepSeek；节假日也按低谷处理。
 */

function beijingDateKey(now: Date): string {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijing.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeHolidays(values?: string[]): Set<string> {
  return new Set(
    (values || [])
      .map(value => value.trim())
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
  );
}

export function isDeepSeekPeakAt(
  now: Date,
  holidays: Array<string | undefined> = []
): boolean {
  const weekday = now.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (normalizeHolidays(holidays.filter(Boolean) as string[]).has(beijingDateKey(now))) {
    return false;
  }
  const hour = now.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function resolvePeakRoute(now = new Date()): 'peak' | 'offpeak' {
  return isDeepSeekPeakAt(now, (process.env.NODE_CHAT_PEAK_HOLIDAYS || '').split(',')) 
    ? 'peak'
    : 'offpeak';
}
