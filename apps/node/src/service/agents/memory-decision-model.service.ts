import { Init, Provide } from '@midwayjs/core';
import { OpenAIService, OpenAITextRequest, OpenAITextResult } from './openai';

/** Separate client/configuration from visible character replies. Reuses an already configured provider. */
@Provide()
export class MemoryDecisionModelService extends OpenAIService {
  @Init()
  configureMemoryModel(): void {
    const base = this.openAIConfig;
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
      timeoutMs: 60000,
    };
  }

  async generateText(
    request: OpenAITextRequest & { memoryReview?: boolean }
  ): Promise<OpenAITextResult> {
    const response = await this.createChatCompletion({
      messages: [
        {
          role: 'system',
          content: `${request.systemPrompt || ''}\n必须输出合法JSON。`,
        },
        { role: 'user', content: request.prompt },
      ],
      model: request.model,
      temperature: request.temperature ?? 0,
      topP: request.topP ?? 1,
      max_tokens: request.maxTokens,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });
    return {
      content: response.choices?.[0]?.message?.content?.trim() || '',
      reasoning: [],
      response,
    };
  }
}
