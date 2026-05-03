import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@midwayjs/core';
import {
  CreateAdminVoiceTimbreDTO,
  ListAdminVoiceTimbresQueryDTO,
  UpdateAdminVoiceTimbreDTO,
} from '../dto/admin-voice-timbre.dto';
import { AdminVoiceTimbreService } from '../service/admin-voice-timbre.service';

@Controller('/voice-timbres')
export class AdminVoiceTimbreController {
  @Inject()
  adminVoiceTimbreService: AdminVoiceTimbreService;

  @Get('/')
  async list(@Query() query: ListAdminVoiceTimbresQueryDTO) {
    return this.adminVoiceTimbreService.listVoiceTimbres(query);
  }

  @Post('/')
  async create(@Body() body: CreateAdminVoiceTimbreDTO) {
    return this.adminVoiceTimbreService.createVoiceTimbre(body);
  }

  @Post('/:id/retry')
  async retry(@Param('id') id: string) {
    return this.adminVoiceTimbreService.retryVoiceTimbreCreate(id);
  }

  @Put('/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAdminVoiceTimbreDTO
  ) {
    return this.adminVoiceTimbreService.updateVoiceTimbre(id, body);
  }
}
