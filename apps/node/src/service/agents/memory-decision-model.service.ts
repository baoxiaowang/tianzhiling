import { Config, Init, Provide } from '@midwayjs/core';
import OpenAI from 'openai';
import { AsyncLocalStorage } from 'async_hooks';
import type {
  OpenAIModelCallAttribution,
  OpenAIServiceConfig,
  OpenAITextRequest,
  OpenAITextResult,
} from './openai';

/** Separate client/configuration from visible character replies. Reuses an already configured provider. */
@Provide()
export class MemoryDecisionModelService {
  @Config('openai')
  providerConfig: OpenAIServiceConfig;

  // Owned by this service; never assign to the framework-injected providerConfig.
  openAIConfig: OpenAIServiceConfig;
  private client: OpenAI | undefined;
  private readonly attribution =
    new AsyncLocalStorage<OpenAIModelCallAttribution>();

  createModelCallAttribution(): OpenAIModelCallAttribution {
    return {
      chatCompletions: 0,
      providerAttempts: 0,
      embeddings: 0,
      visionCompletions: 0,
    };
  }

  runWithModelCallAttribution<T>(
    state: OpenAIModelCallAttribution,
    fn: () => T
  ): T {
    return this.attribution.run(state, fn);
  }

  @Init()
  configureMemoryModel(): void {
    const base = this.providerConfig || {};
    const fallback =
      process.env.NODE_MEMORY_PROVIDER === 'fallback'
        ? base.fallback
        : base.secondaryFallback;
    const model = process.env.NODE_MEMORY_MODEL || fallback?.model;
    const apiKey = process.env.NODE_MEMORY_API_KEY || fallback?.apiKey;
    const baseURL = process.env.NODE_MEMORY_BASE_URL || fallback?.baseURL;
    this.openAIConfig = {
      enabled: !!(model && apiKey && baseURL),
      model,
      apiKey,
      baseURL,
      temperature: 0,
      topP: 1,
      presencePenalty: 0,
      frequencyPenalty: 0,
      reasoningSplit: false,
      maxRetries: 0,
      // 批量抽取实测要 55 秒左右，60 秒的超时会让它频繁超时；
      // 一旦超时整批作废、退化成逐条重跑，一次批量变成十次调用。
      timeoutMs: 180000,
    };
    this.client = undefined;
  }

  isEnabled(): boolean {
    return this.openAIConfig?.enabled === true;
  }

  async generateText(
    request: OpenAITextRequest & { memoryReview?: boolean }
  ): Promise<OpenAITextResult> {
    if (!this.isEnabled()) throw new Error('Memory model is not configured');
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.openAIConfig.apiKey,
        baseURL: this.openAIConfig.baseURL,
        timeout: 180000,
        maxRetries: 0,
      });
    }
    const attribution = this.attribution.getStore();
    if (attribution) {
      attribution.chatCompletions++;
      attribution.providerAttempts++;
    }
    const startedAt = Date.now();
    const label = request.memoryReview
      ? 'review'
      : `${request.maxTokens || 0}`;
    const response = await this.client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `${request.systemPrompt || ''}\n必须输出合法JSON。`,
        },
        { role: 'user', content: request.prompt },
      ],
      model: this.openAIConfig.model!,
      temperature: request.temperature ?? 0,
      top_p: request.topP ?? 1,
      max_tokens: request.maxTokens,
      ...({ thinking: { type: 'disabled' } } as object),
      response_format: { type: 'json_object' },
    });
    if (process.env.MEMORY_MODEL_DEBUG === '1') {
      // 评测期定位耗时用：按调用类型打印耗时与 token，便于统计时间去向。
      // eslint-disable-next-line no-console
      console.log(
        `MEMORY_MODEL_CALL kind=${label} ms=${Date.now() - startedAt} tokens=${
          response.usage?.total_tokens || 0
        } promptChars=${(request.prompt || '').length}`
      );
    }
    return {
      content: response.choices?.[0]?.message?.content?.trim() || '',
      reasoning: [],
      response,
    };
  }
}
