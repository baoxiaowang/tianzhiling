import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { AppError } from '../common/errors';

interface QwenVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  defaultSpeechModel?: string;
  defaultLanguageType?: string;
  timeoutMs?: number;
}

interface QwenSpeechResp {
  status_code?: number;
  request_id?: string;
  output?: {
    finish_reason?: string;
    audio?: {
      data?: string;
      url?: string;
      id?: string;
      expires_at?: number;
    };
  };
  usage?: unknown;
  code?: string;
  message?: string;
}

export interface QwenVoiceSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  language?: string;
}

export interface QwenVoiceSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

@Provide()
export class QwenVoiceSpeechService {
  @Logger()
  logger: ILogger;

  @Config('qwenVoice')
  config: QwenVoiceConfig;

  async synthesize(
    input: QwenVoiceSpeechInput
  ): Promise<QwenVoiceSpeechResult> {
    const text = input.text?.trim();
    const voiceId = input.voiceId?.trim();

    if (!text) {
      throw new AppError(
        'QWEN_INVALID_TEXT_TO_SPEECH_INPUT',
        'text to speech input is required',
        400
      );
    }

    if (!voiceId) {
      throw new AppError(
        'QWEN_VOICE_ID_MISSING',
        'Qwen voice id is missing',
        400
      );
    }

    this.ensureEnabled();

    const model =
      input.model?.trim() ||
      this.config?.defaultSpeechModel?.trim() ||
      'qwen3-tts-vc-2026-01-22';
    const languageType = this.normalizeLanguageType(input.language);
    const body = Buffer.from(
      JSON.stringify({
        model,
        input: {
          text,
          voice: voiceId,
          ...(languageType ? { language_type: languageType } : {}),
        },
      })
    );

    this.logger.info(
      '[qwen-voice-speech] synthesize, model=%s, voiceId=%s, languageType=%s, textLength=%s',
      model,
      voiceId,
      languageType || '',
      text.length
    );

    const response = await this.requestJson<QwenSpeechResp>({
      path: '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
    });
    const audio = response?.output?.audio;
    const audioUrl = audio?.url?.trim() || '';
    const data = audio?.data?.trim() || '';

    if (audioUrl) {
      return this.downloadAudio(audioUrl, response.request_id);
    }

    if (data) {
      return {
        audioUrl: '',
        audioBuffer: Buffer.from(data, 'base64'),
        mimeType: 'audio/wav',
        requestId: response.request_id?.trim() || undefined,
      };
    }

    throw new AppError(
      'QWEN_TEXT_TO_SPEECH_EMPTY_AUDIO',
      'Qwen text to speech response is missing audio',
      502,
      response
    );
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError('QWEN_VOICE_DISABLED', 'Qwen voice is disabled', 400);
    }

    if (!this.config?.apiKey?.trim()) {
      throw new AppError(
        'QWEN_VOICE_API_KEY_MISSING',
        'Qwen voice api key is missing',
        500
      );
    }
  }

  private async requestJson<T>(input: {
    path: string;
    method: 'POST';
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<T> {
    const baseURL = this.normalizeBaseURL();
    const url = new URL(input.path, baseURL);
    const response = await this.requestBinary({
      url: url.toString(),
      method: input.method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey?.trim()}`,
        Accept: 'application/json',
        ...input.headers,
      },
      body: input.body,
    });
    const raw = response.body.toString('utf8');

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'QWEN_HTTP_ERROR',
        raw || `Qwen http status ${response.statusCode}`,
        502
      );
    }

    try {
      const parsed = JSON.parse(raw) as QwenSpeechResp;
      const statusCode = parsed?.status_code;

      if (
        parsed?.code ||
        parsed?.message ||
        (typeof statusCode === 'number' && statusCode !== 200)
      ) {
        throw new AppError(
          parsed.code || 'QWEN_TEXT_TO_SPEECH_FAILED',
          parsed.message || 'Qwen text to speech failed',
          502,
          parsed
        );
      }

      return parsed as T;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'QWEN_INVALID_RESPONSE',
        'Qwen response is not valid JSON',
        502
      );
    }
  }

  private async downloadAudio(
    audioUrl: string,
    requestId: string | undefined
  ): Promise<QwenVoiceSpeechResult> {
    const response = await this.requestBinaryWithRetry({
      url: audioUrl,
      method: 'GET',
      headers: {
        Accept: 'audio/*',
        'User-Agent': 'tianzhiling-node/1.0',
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'QWEN_TEXT_TO_SPEECH_AUDIO_DOWNLOAD_FAILED',
        `Qwen audio download failed with status ${response.statusCode}`,
        502
      );
    }

    return {
      audioUrl,
      audioBuffer: response.body,
      mimeType:
        this.normalizeContentType(response.headers['content-type']) ||
        'audio/wav',
      requestId: requestId?.trim() || undefined,
    };
  }

  private async requestBinary(input: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: Buffer;
  }): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> {
    const url = new URL(input.url);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;

    return new Promise((resolve, reject) => {
      const req = requester(
        url,
        {
          method: input.method,
          timeout: this.config?.timeoutMs || 120000,
          headers: input.headers,
        },
        res => {
          const chunks: Buffer[] = [];

          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('Qwen request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('QWEN_REQUEST_FAILED', error.message, 502)
        );
      });

      if (input.body) {
        req.write(input.body);
      }

      req.end();
    });
  }

  private async requestBinaryWithRetry(input: {
    url: string;
    method: 'GET';
    headers?: Record<string, string>;
  }): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.requestBinary(input);
      } catch (error) {
        lastError = error;

        if (attempt < 3) {
          await this.sleep(attempt * 500);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  private normalizeBaseURL(): string {
    const raw =
      this.config?.baseURL?.trim() || 'https://dashscope.aliyuncs.com';
    return raw.replace(/\/+$/, '');
  }

  private normalizeLanguageType(value?: string): string {
    const raw = value?.trim() || this.config?.defaultLanguageType?.trim() || '';

    if (!raw || raw.toLowerCase() === 'auto') {
      return 'Auto';
    }

    const map: Record<string, string> = {
      zh: 'Chinese',
      chinese: 'Chinese',
      en: 'English',
      english: 'English',
      de: 'German',
      german: 'German',
      it: 'Italian',
      italian: 'Italian',
      pt: 'Portuguese',
      portuguese: 'Portuguese',
      es: 'Spanish',
      spanish: 'Spanish',
      ja: 'Japanese',
      japanese: 'Japanese',
      ko: 'Korean',
      korean: 'Korean',
      fr: 'French',
      french: 'French',
      ru: 'Russian',
      russian: 'Russian',
    };

    return map[raw.toLowerCase()] || 'Auto';
  }

  private normalizeContentType(value?: string | string[]): string {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(';')[0]?.trim() || '';
  }
}
