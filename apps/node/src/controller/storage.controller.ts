import {
  Body,
  Config,
  Controller,
  Fields,
  Files,
  Inject,
  Logger,
  Post,
} from '@midwayjs/core';
import { UploadFileInfo, UploadMiddleware } from '@midwayjs/busboy';
import { Context } from '@midwayjs/koa';
import { ILogger } from '@midwayjs/logger';
import { promises as fs } from 'fs';
import { CreateOssSignedUploadDTO } from '../dto/storage.dto';
import { AppError } from '../common/errors';
import {
  isAllowedUploadContentType,
  normalizeUploadContentType,
  resolveUploadMediaType,
} from '../common/upload-media-types';
import { isFolderWithin } from '../common/upload-policy';
import { AuthenticatedUserPayload } from '../interface';
import { ImageModerationService } from '../service/image-moderation.service';
import { OssService } from '../service/oss.service';
import { TencentCosService } from '../service/tencent-cos.service';
import { UploadQuotaService } from '../service/upload-quota.service';

export interface StorageUploadConfig {
  signedUploadEnabled?: boolean;
  signedUploadFolders?: string[];
  enforceContentTypeFromExtension?: boolean;
}

@Controller('/storage')
export class StorageController {
  @Logger()
  logger: ILogger;

  @Config('storageUpload')
  storageUploadConfig: StorageUploadConfig;

  @Inject()
  ossService: OssService;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  imageModerationService: ImageModerationService;

  @Inject()
  uploadQuotaService: UploadQuotaService;

  @Inject()
  ctx: Context;

  @Post('/oss/sign-upload')
  async createOssSignedUpload(@Body() body: CreateOssSignedUploadDTO) {
    this.assertSignedUploadAllowed(body);

    return this.ossService.createSignedUpload(body);
  }

  @Post('/cos/sign-upload')
  async createTencentCosSignedUpload(@Body() body: CreateOssSignedUploadDTO) {
    this.assertSignedUploadAllowed(body);

    // 直传由客户端直接写入存储桶，服务端拿不到对象内容，无法在返回地址前完成审核。
    // 开启图片审核后，图片必须走 /storage/upload 的服务端中转通道。
    if (this.shouldModerateUpload(body)) {
      throw new AppError(
        'IMAGE_UPLOAD_REQUIRES_SERVER_RELAY',
        '图片上传通道已调整，请更新客户端后重试',
        400
      );
    }

    return this.tencentCosService.createSignedUpload(body);
  }

  /**
   * 客户端直传签名通道的准入校验。
   * 该通道不经过服务端，一旦放开就等于允许把任意路径、任意类型的文件托管在
   * 平台域名下，因此默认关闭；开启时必须限定目录，并只接受媒体类型。
   */
  private assertSignedUploadAllowed(body: CreateOssSignedUploadDTO): void {
    const config = this.storageUploadConfig;

    if (config?.signedUploadEnabled !== true) {
      throw new AppError(
        'STORAGE_SIGNED_UPLOAD_DISABLED',
        '该上传通道已停用，请更新客户端后重试',
        403
      );
    }

    const target = body?.objectKey?.trim() || body?.folder?.trim() || '';

    if (!isFolderWithin(target, config.signedUploadFolders || [])) {
      throw new AppError(
        'STORAGE_SIGNED_UPLOAD_FOLDER_DENIED',
        '该上传目录未开放',
        403
      );
    }

    const fileName = body?.fileName?.trim() || target;
    const declaredType = normalizeUploadContentType(body?.contentType);

    if (!resolveUploadMediaType(fileName)) {
      throw new AppError(
        'STORAGE_SIGNED_UPLOAD_TYPE_DENIED',
        '该文件类型未开放',
        403
      );
    }

    if (declaredType && !isAllowedUploadContentType(declaredType)) {
      throw new AppError(
        'STORAGE_SIGNED_UPLOAD_TYPE_DENIED',
        '该文件类型未开放',
        403
      );
    }
  }

  @Post('/upload', {
    middleware: [UploadMiddleware],
  })
  async uploadFile(
    @Files() files: UploadFileInfo[],
    @Fields() fields: Record<string, string>
  ) {
    const file = files?.[0];

    if (!file) {
      throw new AppError('UPLOAD_FILE_MISSING', 'upload file is missing', 400);
    }

    const folder = fields?.folder;
    const fileName = fields?.fileName || file.filename;
    // 类型以扩展名为准：客户端声明的 Content-Type 可被伪造（例如把 HTML 声明成
    // 图片类型后由对象存储按 text/html 返回），不能作为存储依据。
    const contentType = this.resolveRelayContentType(
      fileName,
      fields?.contentType || file.mimeType
    );
    const userId = this.resolveUserId();

    // 先占配额：超限直接拒绝，不产生上传与审核费用。
    const reservation = await this.uploadQuotaService?.reserve?.({
      userId,
      folder,
      fileName,
      contentType,
      sizeBytes: await this.resolveUploadSizeBytes(file),
    });

    let uploaded;

    try {
      uploaded = await this.tencentCosService.putFile(file.data, {
        fileName,
        folder,
        contentType,
      });
    } catch (error) {
      await this.uploadQuotaService?.release?.(reservation);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'TENCENT_COS_UPLOAD_FAILED',
        '文件上传失败，请稍后重试',
        502
      );
    }

