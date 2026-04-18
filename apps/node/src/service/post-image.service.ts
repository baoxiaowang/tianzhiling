import { Config, Inject, Provide } from '@midwayjs/core';
import { OssConfig, OssService } from './oss.service';
import { TencentCosConfig, TencentCosService } from './tencent-cos.service';

@Provide()
export class PostImageService {
  @Config('oss')
  ossConfig: OssConfig;

  @Config('tencentCos')
  tencentCosConfig: TencentCosConfig;

  @Inject()
  ossService: OssService;

  @Inject()
  tencentCosService: TencentCosService;

  // Store object keys in the database so domain/CDN switches do not require
  // rewriting post content again.
  normalizeForStorage(rawValue: string): string {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      return '';
    }

    return (
      this.extractTencentObjectKey(trimmed) ||
      this.extractOssObjectKey(trimmed) ||
      trimmed
    );
  }

  resolveForResponse(rawValue: string): string {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      return '';
    }

    const tencentObjectKey = this.extractTencentObjectKey(trimmed);

    if (tencentObjectKey) {
      return this.resolveTencentPublicUrl(tencentObjectKey) || trimmed;
    }

    const ossObjectKey = this.extractOssObjectKey(trimmed);

    if (ossObjectKey) {
      return this.resolveOssPublicUrl(ossObjectKey) || trimmed;
    }

    if (this.isUrl(trimmed)) {
      return trimmed;
    }

    return (
      this.resolveTencentPublicUrl(trimmed) ||
      this.resolveOssPublicUrl(trimmed) ||
      trimmed
    );
  }

  private resolveTencentPublicUrl(objectKey: string): string {
    if (!this.tencentCosService.isEnabled()) {
      return '';
    }

    try {
      return this.tencentCosService.getPublicUrl(objectKey);
    } catch {
      return '';
    }
  }

  private resolveOssPublicUrl(objectKey: string): string {
    if (!this.ossService.isEnabled()) {
      return '';
    }

    try {
      return this.ossService.getPublicUrl(objectKey);
    } catch {
      return '';
    }
  }

  private extractTencentObjectKey(value: string): string {
    return this.extractObjectKeyByHosts(value, this.getTencentKnownHosts());
  }

  private extractOssObjectKey(value: string): string {
    return this.extractObjectKeyByHosts(value, this.getOssKnownHosts());
  }

  private extractObjectKeyByHosts(value: string, hosts: string[]): string {
    if (!this.isUrl(value) || hosts.length === 0) {
      return '';
    }

    try {
      const url = new URL(value);

      if (!hosts.includes(url.host.toLowerCase())) {
        return '';
      }

      return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return '';
    }
  }

  private getTencentKnownHosts(): string[] {
    const hosts = new Set<string>();
    const bucket = this.tencentCosConfig?.bucket?.trim();
    const region = this.tencentCosConfig?.region?.trim();
    const domain = this.tencentCosConfig?.domain?.trim();

    if (domain) {
      this.appendHost(hosts, domain);
    }

    if (this.tencentCosConfig?.publicBaseUrl?.trim()) {
      this.appendHost(hosts, this.tencentCosConfig.publicBaseUrl);
    }

    if (bucket && region) {
      hosts.add(`${bucket}.cos.${region}.myqcloud.com`.toLowerCase());
    }

    return Array.from(hosts);
  }

  private getOssKnownHosts(): string[] {
    const hosts = new Set<string>();
    const bucket = this.ossConfig?.bucket?.trim();
    const region = this.ossConfig?.region?.trim();
    const endpoint = this.ossConfig?.endpoint?.trim();

    if (this.ossConfig?.publicBaseUrl?.trim()) {
      this.appendHost(hosts, this.ossConfig.publicBaseUrl);
    }

    if (endpoint) {
      this.appendHost(hosts, endpoint);
    }

    if (bucket && region) {
      hosts.add(`${bucket}.oss-${region.replace(/^oss-/, '')}.aliyuncs.com`);
      hosts.add(`${bucket}.oss.${region}.aliyuncs.com`);
    }

    return Array.from(hosts).map(host => host.toLowerCase());
  }

  private appendHost(target: Set<string>, value: string): void {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    try {
      const url = /^https?:\/\//i.test(trimmed)
        ? new URL(trimmed)
        : new URL(`https://${trimmed}`);
      target.add(url.host.toLowerCase());
    } catch {
      // Ignore invalid host strings so response formatting stays resilient.
    }
  }

  private isUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }
}
