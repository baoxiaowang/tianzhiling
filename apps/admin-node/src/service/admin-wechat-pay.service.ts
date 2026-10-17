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

/** access_token 失效/过期类错误码：40001 无效、40014 不合法、42001 已过期 */
const INVALID_ACCESS_TOKEN_ERRCODES = new Set([40001, 40014, 42001]);

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
  /** 该订单在微信侧已创建的退款单列表；为空即表示微信从未创建退款 */
  refund_info?: { refund_order?: unknown[] };
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

interface WechatVirtualProvideGoodsResponse extends WechatXPayResponse {}

export interface WechatRefundPayload {
  refund_id?: string;
  /** 微信退款成功时间（RFC3339）；SUCCESS 时返回，用于按实际退款日归集 */
  success_time?: string;
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

  /** appId -> access_token 缓存（避免撞 cgi-bin/token 每日 2000 次配额） */
  private readonly accessTokenCache = new Map<
    string,
    { token: string; expiresAt: number }
  >();
  private accessTokenInFlight: Promise<string> | null = null;

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

  async queryRefundByRefundNo(
    refundNo: string
  ): Promise<WechatRefundPayload | null> {
    const normalizedRefundNo = refundNo?.trim();

    if (!normalizedRefundNo) {
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
              $out_refund_no$: {
                get: (config: {
                  out_refund_no: string;
                }) => Promise<{ data: WechatRefundPayload }>;
              };
            };
          };
        };
      };
    };

    try {
      const { data } =
        await wxpay.v3.refund.domestic.refunds.$out_refund_no$.get({
          out_refund_no: normalizedRefundNo,
        });

      return data ?? null;
    } catch (error) {
      const response = (error as WechatPayErrorResponse)?.response;
      const code = response?.data?.code;

      if (response?.status === 404 || code === 'RESOURCE_NOT_EXISTS') {
        return null;
      }

      throw new AppError(
        'WECHAT_REFUND_QUERY_FAILED',
        response?.data?.message ||
          response?.statusText ||
          'failed to query wechat refund',
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
      req_from: '1',
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

  async notifyVirtualGoodsProvided(payload: {
    orderNo?: string;
    wxOrderId?: string;
    env: number;
  }): Promise<WechatVirtualProvideGoodsResponse> {
    const orderNo = payload.orderNo?.trim();
    const wxOrderId = payload.wxOrderId?.trim();

    if (!orderNo && !wxOrderId) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_ORDER_NO_MISSING',
        'wechat virtual pay order no missing',
        400
      );
    }

    const body = JSON.stringify({
      ...(orderNo ? { order_id: orderNo } : { wx_order_id: wxOrderId }),
      env: payload.env,
    });

    return this.postXPay<WechatVirtualProvideGoodsResponse>(
      '/xpay/notify_provide_goods',
      body,
      payload.env
    );
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
      // 令牌失效/过期：清缓存后重试一次，避免缓存中的旧令牌导致一连串失败
      if (INVALID_ACCESS_TOKEN_ERRCODES.has(response.errcode)) {
        this.invalidateAccessToken();
        const fresh = await this.getMiniProgramAccessToken(true);
        const retried = await this.postJson<T>(
          `https://api.weixin.qq.com${uri}?access_token=${encodeURIComponent(
            fresh
          )}&pay_sig=${encodeURIComponent(paySig)}`,
          body
        );
        if (!retried.errcode) return retried;
        response.errcode = retried.errcode;
        response.errmsg = retried.errmsg;
      }
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

  /**
   * 小程序 access_token：**必须缓存**。
   *
   * 以前每次支付/退款都直接调 `cgi-bin/token`，而该接口每天只有 2000 次配额；
   * 退款对账任务每分钟扫几十笔，很快就把配额打满，之后所有虚拟支付退款都会以
   * `errcode 45009 reach max api daily quota limit` 失败（2026-10-17 用户退款失败即此原因）。
   *
   * 现在：
   *   1. 优先用微信推荐的 `cgi-bin/stable_token`（配额更大，短期内返回同一个 token）；
   *   2. 令牌缓存在进程内，按 `expires_in` 提前 120 秒过期，并对并发请求做单飞合并；
   *   3. 拿不到时回退旧的 `cgi-bin/token`，两者都失败才抛错。
   */
  private async getMiniProgramAccessToken(
    forceRefresh = false
  ): Promise<string> {
    const appId = this.requireMiniProgramConfig('appId');
    const cached = this.accessTokenCache.get(appId);

    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    if (!forceRefresh && this.accessTokenInFlight) {
      return this.accessTokenInFlight;
    }

    const task = this.fetchMiniProgramAccessToken(appId)
      .then(token => {
        this.cacheAccessToken(appId, token.token, token.expiresIn);
        return token.token;
      })
      .finally(() => {
        this.accessTokenInFlight = null;
      });

    this.accessTokenInFlight = task;
    return task;
  }

  /** 令牌失效（40001/40014/42001）时清缓存，下次重新拉取 */
  private invalidateAccessToken() {
    this.accessTokenCache.clear();
  }

  private cacheAccessToken(appId: string, token: string, expiresIn?: number) {
    // 提前 120 秒过期，避免用到临界过期的令牌
    const ttlMs = Math.max(60, (expiresIn ?? 7200) - 120) * 1000;
    this.accessTokenCache.set(appId, {
      token,
      expiresAt: Date.now() + ttlMs,
    });
  }

  private async fetchMiniProgramAccessToken(
    appId: string
  ): Promise<{ token: string; expiresIn?: number }> {
    const appSecret = this.requireMiniProgramConfig('appSecret');
    let lastError: WechatAccessTokenResponse | null = null;

    // 1) stable_token：官方推荐，配额远大于 cgi-bin/token
    try {
      const response = await this.postJson<WechatAccessTokenResponse>(
        'https://api.weixin.qq.com/cgi-bin/stable_token',
        JSON.stringify({
          grant_type: 'client_credential',
          appid: appId,
          secret: appSecret,
          force_refresh: false,
        })
      );
      if (!response.errcode && response.access_token) {
        return { token: response.access_token, expiresIn: response.expires_in };
      }
      lastError = response;
    } catch (error) {
      // 网络异常时继续走兜底接口
    }

    // 2) 兜底：cgi-bin/token（每日配额有限）
    const params = new URLSearchParams({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
    });
    const response = await this.getJson<WechatAccessTokenResponse>(
      `https://api.weixin.qq.com/cgi-bin/token?${params.toString()}`
    );

    if (!response.errcode && response.access_token) {
      return { token: response.access_token, expiresIn: response.expires_in };
    }

    const failure = response.errcode ? response : lastError || response;
    throw new AppError(
      'WECHAT_ACCESS_TOKEN_FAILED',
      failure.errmsg || 'failed to get wechat access token',
      502
    );
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
