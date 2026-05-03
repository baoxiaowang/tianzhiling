import { Body, Controller, Files, Inject, Post } from '@midwayjs/core';
import { UploadFileInfo, UploadMiddleware } from '@midwayjs/busboy';
import { CreateOssSignedUploadDTO } from '../dto/storage.dto';
import { AppError } from '../common/errors';
import { OssService } from '../service/oss.service';
import { TencentCosService } from '../service/tencent-cos.service';

@Controller('/storage')
export class StorageController {
  @Inject()
  ossService: OssService;

  @Inject()
  tencentCosService: TencentCosService;

  @Post('/oss/sign-upload')
  async createOssSignedUpload(@Body() body: CreateOssSignedUploadDTO) {
    return this.ossService.createSignedUpload(body);
  }

  @Post('/cos/sign-upload')
  async createTencentCosSignedUpload(@Body() body: CreateOssSignedUploadDTO) {
    return this.tencentCosService.createSignedUpload(body);
  }

  @Post('/upload', {
    middleware: [UploadMiddleware],
  })
  async uploadFile(
    @Files() files: UploadFileInfo[],
    @Body() body: Record<string, string>
  ) {
    const file = files?.[0];

    if (!file) {
      throw new AppError('UPLOAD_FILE_MISSING', 'upload file is missing', 400);
    }

    const uploaded = await this.tencentCosService.putFile(file.data, {
      fileName: body?.fileName || file.filename,
      folder: body?.folder,
      contentType: body?.contentType || file.mimeType,
    });

    return {
      provider: 'tencent-cos',
      objectKey: uploaded.objectKey,
      publicUrl: uploaded.url,
    };
  }
}
