import axios from 'axios';

interface UploadedAdminFile {
  provider: string;
  objectKey: string;
  publicUrl: string;
  contentType?: string;
  etag?: string;
}

async function uploadAdminFile(
  file: File,
  options: { folder: string; contentType?: string }
) {
  const contentType =
    options.contentType || file.type || detectContentType(file.name);
  const formData = new FormData();

  formData.append('file', file, file.name);
  formData.append('folder', options.folder);
  formData.append('contentType', contentType);

  const { data } = await axios.post<UploadedAdminFile>(
    '/admin_api/storage/cos/upload',
    formData
  );

  return {
    objectKey: data.objectKey,
    publicUrl: data.publicUrl,
  };
}

function detectContentType(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'mp3') {
    return 'audio/mpeg';
  }

  if (ext === 'm4a') {
    return 'audio/mp4';
  }

  if (ext === 'wav') {
    return 'audio/wav';
  }

  if (ext === 'mp4') {
    return 'video/mp4';
  }
  return 'application/octet-stream';
}

export default uploadAdminFile;

export async function downloadAdminFile(
  objectKey: string,
  fileName?: string
): Promise<Blob> {
  const { data } = await axios.get<Blob>('/admin_api/storage/cos/download', {
    params: { objectKey, fileName },
    responseType: 'blob',
  });
  if (!(data instanceof Blob) || !data.size || data.type.includes('json')) {
    throw new Error('下载响应不是有效文件');
  }
  return data;
}

export function saveBlobAsFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start reading the Blob before releasing its URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** 从 COS 公网 URL 反推 objectKey（用于下载）。 */
export function objectKeyFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
}
