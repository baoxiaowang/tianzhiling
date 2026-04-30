import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { OrderService } from '../service/order.service';
import { WechatPayService } from '../service/wechat-pay.service';

interface RawBodyRequest {
  rawBody?: string;
  body?: unknown;
}

@Controller('/api/pay/wechat')
export class WechatPayController {
  @Inject()
  wechatPayService: WechatPayService;

  @Inject()
  orderService: OrderService;

  @Inject()
  ctx: Context;

  @Post('/notify')
  async handleNotify(@Body() body: unknown) {
    const rawBody = this.getRawBody(body);
    const headers = this.getWechatPayHeaders();

    this.wechatPayService.verifyNotifySignature(rawBody, headers);
    const transaction = this.wechatPayService.decryptNotifyResource(body);
    await this.orderService.handleWechatPaymentSuccess(transaction);

    this.ctx.status = 200;
    this.ctx.body = {
      code: 'SUCCESS',
      message: '成功',
    };
  }

  private getRawBody(body: unknown): string {
    const request = this.ctx.request as RawBodyRequest;

    if (typeof request.rawBody === 'string' && request.rawBody) {
      return request.rawBody;
    }

    return JSON.stringify(body ?? request.body ?? {});
  }

  private getWechatPayHeaders(): Record<string, string> {
    const headerNames = [
      'wechatpay-timestamp',
      'wechatpay-nonce',
      'wechatpay-signature',
      'wechatpay-serial',
    ];

    return headerNames.reduce<Record<string, string>>((result, name) => {
      const value = this.ctx.get(name);

      if (value) {
        result[name] = value;
      }

      return result;
    }, {});
  }
}
