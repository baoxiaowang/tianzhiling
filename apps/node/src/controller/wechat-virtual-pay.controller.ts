import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  OrderService,
  WechatVirtualPaymentNotifyPayload,
} from '../service/order.service';

interface RawBodyRequest {
  rawBody?: string;
  body?: unknown;
}

@Controller('/pay/virtual')
export class WechatVirtualPayController {
  @Inject()
  orderService: OrderService;

  @Inject()
  ctx: Context;

  @Post('/notify')
  async handleNotify(@Body() body: unknown) {
    const rawBody = this.getRawBody(body);
    const isXml = this.isXmlNotify(rawBody);
    const payload = isXml
      ? this.parseXmlNotify(rawBody)
      : this.parseJsonNotify(body, rawBody);

    await this.orderService.handleWechatVirtualPaymentNotify(payload);

    this.ctx.status = 200;
    this.ctx.type = isXml ? 'application/xml' : 'application/json';
    this.ctx.body = isXml
      ? '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'
      : {
          ErrCode: 0,
          ErrMsg: 'success',
        };
  }

  private getRawBody(body: unknown): string {
    const request = this.ctx.request as RawBodyRequest;

    if (typeof request.rawBody === 'string' && request.rawBody) {
      return request.rawBody;
    }

    if (typeof body === 'string') {
      return body;
    }

    return JSON.stringify(body ?? request.body ?? {});
  }

  private isXmlNotify(rawBody: string): boolean {
    const contentType = this.ctx.get('content-type').toLowerCase();

    return contentType.includes('xml') || rawBody.trim().startsWith('<');
  }

  private parseJsonNotify(
    body: unknown,
    rawBody: string
  ): WechatVirtualPaymentNotifyPayload {
    const raw =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : (JSON.parse(rawBody || '{}') as Record<string, unknown>);

    const payInfo = this.asObject(raw.WeChatPayInfo);
    const goodsInfo = this.asObject(raw.GoodsInfo);

    return {
      Event: this.asString(raw.Event),
      OpenId: this.asString(raw.OpenId),
      OutTradeNo: this.asString(raw.OutTradeNo),
      Env: this.asOptionalNumber(raw.Env),
      WxRefundId: this.asString(raw.WxRefundId),
      MchRefundId: this.asString(raw.MchRefundId),
      WxOrderId: this.asString(raw.WxOrderId),
      MchOrderId: this.asString(raw.MchOrderId),
      RefundFee: this.asOptionalNumber(raw.RefundFee),
      RetCode: this.asOptionalNumber(raw.RetCode),
      RetMsg: this.asString(raw.RetMsg),
      RefundStartTimestamp: this.asOptionalNumber(raw.RefundStartTimestamp),
      RefundSuccTimestamp: this.asOptionalNumber(raw.RefundSuccTimestamp),
      WxpayRefundTransactionId: this.asString(raw.WxpayRefundTransactionId),
      RetryTimes: this.asOptionalNumber(raw.RetryTimes),
      WeChatPayInfo: {
        MchOrderNo: this.asString(payInfo.MchOrderNo),
        TransactionId: this.asString(payInfo.TransactionId),
        PaidTime: this.asOptionalNumber(payInfo.PaidTime),
      },
      GoodsInfo: {
        ProductId: this.asString(goodsInfo.ProductId),
        Quantity: this.asOptionalNumber(goodsInfo.Quantity),
        OrigPrice: this.asOptionalNumber(goodsInfo.OrigPrice),
        ActualPrice: this.asOptionalNumber(goodsInfo.ActualPrice),
        Attach: this.asString(goodsInfo.Attach),
      },
    };
  }

  private parseXmlNotify(rawBody: string): WechatVirtualPaymentNotifyPayload {
    return {
      Event: this.getXmlTag(rawBody, 'Event'),
      OpenId: this.getXmlTag(rawBody, 'OpenId'),
      OutTradeNo: this.getXmlTag(rawBody, 'OutTradeNo'),
      Env: this.asOptionalNumber(this.getXmlTag(rawBody, 'Env')),
      WxRefundId: this.getXmlTag(rawBody, 'WxRefundId'),
      MchRefundId: this.getXmlTag(rawBody, 'MchRefundId'),
      WxOrderId: this.getXmlTag(rawBody, 'WxOrderId'),
      MchOrderId: this.getXmlTag(rawBody, 'MchOrderId'),
      RefundFee: this.asOptionalNumber(this.getXmlTag(rawBody, 'RefundFee')),
      RetCode: this.asOptionalNumber(this.getXmlTag(rawBody, 'RetCode')),
      RetMsg: this.getXmlTag(rawBody, 'RetMsg'),
      RefundStartTimestamp: this.asOptionalNumber(
        this.getXmlTag(rawBody, 'RefundStartTimestamp')
      ),
      RefundSuccTimestamp: this.asOptionalNumber(
        this.getXmlTag(rawBody, 'RefundSuccTimestamp')
      ),
      WxpayRefundTransactionId: this.getXmlTag(
        rawBody,
        'WxpayRefundTransactionId'
      ),
      RetryTimes: this.asOptionalNumber(this.getXmlTag(rawBody, 'RetryTimes')),
      WeChatPayInfo: {
        MchOrderNo: this.getXmlTag(rawBody, 'MchOrderNo'),
        TransactionId: this.getXmlTag(rawBody, 'TransactionId'),
        PaidTime: this.asOptionalNumber(this.getXmlTag(rawBody, 'PaidTime')),
      },
      GoodsInfo: {
        ProductId: this.getXmlTag(rawBody, 'ProductId'),
        Quantity: this.asOptionalNumber(this.getXmlTag(rawBody, 'Quantity')),
        OrigPrice: this.asOptionalNumber(this.getXmlTag(rawBody, 'OrigPrice')),
        ActualPrice: this.asOptionalNumber(
          this.getXmlTag(rawBody, 'ActualPrice')
        ),
        Attach: this.getXmlTag(rawBody, 'Attach'),
      },
    };
  }

  private getXmlTag(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    const value = match?.[1]
      ?.replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
      .trim();

    return value || undefined;
  }

  private asObject<T extends Record<string, unknown>>(value: unknown): T {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as T)
      : ({} as T);
  }

  private asString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return undefined;
  }

  private asOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.trim());

      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }
}
