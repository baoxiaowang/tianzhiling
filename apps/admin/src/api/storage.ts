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
  await axios.request({
    url: ticket.uploadUrl,
    method: (ticket.method || 'PUT') as 'PUT',
    data: file,
    headers: {
      ...(ticket.headers || {}),
      'Content-Type': contentType,
    },
    transformRequest: [(data) => data],
    withCredentials: false,
  });
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

  return 'application/octet-stream';
}
