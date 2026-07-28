import { AppError } from '../common/errors';
import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { createDecipheriv, createHmac } from 'crypto';
import * as https from 'https';
import { Formatter, Rsa, Wechatpay } from 'wechatpay-axios-plugin';

interface WechatPayConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  mchId?: string;
  merchantSerialNo?: string;
  merchantPrivateKey?: string;
  publicKeyId?: string;
  publicKey?: string;
  apiV3Key?: string;
  notifyUrl?: string;
}

interface WechatMiniProgramConfig {
  appId?: string;
  appSecret?: string;
}

interface WechatVirtualPayConfig {
  enabled?: boolean;
  offerId?: string;
  env?: number;
  sandboxAppKey?: string;
  productionAppKey?: string;
}

interface WechatSessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
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

export interface WechatMsgSecCheckResponse {
  errcode?: number;
  errmsg?: string;
  result?: {
    suggest?: string;
    label?: number;
  };
  detail?: unknown[];
  trace_id?: string;
}

export interface WechatSessionPayload {
  openid: string;
  sessionKey: string;
}

export interface WechatMessageContentSafetyResult {
  isSafe: boolean;
  suggest: string;
  label?: number;
  response: WechatMsgSecCheckResponse;
}

export interface WechatVirtualPaymentParams {
  mode: 'short_series_goods';
  signData: string;
  paySig: string;
  signature: string;
}

export interface WechatVirtualOrderPayload {
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

export interface WechatVirtualOrderResponse extends WechatXPayResponse {
  order?: WechatVirtualOrderPayload;
}

export interface WechatVirtualRefundResponse extends WechatXPayResponse {
  refund_order_id?: string;
  refund_wx_order_id?: string;
  pay_order_id?: string;
  pay_wx_order_id?: string;
}

export type WechatVirtualProvideGoodsResponse = WechatXPayResponse;

interface WechatPhoneNumberResponse {
  errcode?: number;
  errmsg?: string;
  phone_info?: {
    phoneNumber?: string;
    purePhoneNumber?: string;
    countryCode?: string;
  };
}

interface JsapiPrepayResponse {
  prepay_id: string;
}

export interface WechatPaymentParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

export interface WechatTransactionPayload {
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

export interface WechatRefundPayload {
  refund_id?: string;
  out_refund_no?: string;
  transaction_id?: string;
  out_trade_no?: string;
  channel?: string;
  user_received_account?: string;
  success_time?: string;
  create_time?: string;
  status?: string;
  amount?: {
    total?: number;
    refund?: number;
    payer_total?: number;
    payer_refund?: number;
    settlement_refund?: number;
    settlement_total?: number;
    discount_refund?: number;
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

const WECHAT_ACCESS_TOKEN_REDIS_KEY = 'wechat:mini-program:access-token';
const WECHAT_ACCESS_TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001]);

@Provide()
export class WechatPayService {
  @Logger()
  logger: ILogger;

  @Config('wechatPay')
  wechatPayConfig: WechatPayConfig;

  @Config('wechatMiniProgram')
  wechatMiniProgramConfig: WechatMiniProgramConfig;

  @Config('wechatVirtualPay')
  wechatVirtualPayConfig: WechatVirtualPayConfig;

  @Inject()
  redisService: RedisService;

  private wxpayClient?: unknown;

  private async exchangeJsCode(jsCode: string): Promise<WechatSessionResponse> {
    const code = jsCode?.trim();
    const appId = this.requireMiniProgramConfig('appId');
    const appSecret = this.requireMiniProgramConfig('appSecret');

    if (!code) {
      throw new AppError('INVALID_WECHAT_JS_CODE', 'jsCode is required');
    }

    const params = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });
    const response = await this.getJson<WechatSessionResponse>(
      `https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`
    );

    if (response.errcode) {
      throw new AppError(
        'WECHAT_CODE_SESSION_FAILED',
        response.errmsg || 'failed to exchange wechat session'
      );
    }

    return response;
  }

  async getOpenidByJsCode(jsCode: string): Promise<string> {
    const response = await this.exchangeJsCode(jsCode);

    if (!response.openid) {
      throw new AppError('WECHAT_OPENID_MISSING', 'wechat openid is missing');
    }

    return response.openid;
  }

