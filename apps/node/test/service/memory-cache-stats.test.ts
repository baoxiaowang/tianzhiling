import { extractMemoryCacheStats } from '../../src/service/memory/memory-cache-stats';

describe('memory cache stats', () => {
  it('解析 DashScope 的 cached_tokens', () => {
    const stats = extractMemoryCacheStats({
      prompt_tokens: 1157,
      completion_tokens: 42,
      prompt_tokens_details: { cached_tokens: 896 },
    });

    expect(stats).toEqual({
      promptTokens: 1157,
      cachedTokens: 896,
      cacheMissTokens: 261,
      completionTokens: 42,
      hitRatio: 0.7744,
    });
  });

  it('解析 DeepSeek 的 prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
    const stats = extractMemoryCacheStats({
      prompt_tokens: 1000,
      completion_tokens: 10,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    });

    expect(stats).toEqual({
      promptTokens: 1000,
      cachedTokens: 800,
      cacheMissTokens: 200,
      completionTokens: 10,
      hitRatio: 0.8,
    });
  });

  it('缺失 usage 时返回全 0', () => {
    expect(extractMemoryCacheStats(undefined)).toEqual({
      promptTokens: 0,
      cachedTokens: 0,
      cacheMissTokens: 0,
      completionTokens: 0,
      hitRatio: 0,
    });
  });
});
