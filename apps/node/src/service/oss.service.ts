import { createHash, randomBytes } from 'crypto';
import { Config, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import OSS = require('ali-oss');
import { AppError } from '../common/errors';

export interface OssConfig {
  enabled?: boolean;
  region?: string;
  bucket?: string;
  endpoint?: string;
  publicBaseUrl?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  stsToken?: string;
  secure?: boolean;
  timeoutMs?: number;
  uploadPrefix?: string;
  signedUrlExpireSeconds?: number;
}

export interface OssSignedUploadRequest {
  fileName?: string;
  folder?: string;
  objectKey?: string;
  contentType?: string;
  expiresInSeconds?: number;
}

export interface OssSignedUploadResult {
  provider: 'aliyun-oss';
  bucket: string;
  region: string;
  endpoint: string;
  objectKey: string;
  uploadUrl: string;
  publicUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface OssPutObjectRequest {
  objectKey?: string;
  fileName?: string;
  folder?: string;
  contentType?: string;
}

export interface OssPutObjectResult {
  objectKey: string;
  url: string;
}

@Provide()
export class OssService {
  @Logger()
  logger: ILogger;

  @Config('oss')
  ossConfig: OssConfig;

  private client: OSS | null = null;

  isEnabled(): boolean {
    return this.ossConfig?.enabled === true;
  }

  createSignedUpload(
    request: OssSignedUploadRequest = {}
  ): OssSignedUploadResult {
    const client = this.getClient();
    const objectKey = this.resolveObjectKey(request);
    const expiresInSeconds = this.normalizeSignedUrlExpiry(
      request.expiresInSeconds
    );
    const contentType = this.normalizeContentType(request.contentType);
    const headers: Record<string, string> = {};

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const uploadUrl = client.signatureUrl(objectKey, {
      method: 'PUT',
      expires: expiresInSeconds,
      ...(contentType ? { 'Content-Type': contentType } : {}),
    });

    this.logger.info(
      '[oss] signed upload created, objectKey=%s, expiresInSeconds=%s',
      objectKey,
      expiresInSeconds
    );

    return {
      provider: 'aliyun-oss',
      bucket: this.getRequiredConfig('bucket', 'NODE_OSS_BUCKET'),
      region: this.getRequiredConfig('region', 'NODE_OSS_REGION'),
      endpoint: this.resolveEndpoint(),
      objectKey,
      uploadUrl,
      publicUrl: this.getPublicUrl(objectKey),
      method: 'PUT',
      headers,
      expiresInSeconds,
    };
  }

  async putBuffer(
    input: Buffer,
    request: OssPutObjectRequest = {}
  ): Promise<OssPutObjectResult> {
    if (!Buffer.isBuffer(input) || input.length === 0) {
      throw new AppError('OSS_INVALID_FILE', 'upload buffer is required', 400);
    }

    const client = this.getClient();
    const objectKey = this.resolveObjectKey(request);
    const headers = this.buildUploadHeaders(request.contentType);

    await client.put(objectKey, input, {
      headers,
    });

    const url = this.getPublicUrl(objectKey);

    this.logger.info('[oss] buffer uploaded, objectKey=%s', objectKey);

    return {
      objectKey,
      url,
    };
  }

  async putFile(
    filePath: string,
    request: OssPutObjectRequest = {}
  ): Promise<OssPutObjectResult> {
    const normalizedPath = filePath?.trim();

    if (!normalizedPath) {
      throw new AppError(
        'OSS_INVALID_FILE',
        'upload file path is required',
        400
      );
    }

    const client = this.getClient();
    const objectKey = this.resolveObjectKey(request);
    const headers = this.buildUploadHeaders(request.contentType);

    await client.put(objectKey, normalizedPath, {
      headers,
    });

    const url = this.getPublicUrl(objectKey);

    this.logger.info('[oss] file uploaded, objectKey=%s', objectKey);

    return {
      objectKey,
      url,
    };
  }

  getPublicUrl(objectKey: string): string {
    const normalizedObjectKey = this.normalizeObjectKey(objectKey);
    const baseUrl = this.normalizeBaseUrl(this.ossConfig?.publicBaseUrl);
    const client = this.getClient();

    return baseUrl
      ? client.generateObjectUrl(normalizedObjectKey, baseUrl)
      : client.generateObjectUrl(normalizedObjectKey);
  }

  private getClient(): OSS {
    if (this.client) {
      return this.client;
    }

    if (!this.isEnabled()) {
      throw new AppError('OSS_DISABLED', 'OSS integration is disabled', 503);
    }

    const region = this.getRequiredConfig('region', 'NODE_OSS_REGION');
    const bucket = this.getRequiredConfig('bucket', 'NODE_OSS_BUCKET');
    const accessKeyId = this.getRequiredConfig(
      'accessKeyId',
      'NODE_OSS_ACCESS_KEY_ID'
    );
    const accessKeySecret = this.getRequiredConfig(
      'accessKeySecret',
      'NODE_OSS_ACCESS_KEY_SECRET'
    );
    const endpoint = this.normalizeBaseUrl(this.ossConfig?.endpoint);
    const stsToken = this.ossConfig?.stsToken?.trim();
    const secure = this.ossConfig?.secure !== false;
    const timeoutMs = this.normalizeTimeout(this.ossConfig?.timeoutMs);

    this.client = new OSS({
      region,
      bucket,
      accessKeyId,
      accessKeySecret,
      ...(endpoint ? { endpoint } : {}),
      ...(stsToken ? { stsToken } : {}),
      ...(typeof timeoutMs === 'number' ? { timeout: timeoutMs } : {}),
      secure,
    });

    return this.client;
  }

  private resolveObjectKey(
    request: Pick<OssSignedUploadRequest, 'objectKey' | 'fileName' | 'folder'>
  ): string {
    const providedObjectKey = request.objectKey?.trim();

    if (providedObjectKey) {
      return this.normalizeObjectKey(providedObjectKey);
    }

    return this.buildObjectKey(request.fileName, request.folder);
  }

  private buildObjectKey(fileName?: string, folder?: string): string {
    const now = new Date();
    const datePath = [
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('/');
    const prefix = this.normalizeFolder(
      folder || this.ossConfig?.uploadPrefix || 'static'
    );
    const generatedFileName = this.createSafeFileName(fileName);

    return [prefix, datePath, generatedFileName].filter(Boolean).join('/');
  }

  private normalizeObjectKey(value: string): string {
    const normalized = value
      .replace(/\\/g, '/')
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)
      .map(segment => {
        if (segment === '.' || segment === '..') {
          throw new AppError(
            'OSS_INVALID_OBJECT_KEY',
            'OSS object key contains invalid path segments',
            400
          );
        }

        return segment.replace(/[^0-9A-Za-z!_.*'()-]/g, '-');
      })
      .join('/');

    if (!normalized) {
      throw new AppError(
        'OSS_INVALID_OBJECT_KEY',
        'OSS object key is required',
        400
      );
    }

    return normalized;
  }

  private normalizeFolder(value?: string): string {
    const raw = value?.trim();

    if (!raw) {
      return '';
    }

    return this.normalizeObjectKey(raw);
  }

  private createSafeFileName(fileName?: string): string {
    const trimmed = fileName?.trim() || '';
    const rawFileName = trimmed.split(/[\\/]/).pop() || '';
    const match = rawFileName.match(/(\.[A-Za-z0-9]{1,16})$/);
    const ext = match ? match[1].toLowerCase() : '';
    const baseName = (ext ? rawFileName.slice(0, -ext.length) : rawFileName)
      .trim()
      .replace(/[^0-9A-Za-z_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const hash = createHash('md5')
      .update(`${rawFileName}:${Date.now()}:${randomBytes(8).toString('hex')}`)
      .digest('hex')
      .slice(0, 16);

    return `${baseName || 'asset'}-${hash}${ext}`;
  }

  private buildUploadHeaders(
    contentType?: string
  ): Record<string, string> | undefined {
    const normalizedContentType = this.normalizeContentType(contentType);

    if (!normalizedContentType) {
      return undefined;
    }

    return {
      'Content-Type': normalizedContentType,
    };
  }

  private normalizeContentType(value?: string): string {
    return value?.trim().slice(0, 100) || '';
  }

  private normalizeSignedUrlExpiry(value?: number): number {
    const source =
      typeof value === 'number'
        ? value
        : this.ossConfig?.signedUrlExpireSeconds;

    if (typeof source !== 'number' || !Number.isFinite(source) || source <= 0) {
      return 900;
    }

    return Math.min(3600, Math.max(60, Math.floor(source)));
  }

  private normalizeTimeout(value?: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private resolveEndpoint(): string {
    const endpoint = this.normalizeBaseUrl(this.ossConfig?.endpoint);

    if (endpoint) {
      return endpoint;
    }

    const region = this.getRequiredConfig('region', 'NODE_OSS_REGION');
    const protocol = this.ossConfig?.secure === false ? 'http' : 'https';

    return `${protocol}://oss-${region.replace(/^oss-/, '')}.aliyuncs.com`;
  }

  private normalizeBaseUrl(value?: string): string {
    const trimmed = value?.trim();

    if (!trimmed) {
      return '';
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/+$/, '');
    }

    const protocol = this.ossConfig?.secure === false ? 'http' : 'https';
    return `${protocol}://${trimmed.replace(/\/+$/, '')}`;
  }

  private getRequiredConfig(key: keyof OssConfig, envName: string): string {
    const value = this.ossConfig?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new AppError(
      'OSS_NOT_CONFIGURED',
      `${envName} is not configured`,
      500
    );
  }
}