    await this.assertUploadedContentAllowed({
      objectKey: uploaded.objectKey,
      folder,
      fileName,
      contentType,
      userId,
    });

    return {
      provider: 'tencent-cos',
      objectKey: uploaded.objectKey,
      publicUrl: uploaded.url,
    };
  }

  private shouldModerateUpload(input: {
    folder?: string;
    contentType?: string;
    fileName?: string;
  }): boolean {
    return Boolean(this.imageModerationService?.shouldModerate?.(input));
  }

  /**
   * 服务端中转上传的存储类型：默认按扩展名推导，扩展名不在媒体白名单内直接拒绝。
   * 关闭 enforcement（NODE_STORAGE_ENFORCE_CONTENT_TYPE=false）时回退到客户端声明，
   * 仅用于兼容排查，不建议在生产使用。
   */
  private resolveRelayContentType(
    fileName: string | undefined,
    declared?: string
  ): string {
    if (this.storageUploadConfig?.enforceContentTypeFromExtension === false) {
      return declared || '';
    }

    const resolved = resolveUploadMediaType(fileName);

    if (!resolved) {
      throw new AppError(
        'UPLOAD_FILE_TYPE_NOT_ALLOWED',
        '不支持的文件类型',
        400
      );
    }

    return resolved;
  }

  /**
   * 审核已上传对象；判定违规时删除对象并拒绝返回访问地址。
   * 审核自身的异常在 ImageModerationService 内已按配置收敛为决策，这里只兜底未知异常。
   */
  private async assertUploadedContentAllowed(input: {
    objectKey: string;
    folder?: string;
    fileName?: string;
    contentType?: string;
    userId?: string;
  }): Promise<void> {
    const moderation = this.imageModerationService;

    if (!moderation || typeof moderation.moderate !== 'function') {
      return;
    }

    if (!moderation.shouldModerate(input)) {
      return;
    }

    let outcome;

    try {
      outcome = await moderation.moderate(input);
    } catch (error) {
      this.logger?.error?.(
        '[storage] image moderation threw unexpectedly, objectKey=%s, error=%s',
        input.objectKey,
        error instanceof Error ? error.message : String(error ?? 'unknown')
      );

      return;
    }

    if (outcome.decision !== 'block') {
      return;
    }

    try {
      await this.tencentCosService.deleteObject(input.objectKey);
    } catch (error) {
      this.logger?.error?.(
        '[storage] failed to delete rejected object, objectKey=%s, reason=%s, error=%s',
        input.objectKey,
        outcome.reason,
        error instanceof Error ? error.message : String(error ?? 'unknown')
      );
    }

    this.logger?.warn?.(
      '[storage] upload rejected by image moderation, objectKey=%s, reason=%s, userId=%s',
      input.objectKey,
      outcome.reason,
      input.userId || ''
    );

    if (outcome.reason === 'unavailable') {
      throw new AppError(
        'IMAGE_MODERATION_UNAVAILABLE',
        '图片审核服务暂不可用，请稍后重试',
        503
      );
    }

    if (outcome.reason === 'suspected') {
      throw new AppError(
        'IMAGE_MODERATION_REVIEW_REQUIRED',
        '图片需要人工复核，请更换图片后重试',
        400
      );
    }

    throw new AppError(
      'IMAGE_MODERATION_BLOCKED',
      '图片内容未通过安全审核，请更换后重试',
      400
    );
  }

  private resolveUserId(): string | undefined {
    const auth = this.ctx?.state?.auth as AuthenticatedUserPayload | undefined;

    return auth?.sub?.trim() || undefined;
  }

  private async resolveUploadSizeBytes(
    file: UploadFileInfo
  ): Promise<number | undefined> {
    const source = file?.data;

    if (typeof source !== 'string' || !source.trim()) {
      return undefined;
    }

    try {
      const stat = await fs.stat(source);

      return Number.isFinite(stat.size) && stat.size > 0
        ? stat.size
        : undefined;
    } catch {
      return undefined;
    }
  }
}
