import { createHash } from 'crypto';
import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { RedisService } from '@midwayjs/redis';
import { AppPreviewGrantEntity } from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { UserService } from './user.service';

@Provide()
export class AppPreviewGrantService {
  @InjectEntityModel(AppPreviewGrantEntity)
  grantModel: MongoRepository<AppPreviewGrantEntity>;

  @Inject()
  redisService: RedisService;

  @Inject()
  userService: UserService;

  @Logger()
  logger: ILogger;

  async redeem(code: string, clientIp: string) {
    if (!/^[A-Z2-9]{12}$/.test(code)) {
      throw new AppError('INVALID_PREVIEW_CODE', '授权码格式不正确', 400);
    }
    const rateKey = `app-preview-grant:redeem:${clientIp || 'unknown'}`;
    const attempts = await this.redisService.incr(rateKey);
    if (attempts === 1) await this.redisService.expire(rateKey, 3600);
    if (attempts > 20) {
      throw new AppError('PREVIEW_RATE_LIMIT', '尝试次数过多，请稍后再试', 429);
    }

    const codeHash = createHash('sha256').update(code).digest('hex');
    const grant = await this.grantModel.findOne({
      where: { codeHash } as never,
    });
    if (!grant) {
      throw new AppError('INVALID_PREVIEW_CODE', '授权码无效', 404);
    }
    const allowedUsers = (process.env.APP_PREVIEW_ALLOWED_USER_IDS ?? '')
      .split(',')
      .map(value => value.trim());
    if (!allowedUsers.includes(grant.targetUserId)) {
      throw new AppError('PREVIEW_DISABLED', '此账号未开放预览授权', 403);
    }
    const now = new Date();
    if (grant.expiresAt <= now) {
      throw new AppError('PREVIEW_CODE_EXPIRED', '授权码已过期', 410);
    }
    if (grant.state !== 'issued') {
      throw new AppError('PREVIEW_ALREADY_USED', '授权码已使用', 409);
    }
    const claimed = await this.grantModel.findOneAndUpdate(
      {
        _id: grant.id,
        codeHash,
        state: 'issued',
        expiresAt: { $gt: now },
      } as never,
      { $set: { state: 'redeemed', redeemedAt: now } },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      throw new AppError('PREVIEW_ALREADY_USED', '授权码已使用', 409);
    }
    const session = await this.userService.issueReadOnlyPreviewSession(
      grant.targetUserId
    );
    this.logger.warn(
      '[app-preview-grant] redeemed targetUser=%s admin=%s ip=%s',
      grant.targetUserId,
      grant.issuedByAdminId,
      clientIp || '-'
    );
    return session;
  }
}
