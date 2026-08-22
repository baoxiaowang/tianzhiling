import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import {
  buildCosyVoiceSpeechInstruction,
  getCosyVoiceSpeechInstructionSource,
} from '@tzl/shared';
import { AppError } from '../common/errors';

interface CosyVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  defaultSpeechModel?: string;
  defaultPreviewModel?: string;
  defaultLanguageHint?: string;
  outputFormat?: string;
  sampleRate?: number;
  timeoutMs?: number;
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

export interface CosyVoiceSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  languageHint?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  instruction?: string;
  dialect?: string;
}

export interface CosyVoiceSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

@Provide()
export class CosyVoiceSpeechService {
  @Logger()
  logger: ILogger;

  @Config('cosyVoice')
  config: CosyVoiceConfig;

  async synthesize(
    input: CosyVoiceSpeechInput
  ): Promise<CosyVoiceSpeechResult> {
    const text = input.text?.trim();
    const voiceId = input.voiceId?.trim();

    if (!text) {
      throw new AppError(
        'COSYVOICE_INVALID_TEXT_TO_SPEECH_INPUT',
        'text to speech input is required',
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

    this.ensureEnabled();

    const format = this.normalizeOutputFormat();
    const sampleRate = this.normalizeSampleRate();
    const model = this.resolveSpeechModel(input.model, voiceId);
    const languageHint = this.normalizeLanguageHint(input.languageHint);
    const instruction = this.isInstructionModel(model)
      ? buildCosyVoiceSpeechInstruction(input)
      : undefined;
    const body = Buffer.from(
      JSON.stringify({
        model,
        input: {
          text,
          voice: voiceId,
          format,
          sample_rate: sampleRate,
          volume: this.normalizeVolume(input.volume),
          rate: this.normalizeRate(input.speed),
          pitch: this.normalizePitch(input.pitch),
          ...(languageHint ? { language_hints: [languageHint] } : {}),
          ...(instruction ? { instruction } : {}),
        },
      })
    );

    this.logger.info(
      '[cosyvoice-speech] synthesize, model=%s, voiceId=%s, format=%s, textLength=%s, instructionSource=%s, instructionLength=%s',
      model,
      voiceId,
      format,
      text.length,
      instruction
        ? getCosyVoiceSpeechInstructionSource(input)
        : 'none',
      instruction?.length || 0
    );

    const response = await this.requestJson<CosyVoiceSpeechResp>({
      path: '/api/v1/services/audio/tts/SpeechSynthesizer',
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
      return this.downloadAudio(audioUrl, response.request_id, format);
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
      'COSYVOICE_TEXT_TO_SPEECH_EMPTY_AUDIO',
      'CosyVoice text to speech response is missing audio',
      502,
      response
    );
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
        'COSYVOICE_HTTP_ERROR',
        raw || `CosyVoice http status ${response.statusCode}`,
        502
      );
    }

    try {
      const parsed = JSON.parse(raw) as CosyVoiceSpeechResp;

      if (parsed?.code || parsed?.message) {
        throw new AppError(
          parsed.code || 'COSYVOICE_TEXT_TO_SPEECH_FAILED',
          parsed.message || 'CosyVoice text to speech failed',
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
        'COSYVOICE_INVALID_RESPONSE',
        'CosyVoice response is not valid JSON',
        502
      );
    }
  }

  private async downloadAudio(
    audioUrl: string,
    requestId: string | undefined,
    format: string
  ): Promise<CosyVoiceSpeechResult> {
    const response = await this.requestBinary({
      url: audioUrl,
      method: 'GET',
      headers: {
        Accept: 'audio/*',
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'COSYVOICE_TEXT_TO_SPEECH_AUDIO_DOWNLOAD_FAILED',
        `CosyVoice audio download failed with status ${response.statusCode}`,
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
        req.destroy(new Error('CosyVoice request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('COSYVOICE_REQUEST_FAILED', error.message, 502)
        );
      });

      if (input.body) {
        req.write(input.body);
      }

      req.end();
    });
  }

  private normalizeBaseURL(): string {
    const raw =
      this.config?.baseURL?.trim() || 'https://dashscope.aliyuncs.com';
    return raw.replace(/\/+$/, '');
  }

  private resolveSpeechModel(
    inputModel: string | undefined,
    voiceId: string
  ): string {
    const modelFromVoiceId = this.inferModelFromVoiceId(voiceId);
    const normalizedInputModel = inputModel?.trim();

    if (modelFromVoiceId) {
      if (normalizedInputModel && normalizedInputModel !== modelFromVoiceId) {
        this.logger?.warn?.(
          '[cosyvoice-speech] model mismatch, inputModel=%s, voiceModel=%s, voiceId=%s',
          normalizedInputModel,
          modelFromVoiceId,
          voiceId
        );
      }

      return modelFromVoiceId;
    }

    return (
      normalizedInputModel ||
      this.config?.defaultSpeechModel?.trim() ||
      this.config?.defaultPreviewModel?.trim() ||
      'cosyvoice-v3.5-plus'
    );
  }

  private inferModelFromVoiceId(voiceId: string): string {
    const normalizedVoiceId = voiceId?.trim().toLowerCase();
    const knownModels = [
      'cosyvoice-v3.5-plus',
      'cosyvoice-v3-plus',
      'cosyvoice-v2',
      'cosyvoice-v1',
    ];
    const knownModel = knownModels.find(model =>
      normalizedVoiceId.startsWith(`${model}-`)
    );

    if (knownModel) {
      return knownModel;
    }

    return (
      normalizedVoiceId.match(
        /^(cosyvoice-v\d+(?:\.\d+)?(?:-[a-z0-9]+)*?)-[a-z0-9]{1,10}$/
      )?.[1] || ''
    );
  }

  private isInstructionModel(model?: string): boolean {
    return /^cosyvoice-v3\.5-plus$/i.test(model?.trim() || '');
  }

  private normalizeOutputFormat(): string {
    const format = this.config?.outputFormat?.trim().toLowerCase();

    if (format && ['mp3', 'wav', 'pcm', 'opus'].includes(format)) {
      return format;
    }

    return 'mp3';
  }

  private normalizeSampleRate(): number {
    const sampleRate = Number(this.config?.sampleRate);

    if ([8000, 16000, 22050, 24000, 44100, 48000].includes(sampleRate)) {
      return sampleRate;
    }

    return 24000;
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

  private normalizeLanguageHint(value?: string): string {
    const raw = value?.trim() || this.config?.defaultLanguageHint?.trim() || '';
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

    return supported.includes(normalized) ? normalized : '';
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