  async getSessionByJsCode(jsCode: string): Promise<WechatSessionPayload> {
    const response = await this.exchangeJsCode(jsCode);

    if (!response.openid) {
      throw new AppError('WECHAT_OPENID_MISSING', 'wechat openid is missing');
    }

    if (!response.session_key) {
      throw new AppError(
        'WECHAT_SESSION_KEY_MISSING',
        'wechat session key is missing'
      );
    }

    return {
      openid: response.openid,
      sessionKey: response.session_key,
    };
  }

  async getPhoneNumberByCode(phoneCode: string): Promise<string> {
    const code = phoneCode?.trim();

    if (!code) {
      throw new AppError('INVALID_WECHAT_PHONE_CODE', 'phoneCode is required');
    }

    const response =
      await this.postMiniProgramJsonWithAccessToken<WechatPhoneNumberResponse>(
        '/wxa/business/getuserphonenumber',
        {
          code,
        }
      );

    if (response.errcode) {
      throw new AppError(
        'WECHAT_PHONE_NUMBER_FAILED',
        response.errmsg || 'failed to get wechat phone number',
        502
      );
    }

    const phoneInfo = response.phone_info;
    const countryCode = phoneInfo?.countryCode?.trim();
    const phoneNumber = (
      phoneInfo?.purePhoneNumber ||
      phoneInfo?.phoneNumber ||
      ''
    ).trim();

    if (!phoneNumber) {
      throw new AppError(
        'WECHAT_PHONE_NUMBER_MISSING',
        'wechat phone number is missing',
        502
      );
    }

    if (countryCode && countryCode !== '86') {
      throw new AppError(
        'WECHAT_PHONE_COUNTRY_UNSUPPORTED',
        'only mainland China mobile phone number is supported',
        400
      );
    }

    return phoneNumber;
  }

  async checkMessageContentSafety(payload: {
    openid: string;
    content: string;
    scene?: 1 | 2 | 3 | 4;
  }): Promise<WechatMessageContentSafetyResult> {
    const openid = payload?.openid?.trim();
    const content = payload?.content?.trim();

    if (!openid) {
      throw new AppError(
        'WECHAT_MSG_SEC_CHECK_OPENID_MISSING',
        'wechat msg sec check openid is missing',
        400
      );
    }

    if (!content) {
      throw new AppError(
        'WECHAT_MSG_SEC_CHECK_CONTENT_MISSING',
        'wechat msg sec check content is missing',
        400
      );
    }

    const response =
      await this.postMiniProgramJsonWithAccessToken<WechatMsgSecCheckResponse>(
        '/wxa/msg_sec_check',
        {
          version: 2,
          openid,
          scene: payload.scene ?? 2,
          content,
        }
      );

    if (response.errcode) {
      throw new AppError(
        'WECHAT_MSG_SEC_CHECK_FAILED',
        response.errmsg || 'wechat msg sec check failed',
        502,
        response
      );
    }

    const suggest = response.result?.suggest?.trim() || '';

    return {
      isSafe: suggest === 'pass',
      suggest,
      label: response.result?.label,
      response,
    };
  }

  async createVipPlanPrepay(payload: {
    orderNo: string;
    title: string;
    amount: number;
    openid: string;
    expireAt: Date;
  }): Promise<{
    prepayId: string;
    payment: WechatPaymentParams;
  }> {
    this.ensureEnabled();
    const appId = this.requireConfig('appId');
    const mchId = this.requireConfig('mchId');
    const notifyUrl = this.requireConfig('notifyUrl');
    const wxpay = this.getWxpayClient() as {
      v3: {
        pay: {
          transactions: {
            jsapi: {
              post: (data: unknown) => Promise<{ data: JsapiPrepayResponse }>;
            };
          };
        };
      };
    };
    const { data } = await wxpay.v3.pay.transactions.jsapi.post({
      appid: appId,
      mchid: mchId,
      description: payload.title,
      out_trade_no: payload.orderNo,
      time_expire: this.formatWechatDateTime(payload.expireAt),
      notify_url: notifyUrl,
      amount: {
        total: payload.amount,
        currency: 'CNY',
      },
      payer: {
        openid: payload.openid,
      },
    });

    if (!data?.prepay_id) {
      throw new AppError('WECHAT_PREPAY_FAILED', 'wechat prepay id is missing');
    }

    return {
      prepayId: data.prepay_id,
      payment: this.buildPaymentParams(data.prepay_id),
    };
  }

