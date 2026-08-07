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
  timeoutMs?: number;
}

interface QwenEnrollmentResponse {
  status_code?: number;
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    voice?: string;
    target_model?: string;
    fallback_mode?: boolean;
    fallback_reason?: string;
  };
}

export interface QwenVoiceEnrollmentResult {
  providerVoiceId: string;
  targetModel: string;
  requestId?: string;
  fallbackMode?: boolean;
  fallbackReason?: string;
}

export interface QwenVoiceDeletionResult {
  requestId?: string;
}

@Provide()
export class QwenVoiceEnrollmentService {
  @Logger()
  logger: ILogger;

  @Config('qwenVoice')
  config: QwenVoiceConfig;

  getDefaultModel(): string {
    return this.config?.defaultSpeechModel?.trim() || 'qwen3-tts-vc-2026-01-22';
  }

  async createVoice(input: {
    audioUrl: string;
    preferredName: string;
    language?: string;
  }): Promise<QwenVoiceEnrollmentResult> {
    this.ensureEnabled();
    const audioUrl = input.audioUrl?.trim();
    const preferredName = input.preferredName?.trim();

    if (!/^https?:\/\//i.test(audioUrl)) {
      throw new AppError(
        'QWEN_VOICE_AUDIO_URL_MISSING',
        'Qwen voice audio url is missing',
        400
      );
    }
    if (!/^[A-Za-z0-9_]{1,16}$/.test(preferredName)) {
      throw new AppError(
        'INVALID_QWEN_PREFERRED_NAME',
        'Qwen preferred name must be 1-16 letters, digits or _',
        400
      );
    }

    const targetModel = this.getDefaultModel();
    const body = Buffer.from(
      JSON.stringify({
        model: 'qwen-voice-enrollment',
        input: {
          action: 'create',
          target_model: targetModel,
          preferred_name: preferredName,
          audio: { data: audioUrl },
          language: input.language?.trim() || 'zh',
        },
      })
    );
    const response = await this.requestJson<QwenEnrollmentResponse>(
      '/api/v1/services/audio/tts/customization',
      body
    );
    const providerVoiceId = response.output?.voice?.trim();

    if (!providerVoiceId) {
      throw new AppError(
        response.code || 'QWEN_VOICE_ID_MISSING',
        response.message || 'Qwen voice response is missing voice',
        502,
        response
      );
    }

    this.logger.info(
      '[qwen-voice-enrollment] voice created, voiceId=%s, model=%s',
      providerVoiceId,
      response.output?.target_model?.trim() || targetModel
    );

    return {
      providerVoiceId,
      targetModel: response.output?.target_model?.trim() || targetModel,
      requestId: response.request_id?.trim() || undefined,
      fallbackMode: response.output?.fallback_mode,
      fallbackReason: response.output?.fallback_reason,
    };
  }

  async deleteVoice(voiceId: string): Promise<QwenVoiceDeletionResult> {
    this.ensureEnabled();
    const voice = voiceId?.trim();
    if (!voice || voice.startsWith('pending_')) {
      throw new AppError(
        'QWEN_VOICE_ID_MISSING',
        'Qwen voice id is required for deletion',
        400
      );
    }

    const body = Buffer.from(
      JSON.stringify({
        model: 'qwen-voice-enrollment',
        input: {
          action: 'delete',
          voice,
        },
      })
    );
    const response = await this.requestJson<QwenEnrollmentResponse>(
      '/api/v1/services/audio/tts/customization',
      body
    );

    this.logger.info(
      '[qwen-voice-enrollment] voice deleted, voiceId=%s',
      voice
    );
    return {
      requestId: response.request_id?.trim() || undefined,
    };
  }

  private requestJson<T>(path: string, body: Buffer): Promise<T> {
    const baseURL =
      this.config?.baseURL?.trim() || 'https://dashscope.aliyuncs.com';
    const url = new URL(path, `${baseURL.replace(/\/+$/, '')}/`);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;

    return new Promise<T>((resolve, reject) => {
      const req = requester(
        url,
        {
          method: 'POST',
          timeout: this.config?.timeoutMs || 120000,
          headers: {
            Authorization: `Bearer ${this.config.apiKey?.trim()}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': String(body.length),
          },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
              const providerError = this.parseJsonRecord(raw);
              reject(
                new AppError(
                  this.readText(providerError?.code) ||
                    'QWEN_VOICE_ENROLLMENT_HTTP_ERROR',
                  this.readText(providerError?.message) ||
                    raw ||
                    `Qwen http status ${res.statusCode || 0}`,
                  502,
                  {
                    ...(providerError ?? {}),
                    httpStatus: res.statusCode || 0,
                  }
                )
              );
              return;
            }

            try {
              const parsed = JSON.parse(raw) as QwenEnrollmentResponse;

              if (parsed.code || parsed.message) {
                reject(
                  new AppError(
                    parsed.code || 'QWEN_VOICE_ENROLLMENT_FAILED',
                    parsed.message || 'Qwen voice enrollment failed',
                    502,
                    parsed
                  )
                );
                return;
              }

              resolve(parsed as T);
            } catch (error) {
              reject(
                error instanceof AppError
                  ? error
                  : new AppError(
                      'QWEN_VOICE_ENROLLMENT_INVALID_RESPONSE',
                      'Qwen response is not valid JSON',
                      502
                    )
              );
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('Qwen request timeout')));
      req.on('error', error =>
        reject(
          new AppError(
            'QWEN_VOICE_ENROLLMENT_REQUEST_FAILED',
            error.message,
            502
          )
        )
      );
      req.end(body);
    });
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false || !this.config?.apiKey?.trim()) {
      throw new AppError(
        'QWEN_VOICE_ENROLLMENT_NOT_CONFIGURED',
        'Qwen voice enrollment is not configured',
        503
      );
    }
  }

  private parseJsonRecord(raw: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
