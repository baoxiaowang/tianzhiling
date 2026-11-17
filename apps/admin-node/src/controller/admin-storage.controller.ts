import {
  Body,
  Controller,
  Files,
  Get,
  Inject,
  Post,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { UploadFileInfo, UploadMiddleware } from '@midwayjs/busboy';
import { AppError } from '@tzl/shared';
import {
  CreateAdminCosSignedUploadDTO,
  DownloadCosObjectQueryDTO,
} from '../dto/admin-storage.dto';
import { AdminStorageService } from '../service/admin-storage.service';

@Controller('/storage')
export class AdminStorageController {
  @Inject()
  adminStorageService: AdminStorageService;

  @Inject()
  ctx: Context;

  @Post('/cos/sign-upload')
  async createCosSignedUpload(@Body() body: CreateAdminCosSignedUploadDTO) {
    return this.adminStorageService.createCosSignedUpload(body);
  }

  @Get('/cos/download')
  async downloadCosObject(@Query() query: DownloadCosObjectQueryDTO) {
    const objectKey = query.objectKey.trim();
    const fallbackName = objectKey.split('/').pop() || 'download';
    const fileName = (query.fileName || fallbackName).trim();
    const { buffer, contentType, contentLength } =
      await this.adminStorageService.downloadCosObject(objectKey);

    this.ctx.set('Content-Type', contentType || 'application/octet-stream');
    this.ctx.set(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(
        fileName
      )}`
    );
    this.ctx.set('Content-Length', String(contentLength));
    this.ctx.body = buffer;
    return buffer;
  }

  @Post('/cos/upload', {
    middleware: [UploadMiddleware],
  })
  async uploadCosFile(
    @Files() files: UploadFileInfo[],
    @Body() body: Record<string, string>
  ) {
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
