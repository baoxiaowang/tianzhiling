import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@midwayjs/core';
import {
  CompleteAdminVoiceTrainingTaskDTO,
  ListAdminVoicePackagesQueryDTO,
  ListAdminVoiceTrainingTasksQueryDTO,
  SaveAdminVoicePackageDTO,
  UpdateAdminVoiceTrainingTaskDTO,
} from '../dto/admin-voice-package.dto';
import { AdminVoicePackageService } from '../service/admin-voice-package.service';

@Controller('/voice-packages')
export class AdminVoicePackageController {
  @Inject()
  adminVoicePackageService: AdminVoicePackageService;

  @Get('/')
  async list(@Query() query: ListAdminVoicePackagesQueryDTO) {
    return this.adminVoicePackageService.listVoicePackages(query);
  }

  @Post('/')
  async create(@Body() body: SaveAdminVoicePackageDTO) {
    return this.adminVoicePackageService.createVoicePackage(body);
  }

  @Put('/:id')
  async update(
    @Param('id') id: string,
    @Body() body: SaveAdminVoicePackageDTO
  ) {
    return this.adminVoicePackageService.updateVoicePackage(id, body);
  }
}

@Controller('/voice-training-tasks')
export class AdminVoiceTrainingTaskController {
  @Inject()
  adminVoicePackageService: AdminVoicePackageService;

  @Get('/')
  async list(@Query() query: ListAdminVoiceTrainingTasksQueryDTO) {
    return this.adminVoicePackageService.listTrainingTasks(query);
  }

  @Put('/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAdminVoiceTrainingTaskDTO
  ) {
    return this.adminVoicePackageService.updateTrainingTask(id, body);
  }

  @Post('/:id/complete')
  async complete(
    @Param('id') id: string,
    @Body() body: CompleteAdminVoiceTrainingTaskDTO
  ) {
    return this.adminVoicePackageService.completeTrainingTask(id, body);
  }
}
