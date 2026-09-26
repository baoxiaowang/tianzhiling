import { createHash } from 'crypto';
import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { RedisService } from '@midwayjs/redis';
import { AppTestGrantEntity } from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { UserService } from './user.service';

@Provide()
export class AppTestGrantService {
  @InjectEntityModel(AppTestGrantEntity)
  grantModel: MongoRepository<AppTestGrantEntity>;

  @Inject()
  redisService: RedisService;

  @Inject()
  userService: UserService;

  @Logger()
  logger: ILogger;

  async redeem(code: string, clientIp: string) {
    if (!/^[A-Z2-9]{12}$/.test(code)) {
      throw new AppError('INVALID_TEST_CODE', '授权码格式不正确', 400);
    }
    const rateKey = `app-test-grant:redeem:${clientIp || 'unknown'}`;
    const attempts = await this.redisService.incr(rateKey);
    if (attempts === 1) await this.redisService.expire(rateKey, 3600);
    if (attempts > 10) {
      throw new AppError('TEST_RATE_LIMIT', '尝试次数过多，请稍后再试', 429);
    }

    const codeHash = createHash('sha256').update(code).digest('hex');
    const grant = await this.grantModel.findOne({
      where: { codeHash } as never,
    });
    if (!grant) {
      throw new AppError('INVALID_TEST_CODE', '授权码无效', 404);
    }
    const now = new Date();
    if (grant.expiresAt <= now) {
      throw new AppError('TEST_CODE_EXPIRED', '授权码已过期', 410);
    }
    if (grant.state !== 'issued') {
      throw new AppError('TEST_ALREADY_USED', '授权码已使用或已撤销', 409);
    }
    const claimed = await this.grantModel.findOneAndUpdate(
      {
        _id: grant.id,
        codeHash,
        state: 'issued',
        expiresAt: { $gt: now },
      } as never,
      {
        $set: {
          state: 'redeemed',
          redeemedAt: now,
          redeemedIp: clientIp || '',
        },
      },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      throw new AppError('TEST_ALREADY_USED', '授权码已使用或已撤销', 409);
    }
    const session = await this.userService.issueTestSession(grant.targetUserId);
    this.logger.warn(
      '[app-test-grant] redeemed targetUser=%s admin=%s ip=%s',
      grant.targetUserId,
      grant.issuedByAdminId,
      clientIp || '-'
    );
    return session;
  }
}
