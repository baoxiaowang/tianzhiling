import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import type {
  AdminAuthenticatedPayload,
  UpdateAdminChatFeedbackRequestDTO,
} from '@tzl/shared';
import { AdminOperationsService } from '../service/admin-operations.service';

@Controller('/operations')
export class AdminOperationsController {
  @Inject()
  ctx: Context;

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

  @Put('/feedback/:id')
  async updateFeedback(
    @Param('id') id: string,
    @Body() body: UpdateAdminChatFeedbackRequestDTO
  ) {
    return this.adminOperationsService.updateFeedback(
      id,
      body,
      this.ctx.state.adminAuth as AdminAuthenticatedPayload
    );
  }

  @Get('/reports')
  async reports(@Query() query: Record<string, string>) {
    return this.adminOperationsService.getReport(query?.month);
  }

  @Get('/user-value')
  async userValue(@Query() query: Record<string, string>) {
    return this.adminOperationsService.getUserValueReport(
      query?.endMonth,
      query?.months
    );
  }

  @Get('/order-analytics')
  async orderAnalytics(@Query() query: Record<string, string>) {
    return this.adminOperationsService.getOrderAnalytics(query?.month);
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
