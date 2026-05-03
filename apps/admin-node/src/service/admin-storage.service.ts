import { createHash, randomBytes } from 'crypto';
import { createReadStream } from 'fs';
import { Config, Provide } from '@midwayjs/core';
import COS = require('cos-nodejs-sdk-v5');
import { AppError } from '@tzl/shared';
import { CreateAdminCosSignedUploadDTO } from '../dto/admin-storage.dto';

interface TencentCosConfig {
  enabled?: boolean;
  region?: string;
  bucket?: string;
  secretId?: string;
  secretKey?: string;
  securityToken?: string;
  protocol?: string;
  domain?: string;
  publicBaseUrl?: string;
}

export interface SignedUploadResult {
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

export interface ServerUploadedFile {
  provider: 'tencent-cos';
  bucket: string;
  region: string;
  endpoint: string;
  objectKey: string;
  publicUrl: string;
  contentType: string;
  etag?: string;
}

export interface UploadCosFileInput {
  filePath: string;
  fileName: string;
  folder?: string;
  contentType?: string;
}

@Provide()
export class AdminStorageService {
  @Config('tencentCos')
  cosConfig: TencentCosConfig;

  createCosSignedUpload(
    payload: CreateAdminCosSignedUploadDTO
  ): SignedUploadResult {
    this.ensureCosEnabled();

    const bucket = this.getRequiredConfig('bucket');
    const region = this.getRequiredConfig('region');
    const objectKey = this.buildObjectKey(payload.fileName, payload.folder);
    const expiresInSeconds = this.normalizeExpires(payload.expiresInSeconds);
    const contentType =
      payload.contentType?.trim() || 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
    };
    const uploadUrl = this.createSignedPutUrl({
      bucket,
      region,
      objectKey,
      expiresInSeconds,
      contentType,
    });

    return {
      provider: 'tencent-cos',
      bucket,
      region,
      endpoint: this.resolveEndpoint(bucket, region),
      objectKey,
      uploadUrl,
      publicUrl: this.getPublicUrl(objectKey, bucket, region),
      method: 'PUT',
      headers,
      expiresInSeconds,
    };
  }

  async uploadCosFile(input: UploadCosFileInput): Promise<ServerUploadedFile> {
    this.ensureCosEnabled();

    const bucket = this.getRequiredConfig('bucket');
    const region = this.getRequiredConfig('region');
    const contentType = input.contentType?.trim() || 'application/octet-stream';
    const objectKey = this.buildObjectKey(input.fileName, input.folder);
    const cos = this.createCosClient();
    const result = await cos.putObject({
      Bucket: bucket,
      Region: region,
      Key: objectKey,
      Body: createReadStream(input.filePath),
      ContentType: contentType,
    });

    return {
      provider: 'tencent-cos',
      bucket,
      region,
      endpoint: this.resolveEndpoint(bucket, region),
      objectKey,
      publicUrl: this.getPublicUrl(objectKey, bucket, region),
      contentType,
      etag: result.ETag,
    };
  }

  private createCosClient(): COS {
    const options: COS.COSOptions = {
      SecretId: this.getRequiredConfig('secretId'),
      SecretKey: this.getRequiredConfig('secretKey'),
      Protocol: this.cosProtocol,
    };
    const token = this.cosConfig.securityToken?.trim();
    const domain = this.cosConfig.domain?.trim();

    if (token) {
      options.SecurityToken = token;
    }

    if (domain) {
      options.Domain = domain;
    }

    return new COS(options);
  }

  private createSignedPutUrl(input: {
    bucket: string;
    region: string;
    objectKey: string;
    expiresInSeconds: number;
    contentType: string;
  }): string {
    const protocol = this.protocol;
    const host = this.resolveSigningHost(input.bucket, input.region);
    const pathname = `/${this.encodeObjectKey(input.objectKey)}`;
    const now = Math.floor(Date.now() / 1000);
    const expireTime = now + input.expiresInSeconds;
    const keyTime = `${now};${expireTime}`;
    const headerList = 'content-type;host';
    const urlParamList = '';
    const httpParameters = '';
    const httpHeaders = `content-type=${encodeURIComponent(
      input.contentType
    )}&host=${host}`;
    const httpString = ['put', pathname, httpParameters, httpHeaders, ''].join(
      '\n'
    );
    const signKey = createHash('sha1')
      .update(keyTime + this.getRequiredConfig('secretKey'))
      .digest('hex');
    const stringToSign = [
      'sha1',
      keyTime,
      createHash('sha1').update(httpString).digest('hex'),
      '',
    ].join('\n');
    const signature = createHash('sha1')
      .update(stringToSign + signKey)
      .digest('hex');
    const query = new URLSearchParams({
      'q-sign-algorithm': 'sha1',
      'q-ak': this.getRequiredConfig('secretId'),
      'q-sign-time': keyTime,
      'q-key-time': keyTime,
      'q-header-list': headerList,
      'q-url-param-list': urlParamList,
      'q-signature': signature,
    });
    const token = this.cosConfig.securityToken?.trim();

    if (token) {
      query.set('x-cos-security-token', token);
    }

    return `${protocol}://${host}${pathname}?${query.toString()}`;
  }

