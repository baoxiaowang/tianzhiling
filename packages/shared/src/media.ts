export const OSS_MEDIA_BASE_URL = 'https://oss.voloian.cn';

export function buildOssMediaUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${OSS_MEDIA_BASE_URL}${normalizedPath}`;
}
