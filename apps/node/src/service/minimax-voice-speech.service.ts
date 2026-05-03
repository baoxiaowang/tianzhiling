import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { AppError } from '../common/errors';

interface MinimaxVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  defaultSpeechModel?: string;
  defaultPreviewModel?: string;
  timeoutMs?: number;
}

interface MinimaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

interface MinimaxTextToSpeechResp {
  base_resp?: MinimaxBaseResp;
  trace_id?: string;
  data?: {
    audio?: string;
    status?: number;
  };
}

export interface MinimaxVoiceSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  languageBoost?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
}

export interface MinimaxVoiceSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

@Provide()
export class MinimaxVoiceSpeechService {
  @Logger()
  logger: ILogger;

  @Config('minimaxVoice')
  config: MinimaxVoiceConfig;

  hasConfig(): boolean {
    return Boolean(
      this.config?.enabled !== false &&
        this.config?.apiKey?.trim() &&
        this.normalizeBaseURL()
    );
  }

  async synthesize(
    input: MinimaxVoiceSpeechInput
  ): Promise<MinimaxVoiceSpeechResult> {
    const text = input.text?.trim();
    const voiceId = input.voiceId?.trim();

    if (!text) {
      throw new AppError(
        'MINIMAX_INVALID_TEXT_TO_SPEECH_INPUT',
        'text to speech input is required',
        400
      );
    }

    if (!voiceId) {
      throw new AppError(
        'MINIMAX_VOICE_ID_MISSING',
        'MiniMax voice id is missing',
        400
      );
    }

    this.ensureEnabled();

    const model =
      input.model?.trim() ||
      this.config?.defaultSpeechModel?.trim() ||
      this.config?.defaultPreviewModel?.trim() ||
      'speech-2.8-turbo';
    const speed = this.normalizeNumberInRange(input.speed, 1, 0.5, 2);
    const volume = this.normalizeNumberInRange(input.volume, 1, 0, 10);
    const pitch = this.normalizeNumberInRange(input.pitch, 0, -12, 12);
    const body = Buffer.from(
      JSON.stringify({
        model,
        text,
        stream: false,
        output_format: 'url',
        voice_setting: {
          voice_id: voiceId,
          speed,
          vol: volume,
          pitch,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
        ...(input.languageBoost?.trim()
          ? { language_boost: input.languageBoost.trim() }
          : {}),
      })
    );

    this.logger.info(
      '[minimax-voice-speech] synthesize, model=%s, voiceId=%s, speed=%s, vol=%s, pitch=%s, textLength=%s',
      model,
      voiceId,
      speed,
      volume,
      pitch,
      text.length
    );

    const response = await this.requestJson<MinimaxTextToSpeechResp>({
      path: '/v1/t2a_v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
    });

    this.assertMinimaxSuccess(response?.base_resp);

    const audio = response?.data?.audio?.trim() || '';

    if (!audio) {
      throw new AppError(
        'MINIMAX_TEXT_TO_SPEECH_EMPTY_AUDIO',
        'text to speech response is missing audio',
        502,
        response
      );
    }

    if (/^https?:\/\//i.test(audio)) {
      return this.downloadAudio(audio, response.trace_id);
    }

    return {
      audioUrl: '',
      audioBuffer: Buffer.from(audio, 'hex'),
      mimeType: 'audio/mpeg',
      requestId: response.trace_id?.trim() || undefined,
    };
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError(
        'MINIMAX_VOICE_DISABLED',
        'MiniMax voice is disabled',
        400
      );
    }

    if (!this.config?.apiKey?.trim()) {
      throw new AppError(
        'MINIMAX_VOICE_API_KEY_MISSING',
        'MiniMax voice api key is missing',
        500
      );
    }
  }

  private async downloadAudio(
    audioUrl: string,
    requestId?: string
  ): Promise<MinimaxVoiceSpeechResult> {
    const response = await this.requestBinary({
      url: audioUrl,
      method: 'GET',
      headers: {
        Accept: 'audio/*',
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'MINIMAX_TEXT_TO_SPEECH_AUDIO_DOWNLOAD_FAILED',
        `text to speech audio download failed with status ${response.statusCode}`,
        502
      );
    }

    return {
      audioUrl,
      audioBuffer: response.body,
      mimeType:
        this.normalizeContentType(response.headers['content-type']) ||
        'audio/mpeg',
      requestId: requestId?.trim() || undefined,
    };
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
        'MINIMAX_HTTP_ERROR',
        raw || `MiniMax http status ${response.statusCode}`,
        502
      );
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new AppError(
        'MINIMAX_INVALID_RESPONSE',
        'MiniMax response is not valid JSON',
        502
      );
    }
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
        req.destroy(new Error('MiniMax request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('MINIMAX_REQUEST_FAILED', error.message, 502)
        );
      });

      if (input.body) {
        req.write(input.body);
      }

      req.end();
    });
  }

  private assertMinimaxSuccess(resp: MinimaxBaseResp | undefined): void {
    if (!resp || resp.status_code === 0) {
      return;
    }

    throw new AppError(
      'MINIMAX_TEXT_TO_SPEECH_FAILED',
      resp.status_msg || 'MiniMax text to speech failed',
      502,
      resp
    );
  }

  private normalizeBaseURL(): string {
    const raw = this.config?.baseURL?.trim() || 'https://api.minimaxi.com';
    return raw.replace(/\/+$/, '');
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

  private normalizeContentType(value?: string | string[]): string {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(';')[0]?.trim() || '';
  }
}
