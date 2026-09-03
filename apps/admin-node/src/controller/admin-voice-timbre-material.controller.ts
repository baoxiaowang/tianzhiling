import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@midwayjs/core';
import {
  CreateAdminVoiceTimbreMaterialDTO,
  ListAdminVoiceTimbreMaterialsQueryDTO,
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

  @Del('/:id')
  async remove(@Param('id') id: string) {
    return this.adminVoiceTimbreMaterialService.remove(id);
  }
}
