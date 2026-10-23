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
import { Context } from '@midwayjs/koa';
import { AdminAuthenticatedPayload } from '@tzl/shared';
import {
  CreateAdminOrderDTO,
  ListAdminOrdersQueryDTO,
  RejectRefundDTO,
  UpdateAdminOrderFinanceInclusionDTO,
  VoiceMembershipDowngradeDTO,
} from '../dto/admin-order.dto';
import { AdminOrderService } from '../service/admin-order.service';
import { AdminOperationsService } from '../service/admin-operations.service';

@Controller('/orders')
export class AdminOrderController {
  @Inject()
  ctx: Context;

  @Inject()
  adminOrderService: AdminOrderService;

  @Inject()
  adminOperationsService: AdminOperationsService;

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

  /**
   * 调整后台补单是否计入财务统计，并立即重算该订单支付日的每日汇总，
   * 让「每日明细」当场反映，而不是等到下一次定时重算。
   */
  @Put('/:id/finance-inclusion')
  async updateFinanceInclusion(
    @Param('id') id: string,
    @Body() body: UpdateAdminOrderFinanceInclusionDTO
  ) {
    const record = await this.adminOrderService.updateFinanceInclusion(
      id,
      body?.includeInFinance === true
    );
    const paidAt = record.paidAt ? new Date(record.paidAt) : null;
    if (paidAt && !Number.isNaN(paidAt.getTime())) {
      const beijing = new Date(paidAt.getTime() + 8 * 60 * 60 * 1000);
      const date = `${beijing.getUTCFullYear()}-${String(
        beijing.getUTCMonth() + 1
      ).padStart(2, '0')}-${String(beijing.getUTCDate()).padStart(2, '0')}`;
      try {
        await this.adminOperationsService.computeAndPersistDailyStats(date);
      } catch (error) {
        // 汇总重算失败不影响标记本身，读取路径/定时任务会再算
      }
    }
    return record;
  }

  @Post('/:id/reject-refund')
  async rejectRefund(
    @Param('id') id: string,
    @Body() body: RejectRefundDTO
  ) {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return this.adminOrderService.rejectRefundOrder(id, body.action, auth);
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

  @Post('/:id/voice-membership-downgrade/retry-refund')
  async retryVoiceMembershipDowngradeRefund(@Param('id') id: string) {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return this.adminOrderService.retryVoiceMembershipDowngradeRefund(id, auth);
  }

  @Post('/:id/voice-membership-downgrade/sync')
  async syncVoiceMembershipDowngrade(@Param('id') id: string) {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return this.adminOrderService.syncVoiceMembershipDowngrade(id, auth);
  }

  @Post('/:id/voice-membership-downgrade/withdraw')
  async withdrawVoiceMembershipDowngrade(@Param('id') id: string) {
    const auth = this.ctx.state.adminAuth as AdminAuthenticatedPayload;

    return this.adminOrderService.withdrawVoiceMembershipDowngrade(id, auth);
  }
}
