import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@midwayjs/core';
import {
  ListAdminVipPlansQueryDTO,
  SaveAdminVipPlanDTO,
} from '../dto/admin-vip-plan.dto';
import { AdminVipPlanService } from '../service/admin-vip-plan.service';

@Controller('/vip-plans')
export class AdminVipPlanController {
  @Inject()
  adminVipPlanService: AdminVipPlanService;

  @Get('/')
  async list(@Query() query: ListAdminVipPlansQueryDTO) {
    return this.adminVipPlanService.listVipPlans(query);
  }

  @Post('/')
  async create(@Body() body: SaveAdminVipPlanDTO) {
    return this.adminVipPlanService.createVipPlan(body);
  }

  @Put('/:id')
  async update(@Param('id') id: string, @Body() body: SaveAdminVipPlanDTO) {
    return this.adminVipPlanService.updateVipPlan(id, body);
  }
}
