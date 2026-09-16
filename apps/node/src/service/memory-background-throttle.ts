/**
 * 后台记忆任务的准入限速配置与窗口计算。
 *
 * 只用"后台开关 + 每窗口准入次数 + 窗口时长"三个配置，不引入时间窗/时区判断：
 * 规则在全天（含凌晨）完全一致。单位是"任务实际启动次数"，不是消息数或模型调用数；
 * semantic_index 与 structured_memory 共享同一额度，失败重试同样计入。
 */

export interface BackgroundThrottleConfig {
  enabled: boolean;
  maxStarts: number;
  windowMs: number;
}

const DEFAULT_MAX_STARTS = 50;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function readPositiveInt(
  value: string | undefined,
  fallback: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/** 后台默认开启：行为与限速前一致，直到显式关闭或调低额度。 */
export function resolveBackgroundThrottleConfig(
  env: NodeJS.ProcessEnv = process.env
): BackgroundThrottleConfig {
  return {
    enabled: readBoolean(env.NODE_MEMORY_BACKGROUND_ENABLED, true),
    maxStarts: readPositiveInt(
      env.NODE_MEMORY_BACKGROUND_MAX_STARTS,
      DEFAULT_MAX_STARTS,
      1_000_000
    ),
    windowMs: readPositiveInt(
      env.NODE_MEMORY_BACKGROUND_WINDOW_MS,
      DEFAULT_WINDOW_MS,
      24 * 60 * 60 * 1000
    ),
  };
}

/** 当前任务所属的固定窗口起点（毫秒）。 */
export function backgroundWindowStart(now: Date, windowMs: number): number {
  return Math.floor(now.getTime() / windowMs) * windowMs;
}

/** 当前窗口的下一次可执行时间。 */
export function backgroundWindowEnd(now: Date, windowMs: number): Date {
  return new Date(backgroundWindowStart(now, windowMs) + windowMs);
}

/** 后台额度不足时的 Redis 计数器键（按固定窗口隔离，重启不重置）。 */
export function backgroundAdmissionKey(windowStart: number): string {
  return `memory-pipeline:background:admission:${windowStart}`;
}
