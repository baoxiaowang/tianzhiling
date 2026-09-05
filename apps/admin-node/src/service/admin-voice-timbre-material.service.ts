import { Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';
import {
  VoiceTimbreMaterialEntity,
  VoiceTimbreMaterialReviewClip,
} from '@tzl/entities';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import { AdminStorageService } from './admin-storage.service';
import { AdminStorageFileService } from './admin-storage-file.service';

const VOICE_MATERIAL_OBJECT_KEY_PREFIXES = [
  'voice-timbres/',
  'voice-training-ready/',
  'voice-timbre-merged/',
];

export interface VoiceTimbreMaterialRecord {
  id: string;
  userId: string;
  name: string;
  objectKey: string;
  publicUrl: string;
  reviewClips: VoiceTimbreMaterialReviewClip[];
  clippedAt?: string;
  createdAt: string;
  updatedAt: string;
}

@Provide()
export class AdminVoiceTimbreMaterialService {
  @InjectEntityModel(VoiceTimbreMaterialEntity)
  materialRepo: MongoRepository<VoiceTimbreMaterialEntity>;

  @Logger()
  logger: ILogger;

  @Inject()
  storageService: AdminStorageService;

  @Inject()
  storageFileService: AdminStorageFileService;

  /** 列出某用户已保存的声音素材（倒序） */
  async listByUser(userId: string): Promise<VoiceTimbreMaterialRecord[]> {
    const items = await this.materialRepo.find({
      where: { userId: new ObjectId(userId) },
      order: { createdAt: 'DESC' as const },
    });

    return items.map(item => this.toRecord(item));
  }

  /** 保存一条素材（同一用户同一 objectKey 自动去重更新） */
  async create(input: {
    userId: string;
    name: string;
    objectKey: string;
    publicUrl?: string;
  }): Promise<VoiceTimbreMaterialRecord> {
    const now = new Date();
    const userId = new ObjectId(input.userId);
    const objectKey = this.normalizeVoiceMaterialObjectKey(input.objectKey);

    const existing = await this.materialRepo.findOne({
      where: { userId, objectKey },
    });

    if (existing) {
      existing.name = input.name;
      existing.publicUrl = input.publicUrl || existing.publicUrl;
      existing.updatedAt = now;
      const saved = await this.materialRepo.save(existing);
      return this.toRecord(saved);
    }

    const entity = this.materialRepo.create({
      userId,
      name: input.name,
      objectKey,
      publicUrl: input.publicUrl,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.materialRepo.save(entity);
    return this.toRecord(saved);
  }

  async saveReviewClips(
    id: string,
    clips: VoiceTimbreMaterialReviewClip[]
  ): Promise<VoiceTimbreMaterialRecord> {
    const material = await this.getById(id);
    const normalizedClips = this.normalizeReviewClips(material, clips);
    const previousKeys = new Set(
      (material.reviewClips ?? []).map(item => item.objectKey)
    );
    const nextKeys = new Set(normalizedClips.map(item => item.objectKey));

    material.reviewClips = normalizedClips;
    material.clippedAt = new Date();
    material.updatedAt = new Date();
    const saved = await this.materialRepo.save(material);

    await Promise.all(
      [...previousKeys]
        .filter(
          objectKey =>
            objectKey !== material.objectKey && !nextKeys.has(objectKey)
        )
        .map(objectKey => this.deleteObjectSafely(objectKey))
    );
    return this.toRecord(saved);
  }

  /** 上传成功但素材记录保存失败时，只允许回收声音素材目录中的孤儿对象。 */
  async rollbackUpload(objectKey: string): Promise<{ deleted: true }> {
    const normalizedObjectKey = this.normalizeObjectKey(
      objectKey,
      'voice-timbres/',
      'INVALID_VOICE_MATERIAL_OBJECT_KEY'
    );
    await this.storageService.deleteCosObject(normalizedObjectKey);
    return { deleted: true };
  }

  /** 先物理删除原素材和派生切片，再移除数据库记录。 */
  async remove(id: string): Promise<{ deleted: boolean }> {
    const material = await this.getById(id);
    const objectKeys = new Set([
      this.normalizeVoiceMaterialObjectKey(material.objectKey),
      ...(material.reviewClips ?? []).map(item =>
        this.normalizeReviewClipObjectKey(material, item.objectKey)
      ),
    ]);

    for (const objectKey of objectKeys) {
      await this.storageService.deleteCosObject(objectKey);
    }

    const result = await this.materialRepo.deleteOne({
      _id: material.id,
    } as Parameters<MongoRepository<VoiceTimbreMaterialEntity>['deleteOne']>[0]);

    return { deleted: (result.deletedCount ?? 0) > 0 };
  }

  private toRecord(item: VoiceTimbreMaterialEntity): VoiceTimbreMaterialRecord {
    return {
      id: String(item.id),
      userId: item.userId ? String(item.userId) : '',
      name: item.name,
      objectKey: item.objectKey,
      publicUrl: this.storageFileService.resolve(
        item.publicUrl || item.objectKey
      ),
      reviewClips: item.reviewClips ?? [],
      clippedAt: item.clippedAt?.toISOString(),
      createdAt: (item.createdAt || new Date()).toISOString(),
      updatedAt: (item.updatedAt || new Date()).toISOString(),
    };
  }

  private async getById(id: string): Promise<VoiceTimbreMaterialEntity> {
    if (!ObjectId.isValid(id)) {
      throw new AppError('INVALID_ID', 'invalid material id', 400);
    }
    const objectId = new ObjectId(id);
    const item =
      (await this.materialRepo.findOne({ where: { id: objectId } })) ??
      (await this.materialRepo.findOne({
        where: { _id: objectId } as never,
      }));
    if (!item) {
      throw new AppError(
        'VOICE_MATERIAL_NOT_FOUND',
        'voice material not found',
        404
      );
    }
    return item;
  }

  private normalizeReviewClips(
    material: VoiceTimbreMaterialEntity,
    clips: VoiceTimbreMaterialReviewClip[]
  ): VoiceTimbreMaterialReviewClip[] {
    const materialId = String(material.id);
    const allowedStatuses = new Set(['pending', 'accepted', 'unused']);

    return clips.map(item => {
      const durationSeconds = Number(item.durationSeconds);
      if (
        item.sourceMaterialId !== materialId ||
        !item.publicUrl?.trim() ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        (item.reviewStatus && !allowedStatuses.has(item.reviewStatus))
      ) {
        throw new AppError(
          'INVALID_VOICE_REVIEW_CLIP',
          'voice review clip is invalid',
          400
        );
      }
      const objectKey = this.normalizeReviewClipObjectKey(
        material,
        item.objectKey
      );

      return {
        ...item,
        sourceMaterialId: materialId,
        sourceName: item.sourceName?.trim() || material.name,
        objectKey,
        publicUrl: item.publicUrl.trim(),
        durationSeconds,
        reviewStatus: item.reviewStatus || 'pending',
        reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : undefined,
      };
    });
  }

  private normalizeObjectKey(
    objectKey: string,
    requiredPrefix: string,
    errorCode: string
  ): string {
    const normalizedObjectKey = objectKey?.trim().replace(/^\/+/, '');
    if (
      !normalizedObjectKey?.startsWith(requiredPrefix) ||
      normalizedObjectKey.includes('..')
    ) {
      throw new AppError(errorCode, 'voice object key is invalid', 400);
    }
    return normalizedObjectKey;
  }

  private normalizeReviewClipObjectKey(
    material: VoiceTimbreMaterialEntity,
    objectKey: string
  ): string {
    const normalizedObjectKey = objectKey?.trim().replace(/^\/+/, '');
    const materialObjectKey = this.normalizeVoiceMaterialObjectKey(
      material.objectKey
    );
    if (normalizedObjectKey === materialObjectKey) {
      return materialObjectKey;
    }
    return this.normalizeObjectKey(
      normalizedObjectKey,
      'voice-service-clips/',
      'INVALID_VOICE_REVIEW_CLIP'
    );
  }

  private normalizeVoiceMaterialObjectKey(objectKey: string): string {
    const normalizedObjectKey = objectKey?.trim().replace(/^\/+/, '');
    if (
      !normalizedObjectKey ||
      normalizedObjectKey.includes('..') ||
      !VOICE_MATERIAL_OBJECT_KEY_PREFIXES.some(prefix =>
        normalizedObjectKey.startsWith(prefix)
      )
    ) {
      throw new AppError(
        'INVALID_VOICE_MATERIAL_OBJECT_KEY',
        'voice material object key is invalid',
        400
      );
    }
    return normalizedObjectKey;
  }

  private async deleteObjectSafely(objectKey: string): Promise<void> {
    try {
      await this.storageService.deleteCosObject(objectKey);
    } catch (error) {
      this.logger.warn(
        '[admin-voice-material] stale clip cleanup failed, objectKey=%s, reason=%s',
        objectKey,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
