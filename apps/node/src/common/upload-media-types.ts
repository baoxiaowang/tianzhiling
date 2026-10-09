import { extractFileExtension } from './upload-policy';

/**
 * 上传媒体类型白名单。
 *
 * 目的：服务端只接受这些扩展名，并以扩展名推导存储用的 Content-Type，
 * 不允许客户端用任意声明类型把非媒体文件（例如 text/html 引流页）
 * 托管在平台自有域名下。
 *
 * 映射与小程序端 detectContentType 保持一致，避免改变正常上传的存储类型。
 */
export const UPLOAD_MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  amr: 'audio/amr',
  silk: 'audio/silk',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
};

/** 去掉 charset 等参数并转小写。 */
export function normalizeUploadContentType(value?: string): string {
  return (value || '').split(';')[0].trim().toLowerCase();
}

export function isAllowedUploadContentType(value?: string): boolean {
  const normalized = normalizeUploadContentType(value);

  return (
    normalized !== '' && Object.values(UPLOAD_MEDIA_TYPES).includes(normalized)
  );
}

/** 按扩展名推导存储类型；扩展名不在白名单时返回 undefined（调用方应拒绝）。 */
export function resolveUploadMediaType(fileName?: string): string | undefined {
  const extension = extractFileExtension(fileName);

  return extension ? UPLOAD_MEDIA_TYPES[extension] : undefined;
}
