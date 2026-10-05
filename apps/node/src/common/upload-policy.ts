/**
 * 上传审核范围判定：只回答“这次上传要不要送审”，不关心具体云厂商与计费实现。
 * 判定必须保持可单测、可解释，避免审核范围随调用方默认值漂移。
 */

/** 数据万象图片审核支持的图片后缀（与控制台“审核后缀”一致）。 */
export const MODERATED_IMAGE_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'bmp',
  'webp',
  'gif',
  'heif',
  'heic',
];

/**
 * 默认纳入审核的上传目录：只覆盖用户产生内容。
 * 服务端生成内容（如 memorial-photos）与运营资产（如 admin/*）默认不审，
 * 它们是审核费用的主要无效来源。
 */
export const DEFAULT_MODERATED_FOLDERS: readonly string[] = [
  'moments',
  'avatars',
  'contact-covers',
  'conversation-images',
  'chat-imports',
  'memorial-source-photos',
];

export function extractFileExtension(fileName?: string): string {
  const name = fileName?.trim() || '';
  const index = name.lastIndexOf('.');

  if (index < 0 || index === name.length - 1) {
    return '';
  }

  return name.slice(index + 1).toLowerCase();
}

export function isImageUpload(input: {
  contentType?: string;
  fileName?: string;
}): boolean {
  const contentType = input.contentType?.trim().toLowerCase() || '';

  if (contentType.startsWith('image/')) {
    return true;
  }

  return MODERATED_IMAGE_EXTENSIONS.includes(
    extractFileExtension(input.fileName)
  );
}

export function normalizeUploadFolder(folder?: string): string {
  return (folder || '').trim().replace(/^\/+|\/+$/g, '');
}

export function normalizeModeratedFolders(
  folders?: readonly string[]
): string[] {
  return (folders || [])
    .map(folder => normalizeUploadFolder(folder))
    .filter(Boolean);
}

/**
 * 目录是否属于给定列表（精确或列表项下的子路径）。
 * 与 isFolderInModerationScope 的区别：未传目录时返回 false。
 * 用于"私密目录"这类降级判定——缺目录时不能误判成可降级。
 */
export function isFolderWithin(
  folder: string | undefined,
  folders: readonly string[]
): boolean {
  const normalized = normalizeUploadFolder(folder);

  if (!normalized) {
    return false;
  }

  return normalizeModeratedFolders(folders).some(
    prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

/**
 * 目录是否在审核范围内。
 * 未传目录时不放宽：按“在范围内”处理，避免旧客户端或异常请求绕过审核。
 */
export function isFolderInModerationScope(
  folder: string | undefined,
  folders: readonly string[]
): boolean {
  const normalized = normalizeUploadFolder(folder);

  if (!normalized) {
    return true;
  }

  return normalizeModeratedFolders(folders).some(
    prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}
