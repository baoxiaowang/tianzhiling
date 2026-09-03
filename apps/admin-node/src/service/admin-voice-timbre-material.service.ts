import { Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';
import { VoiceTimbreMaterialEntity } from '@tzl/entities';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';

export interface VoiceTimbreMaterialRecord {
  id: string;
  userId: string;
  name: string;
  objectKey: string;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

@Provide()
export class AdminVoiceTimbreMaterialService {
  @InjectEntityModel(VoiceTimbreMaterialEntity)
  materialRepo: MongoRepository<VoiceTimbreMaterialEntity>;

  @Logger()
  logger: ILogger;

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

    const existing = await this.materialRepo.findOne({
      where: { userId, objectKey: input.objectKey },
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
      objectKey: input.objectKey,
      publicUrl: input.publicUrl,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.materialRepo.save(entity);
    return this.toRecord(saved);
  }

  /** 删除一条已保存的素材记录 */
  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!ObjectId.isValid(id)) {
      throw new AppError('INVALID_ID', 'invalid material id', 400);
    }

    const result = await this.materialRepo.deleteOne({
      _id: new ObjectId(id),
    } as Parameters<MongoRepository<VoiceTimbreMaterialEntity>['deleteOne']>[0]);

    return { deleted: (result.deletedCount ?? 0) > 0 };
  }

  private toRecord(item: VoiceTimbreMaterialEntity): VoiceTimbreMaterialRecord {
    return {
      id: String(item.id),
      userId: item.userId ? String(item.userId) : '',
      name: item.name,
      objectKey: item.objectKey,
      publicUrl: item.publicUrl || '',
      createdAt: (item.createdAt || new Date()).toISOString(),
      updatedAt: (item.updatedAt || new Date()).toISOString(),
    };
  }
}
