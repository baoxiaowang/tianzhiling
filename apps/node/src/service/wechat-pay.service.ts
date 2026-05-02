import { AppError } from '../common/errors';
import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { createDecipheriv } from 'crypto';
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

@Provide()
export class WechatPayService {
  @Logger()
  logger: ILogger;

  @Config('wechatPay')
  wechatPayConfig: WechatPayConfig;

  @Config('wechatMiniProgram')
  wechatMiniProgramConfig: WechatMiniProgramConfig;

  @Inject()
  redisService: RedisService;

  private wxpayClient?: unknown;

  async getOpenidByJsCode(jsCode: string): Promise<string> {
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

    if (!response.openid) {
      throw new AppError('WECHAT_OPENID_MISSING', 'wechat openid is missing');
    }

    return response.openid;
  }

  async getPhoneNumberByCode(phoneCode: string): Promise<string> {
    const code = phoneCode?.trim();

    if (!code) {
      throw new AppError(
        'INVALID_WECHAT_PHONE_CODE',
        'phoneCode is required'
      );
    }

    const accessToken = await this.getMiniProgramAccessToken();
    const response = await this.postJson<WechatPhoneNumberResponse>(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
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

  private requireMiniProgramConfig(
    key: keyof WechatMiniProgramConfig
  ): string {
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

  private async getMiniProgramAccessToken(): Promise<string> {
    const cachedToken = await this.redisService.get(
      WECHAT_ACCESS_TOKEN_REDIS_KEY
    );

    if (cachedToken) {
      return cachedToken;
    }

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

  private postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const requestBody = JSON.stringify(body);

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
