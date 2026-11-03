import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '../common/errors';

export interface VoiceSeparationConfig {
  enabled?: boolean;
  sidecarUrl?: string;
  timeoutMs?: number;
}

interface SeparateResponse {
  ok: boolean;
  audio?: string;
  durationSeconds?: number;
  costMs?: number;
  truncated?: boolean;
  error?: string;
  detail?: string;
}

/**
 * 人声分离：把背景音乐/伴奏从素材里去掉，只保留人声。
 *
 * 服务由独立 sidecar 提供（UVR-MDX-NET onnx，CPU）。分离失败属于质量增强失败，
 * 调用方必须回退到「只降噪」的音频，不能阻断训练。
 */
@Provide()
export class VoiceSeparationService {
  @Logger()
  logger: ILogger;

  @Config('voiceSeparation')
  config: VoiceSeparationConfig;

  isEnabled(): boolean {
    if (this.config?.enabled === false) {
      return false;
    }
    const raw = String(process.env.NODE_VOICE_SEPARATION_ENABLED ?? '')
      .trim()
      .toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(raw);
  }

  private get sidecarUrl(): string {
    return (
      this.config?.sidecarUrl?.trim() ||
      process.env.NODE_VOICE_SEPARATION_URL?.trim() ||
      'http://tzl_voice_sep:8900'
    ).replace(/\/+$/, '');
  }

  /** 分离人声：返回 24k 单声道 wav。 */
  async separateToVocals(input: {
    buffer: Buffer;
    fileName: string;
  }): Promise<{
    buffer: Buffer;
    fileName: string;
    durationSeconds?: number;
    costMs?: number;
    truncated?: boolean;
  }> {
    if (!input.buffer?.length) {
      throw new AppError('VOICE_SEPARATION_EMPTY_INPUT', 'audio is empty', 422);
    }

    const controller = new AbortController();
    const timeoutMs = Number(this.config?.timeoutMs) || 240000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.sidecarUrl}/separate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: input.buffer.toString('base64') }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const payload = (await response.json().catch(() => null)) as
      | SeparateResponse
      | null;
    if (!response.ok || !payload?.ok || !payload.audio) {
      throw new AppError(
        'VOICE_SEPARATION_FAILED',
        payload?.error || `voice separator responded ${response.status}`,
        502
      );
    }

    const baseName = input.fileName.replace(/\.[^./\\]+$/, '');
    return {
      buffer: Buffer.from(payload.audio, 'base64'),
      fileName: `${baseName}-vocals.wav`,
      durationSeconds: payload.durationSeconds,
      costMs: payload.costMs,
      truncated: payload.truncated,
    };
  }
}
