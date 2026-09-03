import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@midwayjs/core';
import {
  CreateAdminVoiceTimbreMaterialDTO,
  ListAdminVoiceTimbreMaterialsQueryDTO,
  RollbackAdminVoiceTimbreMaterialUploadDTO,
  SaveAdminVoiceTimbreReviewClipsDTO,
} from '../dto/admin-voice-timbre-material.dto';
import { AdminVoiceTimbreMaterialService } from '../service/admin-voice-timbre-material.service';

@Controller('/voice-materials')
export class AdminVoiceTimbreMaterialController {
  @Inject()
  adminVoiceTimbreMaterialService: AdminVoiceTimbreMaterialService;

  @Get('/')
  async list(@Query() query: ListAdminVoiceTimbreMaterialsQueryDTO) {
    return this.adminVoiceTimbreMaterialService.listByUser(query.userId);
  }

  @Post('/')
  async create(@Body() body: CreateAdminVoiceTimbreMaterialDTO) {
    return this.adminVoiceTimbreMaterialService.create(body);
  }

  @Post('/rollback-upload')
  async rollbackUpload(
    @Body() body: RollbackAdminVoiceTimbreMaterialUploadDTO
  ) {
    return this.adminVoiceTimbreMaterialService.rollbackUpload(body.objectKey);
  }

  @Put('/:id/review-clips')
  async saveReviewClips(
    @Param('id') id: string,
    @Body() body: SaveAdminVoiceTimbreReviewClipsDTO
  ) {
    return this.adminVoiceTimbreMaterialService.saveReviewClips(
      id,
      body.clips as never
    );
  }

  @Del('/:id')
  async remove(@Param('id') id: string) {
    return this.adminVoiceTimbreMaterialService.remove(id);
  }
}
