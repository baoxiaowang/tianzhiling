import { Body, Controller, Files, Inject, Post } from '@midwayjs/core';
import { UploadFileInfo, UploadMiddleware } from '@midwayjs/busboy';
import { AppError } from '@tzl/shared';
import { CreateAdminCosSignedUploadDTO } from '../dto/admin-storage.dto';
import { AdminStorageService } from '../service/admin-storage.service';

@Controller('/storage')
export class AdminStorageController {
  @Inject()
  adminStorageService: AdminStorageService;

  @Post('/cos/sign-upload')
  async createCosSignedUpload(@Body() body: CreateAdminCosSignedUploadDTO) {
    return this.adminStorageService.createCosSignedUpload(body);
  }

  @Post('/cos/upload', {
    middleware: [UploadMiddleware],
  })
  async uploadCosFile(@Files() files: UploadFileInfo[], @Body() body: Record<string, string>) {
    const file = files?.[0];

    if (!file) {
      throw new AppError('UPLOAD_FILE_MISSING', 'upload file is missing', 400);
    }

    return this.adminStorageService.uploadCosFile({
      filePath: file.data,
      fileName: file.filename,
      folder: body?.folder,
      contentType: body?.contentType || file.mimeType,
    });
  }
}
