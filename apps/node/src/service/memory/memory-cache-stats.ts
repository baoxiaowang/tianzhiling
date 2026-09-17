import type { ILogger } from '@midwayjs/logger';

/**
 * 记忆链路的大模型缓存命中统计。
 *
 * 不同供应商的字段不同：
 * - DashScope / OpenAI 兼容：usage.prompt_tokens_details.cached_tokens
 * - DeepSeek：usage.prompt_cache_hit_tokens / usage.prompt_cache_miss_tokens
 *
 * 默认关闭（避免刷日志），设置 MEMORY_CACHE_STATS=1 后按调用打印一行结构化日志。
 */
export interface MemoryCacheStats {
  promptTokens: number;
  cachedTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  hitRatio: number;
}

interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

export function isMemoryCacheStatsEnabled(): boolean {
  return process.env.MEMORY_CACHE_STATS === '1';
}

export function extractMemoryCacheStats(usage?: unknown): MemoryCacheStats {
  const value = (usage ?? {}) as UsageLike;
  const promptTokens = Number(value.prompt_tokens) || 0;
  const completionTokens = Number(value.completion_tokens) || 0;
  const cachedFromDetails =
    Number(value.prompt_tokens_details?.cached_tokens) || 0;
  const cachedFromHit = Number(value.prompt_cache_hit_tokens) || 0;
  const cachedTokens = Math.max(cachedFromDetails, cachedFromHit);
  const cacheMissTokens =
    Number(value.prompt_cache_miss_tokens) ||
    Math.max(promptTokens - cachedTokens, 0);

  return {
    promptTokens,
    cachedTokens,
    cacheMissTokens,
    completionTokens,
    hitRatio:
      promptTokens > 0
        ? Number((cachedTokens / promptTokens).toFixed(4))
        : 0,
  };
}

export function logMemoryCacheStats(
  logger: ILogger | undefined,
  input: { kind: string; model?: string; usage?: unknown }
): void {
  if (!isMemoryCacheStatsEnabled()) {
    return;
  }

  const stats = extractMemoryCacheStats(input.usage);

  logger?.info?.(
    'MEMORY_CACHE_CALL kind=%s model=%s prompt_tokens=%d cached_tokens=%d cache_miss_tokens=%d completion_tokens=%d hit_ratio=%s',
    input.kind,
    input.model || 'n/a',
    stats.promptTokens,
    stats.cachedTokens,
    stats.cacheMissTokens,
    stats.completionTokens,
    stats.hitRatio
  );
}
