import { Body, Controller, Get, Inject, Param, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  CreateVipPlanOrderBodyDTO,
  CreateVoicePackageOrderBodyDTO,
} from '../dto/order.dto';
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
      body,
      this.getOrderClientContext(body)
    );
  }

  @Post('/vip-plan/virtual-payment')
  async createVipPlanVirtualPaymentOrder(
    @Body() body: CreateVipPlanOrderBodyDTO
  ) {
    return this.orderService.createVipPlanVirtualPaymentOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body,
      this.getOrderClientContext(body)
    );
  }

  @Post('/voice-package')
  async createVoicePackageOrder(@Body() body: CreateVoicePackageOrderBodyDTO) {
    return this.orderService.createVoicePackageOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body,
      this.getOrderClientContext(body)
    );
  }

  /**
   * 下单请求的客户端上下文：
   * - User-Agent 是旧客户端唯一的平台信号，必须保留以兼容已发布版本；
   * - 新增客户端额外上报 `platform`，服务端做交叉验证，冲突则 fail-closed。
   */
  private getOrderClientContext(body: { platform?: string }) {
    const header = this.ctx.headers['user-agent'];

    return {
      userAgent: Array.isArray(header) ? header[0] : header,
      declaredPlatform: body?.platform,
    };
  }

  @Post('/voice-package/virtual-payment')
  async createVoicePackageVirtualPaymentOrder(
    @Body() body: CreateVoicePackageOrderBodyDTO
  ) {
    return this.orderService.createVoicePackageVirtualPaymentOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body,
      this.getOrderClientContext(body)
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

  @Post('/:orderId/refund')
  async refundOrder(@Param('orderId') orderId: string) {
    return this.orderService.refundUserOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      orderId
    );
  }
}
