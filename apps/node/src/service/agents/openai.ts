import { Config, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import * as http from 'http';
import * as https from 'https';
import { OpenAI } from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { URL } from 'url';
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
  textToSpeechApiKey?: string;
  textToSpeechBaseURL?: string;
  textToSpeechModel?: string;
  textToSpeechVoice?: string;
  textToSpeechLanguageType?: string;
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

export interface OpenAITextToSpeechRequest {
  text: string;
  model?: string;
  voice?: string;
  languageType?: string;
}

export interface OpenAITextToSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType?: string;
  requestId?: string;
}

interface DashScopeTextToSpeechResponse {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    audio?: {
      url?: string;
    };
  };
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

  getTextToSpeechModel(): string {
    return this.openAIConfig?.textToSpeechModel?.trim() || '';
  }

  getTextToSpeechVoice(): string {
    return this.openAIConfig?.textToSpeechVoice?.trim() || '';
  }

  getTextToSpeechLanguageType(): string {
    return this.openAIConfig?.textToSpeechLanguageType?.trim() || '';
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

  hasTextToSpeechConfig(): boolean {
    return Boolean(
      this.isEnabled() &&
        this.getTextToSpeechModel() &&
        this.getTextToSpeechVoice() &&
        this.resolveTextToSpeechApiKey() &&
        this.resolveTextToSpeechBaseURL()
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

  async createTextToSpeech(
    request: OpenAITextToSpeechRequest
  ): Promise<OpenAITextToSpeechResult> {
    const text = request.text?.trim();

    if (!text) {
      throw new AppError(
        'MINIMAX_INVALID_TEXT_TO_SPEECH_INPUT',
        'text to speech input is required'
      );
    }

    const model = request.model?.trim() || this.getTextToSpeechModel();
    const apiKey = this.resolveTextToSpeechApiKey();
    const baseURL = this.resolveTextToSpeechBaseURL();
    const voice = request.voice?.trim() || this.getTextToSpeechVoice();
    const languageType =
      request.languageType?.trim() || this.getTextToSpeechLanguageType();

    if (!model || !apiKey || !baseURL || !voice) {
      throw new AppError(
        'MINIMAX_TEXT_TO_SPEECH_NOT_CONFIGURED',
        'text to speech configuration is incomplete',
        500
      );
    }

    const endpoint = this.resolveTextToSpeechEndpoint(baseURL);

    this.logger.info(
      '[openai] create text to speech, model=%s, voice=%s, textLength=%s, textPreview=%s',
      model,
      voice,
      text.length,
      truncateForLog(text)
    );

    try {
      const response = await this.requestJson<DashScopeTextToSpeechResponse>({
        url: endpoint,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: {
          model,
          input: {
            text,
            voice,
            ...(languageType ? { language_type: languageType } : {}),
          },
        },
      });

      const audioUrl =
        response.output?.audio?.url &&
        typeof response.output.audio.url === 'string'
          ? response.output.audio.url.trim()
          : '';

      if (!audioUrl) {
        throw new AppError(
          'MINIMAX_TEXT_TO_SPEECH_EMPTY_AUDIO',
          'text to speech response is missing audio url',
          502,
          response
        );
      }

      const audioResponse = await this.requestBinary({
        url: audioUrl,
        method: 'GET',
        headers: {
          Accept: 'audio/*',
        },
      });

      if (audioResponse.statusCode < 200 || audioResponse.statusCode >= 300) {
        throw new AppError(
          'MINIMAX_TEXT_TO_SPEECH_AUDIO_DOWNLOAD_FAILED',
          `text to speech audio download failed with status ${audioResponse.statusCode}`,
          502
        );
      }

      const mimeType =
        this.normalizeContentType(audioResponse.headers['content-type']) ||
        this.guessAudioMimeType(audioUrl);

      this.logger.info(
        '[openai] text to speech response received, model=%s, voice=%s, requestId=%s, mimeType=%s, size=%s',
        model,
        voice,
        response.request_id?.trim() || '-',
        mimeType || '-',
        audioResponse.body.length
      );

      return {
        audioUrl,
        audioBuffer: audioResponse.body,
        mimeType: mimeType || undefined,
        requestId: response.request_id?.trim() || undefined,
      };
    } catch (error) {
      this.logger.error(
        '[openai] text to speech request failed, model=%s, voice=%s, reason=%s',
        model,
        voice,
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

  private resolveTextToSpeechApiKey(): string {
    return this.openAIConfig?.textToSpeechApiKey?.trim() || '';
  }

  private resolveTextToSpeechBaseURL(): string {
    return this.openAIConfig?.textToSpeechBaseURL?.trim() || '';
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

  private resolveTextToSpeechEndpoint(baseURL: string): string {
    const url = new URL(baseURL);
    const normalizedPath = url.pathname.replace(/\/+$/, '');

    if (normalizedPath.endsWith('/services/aigc/multimodal-generation')) {
      url.pathname = `${normalizedPath}/generation`;
      return url.toString();
    }

    if (
      normalizedPath.endsWith('/services/aigc/multimodal-generation/generation')
    ) {
      url.pathname = normalizedPath;
      return url.toString();
    }

    if (!normalizedPath || normalizedPath === '/') {
      url.pathname = '/api/v1/services/aigc/multimodal-generation/generation';
      return url.toString();
    }

    if (normalizedPath.endsWith('/api/v1')) {
      url.pathname = `${normalizedPath}/services/aigc/multimodal-generation/generation`;
      return url.toString();
    }

    url.pathname = `${normalizedPath}/services/aigc/multimodal-generation/generation`;
    return url.toString();
  }

  private async requestJson<T>(options: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<T> {
    const serializedBody =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const response = await this.requestBinary({
      url: options.url,
      method: options.method,
      headers: options.headers,
      body: serializedBody,
    });
    const responseText = response.body.toString('utf8').trim();

    if (!responseText) {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new AppError(
          'MINIMAX_PROVIDER_REQUEST_FAILED',
          `provider request failed with status ${response.statusCode}`,
          502
        );
      }

      return {} as T;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new AppError(
        'MINIMAX_INVALID_PROVIDER_RESPONSE',
        'provider response is not valid json',
        502,
        responseText
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'MINIMAX_PROVIDER_REQUEST_FAILED',
        this.extractProviderErrorMessage(
          parsed,
          `provider request failed with status ${response.statusCode}`
        ),
        502,
        parsed
      );
    }

    return parsed as T;
  }

  private async requestBinary(options: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string | Buffer;
    redirectCount?: number;
  }): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }> {
    const requestUrl = new URL(options.url);
    const bodyBuffer =
      typeof options.body === 'string'
        ? Buffer.from(options.body, 'utf8')
        : options.body;
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };

    if (bodyBuffer && !headers['Content-Length']) {
      headers['Content-Length'] = String(bodyBuffer.length);
    }

    const timeoutMs = this.normalizeTimeout(this.openAIConfig?.timeoutMs);
    const transport = requestUrl.protocol === 'http:' ? http : https;

    return new Promise((resolve, reject) => {
      const request = transport.request(
        {
          protocol: requestUrl.protocol,
          hostname: requestUrl.hostname,
          port: requestUrl.port ? Number(requestUrl.port) : undefined,
          method: options.method,
          path: `${requestUrl.pathname}${requestUrl.search}`,
          headers,
          ...(timeoutMs ? { timeout: timeoutMs } : {}),
        },
        response => {
          const statusCode = response.statusCode || 0;
          const locationHeader = response.headers.location;
          const location =
            typeof locationHeader === 'string' ? locationHeader.trim() : '';

          if (
            location &&
            [301, 302, 303, 307, 308].includes(statusCode) &&
            (options.redirectCount || 0) < 3
          ) {
            response.resume();

            void this.requestBinary({
              url: new URL(location, requestUrl).toString(),
              method: statusCode === 303 ? 'GET' : options.method,
              headers: options.headers,
              body: statusCode === 303 ? undefined : options.body,
              redirectCount: (options.redirectCount || 0) + 1,
            }).then(resolve, reject);
            return;
          }

          const chunks: Buffer[] = [];

          response.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on('end', () => {
            resolve({
              statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });

          response.on('error', reject);
        }
      );

      request.on('error', reject);

      request.on('timeout', () => {
        request.destroy(
          new AppError(
            'MINIMAX_PROVIDER_REQUEST_TIMEOUT',
            'provider request timed out',
            504
          )
        );
      });

      if (bodyBuffer && bodyBuffer.length > 0) {
        request.write(bodyBuffer);
      }

      request.end();
    });
  }

  private extractProviderErrorMessage(
    response: unknown,
    fallback: string
  ): string {
    if (!response || typeof response !== 'object') {
      return fallback;
    }

    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }

    const code = (response as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim();
    }

    return fallback;
  }

  private normalizeContentType(value: unknown): string {
    if (Array.isArray(value)) {
      return this.normalizeContentType(value[0]);
    }

    if (typeof value !== 'string') {
      return '';
    }

    return value.split(';')[0]?.trim().toLowerCase() || '';
  }

  private guessAudioMimeType(urlValue: string): string {
    const lower = urlValue.trim().toLowerCase();

    if (lower.endsWith('.mp3')) {
      return 'audio/mpeg';
    }
    if (lower.endsWith('.wav')) {
      return 'audio/wav';
    }
    if (lower.endsWith('.aac')) {
      return 'audio/aac';
    }
    if (lower.endsWith('.ogg')) {
      return 'audio/ogg';
    }
    if (lower.endsWith('.webm')) {
      return 'audio/webm';
    }

    return 'audio/wav';
  }
}
