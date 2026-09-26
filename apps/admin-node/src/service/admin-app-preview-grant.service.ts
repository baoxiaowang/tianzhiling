import { createHash, randomBytes } from 'crypto';
import { Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AppPreviewGrantEntity,
  MongoObjectId,
  UserEntity,
} from '@tzl/entities';
import { AdminAuthenticatedPayload, AppError } from '@tzl/shared';
import { MongoRepository } from 'typeorm';

const GRANT_TTL_MS = 3 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Provide()
export class AdminAppPreviewGrantService {
  @InjectEntityModel(AppPreviewGrantEntity)
  grantModel: MongoRepository<AppPreviewGrantEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @Logger()
  logger: ILogger;

  async issue(userId: string, admin: AdminAuthenticatedPayload) {
    this.assertAllowed(userId, admin);
    const user = await this.userModel.findOne({
      where: { id: new MongoObjectId(userId) },
    });
    if (!user) throw new AppError('USER_NOT_FOUND', '用户不存在', 404);

    const code = Array.from(randomBytes(12), byte => CODE_ALPHABET[byte & 31]).join('');
    const now = new Date();
    const grant = new AppPreviewGrantEntity();
    grant.codeHash = createHash('sha256').update(code).digest('hex');
    grant.targetUserId = userId;
    grant.state = 'issued';
    grant.createdAt = now;
    grant.expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
    grant.issuedByAdminId = admin.sub;
    await this.grantModel.save(grant);
    this.logger.warn(
      '[app-preview-grant] issued targetUser=%s admin=%s expiresAt=%s',
      userId,
      admin.sub,
      grant.expiresAt.toISOString()
    );
    return {
      code,
      expiresAt: grant.expiresAt.getTime(),
      targetUserId: userId,
      readOnly: true,
    };
  }

  private assertAllowed(userId: string, admin: AdminAuthenticatedPayload) {
    const allowedUsers = (process.env.APP_PREVIEW_ALLOWED_USER_IDS ?? '')
      .split(',')
      .map(value => value.trim());
    const allowedAdmins = (process.env.APP_PREVIEW_APPROVER_ADMIN_IDS ?? '')
      .split(',')
      .map(value => value.trim());
    if (
      !MongoObjectId.isValid(userId) ||
      !allowedUsers.includes(userId) ||
      !allowedAdmins.includes(admin.sub) ||
      !admin.roles?.includes('admin')
    ) {
      throw new AppError('PREVIEW_GRANT_FORBIDDEN', '无权为此账号生成预览授权码', 403);
    }
  }
}
