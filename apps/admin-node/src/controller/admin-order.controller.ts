import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AdminAuthenticatedPayload } from '@tzl/shared';
import {
  CreateAdminOrderDTO,
  ListAdminOrdersQueryDTO,
  VoiceMembershipDowngradeDTO,
} from '../dto/admin-order.dto';
import { AdminOrderService } from '../service/admin-order.service';

@Controller('/orders')
export class AdminOrderController {
  @Inject()
  ctx: Context;

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

  @Post('/:id/mark-wechat-refunded')
  async markWechatRefunded(@Param('id') id: string) {
    return this.adminOrderService.markWechatRefunded(id);
  }

  @Post('/:id/revoke')
  async revoke(@Param('id') id: string) {
    return this.adminOrderService.revokeAdminManualOrder(id);
  }

  @Post('/:id/sync-payment')
  async syncPayment(@Param('id') id: string) {
    return this.adminOrderService.syncPaymentStatus(id);
  }

  @Get('/:id/voice-membership-downgrade')
  async previewVoiceMembershipDowngrade(@Param('id') id: string) {
    return this.adminOrderService.getVoiceMembershipDowngradePreview(id);
  }

  @Post('/:id/voice-membership-downgrade')
  async downgradeVoiceMembership(
    @Param('id') id: string,
    @Body() body: VoiceMembershipDowngradeDTO
  ) {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return this.adminOrderService.downgradeVoiceMembership(id, body, auth);
  }

  @Post('/:id/voice-membership-downgrade/sync')
  async syncVoiceMembershipDowngrade(@Param('id') id: string) {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return this.adminOrderService.syncVoiceMembershipDowngrade(id, auth);
  }
}
