import { AppError } from '../common/errors';
import {
  getRemainingTokenTtlSeconds,
  getRevokedAccessTokenRedisKey,
} from '../common/auth-token';
import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { JwtService } from '@midwayjs/jwt';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'crypto';
import * as https from 'https';
import { MongoObjectId, UserAccountEntity, UserEntity } from '@tzl/entities';
import {
  AuthenticatedUserPayload,
  IUserOptions,
  LoginUserProfile,
  LogoutResult,
  PasswordLoginResult,
  SendSmsCodeResult,
} from '../interface';
import {
  PasswordLoginDTO,
  PhoneLoginDTO,
  SendSmsCodeDTO,
  UpdateUserAvatarDTO,
  UpdateUserNameDTO,
  WeappLoginDTO,
  WeappPhoneLoginDTO,
} from '../dto/user.dto';
import { MongoRepository } from 'typeorm';
import { PostImageService } from './post-image.service';
import { WechatPayService } from './wechat-pay.service';

interface JwtConfig {
  secret?: string;
  sign?: {
    expiresIn?: string | number;
  };
  verify?: Record<string, unknown>;
}

interface SmsConfig {
  cloopen?: {
    enabled?: boolean;
    appId?: string;
    accountSid?: string;
    authToken?: string;
    templateId?: string;
    codeExpiresInSeconds?: number;
    resendIntervalSeconds?: number;
  };
}

interface CloopenSmsResponse {
  statusCode?: string;
  statusMsg?: string;
  templateSMS?: {
    smsMessageSid?: string;
    dateCreated?: string;
  };
}

interface SmsCodeCacheValue {
  phone: string;
  purpose: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  providerMessageId?: string;
  providerDateCreated?: string;
}

const PHONE_LOGIN_PURPOSE = 'phone_login';
const WEAPP_ACCOUNT_PREFIX = 'weapp:';

interface VerifiedPhoneLoginOptions {
  weappOpenid?: string;
}

@Provide()
export class UserService {
  @Logger()
  logger: ILogger;

  @Config('jwt')
  jwtConfig: JwtConfig;

  @Config('sms')
  smsConfig: SmsConfig;

  @Inject()
  jwtService: JwtService;

  @Inject()
  redisService: RedisService;

  @Inject()
  postImageService: PostImageService;

  @Inject()
  wechatPayService: WechatPayService;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  async getUser(options: IUserOptions) {
    return {
      uid: options.uid,
      username: 'mockedName',
      nickname: '天之灵用户',
      phone: '12345678901',
      email: 'xxx.xxx@xxx.com',
      avatar: '',
    };
  }

  async sendPhoneLoginCode(
    payload: SendSmsCodeDTO
  ): Promise<SendSmsCodeResult> {
    const phone = this.normalizePhone(payload?.phone);
    const fixedCode = this.getFixedSmsCode();

    if (fixedCode) {
      this.logger.info(
        '[sms-code] fixed code enabled, skip sending, phone=%s',
        this.maskPhone(phone)
      );

      return {
        expiresInSeconds: this.getSmsCodeExpiresInSeconds(),
        resendAfterSeconds: 0,
        debugCode: fixedCode,
      };
    }

    const latestCode = await this.getSmsCodeCache(phone);
    const resendAfterSeconds = this.getSmsResendIntervalSeconds();

    this.logger.info(
      '[sms-code] send requested, phone=%s, purpose=%s',
      this.maskPhone(phone),
      PHONE_LOGIN_PURPOSE
    );

    if (latestCode) {
      const secondsSinceLastSend = Math.floor(
        (Date.now() - latestCode.createdAt) / 1000
      );

      if (secondsSinceLastSend < resendAfterSeconds) {
        throw new AppError(
          'SMS_CODE_SENT_TOO_FREQUENTLY',
          `please retry after ${
            resendAfterSeconds - secondsSinceLastSend
          } seconds`,
          429,
          {
            resendAfterSeconds: resendAfterSeconds - secondsSinceLastSend,
          }
        );
      }
    }

    const code = this.generateSmsCode();
    const response = await this.sendSmsCode(phone, code);
    const now = Date.now();
    const smsLoginCode: SmsCodeCacheValue = {
      phone,
      purpose: PHONE_LOGIN_PURPOSE,
      code,
      createdAt: now,
      expiresAt: now + this.getSmsCodeExpiresInSeconds() * 1000,
      providerMessageId: response.templateSMS?.smsMessageSid,
      providerDateCreated: response.templateSMS?.dateCreated,
    };

    await this.redisService.set(
      this.getSmsCodeRedisKey(phone),
      JSON.stringify(smsLoginCode),
      'EX',
      this.getSmsCodeExpiresInSeconds()
    );

    this.logger.info(
      '[sms-code] send success, phone=%s, providerMessageId=%s, expiresAt=%s',
      this.maskPhone(phone),
      smsLoginCode.providerMessageId || '-',
      new Date(smsLoginCode.expiresAt).toISOString()
    );

    const result: SendSmsCodeResult = {
      expiresInSeconds: this.getSmsCodeExpiresInSeconds(),
      resendAfterSeconds,
    };

    if (this.shouldExposeDebugSmsCode()) {
      result.debugCode = code;
    }

    return result;
  }

