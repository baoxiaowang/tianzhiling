import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { CreateOssSignedUploadDTO } from '../dto/storage.dto';
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
}
