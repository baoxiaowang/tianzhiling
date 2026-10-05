import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { AppError } from '../common/errors';
import { isImageUpload, normalizeUploadFolder } from '../common/upload-policy';

export interface UploadQuotaConfig {
  enabled?: boolean;
  dailyFilesPerUser?: number;
  dailyImageFilesPerUser?: number;
  dailyBytesPerUser?: number;
  /** 目录级额外上限，例如 chat-imports 允许一次导入 30 张截图。 */
  folderDailyFiles?: Record<string, number>;
  /**
   * 豁免“文件数/图片数”全局计数的目录（一次性批量流程）。
   * 豁免仍受目录自身上限与全局总字节约束；未配目录上限时不豁免。
   */
  exemptFolders?: string[];
}

export interface UploadQuotaInput {
  userId?: string;
  folder?: string;
  contentType?: string;
  fileName?: string;
  sizeBytes?: number;
  now?: Date;
}

export interface UploadQuotaReservation {
  userId: string;
  dayKey: string;
  folder: string;
  /** 是否计入全局“文件数/图片数”；豁免目录为 false。 */
  countedGlobals: boolean;
  countedImage: boolean;
  countedFolder: boolean;
  sizeBytes: number;
}

export interface UploadQuotaUsage {
  filesUsed: number;
  imagesUsed: number;
  bytesUsed: number;
  folderUsed: number;
}

/** 只声明用到的最小 Redis 能力，便于单测替换。 */
interface UploadQuotaRedis {
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;
  multi(): {
    hincrby(key: string, field: string, value: number): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<unknown>;
  };
}

const QUOTA_KEY_PREFIX = 'tzl:upload-quota';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;
const FILES_FIELD = 'files';
const IMAGES_FIELD = 'images';
const BYTES_FIELD = 'bytes';

/** 北京时间的自然日标识（配额按北京日切换，与国内业务口径一致）。 */
export function resolveBeijingDayKey(now: Date): string {
  const beijing = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const year = beijing.getUTCFullYear();
  const month = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijing.getUTCDate()).padStart(2, '0');

  return `${year}${month}${day}`;
}

/** 配额键存活到当日结束再多留 60 秒，避免零点点边界丢计数。 */
export function resolveQuotaTtlSeconds(now: Date): number {
  const beijing = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const secondsOfDay =
    beijing.getUTCHours() * 3600 +
    beijing.getUTCMinutes() * 60 +
    beijing.getUTCSeconds();

  return Math.max(SECONDS_PER_DAY - secondsOfDay, 1) + 60;
}