  private async sendSmsCode(
    phone: string,
    code: string
  ): Promise<CloopenSmsResponse> {
    if (this.shouldUseMockSms()) {
      this.logger.info(
        '[sms-code] mock send, phone=%s, code=%s',
        this.maskPhone(phone),
        code
      );

      return {
        statusCode: '000000',
        statusMsg: 'mock success',
        templateSMS: {
          smsMessageSid: `mock-${Date.now()}`,
          dateCreated: this.formatTimestamp(new Date()),
        },
      };
    }

    return this.sendSmsViaCloopen(phone, code);
  }

  private shouldUseMockSms(): boolean {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }

    const config = this.smsConfig?.cloopen;

    return (
      !config?.enabled ||
      !config.appId?.trim() ||
      !config.accountSid?.trim() ||
      !config.authToken?.trim()
    );
  }

  private shouldExposeDebugSmsCode(): boolean {
    return process.env.NODE_ENV !== 'production' && this.shouldUseMockSms();
  }

  async phoneLogin(payload: PhoneLoginDTO): Promise<PasswordLoginResult> {
    const phone = this.normalizePhone(payload?.phone);
    const code = this.normalizeSmsCode(payload?.code);
    const fixedCode = this.getFixedSmsCode();

    if (fixedCode && this.safeCompareText(fixedCode, code)) {
      this.logger.info(
        '[sms-code] fixed code login bypass, phone=%s',
        this.maskPhone(phone)
      );
      return this.loginWithVerifiedPhone(phone);
    }

    const verification = await this.getSmsCodeCache(phone);

    if (!verification) {
      throw new AppError(
        'SMS_CODE_NOT_FOUND',
        'please request a new sms code',
        400
      );
    }

    if (verification.expiresAt <= Date.now()) {
      throw new AppError('SMS_CODE_EXPIRED', 'sms code has expired', 400);
    }

    const expectedCode = this.sanitizeSmsCode(verification.code);

    if (!/^\d{6}$/.test(expectedCode)) {
      this.logger.warn(
        '[sms-code] invalid cached code detected, phone=%s',
        this.maskPhone(phone)
      );
      await this.redisService.del(this.getSmsCodeRedisKey(phone));
      throw new AppError(
        'SMS_CODE_NOT_FOUND',
        'please request a new sms code',
        400
      );
    }

    if (!this.safeCompareText(expectedCode, code)) {
      throw new AppError('INVALID_SMS_CODE', 'sms code is incorrect', 400);
    }

    await this.redisService.del(this.getSmsCodeRedisKey(phone));
    return this.loginWithVerifiedPhone(phone);
  }

  private async loginWithVerifiedPhone(
    phone: string,
    options: VerifiedPhoneLoginOptions = {}
  ): Promise<PasswordLoginResult> {
    const now = new Date();
    let isNewUser = false;
    let userAccount = await this.userAccountModel.findOne({
      where: {
        account: phone,
      },
    });
    let user: UserEntity | null = null;

    if (userAccount) {
      user = await this.findUserById(userAccount.userId);

      if (!user) {
        throw new AppError(
          'USER_NOT_FOUND',
          'user profile does not exist',
          404
        );
      }
    } else {
      user = await this.userModel.findOne({
        where: {
          phone,
        },
      });
    }

    if (!user) {
      user = new UserEntity();
      user.name = this.buildDefaultUserName(phone);
      user.avatar = '';
      user.phone = phone;
      user.phoneVerified = true;
      user.createdAt = now;
      user.updatedAt = now;
      user = await this.userModel.save(user);
      isNewUser = true;
    } else {
      user.phone = phone;
      user.phoneVerified = true;
      user.updatedAt = now;
      user = await this.userModel.save(user);
    }

    if (!userAccount) {
      userAccount = new UserAccountEntity();
      userAccount.userId = user.id;
      userAccount.account = phone;
      userAccount.password = '';
      userAccount.createdAt = now;
      userAccount.updatedAt = now;
      userAccount = await this.userAccountModel.save(userAccount);
    } else {
      userAccount.userId = user.id;
      userAccount.updatedAt = now;
      userAccount = await this.userAccountModel.save(userAccount);
    }

    if (options.weappOpenid) {
      await this.bindWeappOpenidToUser(user, options.weappOpenid, now);
    }

    return this.buildLoginResult(user, userAccount, isNewUser);
  }

  async passwordLogin(payload: PasswordLoginDTO): Promise<PasswordLoginResult> {
    const account = payload?.account?.trim();
    const password = payload?.password ?? '';

    if (!account || !password) {
      throw new AppError(
        'INVALID_LOGIN_PARAMS',
        'account and password are required'
      );
    }

    const userAccount = await this.userAccountModel.findOne({
      where: {
        account,
      },
    });

    if (!userAccount) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'account or password is incorrect',
        401
      );
    }

    if (!userAccount.password) {
      throw new AppError(
        'PASSWORD_NOT_SET',
        'password has not been set for this account',
        403
      );
    }

    const passwordMatched = this.verifyPassword(password, userAccount.password);

    if (!passwordMatched) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'account or password is incorrect',
        401
      );
    }

    const user = await this.userModel.findOne({
      where: {
        id: userAccount.userId,
      },
    });

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 404);
    }

    return this.buildLoginResult(user, userAccount, false);
  }

  async weappLogin(payload: WeappLoginDTO): Promise<PasswordLoginResult> {
    const jsCode = payload?.jsCode?.trim();

    if (!jsCode) {
      throw new AppError('INVALID_WECHAT_JS_CODE', 'jsCode is required');
    }

    const openid = await this.wechatPayService.getOpenidByJsCode(jsCode);
    const account = this.buildWeappAccount(openid);
    const now = new Date();
    let userAccount = await this.userAccountModel.findOne({
      where: {
        account,
      },
    });

    if (userAccount) {
      const user = await this.findUserById(userAccount.userId);

      if (!user) {
        throw new AppError(
          'USER_NOT_FOUND',
          'user profile does not exist',
          404
        );
      }

      if (!user.phone || !user.phoneVerified) {
        throw new AppError(
          'WEAPP_PHONE_BIND_REQUIRED',
          'wechat phone binding is required',
          428
        );
      }

      userAccount.updatedAt = now;
      userAccount = await this.userAccountModel.save(userAccount);

      return this.buildLoginResult(user, userAccount, false);
    }

    throw new AppError(
      'WEAPP_PHONE_BIND_REQUIRED',
      'wechat phone binding is required',
      428
    );
  }

  async weappPhoneLogin(
    payload: WeappPhoneLoginDTO
  ): Promise<PasswordLoginResult> {
    const jsCode = payload?.jsCode?.trim();
    const phoneCode = payload?.phoneCode?.trim();

    if (!jsCode) {
      throw new AppError('INVALID_WECHAT_JS_CODE', 'jsCode is required');
    }

    if (!phoneCode) {
      throw new AppError('INVALID_WECHAT_PHONE_CODE', 'phoneCode is required');
    }

    const [openid, rawPhone] = await Promise.all([
      this.wechatPayService.getOpenidByJsCode(jsCode),
      this.wechatPayService.getPhoneNumberByCode(phoneCode),
    ]);
    const phone = this.normalizePhone(rawPhone);

    return this.loginWithVerifiedPhone(phone, {
      weappOpenid: openid,
    });
  }

  private async bindWeappOpenidToUser(
    user: UserEntity,
    openid: string,
    now: Date
  ): Promise<UserAccountEntity> {
    const account = this.buildWeappAccount(openid);
    let userAccount = await this.userAccountModel.findOne({
      where: {
        account,
      },
    });

    if (userAccount) {
      if (!this.isSameObjectId(userAccount.userId, user.id)) {
        const boundUser = await this.findUserById(userAccount.userId);

        if (boundUser?.phone || boundUser?.phoneVerified) {
          throw new AppError(
            'WEAPP_OPENID_BOUND_TO_OTHER_USER',
            'wechat openid has been bound to another user',
            409
          );
        }

        userAccount.userId = user.id;
      }

      userAccount.updatedAt = now;
      return this.userAccountModel.save(userAccount);
    }

    userAccount = new UserAccountEntity();
    userAccount.userId = user.id;
    userAccount.account = account;
    userAccount.password = '';
    userAccount.createdAt = now;
    userAccount.updatedAt = now;

    return this.userAccountModel.save(userAccount);
  }

  async getCurrentUser(
    auth: AuthenticatedUserPayload
  ): Promise<LoginUserProfile> {
    const userId = this.parseObjectId(auth.sub);
    const user = await this.findUserById(userId);

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 404);
    }

    return this.buildUserProfile(user, auth.account);
  }

  async updateCurrentUserName(
    auth: AuthenticatedUserPayload,
    body: UpdateUserNameDTO
  ): Promise<LoginUserProfile> {
    const userId = this.parseObjectId(auth.sub);
    const name = this.normalizeUserName(body?.name);
    const user = await this.findUserById(userId);

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 404);
    }

    user.name = name;
    user.updatedAt = new Date();

    const savedUser = await this.userModel.save(user);

    return this.buildUserProfile(savedUser, auth.account);
  }

  async updateCurrentUserAvatar(
    auth: AuthenticatedUserPayload,
    body: UpdateUserAvatarDTO
  ): Promise<LoginUserProfile> {
    const userId = this.parseObjectId(auth.sub);
    const avatar = this.normalizeUserAvatar(body?.avatar);
    const user = await this.findUserById(userId);

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 404);
    }

    user.avatar = avatar;
    user.updatedAt = new Date();

    const savedUser = await this.userModel.save(user);

    return this.buildUserProfile(savedUser, auth.account);
  }

  async logoutCurrentUser(
    auth: AuthenticatedUserPayload
  ): Promise<LogoutResult> {
    const nonce = auth?.nonce?.trim();

    if (!nonce) {
      throw new AppError('INVALID_TOKEN', 'token nonce is missing', 401);
    }

    const ttlSeconds = getRemainingTokenTtlSeconds(auth.exp);

    if (ttlSeconds > 0) {
      await this.redisService.set(
        getRevokedAccessTokenRedisKey(nonce),
        JSON.stringify({
          account: auth.account,
          loggedOutAt: Date.now(),
        }),
        'EX',
        ttlSeconds
      );
    }

    this.logger.info(
      '[auth] user logout, account=%s, nonce=%s, ttlSeconds=%s',
      auth.account,
      nonce,
      ttlSeconds
    );

    return {
      loggedOutAt: Date.now(),
    };
  }

  private async getSmsCodeCache(
    phone: string
  ): Promise<SmsCodeCacheValue | undefined> {
    const rawValue = await this.redisService.get(
      this.getSmsCodeRedisKey(phone)
    );

    if (!rawValue) {
      return undefined;
    }

    try {
      return JSON.parse(rawValue) as SmsCodeCacheValue;
    } catch {
      this.logger.warn(
        '[sms-code] invalid redis cache detected, phone=%s',
        this.maskPhone(phone)
      );
      await this.redisService.del(this.getSmsCodeRedisKey(phone));
      return undefined;
    }
  }

  private async sendSmsViaCloopen(
    phone: string,
    code: string
  ): Promise<CloopenSmsResponse> {
    const config = this.getCloopenConfig();
    const validityText = this.formatSmsValidityText();
    const timestamp = this.formatTimestamp(new Date());
    const signature = createHash('md5')
      .update(`${config.accountSid}${config.authToken}${timestamp}`)
      .digest('hex')
      .toUpperCase();
    const authorization = Buffer.from(
      `${config.accountSid}:${timestamp}`
    ).toString('base64');
    const requestBody = JSON.stringify({
      to: phone,
      appId: config.appId,
      templateId: config.templateId,
      datas: [code, validityText],
    });

    this.logger.info(
      '[sms-code] request cloopen, phone=%s, templateId=%s, datas=%j',
      this.maskPhone(phone),
      config.templateId,
      [code, validityText]
    );

    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          protocol: 'https:',
          hostname: 'app.cloopen.com',
          port: 8883,
          method: 'POST',
          path:
            `/2013-12-26/Accounts/${config.accountSid}/SMS/TemplateSMS` +
            `?sig=${signature}`,
          headers: {
            Accept: 'application/json',
            Authorization: authorization,
            'Content-Type': 'application/json;charset=utf-8',
            'Content-Length': Buffer.byteLength(requestBody),
          },
        },
        response => {
          const chunks: Buffer[] = [];

          response.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on('end', () => {
            const responseText = Buffer.concat(chunks).toString('utf8');

            try {
              const parsed = JSON.parse(responseText) as CloopenSmsResponse;

              this.logger.info(
                '[sms-code] cloopen response, httpStatus=%s, statusCode=%s, statusMsg=%s, smsMessageSid=%s',
                response.statusCode || '-',
                parsed.statusCode || '-',
                parsed.statusMsg || '-',
                parsed.templateSMS?.smsMessageSid || '-'
              );

              if (response.statusCode !== 200) {
                reject(
                  new AppError(
                    'SMS_PROVIDER_REQUEST_FAILED',
                    parsed.statusMsg || 'sms provider request failed',
                    502,
                    parsed
                  )
                );
                return;
              }

              if (parsed.statusCode !== '000000') {
                reject(
                  new AppError(
                    'SMS_PROVIDER_SEND_FAILED',
                    parsed.statusMsg || 'sms provider send failed',
                    502,
                    parsed
                  )
                );
                return;
              }

              resolve(parsed);
            } catch {
              this.logger.error(
                '[sms-code] cloopen invalid response, body=%s',
                responseText
              );
              reject(
                new AppError(
                  'SMS_PROVIDER_INVALID_RESPONSE',
                  'sms provider response is invalid',
                  502,
                  responseText
                )
              );
            }
          });
        }
      );

      request.on('error', error => {
        this.logger.error(
          '[sms-code] cloopen network error, phone=%s, error=%s',
          this.maskPhone(phone),
          error.message || 'unknown'
        );
        reject(
          new AppError(
            'SMS_PROVIDER_NETWORK_ERROR',
            error.message || 'failed to request sms provider',
            502
          )
        );
      });

      request.write(requestBody);
      request.end();
    });
  }

  private buildLoginResult(
    user: UserEntity,
    userAccount: UserAccountEntity,
    isNewUser: boolean
  ): PasswordLoginResult {
    const profile = this.buildUserProfile(user, userAccount.account);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + this.getTokenExpiresInSeconds() * 1000;
    const accessToken = this.jwtService.signSync(
      {
        sub: profile.id,
        accountId: this.stringifyObjectId(userAccount.id),
        account: userAccount.account,
        nonce: randomBytes(8).toString('hex'),
      },
      this.getTokenSecret(),
      {
        expiresIn: this.getTokenExpiresInSeconds(),
      }
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt,
      isNewUser,
      user: profile,
    };
  }

  private buildUserProfile(
    user: UserEntity,
    account: string
  ): LoginUserProfile {
    return {
      id: this.stringifyObjectId(user.id),
      name: user.name,
      avatar: this.postImageService.resolveForResponse(user.avatar || ''),
      account,
      phone: user.phone || '',
      phoneVerified: Boolean(user.phoneVerified),
    };
  }

  private normalizeUserAvatar(rawAvatar?: string): string {
    const avatar = rawAvatar?.trim() ?? '';

    if (!avatar) {
      throw new AppError('INVALID_USER_AVATAR', 'user avatar is required', 400);
    }

    if (avatar.length > 1000) {
      throw new AppError(
        'INVALID_USER_AVATAR',
        'user avatar reference is too long',
        400
      );
    }

    return this.postImageService.normalizeForStorage(avatar);
  }

  private verifyPassword(
    plainPassword: string,
    storedPassword: string
  ): boolean {
    if (!storedPassword) {
      return false;
    }

    if (storedPassword.startsWith('scrypt$')) {
      const [, salt, expectedHash] = storedPassword.split('$');

      if (!salt || !expectedHash) {
        return false;
      }

      const derivedKey = scryptSync(plainPassword, salt, 64).toString('hex');
      return this.safeCompareText(derivedKey, expectedHash);
    }

    return this.safeCompareText(plainPassword, storedPassword);
  }

  private safeCompareText(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private async findUserById(
    userId: MongoObjectId
  ): Promise<UserEntity | null> {
    const userById = await this.userModel.findOne({
      where: {
        id: userId,
      },
    });

    if (userById) {
      return userById;
    }

    return this.userModel.findOne({
      where: {
        _id: userId,
      } as never,
    });
  }

  private normalizePhone(rawPhone?: string): string {
    const phone = rawPhone?.trim();

    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      throw new AppError(
        'INVALID_PHONE',
        'phone must be a valid mainland China mobile number'
      );
    }

    return phone;
  }

  private normalizeSmsCode(rawCode?: string): string {
    const code = this.sanitizeSmsCode(rawCode);

    if (!code) {
      throw new AppError('INVALID_SMS_CODE', 'sms code is required');
    }

    if (!/^\d{6}$/.test(code)) {
      throw new AppError('INVALID_SMS_CODE', 'sms code must be 6 digits');
    }

    return code;
  }

  private sanitizeSmsCode(rawCode?: string): string {
    if (!rawCode) {
      return '';
    }

    return rawCode
      .replace(/[０-９]/g, digit =>
        String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
      )
      .replace(/\D/g, '');
  }

  private parseObjectId(value: string): MongoObjectId {
    try {
      return new MongoObjectId(value);
    } catch {
      throw new AppError('INVALID_TOKEN', 'token subject is invalid', 401);
    }
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private getTokenSecret(): string {
    return this.jwtConfig?.secret?.trim() || '1774073039411_5782';
  }

  private getTokenExpiresInSeconds(): number {
    const value = this.jwtConfig?.sign?.expiresIn;

    if (typeof value === 'number' && value > 0) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    if (!value) {
      return 7 * 24 * 60 * 60;
    }

    return 7 * 24 * 60 * 60;
  }

  private getSmsCodeExpiresInSeconds(): number {
    const value = this.smsConfig?.cloopen?.codeExpiresInSeconds;

    if (!value || value <= 0) {
      return 300;
    }

    return value;
  }

  private getSmsResendIntervalSeconds(): number {
    const value = this.smsConfig?.cloopen?.resendIntervalSeconds;

    if (!value || value <= 0) {
      return 60;
    }

    return value;
  }

  private getFixedSmsCode(): string | undefined {
    if (process.env.NODE_ENV === 'production') {
      return undefined;
    }

    return '666666';
  }

  private getCloopenConfig() {
    const config = this.smsConfig?.cloopen;

    if (!config?.enabled) {
      throw new AppError(
        'SMS_NOT_ENABLED',
        'sms service is not enabled in current environment',
        503
      );
    }

    if (!config.appId || !config.accountSid || !config.authToken) {
      throw new AppError(
        'SMS_CONFIG_MISSING',
        'cloopen sms configuration is incomplete',
        500
      );
    }

    return {
      appId: config.appId,
      accountSid: config.accountSid,
      authToken: config.authToken,
      templateId: config.templateId || '1',
    };
  }

  private generateSmsCode(): string {
    return String(Math.floor(Math.random() * 900000) + 100000);
  }

  private buildDefaultUserName(phone: string): string {
    return `天之灵用户${phone.slice(-4)}`;
  }

  private buildWeappAccount(openid: string): string {
    return `${WEAPP_ACCOUNT_PREFIX}${openid}`;
  }

  private isSameObjectId(
    left: MongoObjectId | undefined,
    right: MongoObjectId | undefined
  ): boolean {
    if (!left || !right) {
      return false;
    }

    return this.stringifyObjectId(left) === this.stringifyObjectId(right);
  }

  private normalizeUserName(rawName?: string): string {
    const name = rawName?.trim();

    if (!name) {
      throw new AppError('INVALID_USER_NAME', 'name is required');
    }

    if (name.length > 20) {
      throw new AppError(
        'INVALID_USER_NAME',
        'name must be 20 characters or fewer'
      );
    }

    return name;
  }

  private getSmsCodeRedisKey(phone: string): string {
    return `sms:login:code:${phone}`;
  }

  private formatSmsValidityText(): string {
    const expiresInSeconds = this.getSmsCodeExpiresInSeconds();
    const minutes = Math.ceil(expiresInSeconds / 60);

    return `${minutes}分钟`;
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) {
      return phone;
    }

    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hour}${minute}${second}`;
  }
}
