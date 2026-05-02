import { Controller, Get, Inject, Query } from '@midwayjs/core';
import { ListAdminOrdersQueryDTO } from '../dto/admin-order.dto';
import { AdminOrderService } from '../service/admin-order.service';

@Controller('/orders')
export class AdminOrderController {
  @Inject()
  adminOrderService: AdminOrderService;

  @Get('/')
  async list(@Query() query: ListAdminOrdersQueryDTO) {
    return this.adminOrderService.listOrders(query);
  }
}
