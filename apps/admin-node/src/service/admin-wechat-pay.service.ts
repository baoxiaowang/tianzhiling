import { Config, Provide } from '@midwayjs/core';
import { AppError } from '@tzl/shared';
import { Wechatpay } from 'wechatpay-axios-plugin';

interface WechatPayConfig {
  enabled?: boolean;
  mchId?: string;
  merchantSerialNo?: string;
  merchantPrivateKey?: string;
  publicKeyId?: string;
  publicKey?: string;
}

interface WechatRefundPayload {
  refund_id?: string;
  out_refund_no?: string;
  transaction_id?: string;
  out_trade_no?: string;
  status?: string;
  amount?: {
    total?: number;
    refund?: number;
    currency?: string;
  };
}

interface WechatPayErrorResponse {
  response?: {
    status?: number;
    statusText?: string;
    data?: {
      code?: string;
      message?: string;
    };
  };
}

@Provide()
export class AdminWechatPayService {
  @Config('wechatPay')
  wechatPayConfig: WechatPayConfig;

  private wxpayClient?: unknown;

  async refundOrder(payload: {
    orderNo: string;
    refundNo: string;
    reason: string;
    amount: number;
    totalAmount: number;
  }): Promise<WechatRefundPayload> {
    const orderNo = payload.orderNo?.trim();
    const refundNo = payload.refundNo?.trim();

    if (!orderNo) {
      throw new AppError('WECHAT_ORDER_NO_MISSING', 'wechat order no missing');
    }

    if (!refundNo) {
      throw new AppError(
        'WECHAT_REFUND_NO_MISSING',
        'wechat refund no missing'
      );
    }

    this.ensureEnabled();
    const wxpay = this.getWxpayClient() as {
      v3: {
        refund: {
          domestic: {
            refunds: {
              post: (data: unknown) => Promise<{ data: WechatRefundPayload }>;
            };
          };
        };
      };
    };

    try {
      const { data } = await wxpay.v3.refund.domestic.refunds.post({
        out_trade_no: orderNo,
        out_refund_no: refundNo,
        reason: payload.reason,
        amount: {
          refund: payload.amount,
          total: payload.totalAmount,
          currency: 'CNY',
        },
      });

      return data ?? {};
    } catch (error) {
      const response = (error as WechatPayErrorResponse)?.response;

      throw new AppError(
        'WECHAT_REFUND_FAILED',
        response?.data?.message ||
          response?.statusText ||
          'failed to refund wechat order',
        response?.status && response.status >= 400 ? response.status : 502,
        response?.data ?? null
      );
    }
  }

  private getWxpayClient(): unknown {
    if (!this.wxpayClient) {
      this.wxpayClient = new Wechatpay({
        mchid: this.requireConfig('mchId'),
        serial: this.requireConfig('merchantSerialNo'),
        privateKey: this.requireConfig('merchantPrivateKey'),
        certs: {
          [this.requireConfig('publicKeyId')]: this.requireConfig('publicKey'),
        },
      });
    }

    return this.wxpayClient;
  }

  private ensureEnabled(): void {
    if (!this.wechatPayConfig?.enabled) {
      throw new AppError(
        'WECHAT_PAY_NOT_ENABLED',
        'wechat pay is not enabled',
        503
      );
    }
  }

  private requireConfig(key: keyof WechatPayConfig): string {
    const value = this.wechatPayConfig?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new AppError(
      'WECHAT_PAY_CONFIG_MISSING',
      `wechat pay config ${String(key)} is missing`,
      500
    );
  }
}