  private getPublicUrl(
    objectKey: string,
    bucket: string,
    region: string
  ): string {
    const baseUrl = this.normalizeBaseUrl(this.cosConfig.publicBaseUrl);

    if (baseUrl) {
      return `${baseUrl}/${this.encodeObjectKey(objectKey)}`;
    }

    return `${this.protocol}://${this.resolvePublicHost(
      bucket,
      region
    )}/${this.encodeObjectKey(objectKey)}`;
  }

  private resolveEndpoint(bucket: string, region: string): string {
    return `${this.protocol}://${this.resolvePublicHost(bucket, region)}`;
  }

  private resolveSigningHost(bucket: string, region: string): string {
    return (
      this.cosConfig.domain?.trim() || `${bucket}.cos.${region}.myqcloud.com`
    );
  }

  private resolvePublicHost(bucket: string, region: string): string {
    return (
      this.cosConfig.domain?.trim() || `${bucket}.cos.${region}.myqcloud.com`
    );
  }

  private buildObjectKey(fileName: string, folder?: string): string {
    const now = new Date();
    const datePath = [
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('/');
    const prefix = this.normalizeFolder(folder || 'voice-timbres');
    const safeName = this.createSafeFileName(fileName);

    return [prefix, datePath, safeName].filter(Boolean).join('/');
  }

  private createSafeFileName(fileName?: string): string {
    const rawName = fileName?.trim() || 'file';
    const normalized = rawName
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^_+/, '')
      .slice(0, 100);
    const ext = normalized?.includes('.') ? normalized.split('.').pop() : '';
    const name = normalized || 'file';
    const suffix = randomBytes(6).toString('hex');

    if (!ext) {
      return `${Date.now()}-${suffix}-${name}`;
    }

    const base = name.slice(0, Math.max(1, name.length - ext.length - 1));
    return `${Date.now()}-${suffix}-${base}.${ext}`;
  }

  private normalizeFolder(value: string): string {
    return value
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .map(segment => segment.trim().replace(/[^a-zA-Z0-9._-]/g, '-'))
      .filter(Boolean)
      .join('/');
  }

  private normalizeExpires(value: unknown): number {
    const parsed = Number(value);

    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 3600) {
      return parsed;
    }

    return 900;
  }

  private encodeObjectKey(value: string): string {
    return value
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .map(segment => encodeURIComponent(segment.trim()))
      .filter(Boolean)
      .join('/');
  }

  private normalizeBaseUrl(value?: string): string {
    const trimmed = value?.trim();

    if (!trimmed) {
      return '';
    }

    return trimmed
      .replace(/\/+$/, '')
      .replace(/^http:/, 'http:')
      .replace(/^https:/, 'https:');
  }

  private ensureCosEnabled(): void {
    if (this.cosConfig?.enabled !== true) {
      throw new AppError(
        'TENCENT_COS_DISABLED',
        'Tencent COS is disabled',
        503
      );
    }
  }

  private getRequiredConfig(key: keyof TencentCosConfig): string {
    const value = this.cosConfig?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new AppError(
      `TENCENT_COS_${String(key).toUpperCase()}_MISSING`,
      `Tencent COS ${String(key)} is missing`,
      500
    );
  }

  private get cosProtocol(): 'http' | 'https' {
    return this.protocol === 'http' ? 'http' : 'https';
  }

  private get protocol(): string {
    const value = this.cosConfig?.protocol?.trim().toLowerCase();

    return value === 'http' || value === 'http:' ? 'http' : 'https';
  }
}
