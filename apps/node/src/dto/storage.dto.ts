export class CreateOssSignedUploadDTO {
  fileName?: string;
  folder?: string;
  objectKey?: string;
  contentType?: string;
  expiresInSeconds?: number;
}
