import { Body, Controller, Fields, Files, Inject, Post } from '@midwayjs/core';
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
    @Fields() fields: Record<string, string>
  ) {
    const file = files?.[0];

    if (!file) {
      throw new AppError('UPLOAD_FILE_MISSING', 'upload file is missing', 400);
    }

    let uploaded;

    try {
      uploaded = await this.tencentCosService.putFile(file.data, {
        fileName: fields?.fileName || file.filename,
        folder: fields?.folder,
        contentType: fields?.contentType || file.mimeType,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'TENCENT_COS_UPLOAD_FAILED',
        '文件上传失败，请稍后重试',
        502
      );
    }

    return {
      provider: 'tencent-cos',
      objectKey: uploaded.objectKey,
      publicUrl: uploaded.url,
    };
  }
}
