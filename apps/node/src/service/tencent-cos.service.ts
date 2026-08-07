import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { Config, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import COS = require('cos-nodejs-sdk-v5');
import { AppError } from '../common/errors';

const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
const MULTIPART_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;

export interface TencentCosConfig {
  enabled?: boolean;
  region?: string;
  bucket?: string;
  secretId?: string;
  secretKey?: string;
  securityToken?: string;
  protocol?: string;
  domain?: string;
  publicBaseUrl?: string;
  uploadPrefix?: string;
  signedUrlExpireSeconds?: number;
}

export interface TencentCosSignedUploadRequest {
  fileName?: string;
  folder?: string;
  objectKey?: string;
  contentType?: string;
  expiresInSeconds?: number;
}

export interface TencentCosSignedUploadResult {
  provider: 'tencent-cos';
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

export interface TencentCosPutObjectRequest {
  objectKey?: string;
  fileName?: string;
  folder?: string;
  contentType?: string;
}

export interface TencentCosPutObjectResult {
  objectKey: string;
  url: string;
}

export interface TencentCosGetObjectResult {
  objectKey: string;
  buffer: Buffer;
  contentType?: string;
}

@Provide()
export class TencentCosService {
  @Logger()
  logger: ILogger;

  @Config('tencentCos')
  cosConfig: TencentCosConfig;

  private client: COS | null = null;

  isEnabled(): boolean {
    return this.cosConfig?.enabled === true;
  }

  createSignedUpload(
    request: TencentCosSignedUploadRequest = {}
  ): TencentCosSignedUploadResult {
    const client = this.getClient();
    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');
    const objectKey = this.resolveObjectKey(request);
    const expiresInSeconds = this.normalizeSignedUrlExpiry(
      request.expiresInSeconds
    );
    const contentType = this.normalizeContentType(request.contentType);
    const headers: Record<string, string> = {
      'Cache-Control': IMMUTABLE_ASSET_CACHE_CONTROL,
    };
    const domain = this.resolveSigningDomain();

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const uploadUrl = client.getObjectUrl({
      Bucket: bucket,
      Region: region,
      Key: objectKey,
      Sign: true,
      Method: 'PUT',
      Expires: expiresInSeconds,
      Protocol: this.resolveProtocol(),
      ...(domain ? { Domain: domain } : {}),
      Headers: headers,
    });

    this.logger.info(
      '[tencent-cos] signed upload created, objectKey=%s, expiresInSeconds=%s',
      objectKey,
      expiresInSeconds
    );

    return {
      provider: 'tencent-cos',
      bucket,
      region,
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
    request: TencentCosPutObjectRequest = {}
  ): Promise<TencentCosPutObjectResult> {
    if (!Buffer.isBuffer(input) || input.length === 0) {
      throw new AppError(
        'TENCENT_COS_INVALID_FILE',
        'upload buffer is required',
        400
      );
    }

    const client = this.getClient();
    const objectKey = this.resolveObjectKey(request);
    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');
    const contentType = this.normalizeContentType(request.contentType);

    await client.putObject({
      Bucket: bucket,
      Region: region,
      Key: objectKey,
      Body: input,
      CacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
      ...(contentType ? { ContentType: contentType } : {}),
    });

    const url = this.getPublicUrl(objectKey);

    this.logger.info('[tencent-cos] buffer uploaded, objectKey=%s', objectKey);

    return {
      objectKey,
      url,
    };
  }

  async putFile(
    filePath: string,
    request: TencentCosPutObjectRequest = {}
  ): Promise<TencentCosPutObjectResult> {
    const normalizedPath = filePath?.trim();

    if (!normalizedPath) {
      throw new AppError(
        'TENCENT_COS_INVALID_FILE',
        'upload file path is required',
        400
      );
    }

    const client = this.getClient();
    const objectKey = this.resolveObjectKey(request);
    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');
    const contentType = this.normalizeContentType(request.contentType);
    const fileSizeBytes = (await fs.stat(normalizedPath)).size;

    const startedAt = Date.now();

    try {
      await client.uploadFile({
        Bucket: bucket,
        Region: region,
        Key: objectKey,
        FilePath: normalizedPath,
        SliceSize: MULTIPART_UPLOAD_THRESHOLD_BYTES,
        ChunkSize: MULTIPART_UPLOAD_CHUNK_BYTES,
        CacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
        ...(contentType ? { ContentType: contentType } : {}),
      });
    } catch (error) {
      this.logger?.error?.(
        '[tencent-cos] file upload failed, objectKey=%s, elapsedMs=%s, error=%j',
        objectKey,
        Date.now() - startedAt,
        this.describeProviderError(error)
      );
      throw error;
    }

    const url = this.getPublicUrl(objectKey);

    this.logger.info(
      '[tencent-cos] file uploaded, objectKey=%s, bytes=%s, mode=%s, elapsedMs=%s',
      objectKey,
      fileSizeBytes,
      fileSizeBytes > MULTIPART_UPLOAD_THRESHOLD_BYTES ? 'multipart' : 'simple',
      Date.now() - startedAt
    );

    return {
      objectKey,
      url,
    };
  }

  async getBuffer(objectKey: string): Promise<TencentCosGetObjectResult> {
    const normalizedObjectKey = this.normalizeObjectKey(objectKey);
    const client = this.getClient();
    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');
    const result = await client.getObject({
      Bucket: bucket,
      Region: region,
      Key: normalizedObjectKey,
    });

    if (!Buffer.isBuffer(result.Body) || result.Body.length === 0) {
      throw new AppError(
        'TENCENT_COS_EMPTY_OBJECT',
        'Tencent COS object is empty',
        422
      );
    }

    this.logger.info(
      '[tencent-cos] object downloaded, objectKey=%s, bytes=%s',
      normalizedObjectKey,
      result.Body.length
    );

    return {
      objectKey: normalizedObjectKey,
      buffer: result.Body,
      contentType: result.headers?.['content-type'],
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    const normalizedObjectKey = this.normalizeObjectKey(objectKey);
    const client = this.getClient();
    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');

    await client.deleteObject({
      Bucket: bucket,
      Region: region,
      Key: normalizedObjectKey,
    });
    this.logger.info(
      '[tencent-cos] object deleted, objectKey=%s',
      normalizedObjectKey
    );
  }

  resolveObjectKeyFromPublicUrl(
    value: string | undefined,
    allowedPrefixes: string[] = []
  ): string | undefined {
    const source = value?.trim();
    if (!source) {
      return undefined;
    }

    try {
      const url = new URL(source);
      const configuredBaseUrl = this.normalizeBaseUrl(
        this.cosConfig?.publicBaseUrl
      );
      let path = decodeURIComponent(url.pathname).replace(/^\/+/, '');

      if (configuredBaseUrl) {
        const base = new URL(configuredBaseUrl);
        if (url.origin !== base.origin) {
          return undefined;
        }
        const basePath = decodeURIComponent(base.pathname)
          .replace(/^\/+|\/+$/g, '')
          .trim();
        if (basePath && path !== basePath && !path.startsWith(`${basePath}/`)) {
          return undefined;
        }
        if (basePath) {
          path = path.slice(basePath.length).replace(/^\/+/, '');
        }
      } else if (!this.isConfiguredCosHost(url.hostname)) {
        return undefined;
      }

      const objectKey = this.normalizeObjectKey(path);
      const normalizedPrefixes = allowedPrefixes
        .map(item => item.trim().replace(/^\/+|\/+$/g, ''))
        .filter(Boolean);
      if (
        normalizedPrefixes.length > 0 &&
        !normalizedPrefixes.some(prefix => objectKey.startsWith(`${prefix}/`))
      ) {
        return undefined;
      }

      return objectKey;
    } catch {
      return undefined;
    }
  }

  getPublicUrl(objectKey: string): string {
    const normalizedObjectKey = this.normalizeObjectKey(objectKey);
    const customBaseUrl = this.normalizeBaseUrl(this.cosConfig?.publicBaseUrl);

    if (customBaseUrl) {
      return `${customBaseUrl}/${this.encodeObjectKey(normalizedObjectKey)}`;
    }

    const client = this.getClient();
    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');
    const domain = this.resolveSigningDomain();

    return client.getObjectUrl({
      Bucket: bucket,
      Region: region,
      Key: normalizedObjectKey,
      Sign: false,
      Method: 'GET',
      Protocol: this.resolveProtocol(),
      ...(domain ? { Domain: domain } : {}),
    });
  }

  private isConfiguredCosHost(hostname: string): boolean {
    const normalizedHostname = hostname.trim().toLowerCase();
    const configuredDomain = this.cosConfig?.domain
      ?.trim()
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
    if (configuredDomain && normalizedHostname === configuredDomain) {
      return true;
    }

    const bucket = this.cosConfig?.bucket?.trim().toLowerCase();
    const region = this.cosConfig?.region?.trim().toLowerCase();
    return Boolean(
      bucket &&
        region &&
        normalizedHostname === `${bucket}.cos.${region}.myqcloud.com`
    );
  }

  private getClient(): COS {
    if (this.client) {
      return this.client;
    }

    if (!this.isEnabled()) {
      throw new AppError(
        'TENCENT_COS_DISABLED',
        'Tencent COS integration is disabled',
        503
      );
    }

    this.client = new COS({
      SecretId: this.getRequiredConfig(
        'secretId',
        'NODE_TENCENT_COS_SECRET_ID'
      ),
      SecretKey: this.getRequiredConfig(
        'secretKey',
        'NODE_TENCENT_COS_SECRET_KEY'
      ),
      ...(this.cosConfig?.securityToken?.trim()
        ? { SecurityToken: this.cosConfig.securityToken.trim() }
        : {}),
      Protocol: this.resolveProtocol(),
    });

    return this.client;
  }

  private describeProviderError(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object') {
      return { message: String(error ?? 'unknown') };
    }

    const source = error as Record<string, unknown>;
    return {
      name: source.name,
      code: source.code,
      statusCode: source.statusCode,
      message: source.message,
      requestId: source.requestId,
    };
  }

  private resolveObjectKey(
    request: Pick<
      TencentCosSignedUploadRequest,
      'objectKey' | 'fileName' | 'folder'
    >
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
      folder || this.cosConfig?.uploadPrefix || 'static'
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
            'TENCENT_COS_INVALID_OBJECT_KEY',
            'Tencent COS object key contains invalid path segments',
            400
          );
        }

        return segment.replace(/[^0-9A-Za-z!_.*'()-]/g, '-');
      })
      .join('/');

    if (!normalized) {
      throw new AppError(
        'TENCENT_COS_INVALID_OBJECT_KEY',
        'Tencent COS object key is required',
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

  private normalizeContentType(value?: string): string {
    return value?.trim().slice(0, 100) || '';
  }

  private normalizeSignedUrlExpiry(value?: number): number {
    const source =
      typeof value === 'number'
        ? value
        : this.cosConfig?.signedUrlExpireSeconds;

    if (typeof source !== 'number' || !Number.isFinite(source) || source <= 0) {
      return 900;
    }

    return Math.min(3600, Math.max(60, Math.floor(source)));
  }

  private resolveProtocol(): 'http:' | 'https:' {
    const raw = this.cosConfig?.protocol?.trim().toLowerCase();

    return raw === 'http' || raw === 'http:' ? 'http:' : 'https:';
  }

  private resolveSigningDomain(): string {
    return this.cosConfig?.domain?.trim() || '';
  }

  private resolveEndpoint(): string {
    const customBaseUrl = this.normalizeBaseUrl(this.cosConfig?.publicBaseUrl);

    if (customBaseUrl) {
      return customBaseUrl;
    }

    const domain = this.resolveSigningDomain();

    if (domain) {
      return `${this.resolveProtocol()}//${domain.replace(
        /^https?:\/\//i,
        ''
      )}`;
    }

    const bucket = this.getRequiredConfig('bucket', 'NODE_TENCENT_COS_BUCKET');
    const region = this.getRequiredConfig('region', 'NODE_TENCENT_COS_REGION');

    return `${this.resolveProtocol()}//${bucket}.cos.${region}.myqcloud.com`;
  }

  private normalizeBaseUrl(value?: string): string {
    const trimmed = value?.trim();

    if (!trimmed) {
      return '';
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/+$/, '');
    }

    return `${this.resolveProtocol()}//${trimmed.replace(/\/+$/, '')}`;
  }

  private encodeObjectKey(value: string): string {
    return value
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');
  }

  private getRequiredConfig(
    key: keyof TencentCosConfig,
    envName: string
  ): string {
    const value = this.cosConfig?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new AppError(
      'TENCENT_COS_NOT_CONFIGURED',
      `${envName} is not configured`,
      500
    );
  }
}
