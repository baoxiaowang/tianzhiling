import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AppError } from '../common/errors';
import {
  SiteMessageEntity,
  SiteMessageStatus,
} from '../entity/site-message.entity';

const MINUTE_WINDOW_SECONDS = 60;
const DAY_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_MESSAGES_PER_MINUTE = 2;
const MAX_MESSAGES_PER_DAY = 10;
const MODERATION_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MODERATION_LOGIN_WINDOW_SECONDS = 10 * 60;
const MODERATION_LOGIN_MAX_ATTEMPTS = 5;
const MAX_AUTHOR_NAME_LENGTH = 20;
const MAX_CONTENT_LENGTH = 800;
const MIN_CONTENT_LENGTH = 5;
const MAX_CONTACT_LENGTH = 120;

export interface PublicSiteMessage {
  id: string;
  authorName: string;
  content: string;
  adminReply: string;
  adminReplyAt: string | null;
  publishedAt: string | null;
}

export interface ModeratedSiteMessage extends PublicSiteMessage {
  contact: string;
  status: SiteMessageStatus;
  moderationReason: string;
  ipHash: string;
  userAgent: string;
  createdAt: string;
}

export interface SiteMessagePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateSiteMessageInput {
  authorName?: string;
  content?: string;
  contact?: string;
  agreementAccepted?: boolean;
  website?: string;
}

export interface SiteMessageRequestContext {
  ip: string;
  userAgent: string;
}

