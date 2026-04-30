import { Config, Provide } from '@midwayjs/core';

interface OssPublicConfig {
  enabled?: boolean;
  region?: string;
  bucket?: string;
  endpoint?: string;
  publicBaseUrl?: string;
  secure?: boolean;
}

interface TencentCosPublicConfig {
  enabled?: boolean;
  region?: string;
  bucket?: string;
  protocol?: string;
  domain?: string;
  publicBaseUrl?: string;
}

@Provide()
export class AdminAvatarUrlService {
  @Config('oss')
  ossConfig: OssPublicConfig;

  @Config('tencentCos')
  tencentCosConfig: TencentCosPublicConfig;

  resolve(rawAvatar?: string): string {
    const avatar = rawAvatar?.trim() ?? '';

    if (!avatar) {
      return '';
    }

    const tencentObjectKey = this.extractObjectKeyByHosts(
      avatar,
      this.getTencentKnownHosts()
    );

    if (tencentObjectKey) {
      return this.resolveTencentPublicUrl(tencentObjectKey) || avatar;
    }

    const ossObjectKey = this.extractObjectKeyByHosts(
      avatar,
      this.getOssKnownHosts()
    );

    if (ossObjectKey) {
      return this.resolveOssPublicUrl(ossObjectKey) || avatar;
    }

    if (this.isUrl(avatar)) {
      return avatar;
    }

    return (
      this.resolveTencentPublicUrl(avatar) ||
      this.resolveOssPublicUrl(avatar) ||
      avatar
    );
  }

  normalizeForStorage(rawAvatar?: string): string {
    const avatar = rawAvatar?.trim() ?? '';

    if (!avatar) {
      return '';
    }

    return (
      this.extractObjectKeyByHosts(avatar, this.getTencentKnownHosts()) ||
      this.extractObjectKeyByHosts(avatar, this.getOssKnownHosts()) ||
      avatar
    );
  }

  private resolveTencentPublicUrl(objectKey: string): string {
    if (this.tencentCosConfig?.enabled !== true) {
      return '';
    }

    const baseUrl =
      this.normalizeBaseUrl(this.tencentCosConfig.publicBaseUrl, 'https') ||
      this.normalizeBaseUrl(this.tencentCosConfig.domain, this.tencentProtocol);

    if (baseUrl) {
      return `${baseUrl}/${this.encodeObjectKey(objectKey)}`;
    }

    const bucket = this.tencentCosConfig.bucket?.trim();
    const region = this.tencentCosConfig.region?.trim();

    if (!bucket || !region) {
      return '';
    }

    return `${
      this.tencentProtocol
    }://${bucket}.cos.${region}.myqcloud.com/${this.encodeObjectKey(
      objectKey
    )}`;
  }

  private resolveOssPublicUrl(objectKey: string): string {
    if (this.ossConfig?.enabled !== true) {
      return '';
    }

    const baseUrl = this.normalizeBaseUrl(
      this.ossConfig.publicBaseUrl,
      this.ossProtocol
    );

    if (baseUrl) {
      return `${baseUrl}/${this.encodeObjectKey(objectKey)}`;
    }

    const bucket = this.ossConfig.bucket?.trim();
    const region = this.ossConfig.region?.trim();

    if (!bucket || !region) {
      return '';
    }

    return `${this.ossProtocol}://${bucket}.oss-${region.replace(
      /^oss-/,
      ''
    )}.aliyuncs.com/${this.encodeObjectKey(objectKey)}`;
  }

  private getTencentKnownHosts(): string[] {
    const hosts = new Set<string>();
    const bucket = this.tencentCosConfig?.bucket?.trim();
    const region = this.tencentCosConfig?.region?.trim();

    this.appendHost(hosts, this.tencentCosConfig?.domain);
    this.appendHost(hosts, this.tencentCosConfig?.publicBaseUrl);

    if (bucket && region) {
      hosts.add(`${bucket}.cos.${region}.myqcloud.com`.toLowerCase());
    }

    return Array.from(hosts);
  }

  private getOssKnownHosts(): string[] {
    const hosts = new Set<string>();
    const bucket = this.ossConfig?.bucket?.trim();
    const region = this.ossConfig?.region?.trim();

    this.appendHost(hosts, this.ossConfig?.publicBaseUrl);
    this.appendHost(hosts, this.ossConfig?.endpoint);

    if (bucket && region) {
      hosts.add(`${bucket}.oss-${region.replace(/^oss-/, '')}.aliyuncs.com`);
      hosts.add(`${bucket}.oss.${region}.aliyuncs.com`);
    }

    return Array.from(hosts).map(host => host.toLowerCase());
  }

  private extractObjectKeyByHosts(value: string, hosts: string[]): string {
    if (!this.isUrl(value) || hosts.length === 0) {
      return '';
    }

    try {
      const url = new URL(this.ensureProtocol(value, 'https'));

      if (!hosts.includes(url.host.toLowerCase())) {
        return '';
      }

      return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return '';
    }
  }

  private appendHost(target: Set<string>, value?: string): void {
    const trimmed = value?.trim();

    if (!trimmed) {
      return;
    }

    try {
      const url = new URL(this.ensureProtocol(trimmed, 'https'));
      target.add(url.host.toLowerCase());
    } catch {
      target.add(trimmed.replace(/^https?:\/\//i, '').toLowerCase());
    }
  }

  private normalizeBaseUrl(
    value: string | undefined,
    protocol: string
  ): string {
    const trimmed = value?.trim();

    if (!trimmed) {
      return '';
    }

    return this.ensureProtocol(trimmed, protocol).replace(/\/+$/, '');
  }

  private ensureProtocol(value: string, protocol: string): string {
    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    return `${protocol}://${value.replace(/^\/+/, '')}`;
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

  private isUrl(value: string): boolean {
    return /^(https?:)?\/\//i.test(value);
  }

  private get tencentProtocol(): string {
    const protocol = this.tencentCosConfig?.protocol?.trim().toLowerCase();

    return protocol === 'http' || protocol === 'http:' ? 'http' : 'https';
  }

  private get ossProtocol(): string {
    return this.ossConfig?.secure === false ? 'http' : 'https';
  }
}
