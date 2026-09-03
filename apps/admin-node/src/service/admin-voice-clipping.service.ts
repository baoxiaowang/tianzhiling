import { Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';

export interface AdminVoiceClippingInput {
  userId: string;
  materials: {
    id?: string;
    name?: string;
    objectKey: string;
    publicUrl?: string;
    durationSeconds?: number;
  }[];
  mode?: string;
}

@Provide()
export class AdminVoiceClippingService {
  @Logger()
  logger: ILogger;

  /** 调 node 内部剪辑接口，触发底层声音剪辑工作流 */
  async createClips(input: AdminVoiceClippingInput) {
    return this.callNode('/api/system/voice-clipping', input);
  }

  async recutClip(input: Record<string, unknown>) {
    return this.callNode('/api/system/voice-clipping/recut', input);
  }

  private async callNode(path: string, input: unknown) {
    const baseUrl =
      process.env.TZL_NODE_API_URL?.trim() || 'http://tzl_node:7001';
    const secret = process.env.INTERNAL_API_SECRET?.trim();
    if (!secret) {
      throw new AppError(
        'INTERNAL_API_SECRET_MISSING',
        'internal api secret not configured',
        500
      );
    }

    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120 * 1000);
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      this.logger.error('[admin-voice-clipping] node call failed', error);
      throw new AppError(
        'VOICE_CLIPPING_UNAVAILABLE',
        '剪辑服务暂不可用，请稍后重试',
        502
      );
    } finally {
      clearTimeout(timer);
    }

    let data: Record<string, unknown>;
    try {
      data = await response.json();
    } catch {
      throw new AppError(
        'VOICE_CLIPPING_BAD_RESPONSE',
        '剪辑服务返回异常',
        502
      );
    }

    // node 端全局响应信封：{ success, code, message, data, timestamp }，
    // 业务结果在 data 字段内，先解包再判断
    const envelope = data as {
      success?: boolean;
      code?: unknown;
      message?: unknown;
      data?: unknown;
    };
    const inner =
      envelope &&
      typeof envelope.data === 'object' &&
      envelope.data !== null &&
      'ok' in envelope.data
        ? (envelope.data as Record<string, unknown>)
        : data;

    if (!response.ok || inner?.ok !== true) {
      const downstreamCode =
        typeof envelope.code === 'string' && envelope.code.trim()
          ? envelope.code.trim()
          : 'VOICE_CLIPPING_FAILED';
      const message =
        typeof inner?.error === 'string'
          ? inner.error
          : typeof inner?.message === 'string' && inner.message.trim()
          ? inner.message.trim()
          : typeof envelope.message === 'string' && envelope.message.trim()
          ? envelope.message.trim()
          : `剪辑服务返回异常 status=${response.status}`;
      const status =
        response.status >= 400 && response.status < 500 ? response.status : 502;
      this.logger.warn(
        '[admin-voice-clipping] node rejected request, path=%s, status=%s, code=%s, message=%s',
        path,
        response.status,
        downstreamCode,
        message
      );
      throw new AppError(downstreamCode, message, status);
    }

    return inner;
  }
}
