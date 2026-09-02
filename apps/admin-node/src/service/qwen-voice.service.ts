import { Config, Logger, Provide } from '@midwayjs/core';
import {
  AppError,
  buildQwenAudioSpeechInstruction,
  getQwenAudioSpeechInstructionSource,
  resolveVoiceTimbreDialect,
} from '@tzl/shared';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import type { ILogger } from '@midwayjs/logger';

interface QwenVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  defaultPreviewModel?: string;
  defaultLanguage?: string;
  timeoutMs?: number;
}

interface QwenVoiceResp {
  status_code?: number;
  request_id?: string;
  output?: {
    voice?: string;
    voice_id?: string;
    target_model?: string;
    fallback_mode?: boolean;
    fallback_reason?: string;
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

export interface QwenCloneInput {
  audioUrl: string;
  preferredName: string;
  targetModel?: string;
  language?: string;
}

export interface QwenCloneResult {
  providerVoiceId: string;
  targetModel: string;
  requestId?: string;
  fallbackMode?: boolean;
  fallbackReason?: string;
}

export interface QwenPreviewSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  language?: string;
  instruction?: string;
  dialect?: string;
  speed?: number;
}

export interface QwenPreviewSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

export interface QwenDeleteVoiceResult {
  requestId?: string;
}

@Provide()
export class QwenVoiceService {
  @Logger()
  logger: ILogger;

  @Config('qwenVoice')
  config: QwenVoiceConfig;

  getDefaultPreviewModel(): string {
    return (
      this.config?.defaultPreviewModel?.trim() || 'qwen3-tts-vc-2026-01-22'
    );
  }

  getDefaultLanguage(): string {
    return this.config?.defaultLanguage?.trim() || 'zh';
  }

  async cloneVoice(input: QwenCloneInput): Promise<QwenCloneResult> {
    this.ensureEnabled();

    const audioUrl = input.audioUrl?.trim();
    const targetModel =
      input.targetModel?.trim() || this.getDefaultPreviewModel();
    const qwenAudio = this.isQwenAudioModel(targetModel);
    const preferredName = this.normalizePreferredName(
      input.preferredName,
      qwenAudio
    );
    const language = this.normalizeCloneLanguage(input.language);
    const payload: Record<string, unknown> = qwenAudio
      ? {
          model: 'voice-enrollment',
          input: {
            action: 'create_voice',
            target_model: targetModel,
            prefix: preferredName,
            url: audioUrl,
            ...(this.supportsEnrollmentHints(targetModel)
              ? {
                  language_hints: [language || 'zh'],
                  max_prompt_audio_length: 20,
                }
              : {}),
          },
        }
      : {
          model: 'qwen-voice-enrollment',
          input: {
            action: 'create',
            target_model: targetModel,
            preferred_name: preferredName,
            audio: {
              data: audioUrl,
            },
            ...(language ? { language } : {}),
          },
        };

    if (!audioUrl) {
      throw new AppError(
        'QWEN_VOICE_AUDIO_URL_MISSING',
        'Qwen voice audio url is missing',
        400
      );
    }

    this.logger.info(
      '[qwen-voice] create voice, targetModel=%s, preferredName=%s, language=%s',
      targetModel,
      preferredName,
      language || ''
    );

    const response = await this.requestJson<QwenVoiceResp>({
      path: '/api/v1/services/audio/tts/customization',
      method: 'POST',
      body: Buffer.from(JSON.stringify(payload)),
    });
    const voice = (
      response?.output?.voice_id || response?.output?.voice
    )?.trim();

    if (!voice) {
      throw new AppError(
        'QWEN_VOICE_ID_MISSING',
        'Qwen voice response is missing voice',
        502,
        response
      );
    }

    return {
      providerVoiceId: voice,
      targetModel: response.output?.target_model?.trim() || targetModel,
      requestId: response.request_id?.trim() || undefined,
      fallbackMode: response.output?.fallback_mode,
      fallbackReason: response.output?.fallback_reason,
    };
  }

