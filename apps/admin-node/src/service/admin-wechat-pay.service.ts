import { Config, Provide } from '@midwayjs/core';
import { AppError } from '@tzl/shared';
import { createHmac } from 'crypto';
import * as https from 'https';
import { Wechatpay } from 'wechatpay-axios-plugin';

interface WechatPayConfig {
  enabled?: boolean;
  mchId?: string;
  merchantSerialNo?: string;
  merchantPrivateKey?: string;
  publicKeyId?: string;
  publicKey?: string;
}

interface WechatMiniProgramConfig {
  appId?: string;
  appSecret?: string;
}

interface WechatVirtualPayConfig {
  enabled?: boolean;
  env?: number;
  sandboxAppKey?: string;
  productionAppKey?: string;
}

interface WechatAccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface WechatXPayResponse {
  errcode?: number;
  errmsg?: string;
}

export interface AdminWechatTransactionPayload {
  appid?: string;
  mchid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  trade_state_desc?: string;
  success_time?: string;
  payer?: {
    openid?: string;
  };
  amount?: {
    total?: number;
    payer_total?: number;
    currency?: string;
    payer_currency?: string;
  };
}

export interface AdminWechatVirtualOrderPayload {
  order_id?: string;
  create_time?: number;
  update_time?: number;
  status?: number;
  order_type?: number;
  order_fee?: number;
  paid_fee?: number;
  refund_fee?: number;
  paid_time?: number;
  provide_time?: number;
  biz_meta?: string;
  env_type?: number;
  left_fee?: number;
  wx_order_id?: string;
  channel_order_id?: string;
  wxpay_order_id?: string;
}

interface WechatVirtualOrderResponse extends WechatXPayResponse {
  order?: AdminWechatVirtualOrderPayload;
}

interface WechatVirtualRefundResponse extends WechatXPayResponse {
  refund_order_id?: string;
  refund_wx_order_id?: string;
  pay_order_id?: string;
  pay_wx_order_id?: string;
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

  @Config('wechatMiniProgram')
  wechatMiniProgramConfig: WechatMiniProgramConfig;

  @Config('wechatVirtualPay')
  wechatVirtualPayConfig: WechatVirtualPayConfig;

  private wxpayClient?: unknown;

  async queryTransactionByOrderNo(
    orderNo: string
  ): Promise<AdminWechatTransactionPayload | null> {
    const normalizedOrderNo = orderNo?.trim();

    if (!normalizedOrderNo) {
      throw new AppError('WECHAT_ORDER_NO_MISSING', 'wechat order no missing');
    }

    this.ensureEnabled();
    const mchId = this.requireConfig('mchId');
    const wxpay = this.getWxpayClient() as {
      v3: {
        pay: {
          transactions: {
            outTradeNo: {
              $out_trade_no$: {
                get: (config: {
                  params: { mchid: string };
                  out_trade_no: string;
                }) => Promise<{ data: AdminWechatTransactionPayload }>;
              };
            };
          };
        };
      };
    };

    try {
      const { data } =
        await wxpay.v3.pay.transactions.outTradeNo.$out_trade_no$.get({
          params: {
            mchid: mchId,
          },
          out_trade_no: normalizedOrderNo,
        });

      return data ?? null;
    } catch (error) {
      const response = (error as WechatPayErrorResponse)?.response;
      const code = response?.data?.code;

      if (response?.status === 404 || code === 'RESOURCE_NOT_EXISTS') {
        return null;
      }

      throw new AppError(
        'WECHAT_TRANSACTION_QUERY_FAILED',
        response?.data?.message ||
          response?.statusText ||
          'failed to query wechat transaction',
        response?.status && response.status >= 400 ? response.status : 502,
        response?.data ?? null
      );
    }
  }

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

  getVirtualPayEnv(): number {
    return this.wechatVirtualPayConfig?.env === 0 ? 0 : 1;
  }