@Provide()
export class SiteMessageService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(SiteMessageEntity)
  messageModel: MongoRepository<SiteMessageEntity>;

  @Inject()
  redisService: RedisService;

  async listPublished(pageInput?: string, pageSizeInput?: string): Promise<SiteMessagePage<PublicSiteMessage>> {
    const page = this.normalizePositiveInteger(pageInput, 1);
    const pageSize = this.normalizePositiveInteger(pageSizeInput, 10, 20);
    const [rows, total] = await this.messageModel.findAndCount({
      where: { status: SiteMessageStatus.published },
      order: { publishedAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: rows.map(row => this.toPublicItem(row)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async create(
    input: CreateSiteMessageInput,
    context: SiteMessageRequestContext
  ): Promise<{ id: string; status: SiteMessageStatus }> {
    if (String(input?.website || '').trim()) {
      throw new AppError('INVALID_MESSAGE', 'invalid message', 400);
    }

    const content = String(input?.content || '').trim();
    const authorName = String(input?.authorName || '').trim() || '匿名';
    const contact = String(input?.contact || '').trim();

    if (content.length < MIN_CONTENT_LENGTH || content.length > MAX_CONTENT_LENGTH) {
      throw new AppError(
        'INVALID_MESSAGE_CONTENT',
        `content must be between ${MIN_CONTENT_LENGTH} and ${MAX_CONTENT_LENGTH} characters`,
        400
      );
    }
    if (authorName.length > MAX_AUTHOR_NAME_LENGTH) {
      throw new AppError('INVALID_AUTHOR_NAME', 'author name is too long', 400);
    }
    if (contact.length > MAX_CONTACT_LENGTH) {
      throw new AppError('INVALID_CONTACT', 'contact is too long', 400);
    }
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
      throw new AppError('INVALID_CONTACT', 'contact must be an email address', 400);
    }
    if (input?.agreementAccepted !== true) {
      throw new AppError('AGREEMENT_REQUIRED', 'agreement is required', 400);
    }
    if (/<script|<\/script|javascript:/i.test(content)) {
      throw new AppError('INVALID_MESSAGE_CONTENT', 'html is not allowed', 400);
    }

    const ipHash = this.hashText(context.ip || 'unknown');
    await this.assertWithinRateLimit(ipHash);

    const now = new Date();
    const message = new SiteMessageEntity();
    message.authorName = authorName;
    message.content = content;
    message.contact = contact;
    message.status = SiteMessageStatus.pending;
    message.moderationReason = '';
    message.adminReply = '';
    message.ipHash = ipHash;
    message.userAgent = String(context.userAgent || '').slice(0, 300);
    message.createdAt = now;
    message.updatedAt = now;

    const saved = await this.messageModel.save(message);
    this.logger?.info?.('[site-message] created id=%s', this.stringifyId(saved.id));
    return { id: this.stringifyId(saved.id), status: saved.status };
  }

  async loginModerator(password: string, ip: string): Promise<{ token: string; expiresAt: number }> {
    const expected = String(process.env.SITE_MODERATION_PASSWORD || '').trim();
    if (expected.length < 12) {
      throw new AppError(
        'MODERATION_DISABLED',
        'moderation password is not configured',
        503
      );
    }

    const attemptKey = `site-moderation:login:${this.hashText(ip || 'unknown')}`;
    const attempts = await this.incrementWithTtl(attemptKey, MODERATION_LOGIN_WINDOW_SECONDS);
    if (attempts > MODERATION_LOGIN_MAX_ATTEMPTS) {
      throw new AppError('MODERATION_RATE_LIMITED', 'too many login attempts', 429);
    }

    if (!this.safeCompare(String(password || ''), expected)) {
      throw new AppError('INVALID_MODERATION_PASSWORD', 'password is incorrect', 401);
    }

    await this.redisService.del(attemptKey);
    const token = randomBytes(32).toString('hex');
    await this.redisService.set(
      this.moderationTokenKey(token),
      '1',
      'EX',
      MODERATION_TOKEN_TTL_SECONDS
    );
    return { token, expiresAt: Date.now() + MODERATION_TOKEN_TTL_SECONDS * 1000 };
  }

  async logoutModerator(token: string): Promise<{ loggedOut: true }> {
    if (token) await this.redisService.del(this.moderationTokenKey(token));
    return { loggedOut: true };
  }

  async assertModerator(token?: string): Promise<void> {
    const value = String(token || '').trim();
    if (!value) throw new AppError('UNAUTHORIZED', 'moderator token is required', 401);
    const exists = await this.redisService.get(this.moderationTokenKey(value));
    if (!exists) throw new AppError('UNAUTHORIZED', 'moderator session expired', 401);
  }

  async listForModeration(
    statusInput?: string,
    pageInput?: string,
    pageSizeInput?: string
  ): Promise<SiteMessagePage<ModeratedSiteMessage>> {
    const status = this.normalizeStatus(statusInput);
    const page = this.normalizePositiveInteger(pageInput, 1);
    const pageSize = this.normalizePositiveInteger(pageSizeInput, 20, 50);
    const where = status === 'all' ? {} : { status };
    const [rows, total] = await this.messageModel.findAndCount({
      where: where as never,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: rows.map(row => this.toModeratedItem(row)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  }

  async approve(id: string, reason?: string): Promise<ModeratedSiteMessage> {
    const message = await this.getById(id);
    const now = new Date();
    message.status = SiteMessageStatus.published;
    message.moderationReason = String(reason || '').slice(0, 500);
    message.reviewedAt = now;
    message.publishedAt = message.publishedAt || now;
    message.updatedAt = now;
    return this.toModeratedItem(await this.messageModel.save(message));
  }

  async reject(id: string, reason?: string): Promise<ModeratedSiteMessage> {
    const message = await this.getById(id);
    const now = new Date();
    message.status = SiteMessageStatus.rejected;
    message.moderationReason = String(reason || '').slice(0, 500);
    message.reviewedAt = now;
    message.updatedAt = now;
    return this.toModeratedItem(await this.messageModel.save(message));
  }

  async remove(id: string): Promise<ModeratedSiteMessage> {
    const message = await this.getById(id);
    const now = new Date();
    message.status = SiteMessageStatus.deleted;
    message.updatedAt = now;
    return this.toModeratedItem(await this.messageModel.save(message));
  }

  async reply(id: string, reply: string): Promise<ModeratedSiteMessage> {
    const message = await this.getById(id);
    const content = String(reply || '').trim();
    if (content.length < 1 || content.length > 500) {
      throw new AppError('INVALID_REPLY', 'reply must be 1-500 characters', 400);
    }
    const now = new Date();
    message.adminReply = content;
    message.adminReplyAt = now;
    message.updatedAt = now;
    return this.toModeratedItem(await this.messageModel.save(message));
  }

  private async getById(id: string): Promise<SiteMessageEntity> {
    if (!/^[a-f0-9]{24}$/i.test(String(id || ''))) {
      throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    }
    const found = await this.messageModel.findOne({ where: { id: id as never } });
    if (!found) throw new AppError('MESSAGE_NOT_FOUND', 'message not found', 404);
    return found;
  }

  private async assertWithinRateLimit(ipHash: string): Promise<void> {
    const minuteCount = await this.incrementWithTtl(
      `site-message:rate:min:${ipHash}`,
      MINUTE_WINDOW_SECONDS
    );
    if (minuteCount > MAX_MESSAGES_PER_MINUTE) {
      throw new AppError('MESSAGE_RATE_LIMITED', 'please wait before sending again', 429);
    }

    const dayCount = await this.incrementWithTtl(
      `site-message:rate:day:${ipHash}`,
      DAY_WINDOW_SECONDS
    );
    if (dayCount > MAX_MESSAGES_PER_DAY) {
      throw new AppError('MESSAGE_DAILY_LIMIT', 'daily message limit reached', 429);
    }
  }

  private async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redisService.incr(key);
    if (count === 1) {
      await this.redisService.expire(key, ttlSeconds);
    }
    return Number(count);
  }

  private toPublicItem(row: SiteMessageEntity): PublicSiteMessage {
    return {
      id: this.stringifyId(row.id),
      authorName: row.authorName || '匿名',
      content: row.content || '',
      adminReply: row.adminReply || '',
      adminReplyAt: row.adminReplyAt ? row.adminReplyAt.toISOString() : null,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    };
  }

  private toModeratedItem(row: SiteMessageEntity): ModeratedSiteMessage {
    return {
      ...this.toPublicItem(row),
      contact: row.contact || '',
      status: row.status,
      moderationReason: row.moderationReason || '',
      ipHash: row.ipHash || '',
      userAgent: row.userAgent || '',
      createdAt: row.createdAt ? row.createdAt.toISOString() : '',
    };
  }

  private normalizeStatus(value?: string): SiteMessageStatus | 'all' {
    const status = String(value || 'pending').trim();
    if (status === 'all') return 'all';
    if (Object.values(SiteMessageStatus).includes(status as SiteMessageStatus)) {
      return status as SiteMessageStatus;
    }
    return SiteMessageStatus.pending;
  }

  private normalizePositiveInteger(value: string | undefined, fallback: number, max = 100): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
  }

  private hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }

  private safeCompare(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private moderationTokenKey(token: string): string {
    return `site-moderation:token:${this.hashText(token)}`;
  }

  private stringifyId(id: unknown): string {
    return id ? String(id) : '';
  }
}