  async synthesizePreview(
    input: QwenPreviewSpeechInput
  ): Promise<QwenPreviewSpeechResult> {
    this.ensureEnabled();

    const text = input.text?.trim();
    const voiceId = input.voiceId?.trim();

    if (!text) {
      throw new AppError(
        'QWEN_PREVIEW_TEXT_MISSING',
        'Qwen preview text is missing',
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

    const model = input.model?.trim() || this.getDefaultPreviewModel();
    const qwenAudio = this.isQwenAudioModel(model);
    const languageType = this.normalizeSpeechLanguageType(input.language);
    const languageHint = this.normalizeCloneLanguage(input.language) || 'zh';
    const instruction = buildQwenAudioSpeechInstruction({
      instruction: input.instruction,
      dialect: input.dialect,
      speechSpeed: input.speed,
    });
    const instructionSource = getQwenAudioSpeechInstructionSource(input);
    const resolvedDialect = resolveVoiceTimbreDialect(
      input.dialect,
      input.instruction
    );
    const body = Buffer.from(
      JSON.stringify({
        model,
        input: qwenAudio
          ? {
              text,
              voice: voiceId,
              format: 'wav',
              sample_rate: 24000,
              language_hints: [languageHint],
              rate: this.normalizeRate(input.speed),
              ...(instruction ? { instruction } : {}),
            }
          : {
              text,
              voice: voiceId,
              ...(languageType ? { language_type: languageType } : {}),
            },
      })
    );

    this.logger.info(
      '[qwen-voice] synthesize preview, model=%s, voiceRef=%s, language=%s, dialect=%s, instructionSource=%s, instructionLength=%s, textLength=%s',
      model,
      this.describeVoiceId(voiceId),
      qwenAudio ? languageHint : languageType || '',
      resolvedDialect,
      instructionSource,
      instruction?.length || 0,
      text.length
    );

    const response = await this.requestJson<QwenVoiceResp>({
      path: qwenAudio
        ? '/api/v1/services/audio/tts/SpeechSynthesizer'
        : '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      body,
    });
    const audio = response?.output?.audio;
    const audioUrl = audio?.url?.trim() || '';
    const data = audio?.data?.trim() || '';

    if (audioUrl || data) {
      this.logger.info(
        '[qwen-voice] synthesize preview succeeded, model=%s, requestId=%s, audioSource=%s',
        model,
        response.request_id?.trim() || '',
        audioUrl ? 'url' : 'base64'
      );
    }

    if (audioUrl) {
      try {
        return await this.downloadAudio(audioUrl, response.request_id);
      } catch (error) {
        this.logger?.warn?.(
          '[qwen-voice] preview audio download failed, fallback to provider url, url=%s, reason=%s',
          this.describeUrl(audioUrl),
          error instanceof Error ? error.message : String(error)
        );

        return {
          audioUrl,
          audioBuffer: Buffer.alloc(0),
          mimeType: 'audio/wav',
          requestId: response.request_id?.trim() || undefined,
        };
      }
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
      'QWEN_PREVIEW_EMPTY_AUDIO',
      'Qwen preview response is missing audio',
      502,
      response
    );
  }

  async deleteVoice(
    voiceId: string,
    model?: string
  ): Promise<QwenDeleteVoiceResult> {
    this.ensureEnabled();

    const voice = voiceId?.trim();
    if (!voice) {
      throw new AppError(
        'QWEN_VOICE_ID_MISSING',
        'Qwen voice id is missing',
        400
      );
    }

    const qwenAudio =
      this.isQwenAudioModel(model) || /^qwen-audio-/i.test(voice);
    const payload = qwenAudio
      ? {
          model: 'voice-enrollment',
          input: { action: 'delete_voice', voice_id: voice },
        }
      : {
          model: 'qwen-voice-enrollment',
          input: { action: 'delete', voice },
        };
    const response = await this.requestJson<QwenVoiceResp>({
      path: '/api/v1/services/audio/tts/customization',
      method: 'POST',
      body: Buffer.from(JSON.stringify(payload)),
    });

    this.logger?.info?.(
      '[qwen-voice] voice deleted, voiceRef=%s, requestId=%s',
      this.describeVoiceId(voice),
      response.request_id?.trim() || ''
    );

    return { requestId: response.request_id?.trim() || undefined };
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

  private normalizePreferredName(value: string, qwenAudio = false): string {
    const preferredName = value?.trim();

    const pattern = qwenAudio ? /^[A-Za-z0-9]{1,10}$/ : /^[A-Za-z0-9_]{1,16}$/;
    if (!pattern.test(preferredName)) {
      throw new AppError(
        'INVALID_QWEN_PREFERRED_NAME',
        qwenAudio
          ? 'Qwen Audio prefix must be 1-10 letters or digits'
          : 'Qwen preferred name must be 1-16 letters, digits or _',
        400
      );
    }

    return preferredName;
  }

  private normalizeRate(value?: number): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return 1;
    }

    return Math.round(Math.min(2, Math.max(0.5, parsed)) * 100) / 100;
  }

  private isQwenAudioModel(model?: string): boolean {
    return /^qwen-audio-/i.test(model?.trim() || '');
  }

  private describeVoiceId(value: string): string {
    const voiceId = value.trim();

    if (voiceId.length <= 10) {
      return voiceId;
    }

    return `${voiceId.slice(0, 4)}...${voiceId.slice(-4)}`;
  }

  private supportsEnrollmentHints(model?: string): boolean {
    return /^qwen-audio-.*-flash$/i.test(model?.trim() || '');
  }

  private normalizeCloneLanguage(value?: string): string {
    const raw = value?.trim() || this.getDefaultLanguage();
    const map: Record<string, string> = {
      auto: '',
      chinese: 'zh',
      english: 'en',
      german: 'de',
      italian: 'it',
      portuguese: 'pt',
      spanish: 'es',
      japanese: 'ja',
      korean: 'ko',
      french: 'fr',
      russian: 'ru',
      thai: 'th',
      indonesian: 'id',
      vietnamese: 'vi',
      malaysian: 'ms',
      filipino: 'fil',
      arabic: 'ar',
    };
    const normalized = map[raw.toLowerCase()] || raw.toLowerCase();
    const supported = [
      'zh',
      'en',
      'de',
      'it',
      'pt',
      'es',
      'ja',
      'ko',
      'fr',
      'ru',
      'th',
      'id',
      'vi',
      'ms',
      'fil',
      'ar',
    ];

    return supported.includes(normalized)
      ? normalized
      : this.getDefaultLanguage();
  }

  private normalizeSpeechLanguageType(value?: string): string {
    const raw = value?.trim();

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

  private async downloadAudio(
    audioUrl: string,
    requestId: string | undefined
  ): Promise<QwenPreviewSpeechResult> {
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
        'QWEN_PREVIEW_AUDIO_DOWNLOAD_FAILED',
        `Qwen preview audio download failed with status ${response.statusCode}`,
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
                  'QWEN_HTTP_ERROR',
                  raw || `Qwen http status ${res.statusCode}`,
                  502
                )
              );
              return;
            }

            try {
              const parsed = JSON.parse(raw) as QwenVoiceResp;
              const statusCode = parsed?.status_code;

              if (
                parsed?.code ||
                parsed?.message ||
                (typeof statusCode === 'number' && statusCode !== 200)
              ) {
                reject(
                  new AppError(
                    parsed.code || 'QWEN_REQUEST_FAILED',
                    parsed.message || 'Qwen request failed',
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
                  'QWEN_INVALID_RESPONSE',
                  'Qwen response is not valid JSON',
                  502
                )
              );
            }
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
        req.destroy(new Error('Qwen request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('QWEN_REQUEST_FAILED', error.message, 502)
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
}
