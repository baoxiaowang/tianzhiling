import { Body, Controller, Get, Inject, Param, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { CreateVipPlanOrderBodyDTO } from '../dto/order.dto';
import { AuthenticatedUserPayload } from '../interface';
import { OrderService } from '../service/order.service';

@Controller('/orders')
export class OrderController {
  @Inject()
  orderService: OrderService;

  @Inject()
  ctx: Context;

  @Post('/vip-plan')
  async createVipPlanOrder(@Body() body: CreateVipPlanOrderBodyDTO) {
    return this.orderService.createVipPlanOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Get('/')
  async listOrders() {
    return this.orderService.listUserOrders(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Get('/:orderId')
  async getOrder(@Param('orderId') orderId: string) {
    return this.orderService.getUserOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      orderId
    );
  }

  @Post('/:orderId/sync-payment')
  async syncOrderPayment(@Param('orderId') orderId: string) {
    return this.orderService.syncUserOrderPayment(
      this.ctx.state.auth as AuthenticatedUserPayload,
      orderId
    );
  }
}
