export const CONVERSATION_RETURN_CONTEXT_VERSION =
  'conversation_return_context_v2' as const;

// 间隔多久算"隔了一段时间"。只作为事实标注（isReunion）给上层用，
// 不再用它决定"要不要把时间材料给模型"——时间是常态参考材料。
export const CONVERSATION_RETURN_MIN_GAP_MS = 36 * 60 * 60 * 1000;

// 超过 6 小时才值得告诉模型"上一次是多久以前"：同一段连着聊的几个小时，
// 时间材料只是噪声。现在时间本身仍然常态给。
export const CONVERSATION_TIME_MATERIAL_MIN_GAP_MS = 6 * 60 * 60 * 1000;

export interface ConversationReturnContext {
  version: typeof CONVERSATION_RETURN_CONTEXT_VERSION;
  currentTurnAt: string;
  previousContactAt: string;
  previousUserContactAt: string;
  previousAssistantContactAt?: string;
  elapsedHours: number;
  elapsedDays: number;
  // 事实标注：间隔达到"隔了一段时间"的阈值（36 小时）。微模型快路径用它判断
  // 这轮是不是"隔了一段时间才回来"，避免每次晚安/再见都失去快路径。
  isReunion: boolean;
}

/**
 * 本轮与上一次联系之间的时间事实。
 * 只要有上一次用户发言就返回：模型需要常态知道"现在是什么时候、上一次联系是什么时候、
 * 中间隔了多久"；上一次联系的内容本来就在最近的历史消息里，这里只补时间。
 * 首轮（没有上一次用户发言）或时间戳非法/倒挂时返回 undefined。
 */
export function resolveConversationReturnContext(options: {
  currentTurnAt?: Date;
  previousUserContactAt?: Date;
  previousAssistantContactAt?: Date;
}): ConversationReturnContext | undefined {
  const currentTurnAt = normalizeDate(options.currentTurnAt);
  const previousUserContactAt = normalizeDate(options.previousUserContactAt);
  const previousAssistantContactAt = normalizeDate(
    options.previousAssistantContactAt
  );

  if (!currentTurnAt || !previousUserContactAt) {
    return undefined;
  }

  const previousContactAt = [previousUserContactAt, previousAssistantContactAt]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const elapsedMs = currentTurnAt.getTime() - previousContactAt.getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return undefined;
  }

  return {
    version: CONVERSATION_RETURN_CONTEXT_VERSION,
    currentTurnAt: currentTurnAt.toISOString(),
    previousContactAt: previousContactAt.toISOString(),
    previousUserContactAt: previousUserContactAt.toISOString(),
    ...(previousAssistantContactAt
      ? { previousAssistantContactAt: previousAssistantContactAt.toISOString() }
      : {}),
    elapsedHours: round(elapsedMs / (60 * 60 * 1000), 1),
    elapsedDays: round(elapsedMs / (24 * 60 * 60 * 1000), 2),
    isReunion: elapsedMs >= CONVERSATION_RETURN_MIN_GAP_MS,
  };
}

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

/** 一天中的时段，用于把 07:06 这类时刻变成模型能直接理解的“早上”。 */
export function resolveBeijingDayPeriod(hour: number): string {
  if (!Number.isFinite(hour)) return '';
  if (hour < 5) return '凌晨';
  if (hour < 9) return '早上';
  if (hour < 12) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  if (hour < 23) return '晚上';
  return '深夜';
}

/** 北京时间人话格式：2026年9月20日（周日）21:30（晚上）。 */
export function formatBeijingDateTime(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(value);
  const partMap = new Map(parts.map(part => [part.type, part.value]));
  const hour = Number(partMap.get('hour'));
  const period = resolveBeijingDayPeriod(hour);

  return `${partMap.get('year')}年${partMap.get('month')}月${partMap.get(
    'day'
  )}日（${partMap.get('weekday')}）${partMap.get('hour')}:${partMap.get(
    'minute'
  )}${period ? `（${period}）` : ''}`;
}

/** 间隔多久的人话说法：约 25 分钟 / 约 2.5 小时 / 约 7 天 / 约 3 个月 / 约 1.2 年。 */
export function describeElapsedTime(from: Date, to: Date): string {
  const fromAt = normalizeDate(from);
  const toAt = normalizeDate(to);
  if (!fromAt || !toAt) {
    return '';
  }

  const elapsedMs = toAt.getTime() - fromAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '';
  }

  const minutes = Math.floor(elapsedMs / (60 * 1000));
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `约 ${minutes} 分钟`;

  const hours = elapsedMs / (60 * 60 * 1000);
  if (hours < 24) return `约 ${round(hours, hours < 3 ? 1 : 0)} 小时`;

  const days = elapsedMs / (24 * 60 * 60 * 1000);
  if (days < 30) return `约 ${round(days, days < 7 ? 1 : 0)} 天`;

  const months = days / 30;
  if (months < 12) return `约 ${round(months, months < 3 ? 1 : 0)} 个月`;

  return `约 ${round(days / 365, 1)} 年`;
}

function normalizeDate(value?: Date): Date | undefined {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : undefined;
}

function round(value: number, fractionDigits: number): number {
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}
