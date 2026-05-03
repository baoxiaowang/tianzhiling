import { Body, Controller, Inject, Post } from '@midwayjs/core';
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
}
