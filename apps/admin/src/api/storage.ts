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