  async refundVirtualOrder(payload: {
    openid: string;
    orderNo: string;
    refundNo: string;
    leftFee: number;
    refundFee: number;
    reason?: string;
    env: number;
  }): Promise<WechatVirtualRefundResponse> {
    const openid = payload.openid?.trim();
    const orderNo = payload.orderNo?.trim();
    const refundNo = payload.refundNo?.trim();

    if (!openid) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_OPENID_MISSING',
        'wechat virtual pay openid missing',
        500
      );
    }

    if (!orderNo) {
      throw new AppError('WECHAT_ORDER_NO_MISSING', 'wechat order no missing');
    }

    if (!refundNo) {
      throw new AppError(
        'WECHAT_REFUND_NO_MISSING',
        'wechat refund no missing'
      );
    }

    const body = JSON.stringify({
      openid,
      order_id: orderNo,
      refund_order_id: refundNo,
      left_fee: payload.leftFee,
      refund_fee: payload.refundFee,
      biz_meta: payload.reason || '',
      refund_reason: '3',
      req_from: '2',
      env: payload.env,
    });

    return this.postXPay<WechatVirtualRefundResponse>(
      '/xpay/refund_order',
      body,
      payload.env
    );
  }

  async queryVirtualOrder(payload: {
    openid: string;
    orderNo: string;
    env: number;
  }): Promise<AdminWechatVirtualOrderPayload | null> {
    const body = JSON.stringify({
      openid: payload.openid,
      env: payload.env,
      order_id: payload.orderNo,
    });
    let response: WechatVirtualOrderResponse;

    try {
      response = await this.postXPay<WechatVirtualOrderResponse>(
        '/xpay/query_order',
        body,
        payload.env
      );
    } catch (error) {
      if (this.isWechatVirtualPayDataNotExists(error)) {
        return null;
      }

      throw error;
    }

    return response.order ?? null;
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

  private ensureVirtualPayEnabled(): void {
    if (!this.wechatVirtualPayConfig?.enabled) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_NOT_ENABLED',
        'wechat virtual pay is not enabled',
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

  private requireMiniProgramConfig(key: keyof WechatMiniProgramConfig): string {
    const value = this.wechatMiniProgramConfig?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new AppError(
      'WECHAT_MINI_PROGRAM_CONFIG_MISSING',
      `wechat mini program config ${String(key)} is missing`,
      500
    );
  }

  private requireVirtualPayConfig(key: keyof WechatVirtualPayConfig): string {
    const value = this.wechatVirtualPayConfig?.[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    throw new AppError(
      'WECHAT_VIRTUAL_PAY_CONFIG_MISSING',
      `wechat virtual pay config ${String(key)} is missing`,
      500
    );
  }

  private requireVirtualPayAppKey(env: number): string {
    return env === 0
      ? this.requireVirtualPayConfig('productionAppKey')
      : this.requireVirtualPayConfig('sandboxAppKey');
  }

  private calcVirtualPaySig(uri: string, body: string, env: number): string {
    return createHmac('sha256', this.requireVirtualPayAppKey(env))
      .update(`${uri}&${body}`)
      .digest('hex');
  }

  private async postXPay<T extends WechatXPayResponse>(
    uri: string,
    body: string,
    env: number
  ): Promise<T> {
    this.ensureVirtualPayEnabled();
    const accessToken = await this.getMiniProgramAccessToken();
    const paySig = this.calcVirtualPaySig(uri, body, env);
    const response = await this.postJson<T>(
      `https://api.weixin.qq.com${uri}?access_token=${encodeURIComponent(
        accessToken
      )}&pay_sig=${encodeURIComponent(paySig)}`,
      body
    );

    if (response.errcode) {
      if (this.isIosVirtualRefundUnsupported(response)) {
        throw new AppError(
          'WECHAT_VIRTUAL_PAY_IOS_REFUND_UNSUPPORTED',
          'iOS 虚拟支付订单不支持管理端主动退款，请引导用户通过 Apple/App Store 申请退款。',
          400,
          response
        );
      }

      throw new AppError(
        'WECHAT_VIRTUAL_PAY_API_FAILED',
        response.errmsg || 'wechat virtual pay api failed',
        502,
        response
      );
    }

    return response;
  }

  private isIosVirtualRefundUnsupported(response: WechatXPayResponse): boolean {
    return /OS订单不支持开发者发起退款|iOS订单不支持开发者发起退款/i.test(
      response.errmsg ?? ''
    );
  }

  private isWechatVirtualPayDataNotExists(error: unknown): boolean {
    const response = error instanceof AppError ? error.data : null;
    const xpayResponse = response as WechatXPayResponse | null;

    return (
      error instanceof AppError &&
      error.code === 'WECHAT_VIRTUAL_PAY_API_FAILED' &&
      xpayResponse?.errcode === 268490002 &&
      /数据不存在/.test(xpayResponse.errmsg ?? '')
    );
  }

  private async getMiniProgramAccessToken(): Promise<string> {
    const appId = this.requireMiniProgramConfig('appId');
    const appSecret = this.requireMiniProgramConfig('appSecret');
    const params = new URLSearchParams({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
    });
    const response = await this.getJson<WechatAccessTokenResponse>(
      `https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`
    );

    if (response.errcode || !response.access_token) {
      throw new AppError(
        'WECHAT_ACCESS_TOKEN_FAILED',
        response.errmsg || 'failed to get wechat access token',
        502
      );
    }

    return response.access_token;
  }

  private getJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https
        .get(url, response => {
          const chunks: Buffer[] = [];

          response.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
            } catch (error) {
              reject(error);
            }
          });
        })
        .on('error', reject);
    });
  }

  private postJson<T>(url: string, body: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        response => {
          const chunks: Buffer[] = [];

          response.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }
}
