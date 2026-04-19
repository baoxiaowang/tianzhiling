import { Config, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { OpenAI } from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { extractTranscriptionContent } from '../../common/asr-utils';
import { AppError } from '../../common/errors';
import { describeErrorForLog, truncateForLog } from '../../common/log-utils';

export interface OpenAIServiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  visionModel?: string;
  visionApiKey?: string;
  visionBaseURL?: string;
  speechToTextApiKey?: string;
  speechToTextBaseURL?: string;
  speechToTextModel?: string;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  maxRetries?: number;
  timeoutMs?: number;
  reasoningSplit?: boolean;
  embeddingApiKey?: string;
  embeddingBaseURL?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
}

export interface OpenAIChatRequest
  extends Omit<
    ChatCompletionCreateParamsNonStreaming,
    'model' | 'messages' | 'top_p' | 'presence_penalty' | 'frequency_penalty'
  > {
  messages: ChatCompletionMessageParam[];
  model?: string;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  reasoningSplit?: boolean;
}

export interface OpenAITextRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  reasoningSplit?: boolean;
}

export interface OpenAITextResult {
  content: string;
  reasoning: string[];
  response: ChatCompletion;
}

export interface OpenAIEmbeddingRequest {
  input: string;
  model?: string;
  dimensions?: number;
}

export interface OpenAITranscriptionRequest {
  audioUrl: string;
  model?: string;
  prompt?: string;
  language?: string;
}

@Provide()
export class OpenAIService {
  @Logger()
  logger: ILogger;

  @Config('openai')
  openAIConfig: OpenAIServiceConfig;

  private client: OpenAI | null = null;
  private visionClient: OpenAI | null = null;
  private speechToTextClient: OpenAI | null = null;
  private embeddingClient: OpenAI | null = null;

  isEnabled(): boolean {
    return this.openAIConfig?.enabled !== false;
  }

  getDefaultModel(): string {
    return this.openAIConfig?.model?.trim() || 'MiniMax-M2.5';
  }

  getVisionModel(): string {
    return this.openAIConfig?.visionModel?.trim() || '';
  }

  getEmbeddingModel(): string {
    return this.openAIConfig?.embeddingModel?.trim() || '';
  }

  getSpeechToTextModel(): string {
    return this.openAIConfig?.speechToTextModel?.trim() || '';
  }

  hasDedicatedVisionConfig(): boolean {
    return Boolean(
      this.openAIConfig?.visionApiKey?.trim() &&
        this.openAIConfig?.visionBaseURL?.trim()
    );
  }

  hasEmbeddingConfig(): boolean {
    return Boolean(
      this.isEnabled() &&
        this.getEmbeddingModel() &&
        this.resolveEmbeddingApiKey() &&
        this.resolveEmbeddingBaseURL()
    );
  }

  hasSpeechToTextConfig(): boolean {
    return Boolean(
      this.isEnabled() &&
        this.getSpeechToTextModel() &&
        this.resolveSpeechToTextApiKey() &&
        this.resolveSpeechToTextBaseURL()
    );
  }

  async createChatCompletion(
    request: OpenAIChatRequest
  ): Promise<ChatCompletion> {
    if (!request?.messages?.length) {
      throw new AppError(
        'MINIMAX_INVALID_REQUEST',
        'MiniMax messages are required'
      );
    }

    const client = this.getClient();
    const body = {
      ...request,
      model: request.model?.trim() || this.getDefaultModel(),
      temperature: this.normalizeTemperature(request.temperature),
      top_p: this.normalizeTopP(request.topP),
      presence_penalty: this.normalizePenalty(
        request.presencePenalty,
        this.openAIConfig?.presencePenalty
      ),
      frequency_penalty: this.normalizePenalty(
        request.frequencyPenalty,
        this.openAIConfig?.frequencyPenalty
      ),
      reasoning_split: this.resolveReasoningSplit(request.reasoningSplit),
    } as unknown as ChatCompletionCreateParamsNonStreaming;

    this.logger.info(
      '[openai] create chat completion, model=%s, messages=%s',
      body.model,
      request.messages.length
    );

    return client.chat.completions.create(body);
  }

  async createVisionChatCompletion(
    request: OpenAIChatRequest
  ): Promise<ChatCompletion> {
    if (!request?.messages?.length) {
      throw new AppError(
        'MINIMAX_INVALID_REQUEST',
        'MiniMax messages are required'
      );
    }

    const model = request.model?.trim() || this.getVisionModel();

    if (!model) {
      throw new AppError(
        'MINIMAX_VISION_NOT_CONFIGURED',
        'MiniMax vision model is not configured',
        500
      );
    }

    const client = this.getVisionClient();
    const body = {
      ...request,
      model,
      temperature: this.normalizeTemperature(request.temperature),
      top_p: this.normalizeTopP(request.topP),
      presence_penalty: this.normalizePenalty(
        request.presencePenalty,
        this.openAIConfig?.presencePenalty
      ),
      frequency_penalty: this.normalizePenalty(
        request.frequencyPenalty,
        this.openAIConfig?.frequencyPenalty
      ),
      reasoning_split: this.resolveReasoningSplit(request.reasoningSplit),
    } as unknown as ChatCompletionCreateParamsNonStreaming;

    this.logger.info(
      '[openai] create vision chat completion, model=%s, messages=%s',
      body.model,
      request.messages.length
    );

    return client.chat.completions.create(body);
  }

