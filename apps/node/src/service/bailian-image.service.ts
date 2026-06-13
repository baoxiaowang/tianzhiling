import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { AppError } from '../common/errors';
import {
  buildMemorialPhotoPrompt,
  normalizeMemorialPhotoCustomPrompt,
} from '../prompt/memorial-photo';

interface BailianImageConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  size?: string;
  timeoutMs?: number;
}

interface BailianImageResp {
  status_code?: number;
  requestId?: string;
  request_id?: string;
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string;
          type?: string;
        }>;
      };
    }>;
  };
  code?: string;
  message?: string;
}

export interface BailianMemorialPhotoInput {
  agentPhotoUrls: string[];
  userPhotoUrl: string;
  agentName?: string;
  customPrompt?: string;
}

export interface BailianMemorialPhotoResult {
  imageUrl: string;
  imageBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

@Provide()
export class BailianImageService {
  @Logger()
  logger: ILogger;

  @Config('bailianImage')
  config: BailianImageConfig;

  async generateMemorialPhoto(
    input: BailianMemorialPhotoInput
  ): Promise<BailianMemorialPhotoResult> {
    const agentPhotoUrls = input.agentPhotoUrls
      .map(url => url.trim())
      .filter(Boolean);
    const userPhotoUrl = input.userPhotoUrl?.trim();
    const customPrompt = normalizeMemorialPhotoCustomPrompt(input.customPrompt);

    if (agentPhotoUrls.length === 0 || agentPhotoUrls.length > 3) {
      throw new AppError(
        'INVALID_MEMORIAL_AGENT_PHOTOS',
        'TA 的照片需为 1-3 张',
        400
      );
    }

    if (!userPhotoUrl) {
      throw new AppError('INVALID_MEMORIAL_USER_PHOTO', '请上传你的照片', 400);
    }

    this.ensureEnabled();

    const model = this.config?.model?.trim() || 'wan2.7-image-pro';
    const body = Buffer.from(
      JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: 'user',
              content: [
                ...agentPhotoUrls.map(image => ({ image })),
                { image: userPhotoUrl },
                {
                  text: buildMemorialPhotoPrompt({
                    agentPhotoCount: agentPhotoUrls.length,
                    agentName: input.agentName,
                    customPrompt,
                  }),
                },
              ],
            },
          ],
        },
        parameters: {
          size: this.config?.size?.trim() || '2K',
          n: 1,
          watermark: false,
        },
      })
    );

    this.logger.info(
      '[bailian-image] generate memorial photo, model=%s, agentPhotoCount=%s',
      model,
      agentPhotoUrls.length
    );

    const response = await this.requestJson<BailianImageResp>({
      path: '/api/v1/services/aigc/multimodal-generation/generation',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
    });
    const imageUrl = this.extractGeneratedImageUrl(response);
    const downloaded = await this.downloadImage(imageUrl);

    return {
      imageUrl,
      imageBuffer: downloaded.body,
      mimeType: this.resolveImageMimeType(
        downloaded.headers['content-type'],
        imageUrl
      ),
      requestId:
        response.requestId?.trim() || response.request_id?.trim() || undefined,
    };
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError('BAILIAN_IMAGE_DISABLED', '纪念合照服务暂不可用', 400);
    }

    if (!this.config?.apiKey?.trim()) {
      throw new AppError(
        'BAILIAN_IMAGE_API_KEY_MISSING',
        '百炼图片服务配置缺失',
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
        'BAILIAN_IMAGE_HTTP_ERROR',
        raw || `Bailian image http status ${response.statusCode}`,
        502
      );
    }

    try {
      const parsed = JSON.parse(raw) as BailianImageResp;
      const statusCode = parsed?.status_code;

      if (
        parsed?.code ||
        (typeof statusCode === 'number' && statusCode !== 200)
      ) {
        throw new AppError(
          parsed.code || 'BAILIAN_IMAGE_GENERATION_FAILED',
          parsed.message || '纪念合照生成失败，请稍后重试',
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
        'BAILIAN_IMAGE_INVALID_RESPONSE',
        '百炼图片服务返回异常',
        502
      );
    }
  }

  private extractGeneratedImageUrl(response: BailianImageResp): string {
    for (const choice of response.output?.choices ?? []) {
      for (const item of choice.message?.content ?? []) {
        const imageUrl = item.image?.trim();

        if (imageUrl) {
          return imageUrl;
        }
      }
    }

    throw new AppError(
      'BAILIAN_IMAGE_EMPTY_RESULT',
      '纪念合照生成结果为空',
      502,
      response
    );
  }

  private async downloadImage(imageUrl: string): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> {
    const response = await this.requestBinaryWithRetry({
      url: imageUrl,
      method: 'GET',
      headers: {
        Accept: 'image/*',
        'User-Agent': 'tianzhiling-node/1.0',
      },
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'BAILIAN_IMAGE_DOWNLOAD_FAILED',
        `Bailian image download failed with status ${response.statusCode}`,
        502
      );
    }

    if (!response.body.length) {
      throw new AppError(
        'BAILIAN_IMAGE_DOWNLOAD_EMPTY',
        '纪念合照下载结果为空',
        502
      );
    }

    return response;
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
          timeout: this.config?.timeoutMs || 180000,
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
        req.destroy(new Error('Bailian image request timeout'));
      });
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('BAILIAN_IMAGE_REQUEST_FAILED', error.message, 502)
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

  private resolveImageMimeType(
    value: string | string[] | undefined,
    imageUrl: string
  ): string {
    const contentType = this.normalizeContentType(value);

    if (contentType.startsWith('image/')) {
      return contentType;
    }

    const pathname = (() => {
      try {
        return new URL(imageUrl).pathname.toLowerCase();
      } catch {
        return imageUrl.toLowerCase();
      }
    })();

    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (pathname.endsWith('.webp')) {
      return 'image/webp';
    }
    if (pathname.endsWith('.gif')) {
      return 'image/gif';
    }

    return 'image/png';
  }

  private normalizeContentType(value?: string | string[]): string {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(';')[0]?.trim().toLowerCase() || '';
  }
}
