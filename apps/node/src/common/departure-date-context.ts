const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Date-only identity facts and calendar arithmetic; never infer a missing date. */
export function buildDepartureDateContext(
  deathDate?: Date | null,
  now = new Date()
): { dateText: string; elapsedText?: string } | null {
  if (
    !(deathDate instanceof Date) ||
    !Number.isFinite(deathDate.getTime()) ||
    !Number.isFinite(now.getTime())
  )
    return null;
  const day = (date: Date) =>
    Math.floor((date.getTime() + BEIJING_OFFSET_MS) / DAY_MS);
  const dateLabel = (date: Date) =>
    new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
  const elapsed = day(now) - day(deathDate);
  return {
    dateText: `角色档案中的离世日期是${dateLabel(deathDate)}（北京时间日期）`,
    ...(elapsed >= 0
      ? {
          elapsedText: `截至北京时间${dateLabel(
            now
          )}，与离世日相隔${elapsed}个自然日；按离世当天为第1天计，今天是第${
            elapsed + 1
          }天。此处不代表精确经过的小时数。`,
        }
      : {}),
  };
}