  async generateText(request: OpenAITextRequest): Promise<OpenAITextResult> {
    const prompt = request?.prompt?.trim();

    if (!prompt) {
      throw new AppError(
        'MINIMAX_INVALID_PROMPT',
        'MiniMax prompt is required'
      );
    }

    const messages: ChatCompletionMessageParam[] = [];
    const systemPrompt = request.systemPrompt?.trim();

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    const response = await this.createChatCompletion({
      messages,
      model: request.model,
      temperature: request.temperature,
      topP: request.topP,
      presencePenalty: request.presencePenalty,
      frequencyPenalty: request.frequencyPenalty,
      max_tokens: request.maxTokens,
      reasoningSplit: request.reasoningSplit,
    });

    const message = response.choices?.[0]?.message;
    const content =
      typeof message?.content === 'string' ? message.content.trim() : '';
    const reasoning = this.extractReasoning(message);

    return {
      content,
      reasoning,
      response,
    };
  }

  async createEmbedding(request: OpenAIEmbeddingRequest): Promise<number[]> {
    const input = request?.input?.trim();

    if (!input) {
      throw new AppError(
        'MINIMAX_INVALID_EMBEDDING_INPUT',
        'embedding input is required'
      );
    }

    const client = this.getEmbeddingClient();
    const dimensions = this.normalizeEmbeddingDimensions(
      request.dimensions,
      this.openAIConfig?.embeddingDimensions
    );
    const response = await client.embeddings.create({
      input,
      model: request.model?.trim() || this.getEmbeddingModel(),
      ...(dimensions ? { dimensions } : {}),
    });
    const embedding = response.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new AppError(
        'MINIMAX_EMPTY_EMBEDDING',
        'embedding response is empty',
        502
      );
    }

