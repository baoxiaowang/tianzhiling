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
      this.getClientUserAgent()
    );
  }

  @Post('/vip-plan/virtual-payment')
  async createVipPlanVirtualPaymentOrder(
    @Body() body: CreateVipPlanOrderBodyDTO
  ) {
    return this.orderService.createVipPlanVirtualPaymentOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Post('/voice-package')
  async createVoicePackageOrder(@Body() body: CreateVoicePackageOrderBodyDTO) {
    return this.orderService.createVoicePackageOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body,
      this.getClientUserAgent()
    );
  }

  /**
   * 客户端平台只从 User-Agent 判定：微信只关闭了非 iOS 的普通微信支付，
   * iOS 必须能走普通支付（其虚拟支付基本不可用）。用 UA 而不是新增请求字段，
   * 是为了让已发布的旧版小程序无需发版即可生效。
   */
  private getClientUserAgent(): string | undefined {
    const header = this.ctx.headers['user-agent'];
    return Array.isArray(header) ? header[0] : header;
  }

  @Post('/voice-package/virtual-payment')
  async createVoicePackageVirtualPaymentOrder(
    @Body() body: CreateVoicePackageOrderBodyDTO
  ) {
    return this.orderService.createVoicePackageVirtualPaymentOrder(
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

  @Post('/:orderId/refund')
  async refundOrder(@Param('orderId') orderId: string) {
    return this.orderService.refundUserOrder(
      this.ctx.state.auth as AuthenticatedUserPayload,
      orderId
    );
  }
}
