import { Config, Logger, Provide } from '@midwayjs/core';
import { AppError } from '@tzl/shared';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import type { ILogger } from '@midwayjs/logger';

interface MinimaxVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  defaultPreviewModel?: string;
  timeoutMs?: number;
}

interface MinimaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

interface MinimaxUploadFileResp {
  file?: {
    file_id?: number | string;
    bytes?: number;
    created_at?: number;
    filename?: string;
    purpose?: string;
  };
  base_resp?: MinimaxBaseResp;
}

interface MinimaxVoiceCloneResp {
  demo_audio?: string;
  input_sensitive?: unknown;
  input_sensitive_type?: number;
  base_resp?: MinimaxBaseResp;
}

export interface MinimaxCloneVoiceInput {
  fileId: string;
  voiceId: string;
  text?: string;
  model?: string;
  languageBoost?: string;
}

export interface MinimaxCloneVoiceResult {
  providerVoiceId: string;
  demoAudio: string;
}

@Provide()
export class MinimaxVoiceService {
  @Logger()
  logger: ILogger;

  @Config('minimaxVoice')
  config: MinimaxVoiceConfig;

  getDefaultPreviewModel(): string {
    return this.config?.defaultPreviewModel?.trim() || 'speech-2.8-turbo';
  }

  async uploadCloneAudio(input: {
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }): Promise<string> {
    this.ensureEnabled();

    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new AppError(
        'MINIMAX_INVALID_AUDIO',
        'audio file is required',
        400
      );
    }

    const boundary = `----tzl-minimax-${Date.now().toString(16)}`;
    const body = this.buildMultipartBody(boundary, input);
    const response = await this.requestJson<MinimaxUploadFileResp>({
      path: '/v1/files/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });

    this.assertMinimaxSuccess(response?.base_resp, 'MINIMAX_UPLOAD_FAILED');

    const fileId = response?.file?.file_id;

    if (
      fileId === undefined ||
      fileId === null ||
      String(fileId).trim() === ''
    ) {
      throw new AppError(
        'MINIMAX_UPLOAD_FILE_ID_MISSING',
        'MiniMax file_id is missing',
        502
      );
    }

    return String(fileId);
  }

  async cloneVoice(
    input: MinimaxCloneVoiceInput
  ): Promise<MinimaxCloneVoiceResult> {
    this.ensureEnabled();

    const payload: Record<string, unknown> = {
      file_id: this.normalizeFileId(input.fileId),
      voice_id: input.voiceId,
      need_noise_reduction: false,
      need_volume_normalization: false,
    };
    const text = input.text?.trim();

    if (input.languageBoost?.trim()) {
      payload.language_boost = input.languageBoost.trim();
    }

    if (text) {
      payload.text = text;
      payload.model = input.model?.trim() || this.getDefaultPreviewModel();
    }

    const body = Buffer.from(JSON.stringify(payload));
    const response = await this.requestJson<MinimaxVoiceCloneResp>({
      path: '/v1/voice_clone',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
    });

    this.assertMinimaxSuccess(
      response?.base_resp,
      'MINIMAX_VOICE_CLONE_FAILED'
    );

    return {
      providerVoiceId: input.voiceId,
      demoAudio: response?.demo_audio?.trim() || '',
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

  private buildMultipartBody(
    boundary: string,
    input: { buffer: Buffer; fileName: string; contentType: string }
  ): Buffer {
    const safeFileName = input.fileName.replace(/[\r\n"]/g, '_') || 'voice.wav';
    const contentType = input.contentType?.trim() || 'application/octet-stream';
    const chunks = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone\r\n`
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\nContent-Type: ${contentType}\r\n\r\n`
      ),
      input.buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];

    return Buffer.concat(chunks);
  }

  private async requestJson<T>(input: {
    path: string;
    method: 'POST';
    headers: Record<string, string>;
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
            ...input.headers,
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
                  'MINIMAX_HTTP_ERROR',
                  raw || `MiniMax http status ${res.statusCode}`,
                  502
                )
              );
              return;
            }

            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              reject(
                new AppError(
                  'MINIMAX_INVALID_RESPONSE',
                  'MiniMax response is not valid JSON',
                  502
                )
              );
            }
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
      req.write(input.body);
      req.end();
    });
  }

  private assertMinimaxSuccess(
    resp: MinimaxBaseResp | undefined,
    code: string
  ): void {
    if (resp?.status_code === 0) {
      return;
    }

    throw new AppError(
      code,
      resp?.status_msg || 'MiniMax request failed',
      502,
      resp || null
    );
  }

  private normalizeBaseURL(): string {
    const raw = this.config?.baseURL?.trim() || 'https://api.minimax.io';
    return raw.replace(/\/+$/, '');
  }

  private normalizeFileId(fileId: string): number | string {
    const normalized = fileId.trim();
    const numberValue = Number(normalized);

    if (Number.isSafeInteger(numberValue)) {
      return numberValue;
    }

    return normalized;
  }
}
