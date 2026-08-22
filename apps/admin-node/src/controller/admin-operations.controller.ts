import { Controller, Get, Inject, Query } from '@midwayjs/core';
import { AdminOperationsService } from '../service/admin-operations.service';

@Controller('/operations')
export class AdminOperationsController {
  @Inject()
  adminOperationsService: AdminOperationsService;

  @Get('/overview')
  async overview() {
    return this.adminOperationsService.getOverview();
  }

  @Get('/chat-quality')
  async chatQuality() {
    return this.adminOperationsService.getChatQuality();
  }

  @Get('/tasks')
  async tasks(@Query() query: Record<string, string>) {
    return this.adminOperationsService.listTasks(query);
  }

  @Get('/system-runtime')
  async systemRuntime() {
    return this.adminOperationsService.getSystemRuntime();
  }
}
