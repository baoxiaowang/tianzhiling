import axios from 'axios';

export interface SignedUploadTicket {
  provider: string;
  objectKey: string;
  uploadUrl: string;
  publicUrl: string;
  method: string;
  headers?: Record<string, string>;
  expiresInSeconds?: number;
}

interface CreateSignedUploadParams {
  fileName: string;
  folder: string;
  contentType: string;
}

export async function createCosSignedUpload(params: CreateSignedUploadParams) {
  const { data } = await axios.post<SignedUploadTicket>(
    '/admin_api/storage/cos/sign-upload',
    params
  );

  return data;
}

export async function uploadFileToSignedUrl(
  file: File,
  ticket: SignedUploadTicket,
  contentType: string
) {
  const response = await fetch(ticket.uploadUrl, {
    method: ticket.method || 'PUT',
    body: file,
    headers: {
      ...(ticket.headers || {}),
      'Content-Type': contentType,
    },
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`文件上传失败：${response.status} ${response.statusText}`);
  }
}

export async function uploadAdminFile(
  file: File,
  options: { folder: string; contentType?: string }
) {
  const contentType =
    options.contentType || file.type || detectContentType(file.name);
  const ticket = await createCosSignedUpload({
    fileName: file.name,
    folder: options.folder,
    contentType,
  });

  await uploadFileToSignedUrl(file, ticket, contentType);

  return {
    objectKey: ticket.objectKey,
    publicUrl: ticket.publicUrl,
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