    return embedding.filter(
      item => typeof item === 'number' && Number.isFinite(item)
    );
  }

  async createTranscription(
    request: OpenAITranscriptionRequest
  ): Promise<string> {
    const audioUrl = request.audioUrl?.trim();

    if (!audioUrl) {
      throw new AppError(
        'MINIMAX_INVALID_AUDIO_INPUT',
        'audio url is required'
      );
    }

    const model = request.model?.trim() || this.getSpeechToTextModel();
    const apiKey = this.resolveSpeechToTextApiKey();
    const baseURL = this.resolveSpeechToTextBaseURL();

    if (!model || !apiKey || !baseURL) {
      throw new AppError(
        'MINIMAX_SPEECH_TO_TEXT_NOT_CONFIGURED',
        'speech to text configuration is incomplete',
        500
      );
    }

    const client = this.getSpeechToTextClient();
    const messages = [
      ...(request.prompt?.trim()
        ? [
            {
              role: 'system',
              content: [
                {
                  text: request.prompt.trim(),
                },
              ],
            },
          ]
        : []),
      {
        role: 'user',
        content: [
          {
            audio: audioUrl,
          },
        ],
      },
    ];

    this.logger.info(
      '[openai] create transcription, model=%s, audioUrl=%s',
      model,
      audioUrl
    );

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        stream: false,
        extra_body: {
          asr_options: {
            enable_itn: false,
            ...(request.language?.trim()
              ? { language: request.language.trim() }
              : {}),
          },
        },
      } as unknown as ChatCompletionCreateParamsNonStreaming);

      const transcript = extractTranscriptionContent(
        response.choices?.[0]?.message?.content
      );

      this.logger.info(
        '[openai] transcription response received, model=%s, choices=%s, transcriptLength=%s, transcriptPreview=%s',
        model,
        response.choices?.length ?? 0,
        transcript.length,
        truncateForLog(transcript)
      );

      return transcript;
    } catch (error) {
      this.logger.error(
        '[openai] transcription request failed, model=%s, audioUrl=%s, reason=%s',
        model,
        audioUrl,
        describeErrorForLog(error)
      );
      throw error;
    }
  }

  private extractReasoning(
    message: ChatCompletion['choices'][number]['message'] | undefined
  ): string[] {
    const raw = (message as { reasoning_details?: unknown })?.reasoning_details;

    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map(item => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        const text = (item as { text?: unknown }).text;
        return typeof text === 'string' ? text.trim() : '';
      })
      .filter(Boolean);
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    if (!this.isEnabled()) {
      throw new AppError(
        'MINIMAX_DISABLED',
        'MiniMax integration is disabled',
        503
      );
    }

    const apiKey = this.openAIConfig?.apiKey?.trim();

    if (!apiKey) {
      throw new AppError(
        'MINIMAX_NOT_CONFIGURED',
        'MiniMax API key is not configured',
        500
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL:
        this.openAIConfig?.baseURL?.trim() || 'https://api.minimax.io/v1',
      maxRetries: this.normalizeMaxRetries(this.openAIConfig?.maxRetries),
      timeout: this.normalizeTimeout(this.openAIConfig?.timeoutMs),
    });

    return this.client;
  }

  private getVisionClient(): OpenAI {
    if (this.visionClient) {
      return this.visionClient;
    }

    const apiKey = this.openAIConfig?.visionApiKey?.trim();
    const baseURL = this.openAIConfig?.visionBaseURL?.trim();

    if (!apiKey || !baseURL) {
      throw new AppError(
        'MINIMAX_VISION_NOT_CONFIGURED',
        'MiniMax vision configuration is incomplete',
        500
      );
    }

    this.visionClient = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: this.normalizeMaxRetries(this.openAIConfig?.maxRetries),
      timeout: this.normalizeTimeout(this.openAIConfig?.timeoutMs),
    });

    return this.visionClient;
  }

  private getEmbeddingClient(): OpenAI {
    if (this.embeddingClient) {
      return this.embeddingClient;
    }

    if (!this.isEnabled()) {
      throw new AppError(
        'MINIMAX_DISABLED',
        'MiniMax integration is disabled',
        503
      );
    }

    const apiKey = this.resolveEmbeddingApiKey();
    const baseURL = this.resolveEmbeddingBaseURL();
    const model = this.getEmbeddingModel();

    if (!apiKey || !baseURL || !model) {
      throw new AppError(
        'MINIMAX_EMBEDDING_NOT_CONFIGURED',
        'MiniMax embedding configuration is incomplete',
        500
      );
    }

    this.embeddingClient = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: this.normalizeMaxRetries(this.openAIConfig?.maxRetries),
      timeout: this.normalizeTimeout(this.openAIConfig?.timeoutMs),
    });

    return this.embeddingClient;
  }

  private getSpeechToTextClient(): OpenAI {
    if (this.speechToTextClient) {
      return this.speechToTextClient;
    }

    if (!this.isEnabled()) {
      throw new AppError(
        'MINIMAX_DISABLED',
        'MiniMax integration is disabled',
        503
      );
    }

    const apiKey = this.resolveSpeechToTextApiKey();
    const baseURL = this.resolveSpeechToTextBaseURL();
    const model = this.getSpeechToTextModel();

    if (!apiKey || !baseURL || !model) {
      throw new AppError(
        'MINIMAX_SPEECH_TO_TEXT_NOT_CONFIGURED',
        'speech to text configuration is incomplete',
        500
      );
    }

    this.speechToTextClient = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: this.normalizeMaxRetries(this.openAIConfig?.maxRetries),
      timeout: this.normalizeTimeout(this.openAIConfig?.timeoutMs),
    });

    return this.speechToTextClient;
  }

  private resolveEmbeddingApiKey(): string {
    return this.openAIConfig?.embeddingApiKey?.trim() || '';
  }

  private resolveEmbeddingBaseURL(): string {
    return this.openAIConfig?.embeddingBaseURL?.trim() || '';
  }

  private resolveSpeechToTextApiKey(): string {
    return this.openAIConfig?.speechToTextApiKey?.trim() || '';
  }

  private resolveSpeechToTextBaseURL(): string {
    return this.openAIConfig?.speechToTextBaseURL?.trim() || '';
  }

  private resolveReasoningSplit(value?: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    return this.openAIConfig?.reasoningSplit !== false;
  }

  private normalizeTemperature(value?: number | null): number | undefined {
    const source =
      typeof value === 'number' ? value : this.openAIConfig?.temperature;

    if (typeof source !== 'number' || !Number.isFinite(source)) {
      return undefined;
    }

    return Math.max(0.01, Math.min(2, source));
  }

  private normalizeTopP(value?: number | null): number | undefined {
    const source = typeof value === 'number' ? value : this.openAIConfig?.topP;

    if (typeof source !== 'number' || !Number.isFinite(source)) {
      return undefined;
    }

    return Math.max(0.01, Math.min(1, source));
  }

  private normalizePenalty(
    value?: number | null,
    fallback?: number | null
  ): number | undefined {
    const source = typeof value === 'number' ? value : fallback;

    if (typeof source !== 'number' || !Number.isFinite(source)) {
      return undefined;
    }

    return Math.max(-2, Math.min(2, source));
  }

  private normalizeMaxRetries(value?: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.floor(value));
  }

  private normalizeTimeout(value?: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private normalizeEmbeddingDimensions(
    value?: number,
    fallback?: number
  ): number | undefined {
    const source = typeof value === 'number' ? value : fallback;

    if (typeof source !== 'number' || !Number.isFinite(source) || source <= 0) {
      return undefined;
    }

    return Math.floor(source);
  }
}
