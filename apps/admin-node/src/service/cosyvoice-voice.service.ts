import { Config, Logger, Provide } from '@midwayjs/core';
import { AppError } from '@tzl/shared';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import type { ILogger } from '@midwayjs/logger';

interface CosyVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  defaultPreviewModel?: string;
  defaultLanguageHint?: string;
  maxPromptAudioLength?: number;
  enablePreprocess?: boolean;
  timeoutMs?: number;
}

interface CosyVoiceResp {
  request_id?: string;
  output?: {
    voice_id?: string;
    status?: string;
    target_model?: string;
    resource_link?: string;
    preview_audio?: {
      data?: string;
      sample_rate?: number;
      response_format?: string;
    };
  };
  usage?: unknown;
  code?: string;
  message?: string;
}

interface CosyVoiceSpeechResp {
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

export interface CosyVoiceCloneInput {
  audioUrl: string;
  prefix: string;
  targetModel?: string;
  languageHint?: string;
}

export interface CosyVoiceCloneResult {
  providerVoiceId: string;
  demoAudio: string;
  requestId?: string;
}

export interface CosyVoicePreviewSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  languageHint?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
}

export interface CosyVoicePreviewSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

export interface CosyVoiceQueryVoiceResult {
  voiceId: string;
  status: string;
  targetModel?: string;
  resourceLink?: string;
  requestId?: string;
}

@Provide()
export class CosyVoiceVoiceService {
  @Logger()
  logger: ILogger;

  @Config('cosyVoice')
  config: CosyVoiceConfig;

  getDefaultPreviewModel(): string {
    return this.config?.defaultPreviewModel?.trim() || 'cosyvoice-v3.5-plus';
  }

  getDefaultLanguageHint(): string {
    return this.config?.defaultLanguageHint?.trim() || 'zh';
  }

  async cloneVoice(input: CosyVoiceCloneInput): Promise<CosyVoiceCloneResult> {
    this.ensureEnabled();

    const audioUrl = input.audioUrl?.trim();
    const prefix = this.normalizePrefix(input.prefix);
    const targetModel =
      input.targetModel?.trim() || this.getDefaultPreviewModel();
    const languageHint = this.normalizeLanguageHint(input.languageHint);
    const parameters = this.buildCloneParameters();
    const payload: Record<string, unknown> = {
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: targetModel,
        prefix,
        url: audioUrl,
        ...(languageHint ? { language_hints: [languageHint] } : {}),
      },
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    };

    if (!audioUrl) {
      throw new AppError(
        'COSYVOICE_AUDIO_URL_MISSING',
        'CosyVoice audio url is missing',
        400
      );
    }

    this.logger.info(
      '[cosyvoice] create voice, targetModel=%s, prefix=%s, languageHint=%s',
      targetModel,
      prefix,
      languageHint || ''
    );

    const response = await this.requestJson<CosyVoiceResp>({
      path: '/api/v1/services/audio/tts/customization',
      method: 'POST',
      body: Buffer.from(JSON.stringify(payload)),
    });
    const voiceId = response?.output?.voice_id?.trim();

    if (!voiceId) {
      throw new AppError(
        'COSYVOICE_VOICE_ID_MISSING',
        'CosyVoice voice_id is missing',
        502,
        response
      );
    }

