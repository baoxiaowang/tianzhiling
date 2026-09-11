import { Config, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';

/**
 * 简化的 LLM 调用服务（admin-node 专用）。
 *
 * 直接使用 fetch 调用 OpenAI 兼容接口，避免依赖 node 应用的 OpenAIService。
 * 用于每月末批量分析聊天内容推断订单关系等低频次后台任务。
 */
@Provide()
export class AdminLlmService {
  @Logger()
  logger: ILogger;

  @Config('llm')
  llmConfig?: {
    enabled?: boolean;
    apiKey?: string;
    baseURL?: string;
    model?: string;
    timeoutMs?: number;
  };

  /**
   * 调用 LLM 生成文本。
   * 返回模型输出的纯文本内容；未配置或调用失败时返回空字符串。
   */
  async generateText(
    prompt: string,
    options?: { systemPrompt?: string; model?: string; temperature?: number }
  ): Promise<string> {
    const cfg = this.llmConfig;
    if (!cfg?.enabled || !cfg.apiKey || !cfg.baseURL) {
      this.logger.warn('[admin-llm] not configured, skip');
      return '';
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: options.systemPrompt.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const body = {
      model: options?.model ?? cfg.model ?? 'gpt-4o-mini',
      messages,
      temperature: options?.temperature ?? 0,
      max_tokens: 512,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);

    try {
      const resp = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        this.logger.error('[admin-llm] http %s: %s', resp.status, text.slice(0, 200));
        return '';
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (err) {
      this.logger.error('[admin-llm] call failed: %s', (err as Error).message);
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }
}
