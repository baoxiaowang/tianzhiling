import { Body, Controller, Get, Inject, Param, Post, Query } from '@midwayjs/core';
import {
  CreateAdminOrderDTO,
  ListAdminOrdersQueryDTO,
} from '../dto/admin-order.dto';
import { AdminOrderService } from '../service/admin-order.service';

@Controller('/orders')
export class AdminOrderController {
  @Inject()
  adminOrderService: AdminOrderService;

  @Get('/')
  async list(@Query() query: ListAdminOrdersQueryDTO) {
    return this.adminOrderService.listOrders(query);
  }

  @Post('/')
  async create(@Body() body: CreateAdminOrderDTO) {
    return this.adminOrderService.createOrder(body);
  }

  @Post('/:id/refund')
  async refund(@Param('id') id: string) {
    return this.adminOrderService.refundOrder(id);
  }

  @Post('/:id/revoke')
  async revoke(@Param('id') id: string) {
    return this.adminOrderService.revokeAdminManualOrder(id);
  }

  @Post('/:id/sync-payment')
  async syncPayment(@Param('id') id: string) {
    return this.adminOrderService.syncPaymentStatus(id);
  }
}