    return {
      providerVoiceId: voiceId,
      demoAudio: '',
      requestId: response.request_id?.trim() || undefined,
    };
  }

  async synthesizePreview(
    input: CosyVoicePreviewSpeechInput
  ): Promise<CosyVoicePreviewSpeechResult> {
    this.ensureEnabled();

    const text = input.text?.trim();
    const voiceId = input.voiceId?.trim();

    if (!text) {
      throw new AppError(
        'COSYVOICE_PREVIEW_TEXT_MISSING',
        'CosyVoice preview text is missing',
        400
      );
    }

    if (!voiceId) {
      throw new AppError(
        'COSYVOICE_VOICE_ID_MISSING',
        'CosyVoice voice id is missing',
        400
      );
    }

    const format = 'mp3';
    const languageHint = this.normalizeLanguageHint(input.languageHint);
    const body = Buffer.from(
      JSON.stringify({
        model: input.model?.trim() || this.getDefaultPreviewModel(),
        input: {
          text,
          voice: voiceId,
          format,
          sample_rate: 24000,
          volume: this.normalizeVolume(input.volume),
          rate: this.normalizeRate(input.speed),
          pitch: this.normalizePitch(input.pitch),
          ...(languageHint ? { language_hints: [languageHint] } : {}),
        },
      })
    );
    const response = await this.requestJson<CosyVoiceSpeechResp>({
      path: '/api/v1/services/audio/tts/SpeechSynthesizer',
      method: 'POST',
      body,
    });
    const audio = response?.output?.audio;
    const audioUrl = audio?.url?.trim() || '';
    const data = audio?.data?.trim() || '';

    if (audioUrl) {
      try {
        return await this.downloadAudio(audioUrl, response.request_id, format);
      } catch (error) {
        this.logger?.warn?.(
          '[cosyvoice] preview audio download failed, fallback to provider url, url=%s, reason=%s',
          this.describeUrl(audioUrl),
          error instanceof Error ? error.message : String(error)
        );

        return {
          audioUrl,
          audioBuffer: Buffer.alloc(0),
          mimeType: this.mimeTypeFromFormat(format),
          requestId: response.request_id?.trim() || undefined,
        };
      }
    }

    if (data) {
      return {
        audioUrl: '',
        audioBuffer: Buffer.from(data, 'base64'),
        mimeType: this.mimeTypeFromFormat(format),
        requestId: response.request_id?.trim() || undefined,
      };
    }

    throw new AppError(
      'COSYVOICE_PREVIEW_EMPTY_AUDIO',
      'CosyVoice preview response is missing audio',
      502,
      response
    );
  }

  async queryVoice(voiceId: string): Promise<CosyVoiceQueryVoiceResult> {
    this.ensureEnabled();

    const normalizedVoiceId = voiceId?.trim();

    if (!normalizedVoiceId) {
      throw new AppError(
        'COSYVOICE_VOICE_ID_MISSING',
        'CosyVoice voice id is missing',
        400
      );
    }

    const payload = {
      model: 'voice-enrollment',
      input: {
        action: 'query_voice',
        voice_id: normalizedVoiceId,
      },
    };
    const response = await this.requestJson<CosyVoiceResp>({
      path: '/api/v1/services/audio/tts/customization',
      method: 'POST',
      body: Buffer.from(JSON.stringify(payload)),
    });
    const output = response?.output;
    const providerStatus = output?.status?.trim();

    if (!providerStatus) {
      throw new AppError(
        'COSYVOICE_VOICE_STATUS_MISSING',
        'CosyVoice voice status is missing',
        502,
        response
      );
    }

    return {
      voiceId: output?.voice_id?.trim() || normalizedVoiceId,
      status: providerStatus,
      targetModel: output?.target_model?.trim() || undefined,
      resourceLink: output?.resource_link?.trim() || undefined,
      requestId: response.request_id?.trim() || undefined,
    };
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError(
        'COSYVOICE_DISABLED',
        'CosyVoice voice is disabled',
        400
      );
    }

    if (!this.config?.apiKey?.trim()) {
      throw new AppError(
        'COSYVOICE_API_KEY_MISSING',
        'CosyVoice api key is missing',
        500
      );
    }
  }

  private buildCloneParameters(): Record<string, unknown> {
    const parameters: Record<string, unknown> = {};
    const maxPromptAudioLength = Number(this.config?.maxPromptAudioLength);

    if (
      Number.isFinite(maxPromptAudioLength) &&
      maxPromptAudioLength >= 3 &&
      maxPromptAudioLength <= 30
    ) {
      parameters.max_prompt_audio_length = maxPromptAudioLength;
    }

    if (typeof this.config?.enablePreprocess === 'boolean') {
      parameters.enable_preprocess = this.config.enablePreprocess;
    }

    return parameters;
  }

  private normalizePrefix(value: string): string {
    const prefix = value?.trim().toLowerCase();

    if (!/^[a-z0-9]{1,10}$/.test(prefix)) {
      throw new AppError(
        'INVALID_COSYVOICE_PREFIX',
        'CosyVoice prefix must be 1-10 lowercase letters or digits',
        400
      );
    }

    return prefix;
  }

  private normalizeLanguageHint(value?: string): string {
    const raw = value?.trim() || this.getDefaultLanguageHint();
    const map: Record<string, string> = {
      auto: '',
      chinese: 'zh',
      'chinese,yue': 'zh',
      english: 'en',
    };
    const normalized = map[raw.toLowerCase()] || raw.toLowerCase();
    const supported = [
      '',
      'zh',
      'en',
      'fr',
      'de',
      'ja',
      'ko',
      'ru',
      'pt',
      'th',
      'id',
      'vi',
    ];

    if (!supported.includes(normalized)) {
      return this.getDefaultLanguageHint();
    }

    return normalized;
  }

  private normalizeRate(value: unknown): number {
    return this.normalizeNumberInRange(value, 1, 0.5, 2);
  }

  private normalizeVolume(value: unknown): number {
    const volume = this.normalizeNumberInRange(value, 1, 0, 10);
    return Math.round(volume * 10);
  }

  private normalizePitch(value: unknown): number {
    const semitones = this.normalizeNumberInRange(value, 0, -12, 12);
    return Math.round(Math.pow(2, semitones / 12) * 100) / 100;
  }

  private normalizeNumberInRange(
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    const clamped = Math.min(max, Math.max(min, parsed));
    return Math.round(clamped * 100) / 100;
  }

  private async downloadAudio(
    audioUrl: string,
    requestId: string | undefined,
    format: string
  ): Promise<CosyVoicePreviewSpeechResult> {
    const response = await this.requestBinaryWithRetry({
      url: audioUrl,
      method: 'GET',
      headers: {
        Accept: 'audio/*',
        'User-Agent': 'tianzhiling-admin-node/1.0',
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'COSYVOICE_PREVIEW_AUDIO_DOWNLOAD_FAILED',
        `CosyVoice preview audio download failed with status ${response.statusCode}`,
        502
      );
    }

    return {
      audioUrl,
      audioBuffer: response.body,
      mimeType:
        this.normalizeContentType(response.headers['content-type']) ||
        this.mimeTypeFromFormat(format),
      requestId: requestId?.trim() || undefined,
    };
  }

  private async requestJson<T>(input: {
    path: string;
    method: 'POST';
    body: Buffer;
  }): Promise<T> {
    const baseURL = this.normalizeBaseURL();
    const url = new URL(input.path, baseURL);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;

    return new Promise<T>((resolve, reject) => {
      const req = requester(
        url,
        {
          method: input.method,
          timeout: this.config?.timeoutMs || 120000,
          headers: {
            Authorization: `Bearer ${this.config.apiKey?.trim()}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': String(input.body.length),
          },
        },
        res => {
          const chunks: Buffer[] = [];

          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if (
              !res.statusCode ||
              res.statusCode < 200 ||
              res.statusCode >= 300
            ) {
              reject(
                new AppError(
                  'COSYVOICE_HTTP_ERROR',
                  raw || `CosyVoice http status ${res.statusCode}`,
                  502
                )
              );
              return;
            }

            try {
              const parsed = JSON.parse(raw) as CosyVoiceResp;

              if (parsed?.code || parsed?.message) {
                reject(
                  new AppError(
                    parsed.code || 'COSYVOICE_REQUEST_FAILED',
                    parsed.message || 'CosyVoice request failed',
                    502,
                    parsed
                  )
                );
                return;
              }

              resolve(parsed as T);
            } catch {
              reject(
                new AppError(
                  'COSYVOICE_INVALID_RESPONSE',
                  'CosyVoice response is not valid JSON',
                  502
                )
              );
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('CosyVoice request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('COSYVOICE_REQUEST_FAILED', error.message, 502)
        );
      });
      req.write(input.body);
      req.end();
    });
  }

  private async requestBinary(input: {
    url: string;
    method: 'GET';
    headers?: Record<string, string>;
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
        req.destroy(new Error('CosyVoice request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('COSYVOICE_REQUEST_FAILED', error.message, 502)
        );
      });
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

  private describeUrl(value: string): string {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return value.split('?')[0] || value;
    }
  }

  private normalizeContentType(value?: string | string[]): string {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(';')[0]?.trim() || '';
  }

  private mimeTypeFromFormat(format: string): string {
    const map: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      pcm: 'audio/pcm',
      opus: 'audio/opus',
    };

    return map[format] || 'audio/mpeg';
  }
}
