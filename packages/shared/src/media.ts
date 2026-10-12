/**
 * 媒体资源地址拼接（跨端共享）
 *
 * 媒体域名是品牌差异项（各品牌自有 OSS 域名），因此 shared 不再写死任一品牌域名：
 * 默认基址为空，由调用方传入自己的媒体基址
 * （Node 端见 apps/node/src/config/brand.ts 的 `mediaBaseUrl`；
 *   小程序端见 apps/weapp/src/utils/public-asset.ts 的 `resolveMediaAssetUrl`）。
 */
export const OSS_MEDIA_BASE_URL = '';

export function buildOssMediaUrl(path: string, baseUrl: string = OSS_MEDIA_BASE_URL) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  return `${normalizedBaseUrl}${normalizedPath}`;
}
