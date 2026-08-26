import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import {
  buildDoubaoIcl2SpeechInstruction,
  getDoubaoIcl2SpeechInstructionSource,
  resolveVoiceTimbreDialect,
} from '@tzl/shared';
import { randomUUID } from 'crypto';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { AppError } from '../common/errors';

interface DoubaoVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  appId?: string;
  accessToken?: string;
  baseURL?: string;
  resourceId?: string;
  defaultSpeechModel?: string;
  timeoutMs?: number;
}

interface DoubaoSpeechEvent {
  code?: number;
  message?: string;
  data?: string;
  request_id?: string;
}

export interface DoubaoVoiceSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  instruction?: string;
  dialect?: string;
  speed?: number;
  volume?: number;
}

export interface DoubaoVoiceSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
  nativeSpeechSpeedApplied: true;
  nativeSpeechVolumeApplied: true;
}

@Provide()
export class DoubaoVoiceSpeechService {
  @Logger()
  logger: ILogger;

  @Config('doubaoVoice')
  config: DoubaoVoiceConfig;

  async synthesize(
    input: DoubaoVoiceSpeechInput
  ): Promise<DoubaoVoiceSpeechResult> {
    this.ensureConfigured();
    const text = input.text?.trim();
    const voiceId = this.normalizeSpeakerId(input.voiceId);

    if (!text) {
      throw new AppError(
        'DOUBAO_INVALID_TEXT_TO_SPEECH_INPUT',
        'text to speech input is required',
        400
      );
    }

    const instruction = buildDoubaoIcl2SpeechInstruction(input);
    const instructionSource = getDoubaoIcl2SpeechInstructionSource(input);
    const dialect = resolveVoiceTimbreDialect(input.dialect, input.instruction);
    const model =
      input.model?.trim() ||
      this.config?.defaultSpeechModel?.trim() ||
      'seed-tts-2.0-expressive';
    const requestId = randomUUID();
    const body = Buffer.from(
      JSON.stringify({
        user: { uid: 'tianzhiling-node' },
        req_params: {
          text,
          speaker: voiceId,
          model,
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: this.toProviderRate(input.speed),
            loudness_rate: this.toProviderRate(input.volume),
          },
          additions: JSON.stringify({
            model_type: 4,
            disable_markdown_filter: true,
            ...(instruction ? { context_texts: [instruction] } : {}),
          }),
        },
      })
    );

    this.logger.info(
      '[doubao-voice-speech] synthesize, model=%s, voiceRef=%s, dialect=%s, instructionSource=%s, instructionLength=%s, textLength=%s',
      model,
      this.describeVoiceId(voiceId),
      dialect,
      instructionSource,
      instruction?.length || 0,
      text.length
    );

    const response = await this.requestBinary({
      headers: {
        ...this.authHeaders(),
        'X-Api-Resource-Id': this.resourceId,
        'X-Api-Request-Id': requestId,
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'DOUBAO_TEXT_TO_SPEECH_HTTP_ERROR',
        response.body.toString('utf8') ||
          `Doubao http status ${response.statusCode}`,
        502,
        { httpStatus: response.statusCode, requestId }
      );
    }

    return {
      audioUrl: '',
      audioBuffer: this.parseSpeechAudio(response.body, requestId),
      mimeType: 'audio/mpeg',
      requestId,
      nativeSpeechSpeedApplied: true,
      nativeSpeechVolumeApplied: true,
    };
  }

  private requestBinary(input: {
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<{ statusCode: number; body: Buffer }> {
    const url = new URL('/api/v3/tts/unidirectional', `${this.baseURL}/`);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;

    return new Promise((resolve, reject) => {
      const req = requester(
        url,
        {
          method: 'POST',
          timeout: this.timeoutMs,
          headers: input.headers,
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () =>
            resolve({
              statusCode: res.statusCode || 0,
              body: Buffer.concat(chunks),
            })
          );
        }
      );
      req.on('timeout', () =>
        req.destroy(new Error('Doubao voice request timeout'))
      );
      req.on('error', error =>
        reject(new AppError('DOUBAO_VOICE_REQUEST_FAILED', error.message, 502))
      );
      req.end(input.body);
    });
  }

  private parseSpeechAudio(body: Buffer, requestId: string): Buffer {
    const chunks: Buffer[] = [];
    const lines = body
      .toString('utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      let event: DoubaoSpeechEvent;
      try {
        event = JSON.parse(line) as DoubaoSpeechEvent;
      } catch {
        continue;
      }
      if (event.code === 20000000) {
        break;
      }
      if (event.code !== undefined && event.code !== 0 && event.code !== 3000) {
        throw new AppError(
          'DOUBAO_TEXT_TO_SPEECH_FAILED',
          event.message || `Doubao speech code ${event.code}`,
          502,
          { ...event, requestId }
        );
      }
      if (event.data) {
        chunks.push(Buffer.from(event.data, 'base64'));
      }
    }

    const audio = Buffer.concat(chunks);
    if (!audio.length) {
      throw new AppError(
        'DOUBAO_TEXT_TO_SPEECH_EMPTY_AUDIO',
        'Doubao text to speech response is missing audio',
        502,
        { requestId }
      );
    }
    return audio;
  }

  private authHeaders(): Record<string, string> {
    const apiKey = this.config?.apiKey?.trim();
    if (apiKey) {
      return { 'X-Api-Key': apiKey };
    }
    return {
      'X-Api-App-Id': this.config.appId?.trim() || '',
      'X-Api-Access-Key': this.config.accessToken?.trim() || '',
    };
  }

  private ensureConfigured(): void {
    if (this.config?.enabled === false) {
      throw new AppError(
        'DOUBAO_VOICE_DISABLED',
        'Doubao voice is disabled',
        400
      );
    }
    if (!this.config?.apiKey?.trim()) {
      if (!this.config?.appId?.trim()) {
        throw new AppError(
          'DOUBAO_VOICE_APP_ID_MISSING',
          'Doubao voice app id is missing',
          500
        );
      }
      if (!this.config?.accessToken?.trim()) {
        throw new AppError(
          'DOUBAO_VOICE_CREDENTIAL_MISSING',
          'Doubao voice credential is missing',
          500
        );
      }
    }
  }

  private normalizeSpeakerId(value: string): string {
    const speakerId = value?.trim();
    if (!/^S_[A-Za-z0-9_-]{4,128}$/.test(speakerId)) {
      throw new AppError(
        'INVALID_DOUBAO_SPEAKER_ID',
        'Doubao speaker id must start with S_',
        400
      );
    }
    return speakerId;
  }

  private toProviderRate(value: unknown): number {
    const parsed = Number(value);
    const multiplier = Number.isFinite(parsed) ? parsed : 1;
    return Math.round(Math.min(100, Math.max(-50, (multiplier - 1) * 100)));
  }

  private describeVoiceId(value: string): string {
    return value.length <= 10
      ? value
      : `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private get baseURL(): string {
    return (
      this.config?.baseURL?.trim() || 'https://openspeech.bytedance.com'
    ).replace(/\/+$/, '');
  }

  private get resourceId(): string {
    return this.config?.resourceId?.trim() || 'seed-icl-2.0';
  }

  private get timeoutMs(): number {
    return Number(this.config?.timeoutMs) > 0
      ? Number(this.config.timeoutMs)
      : 120000;
  }
}