function toCounter(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

@Provide()
export class UploadQuotaService {
  @Logger()
  logger: ILogger;

  @Config('uploadQuota')
  quotaConfig: UploadQuotaConfig;

  @Inject()
  redisService: RedisService;

  isEnabled(): boolean {
    return Boolean(this.quotaConfig?.enabled);
  }

  resolveLimits(folder?: string): {
    files: number;
    images: number;
    bytes: number;
    folderFiles: number;
    exempt: boolean;
  } {
    const normalizedFolder = normalizeUploadFolder(folder);
    const folderLimits = this.quotaConfig?.folderDailyFiles;
    const folderLimit = normalizedFolder
      ? folderLimits?.[normalizedFolder]
      : undefined;
    const folderFiles = this.normalizeLimit(folderLimit);
    // 豁免只在目录自己有上限时生效：漏配上限就退回普通目录，避免变成完全不限。
    const exempt =
      folderFiles > 0 &&
      (this.quotaConfig?.exemptFolders || []).some(
        item => normalizeUploadFolder(item) === normalizedFolder
      );

    return {
      files: this.normalizeLimit(this.quotaConfig?.dailyFilesPerUser),
      images: this.normalizeLimit(this.quotaConfig?.dailyImageFilesPerUser),
      bytes: this.normalizeLimit(this.quotaConfig?.dailyBytesPerUser),
      folderFiles,
      exempt,
    };
  }

  /**
   * 预占当日配额；超出上限时抛出 429，调用方不得继续上传。
   * Redis 不可用时放行并告警：配额是成本护栏，不能变成上传的单点故障。
   */
  async reserve(
    input: UploadQuotaInput
  ): Promise<UploadQuotaReservation | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const userId = input.userId?.trim();

    if (!userId) {
      this.logger?.warn?.(
        '[upload-quota] skip reservation because userId is missing, folder=%s',
        input.folder || ''
      );

      return null;
    }

    const redis = this.resolveRedis();

    if (!redis) {
      return null;
    }

    const now = input.now || new Date();
    const dayKey = resolveBeijingDayKey(now);
    const key = this.buildKey(userId, dayKey);
    const folder = normalizeUploadFolder(input.folder) || 'static';
    const folderField = this.buildFolderField(folder);
    const countedImage = isImageUpload(input);
    const sizeBytes = this.normalizeSize(input.sizeBytes);
    const limits = this.resolveLimits(folder);
    const countedGlobals = !limits.exempt;
    const fields = countedGlobals
      ? [FILES_FIELD, IMAGES_FIELD, BYTES_FIELD, folderField]
      : [BYTES_FIELD, folderField];

    try {
      const values = await redis.hmget(key, ...fields);
      const usage: UploadQuotaUsage = countedGlobals
        ? {
            filesUsed: toCounter(values?.[0]),
            imagesUsed: toCounter(values?.[1]),
            bytesUsed: toCounter(values?.[2]),
            folderUsed: toCounter(values?.[3]),
          }
        : {
            filesUsed: 0,
            imagesUsed: 0,
            bytesUsed: toCounter(values?.[0]),
            folderUsed: toCounter(values?.[1]),
          };

      this.assertWithinLimits({
        folder,
        countedImage,
        sizeBytes,
        limits,
        usage,
      });

      const pipeline = redis.multi();

      if (countedGlobals) {
        pipeline.hincrby(key, FILES_FIELD, 1);

        if (countedImage) {
          pipeline.hincrby(key, IMAGES_FIELD, 1);
        }
      }

      if (sizeBytes > 0) {
        pipeline.hincrby(key, BYTES_FIELD, sizeBytes);
      }

      if (limits.folderFiles > 0) {
        pipeline.hincrby(key, folderField, 1);
      }

      pipeline.expire(key, resolveQuotaTtlSeconds(now));

      await pipeline.exec();

      return {
        userId,
        dayKey,
        folder,
        countedGlobals,
        countedImage: countedGlobals && countedImage,
        countedFolder: limits.folderFiles > 0,
        sizeBytes,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      this.logger?.warn?.(
        '[upload-quota] reservation failed open, userId=%s, folder=%s, error=%s',
        userId,
        folder,
        error instanceof Error ? error.message : String(error ?? 'unknown')
      );

      return null;
    }
  }

  /** 上传失败时回补配额；跨天后不再回补，避免污染新一天计数。 */
  async release(
    reservation?: UploadQuotaReservation | null,
    now: Date = new Date()
  ): Promise<void> {
    if (!reservation || !this.isEnabled()) {
      return;
    }

    if (resolveBeijingDayKey(now) !== reservation.dayKey) {
      return;
    }

    const redis = this.resolveRedis();

    if (!redis) {
      return;
    }

    try {
      const key = this.buildKey(reservation.userId, reservation.dayKey);
      const pipeline = redis.multi();

      if (reservation.countedGlobals) {
        pipeline.hincrby(key, FILES_FIELD, -1);

        if (reservation.countedImage) {
          pipeline.hincrby(key, IMAGES_FIELD, -1);
        }
      }

      if (reservation.sizeBytes > 0) {
        pipeline.hincrby(key, BYTES_FIELD, -reservation.sizeBytes);
      }

      if (reservation.countedFolder) {
        pipeline.hincrby(key, this.buildFolderField(reservation.folder), -1);
      }

      await pipeline.exec();
    } catch (error) {
      this.logger?.warn?.(
        '[upload-quota] release failed, userId=%s, folder=%s, error=%s',
        reservation.userId,
        reservation.folder,
        error instanceof Error ? error.message : String(error ?? 'unknown')
      );
    }
  }

  private assertWithinLimits(options: {
    folder: string;
    countedImage: boolean;
    sizeBytes: number;
    limits: {
      files: number;
      images: number;
      bytes: number;
      folderFiles: number;
      exempt: boolean;
    };
    usage: UploadQuotaUsage;
  }): void {
    const { limits, usage, countedImage, sizeBytes, folder } = options;

    if (limits.folderFiles > 0 && usage.folderUsed >= limits.folderFiles) {
      throw this.buildLimitError({
        reason: 'folder',
        folder,
        limit: limits.folderFiles,
        used: usage.folderUsed,
        message: `今日「${folder}」上传数量已达上限（${limits.folderFiles} 个），请明天再试`,
      });
    }

    // 豁免目录只受目录上限与全局总字节约束。
    if (limits.exempt) {
      this.assertWithinBytesLimit({ limits, usage, sizeBytes });

      return;
    }

    if (
      countedImage &&
      limits.images > 0 &&
      usage.imagesUsed >= limits.images
    ) {
      throw this.buildLimitError({
        reason: 'images',
        limit: limits.images,
        used: usage.imagesUsed,
        message: `今日上传图片数量已达上限（${limits.images} 张），请明天再试`,
      });
    }

    if (limits.files > 0 && usage.filesUsed >= limits.files) {
      throw this.buildLimitError({
        reason: 'files',
        limit: limits.files,
        used: usage.filesUsed,
        message: `今日上传文件数量已达上限（${limits.files} 个），请明天再试`,
      });
    }

    this.assertWithinBytesLimit({ limits, usage, sizeBytes });
  }

  private assertWithinBytesLimit(options: {
    limits: { bytes: number };
    usage: UploadQuotaUsage;
    sizeBytes: number;
  }): void {
    const { limits, usage, sizeBytes } = options;

    if (limits.bytes > 0 && usage.bytesUsed + sizeBytes > limits.bytes) {
      throw this.buildLimitError({
        reason: 'bytes',
        limit: limits.bytes,
        used: usage.bytesUsed,
        message: `今日上传总大小已达上限（${Math.floor(
          limits.bytes / (1024 * 1024)
        )} MB），请明天再试`,
      });
    }
  }

  private buildLimitError(options: {
    reason: string;
    message: string;
    limit: number;
    used: number;
    folder?: string;
  }): AppError {
    return new AppError('UPLOAD_DAILY_LIMIT_EXCEEDED', options.message, 429, {
      reason: options.reason,
      limit: options.limit,
      used: options.used,
      ...(options.folder ? { folder: options.folder } : {}),
    });
  }

  private buildKey(userId: string, dayKey: string): string {
    return `${QUOTA_KEY_PREFIX}:${userId}:${dayKey}`;
  }

  private buildFolderField(folder: string): string {
    return `folder:${folder}`;
  }

  private normalizeLimit(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.floor(value);
  }

  private normalizeSize(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.floor(value);
  }

  private resolveRedis(): UploadQuotaRedis | null {
    return (this.redisService as unknown as UploadQuotaRedis) || null;
  }
}