  async queryTransactionByOrderNo(
    orderNo: string
  ): Promise<WechatTransactionPayload | null> {
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
                }) => Promise<{ data: WechatTransactionPayload }>;
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

  buildVirtualPaymentParams(payload: {
    sessionKey: string;
    productId: string;
    orderNo: string;
    amount: number;
    attach: string;
  }): WechatVirtualPaymentParams {
    this.ensureVirtualPayEnabled();
    const env = this.getVirtualPayEnv();
    const signData = JSON.stringify({
      offerId: this.requireVirtualPayConfig('offerId'),
      buyQuantity: 1,
      env,
      currencyType: 'CNY',
      productId: payload.productId,
      goodsPrice: payload.amount,
      outTradeNo: payload.orderNo,
      attach: payload.attach,
      mode: 'short_series_goods',
    });

    return {
      mode: 'short_series_goods',
      signData,
      paySig: this.calcVirtualPaySig('requestVirtualPayment', signData, env),
      signature: this.calcSignature(signData, payload.sessionKey),
    };
  }

  getVirtualPayEnv(): number {
    return this.wechatVirtualPayConfig?.env === 0 ? 0 : 1;
  }

  async queryVirtualOrder(payload: {
    openid: string;
    orderNo: string;
    env: number;
  }): Promise<WechatVirtualOrderPayload | null> {
    const body = this.stringifyXPayBody({
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

    const body = this.stringifyXPayBody({
      ...(orderNo ? { order_id: orderNo } : { wx_order_id: wxOrderId }),
      env: payload.env,
    });

    return this.postXPay<WechatVirtualProvideGoodsResponse>(
      '/xpay/notify_provide_goods',
      body,
      payload.env
    );
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
    const body = this.stringifyXPayBody({
      openid: payload.openid,
      order_id: payload.orderNo,
      refund_order_id: payload.refundNo,
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

  verifyNotifySignature(rawBody: string, headers: Record<string, string>) {
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    const serial = headers['wechatpay-serial'];

    if (!timestamp || !nonce || !signature || !serial) {
      throw new AppError(
        'WECHAT_NOTIFY_SIGNATURE_MISSING',
        'wechat notify signature headers are incomplete',
        400
      );
    }

    if (serial !== this.requireConfig('publicKeyId')) {
      throw new AppError(
        'WECHAT_NOTIFY_SERIAL_MISMATCH',
        'wechat pay public key id mismatch',
        400
      );
    }

    const message = Formatter.joinedByLineFeed(timestamp, nonce, rawBody);
    const verified = Rsa.verify(
      message,
      signature,
      this.requireConfig('publicKey')
    );

    if (!verified) {
      throw new AppError(
        'WECHAT_NOTIFY_SIGNATURE_INVALID',
        'wechat notify signature is invalid',
        400
      );
    }
  }

  decryptNotifyResource(body: unknown): WechatTransactionPayload {
    const raw = body as {
      resource?: {
        algorithm?: string;
        ciphertext?: string;
        associated_data?: string;
        nonce?: string;
      };
    };
    const resource = raw?.resource;

    if (
      resource?.algorithm !== 'AEAD_AES_256_GCM' ||
      !resource.ciphertext ||
      !resource.nonce
    ) {
      throw new AppError(
        'WECHAT_NOTIFY_RESOURCE_INVALID',
        'wechat notify resource is invalid',
        400
      );
    }

    const decrypted = this.decryptAes256Gcm({
      ciphertext: resource.ciphertext,
      nonce: resource.nonce,
      associatedData: resource.associated_data ?? '',
    });

    return JSON.parse(decrypted) as WechatTransactionPayload;
  }

  private buildPaymentParams(prepayId: string): WechatPaymentParams {
    const appId = this.requireConfig('appId');
    const timeStamp = `${Formatter.timestamp()}`;
    const nonceStr = Formatter.nonce();
    const packageValue = `prepay_id=${prepayId}`;
    const paySign = Rsa.sign(
      Formatter.joinedByLineFeed(appId, timeStamp, nonceStr, packageValue),
      this.requireConfig('merchantPrivateKey')
    );

    return {
      timeStamp,
      nonceStr,
      package: packageValue,
      signType: 'RSA',
      paySign,
    };
  }

  private formatWechatDateTime(value: Date): string {
    return value.toISOString().replace(/\.\d{3}Z$/, '+00:00');
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

  private decryptAes256Gcm(options: {
    ciphertext: string;
    nonce: string;
    associatedData: string;
  }): string {
    const ciphertext = Buffer.from(options.ciphertext, 'base64');
    const authTag = ciphertext.slice(ciphertext.length - 16);
    const encrypted = ciphertext.slice(0, ciphertext.length - 16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.requireConfig('apiV3Key'),
      options.nonce
    );

    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(options.associatedData));

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
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

  private calcSignature(body: string, sessionKey: string): string {
    return createHmac('sha256', sessionKey).update(body).digest('hex');
  }

  private stringifyXPayBody(body: Record<string, unknown>): string {
    return JSON.stringify(body);
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

  private async postXPay<T extends WechatXPayResponse>(
    uri: string,
    body: string,
    env: number
  ): Promise<T> {
    this.ensureVirtualPayEnabled();
    const paySig = this.calcVirtualPaySig(uri, body, env);
    const response = await this.postMiniProgramJsonWithAccessToken<T>(
      uri,
      body,
      {
        pay_sig: paySig,
      }
    );

    if (response.errcode) {
      throw new AppError(
        'WECHAT_VIRTUAL_PAY_API_FAILED',
        response.errmsg || 'wechat virtual pay api failed',
        502,
        response
      );
    }

    return response;
  }

  private async postMiniProgramJsonWithAccessToken<
    T extends { errcode?: number; errmsg?: string }
  >(
    uri: string,
    body: Record<string, unknown> | string,
    extraQuery: Record<string, string> = {}
  ): Promise<T> {
    const accessToken = await this.getMiniProgramAccessToken();
    const response = await this.postJson<T>(
      this.buildMiniProgramApiUrl(uri, accessToken, extraQuery),
      body
    );

    if (!this.isAccessTokenInvalidResponse(response)) {
      return response;
    }

    this.logger?.warn?.(
      '[wechat-mini-program] access_token invalid, refreshing and retrying, errcode=%s, errmsg=%s',
      response.errcode,
      response.errmsg || '-'
    );

    const refreshedAccessToken = await this.getMiniProgramAccessToken({
      forceRefresh: true,
    });

    return this.postJson<T>(
      this.buildMiniProgramApiUrl(uri, refreshedAccessToken, extraQuery),
      body
    );
  }

  private buildMiniProgramApiUrl(
    uri: string,
    accessToken: string,
    extraQuery: Record<string, string> = {}
  ): string {
    const params = new URLSearchParams({
      access_token: accessToken,
      ...extraQuery,
    });

    return `https://api.weixin.qq.com${uri}?${params.toString()}`;
  }

  private isAccessTokenInvalidResponse(response: {
    errcode?: number;
  }): boolean {
    return WECHAT_ACCESS_TOKEN_INVALID_ERRCODES.has(Number(response?.errcode));
  }

  private async getMiniProgramAccessToken(
    options: { forceRefresh?: boolean } = {}
  ): Promise<string> {
    if (!options.forceRefresh) {
      const cachedToken = await this.redisService.get(
        WECHAT_ACCESS_TOKEN_REDIS_KEY
      );

      if (cachedToken) {
        return cachedToken;
      }
    } else {
      await this.redisService.del(WECHAT_ACCESS_TOKEN_REDIS_KEY);
    }

    const appId = this.requireMiniProgramConfig('appId');
    const appSecret = this.requireMiniProgramConfig('appSecret');
    const response = await this.postJson<WechatAccessTokenResponse>(
      'https://api.weixin.qq.com/cgi-bin/stable_token',
      {
        grant_type: 'client_credential',
        appid: appId,
        secret: appSecret,
        force_refresh: options.forceRefresh === true,
      }
    );

    if (response.errcode || !response.access_token) {
      throw new AppError(
        'WECHAT_ACCESS_TOKEN_FAILED',
        response.errmsg || 'failed to get wechat access token',
        502,
        response
      );
    }

    const expiresInSeconds = Math.max(
      Math.min(response.expires_in || 7200, 7200) - 300,
      60
    );

    await this.redisService.set(
      WECHAT_ACCESS_TOKEN_REDIS_KEY,
      response.access_token,
      'EX',
      expiresInSeconds
    );

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

  private postJson<T>(
    url: string,
    body: Record<string, unknown> | string
  ): Promise<T> {
    const requestBody = typeof body === 'string' ? body : JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
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
      request.write(requestBody);
      request.end();
    });
  }
}
