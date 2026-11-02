import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ILogger } from '@midwayjs/logger';
import { MongoRepository } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  FaceRecognitionDecision,
  FaceRecognitionFaceResult,
  FaceRecognitionLogEntity,
  MongoObjectId,
  UserKnownPersonEntity,
  UserKnownPersonFaceEntity,
  UserKnownPersonFaceSource,
  UserKnownPersonFaceStatus,
  UserKnownPersonStatus,
} from '@tzl/entities';
import { AppError } from '../common/errors';
import { TencentCosService } from './tencent-cos.service';

export interface FaceRecognitionConfig {
  enabled?: boolean;
  sidecarUrl?: string;
  timeoutMs?: number;
  /** 判定「确认」的最大欧氏距离（dlib 建议 0.6 以内为同一人） */
  confirmDistance?: number;
  /** 判定「反问」的最大欧氏距离 */
  askDistance?: number;
  /** top1 与 top2 的最小距离差（越大越保守） */
  confirmMargin?: number;
  /** 小于该人脸边长视为不合格 */
  minFaceSize?: number;
  /** 低于该拉普拉斯方差视为模糊 */
  minBlur?: number;
  /** 人脸左右偏转上限（0 正面） */
  maxYaw?: number;
  /** 是否把识别记录写入 face_recognition_log */
  logEnabled?: boolean;
}

export interface FaceSidecarFace {
  box?: { top: number; right: number; bottom: number; left: number };
  landmarks?: number[][];
  quality?: {
    faceSize?: number;
    blur?: number;
    brightness?: number;
    yaw?: number;
    tooSmall?: boolean;
    tooBlurry?: boolean;
  };
  embedding?: number[];
}

export interface FaceSidecarResult {
  ok: boolean;
  model?: string;
  version?: string;
  dim?: number;
  costMs?: number;
  faces: FaceSidecarFace[];
}

export interface FaceRecognitionCandidateView {
  personId: string;
  name: string;
  relation?: string;
  score: number;
  distance: number;
}

export interface FaceRecognitionOutcome {
  enabled: boolean;
  model?: string;
  latencyMs: number;
  faces: FaceRecognitionFaceResult[];
  candidates: FaceRecognitionCandidateView[][];
}

interface TemplateRow {
  personId: string;
  name: string;
  relation?: string;
  embedding: number[];
}

const MAX_FACES_PER_IMAGE = 8;

/**
 * 自建人脸识别：sidecar 负责检测与编码，这里负责模板管理、比对与三档决策。
 *
 * 设计上「人」沿用 user_known_person（家人/熟人档案），人脸模板单独一张表；
 * 识别结果只作为「身份线索」提供给对话层，不直接断言身份。
 */
@Provide()
export class FaceRecognitionService {
  @Logger()
  logger: ILogger;

  @Config('faceRecognition')
  config: FaceRecognitionConfig;

  @InjectEntityModel(UserKnownPersonFaceEntity)
  faceModel: MongoRepository<UserKnownPersonFaceEntity>;

  @InjectEntityModel(UserKnownPersonEntity)
  personModel: MongoRepository<UserKnownPersonEntity>;

  @InjectEntityModel(FaceRecognitionLogEntity)
  logModel: MongoRepository<FaceRecognitionLogEntity>;

  @Inject()
  tencentCosService: TencentCosService;

  isEnabled(): boolean {
    if (this.config?.enabled === false) {
      return false;
    }
    const raw = String(process.env.NODE_FACE_RECOGNITION_ENABLED ?? '')
      .trim()
      .toLowerCase();
    return !['0', 'false', 'off', 'no'].includes(raw);
  }

  private get sidecarUrl(): string {
    return (
      this.config?.sidecarUrl?.trim() ||
      process.env.NODE_FACE_SIDECAR_URL?.trim() ||
      'http://tzl_face_sidecar:8899'
    ).replace(/\/+$/, '');
  }

  private async callSidecar<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Number(this.config?.timeoutMs) || 15000
    );
    try {
      const response = await fetch(`${this.sidecarUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AppError(
          'FACE_SIDECAR_ERROR',
          `face sidecar responded ${response.status}`,
          502
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 调 sidecar 做检测 + 编码。图片可以用 buffer 或 COS objectKey。 */
  async analyze(input: {
    buffer?: Buffer;
    objectKey?: string;
  }): Promise<FaceSidecarResult> {
    if (!this.isEnabled()) {
      throw new AppError('FACE_RECOGNITION_DISABLED', 'face recognition disabled', 400);
    }
    let buffer = input.buffer;
    if (!buffer && input.objectKey) {
      const downloaded = await this.tencentCosService.getBuffer(input.objectKey);
      buffer = downloaded.buffer;
    }
    if (!buffer || !buffer.length) {
      throw new AppError('FACE_IMAGE_REQUIRED', 'face image is required', 400);
    }
    return this.callSidecar<FaceSidecarResult>('/analyze', {
      image: buffer.toString('base64'),
    });
  }

  /** 给某个「认识的人」登记人脸模板（一张图里可能有多张脸，取最大的一张）。 */
  async registerFaces(input: {
    userId: string;
    personId: string;
    images: Array<{ buffer?: Buffer; objectKey?: string }>;
    source?: UserKnownPersonFaceSource;
    consentAt?: Date;
  }): Promise<{ stored: number; skipped: number }> {
    const person = await this.loadPerson(input.userId, input.personId);
    if (!person) {
      throw new AppError('FACE_PERSON_NOT_FOUND', 'known person not found', 404);
    }

    let stored = 0;
    let skipped = 0;
    for (const image of input.images) {
      try {
        const analysis = await this.analyze(image);
        const face = this.pickBestFace(analysis.faces);
        if (!face?.embedding || !this.passesQualityGate(face)) {
          skipped += 1;
          continue;
        }
        const serialized = this.serializeEmbedding(face.embedding);
        const entity = this.faceModel.create({
          personId: new MongoObjectId(input.personId),
          userId: new MongoObjectId(input.userId),
          embedding: serialized.embedding,
          embeddingEnc: serialized.embeddingEnc,
          dim: face.embedding.length,
          model: analysis.model || 'dlib-resnet-v1',
          modelVersion: analysis.version || '2026.11',
          quality: face.quality
            ? {
                faceSize: face.quality.faceSize,
                blur: face.quality.blur,
                brightness: face.quality.brightness,
                yaw: face.quality.yaw,
                score: this.qualityScore(face),
              }
            : undefined,
          objectKey: image.objectKey,
          source: input.source || UserKnownPersonFaceSource.admin,
          status: UserKnownPersonFaceStatus.active,
          consentAt: input.consentAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as UserKnownPersonFaceEntity);
        await this.faceModel.save(entity);
        stored += 1;
      } catch (error) {
        this.logger.warn(
          '[face] register face failed, personId=%s, reason=%s',
          input.personId,
          error instanceof Error ? error.message : String(error)
        );
        skipped += 1;
      }
    }

    return { stored, skipped };
  }

  /** 识别一张图片里的所有人脸。 */
  async recognize(input: {
    userId: string;
    agentId?: string;
    messageId?: string;
    objectKey?: string;
    buffer?: Buffer;
  }): Promise<FaceRecognitionOutcome> {
    const startedAt = Date.now();
    if (!this.isEnabled()) {
      return { enabled: false, latencyMs: 0, faces: [], candidates: [] };
    }

    const templates = await this.loadTemplates(input.userId);
    const analysis = await this.analyze({
      buffer: input.buffer,
      objectKey: input.objectKey,
    });

    const faces: FaceRecognitionFaceResult[] = [];
    const candidates: FaceRecognitionCandidateView[][] = [];

    for (const face of analysis.faces.slice(0, MAX_FACES_PER_IMAGE)) {
      const gatedBy = this.gateReason(face);
      const ranking = face.embedding
        ? this.rank(face.embedding, templates)
        : [];
      const top1 = ranking[0];
      const top2 = ranking[1];
      const margin = top1 && top2 ? top2.distance - top1.distance : top1 ? 1 : 0;

      let decision: FaceRecognitionDecision = FaceRecognitionDecision.unknown;
      if (!gatedBy && top1) {
        if (
          top1.distance <= this.confirmDistance &&
          margin >= this.confirmMargin
        ) {
          decision = FaceRecognitionDecision.confirmed;
        } else if (top1.distance <= this.askDistance) {
          decision = FaceRecognitionDecision.ask;
        }
      } else if (top1 && top1.distance <= this.askDistance) {
        decision = FaceRecognitionDecision.ask;
      }

      faces.push({
        box: face.box,
        decision,
        top1: top1
          ? { personId: top1.personId, name: top1.name, score: top1.score }
          : undefined,
        margin: top1 ? Number(margin.toFixed(3)) : undefined,
        quality: face.quality
          ? {
              faceSize: face.quality.faceSize,
              blur: face.quality.blur,
              brightness: face.quality.brightness,
              yaw: face.quality.yaw,
            }
          : undefined,
        gatedBy,
      });
      candidates.push(
        ranking.slice(0, 3).map(item => ({
          personId: item.personId,
          name: item.name,
          relation: item.relation,
          score: item.score,
          distance: item.distance,
        }))
      );
    }

    const outcome: FaceRecognitionOutcome = {
      enabled: true,
      model: analysis.model,
      latencyMs: Date.now() - startedAt,
      faces,
      candidates,
    };

    if (this.config?.logEnabled !== false) {
      try {
        await this.logModel.save(
          this.logModel.create({
            userId: new MongoObjectId(input.userId),
            agentId: input.agentId
              ? new MongoObjectId(input.agentId)
              : undefined,
            messageId: input.messageId
              ? new MongoObjectId(input.messageId)
              : undefined,
            objectKey: input.objectKey,
            action: 'recognize',
            faces,
            model: analysis.model,
            latencyMs: outcome.latencyMs,
            createdAt: new Date(),
          } as unknown as FaceRecognitionLogEntity)
        );
      } catch (error) {
        this.logger.warn(
          '[face] write recognition log failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return outcome;
  }

  async listPersonFaces(input: {
    userId: string;
    personId: string;
  }): Promise<
    Array<{
      id: string;
      quality?: Record<string, unknown>;
      source: string;
      createdAt: Date;
    }>
  > {
    const rows = await this.faceModel.find({
      where: {
        personId: new MongoObjectId(input.personId),
        userId: new MongoObjectId(input.userId),
        status: UserKnownPersonFaceStatus.active,
      } as never,
      order: { createdAt: 'DESC' } as never,
    } as never);
    return rows.map(row => ({
      id: String(row.id ?? (row as unknown as { _id: MongoObjectId })._id),
      quality: row.quality as Record<string, unknown> | undefined,
      source: row.source,
      createdAt: row.createdAt,
    }));
  }

  /** 软删除某人的全部人脸模板（原图由调用方按存储策略清理）。 */
  async deletePersonFaces(input: {
    userId: string;
    personId: string;
  }): Promise<{ deleted: number }> {
    const result = await this.faceModel.updateMany(
      {
        personId: new MongoObjectId(input.personId),
        userId: new MongoObjectId(input.userId),
        status: UserKnownPersonFaceStatus.active,
      } as never,
      {
        $set: {
          status: UserKnownPersonFaceStatus.deleted,
          updatedAt: new Date(),
        },
      } as never
    );
    const modified = Number(
      (result as unknown as { modifiedCount?: number }).modifiedCount ?? 0
    );
    try {
      await this.logModel.save(
        this.logModel.create({
          userId: new MongoObjectId(input.userId),
          personId: new MongoObjectId(input.personId),
          action: 'delete',
          deletedCount: modified,
          faces: [],
          createdAt: new Date(),
        } as unknown as FaceRecognitionLogEntity)
      );
    } catch (error) {
      this.logger.warn(
        '[face] write delete audit failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
    }
    return { deleted: modified };
  }

  /** 读取该用户名下所有有效人脸模板（识别候选集）。 */
  private async loadTemplates(userId: string): Promise<TemplateRow[]> {
    const rows = await this.faceModel.find({
      where: {
        userId: new MongoObjectId(userId),
        status: UserKnownPersonFaceStatus.active,
      } as never,
    } as never);
    if (!rows.length) {
      return [];
    }
    const personIds = Array.from(
      new Set(rows.map(row => String(row.personId)))
    ).map(id => new MongoObjectId(id));
    const persons = await this.personModel.find({
      where: {
        _id: { $in: personIds },
        status: UserKnownPersonStatus.active,
      } as never,
    } as never);
    const personMap = new Map(
      persons.map(person => [String(person.id ?? (person as unknown as { _id: MongoObjectId })._id), person])
    );

    const result: TemplateRow[] = [];
    for (const row of rows) {
      const personId = String(row.personId);
      const person = personMap.get(personId);
      if (!person) {
        continue;
      }
      const embedding = this.readEmbedding(row);
      if (!embedding) {
        continue;
      }
      result.push({
        personId,
        name:
          person.preferredName?.trim() ||
          person.realName?.trim() ||
          person.relationToUser?.trim() ||
          '家人',
        relation: person.relationToUser,
        embedding,
      });
    }
    return result;
  }

  private async loadPerson(
    userId: string,
    personId: string
  ): Promise<UserKnownPersonEntity | null> {
    if (!MongoObjectId.isValid(personId)) {
      return null;
    }
    return this.personModel.findOne({
      where: {
        _id: new MongoObjectId(personId),
        userId: new MongoObjectId(userId),
        status: UserKnownPersonStatus.active,
      } as never,
    } as never);
  }

  private pickBestFace(faces: FaceSidecarFace[]): FaceSidecarFace | undefined {
    if (!faces.length) {
      return undefined;
    }
    return [...faces].sort(
      (left, right) =>
        Number(right.quality?.faceSize ?? 0) - Number(left.quality?.faceSize ?? 0)
    )[0];
  }

  private passesQualityGate(face: FaceSidecarFace): boolean {
    const quality = face.quality;
    if (!quality) {
      return true;
    }
    if (Number(quality.faceSize ?? 0) < this.minFaceSize) {
      return false;
    }
    if (Number(quality.blur ?? 0) < this.minBlur) {
      return false;
    }
    return true;
  }

  private gateReason(face: FaceSidecarFace): string | undefined {
    const quality = face.quality;
    if (!quality) {
      return undefined;
    }
    if (Number(quality.faceSize ?? 0) < this.minFaceSize) {
      return 'size';
    }
    if (Number(quality.blur ?? 0) < this.minBlur) {
      return 'blur';
    }
    if (Math.abs(Number(quality.yaw ?? 0)) > this.maxYaw) {
      return 'pose';
    }
    return undefined;
  }

  private qualityScore(face: FaceSidecarFace): number {
    const quality = face.quality || {};
    const sizeScore = Math.min(1, Number(quality.faceSize ?? 0) / 200);
    const blurScore = Math.min(1, Number(quality.blur ?? 0) / 300);
    const yawScore = Math.max(0, 1 - Math.abs(Number(quality.yaw ?? 0)) / 0.6);
    return Number(((sizeScore + blurScore + yawScore) / 3).toFixed(3));
  }

  /**
   * 按「人」聚合后排序：同一个人的多张模板取最小距离，
   * 这样 top1/top2 的 margin 才是「人」与「人」之间的差距
   * （否则同一人的两张模板会把 margin 压成 0，导致永远无法确认）。
   */
  private rank(
    embedding: number[],
    templates: TemplateRow[]
  ): Array<TemplateRow & { distance: number; score: number }> {
    const bestByPerson = new Map<
      string,
      TemplateRow & { distance: number; score: number }
    >();
    for (const template of templates) {
      const distance = euclideanDistance(embedding, template.embedding);
      const current = bestByPerson.get(template.personId);
      if (!current || distance < current.distance) {
        bestByPerson.set(template.personId, {
          ...template,
          distance,
          score: Number((1 - distance).toFixed(4)),
        });
      }
    }
    return Array.from(bestByPerson.values()).sort(
      (left, right) => left.distance - right.distance
    );
  }

  private get confirmDistance(): number {
    return Number(this.config?.confirmDistance ?? 0.45);
  }

  private get askDistance(): number {
    return Number(this.config?.askDistance ?? 0.6);
  }

  private get confirmMargin(): number {
    return Number(this.config?.confirmMargin ?? 0.08);
  }

  private get minFaceSize(): number {
    return Number(this.config?.minFaceSize ?? 80);
  }

  private get minBlur(): number {
    return Number(this.config?.minBlur ?? 40);
  }

  private get maxYaw(): number {
    return Number(this.config?.maxYaw ?? 0.35);
  }


  /** 是否启用向量加密（配置 NODE_FACE_EMBEDDING_KEY 即启用）。 */
  private encryptionKey(): Buffer | null {
    const raw = String(process.env.NODE_FACE_EMBEDDING_KEY ?? '').trim();
    if (!raw) {
      return null;
    }
    const buffer = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    return buffer.length === 32 ? buffer : null;
  }

  /** 存库前：有密钥则加密，否则存明文（兼容未配置的部署）。 */
  private serializeEmbedding(embedding: number[]): {
    embedding?: number[];
    embeddingEnc?: string;
  } {
    const key = this.encryptionKey();
    if (!key) {
      return { embedding };
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(embedding), 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      embeddingEnc: [
        'v1',
        iv.toString('base64'),
        tag.toString('base64'),
        ciphertext.toString('base64'),
      ].join(':'),
    };
  }

  /** 读库时：密文优先解密；明文直接返回。 */
  private readEmbedding(row: {
    embedding?: number[];
    embeddingEnc?: string;
  }): number[] | null {
    if (row.embeddingEnc) {
      const key = this.encryptionKey();
      if (!key) {
        this.logger.warn(
          '[face] encrypted embedding found but NODE_FACE_EMBEDDING_KEY missing'
        );
        return null;
      }
      try {
        const [version, iv, tag, ciphertext] = row.embeddingEnc.split(':');
        if (version !== 'v1') {
          return null;
        }
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        const plain = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, 'base64')),
          decipher.final(),
        ]);
        return JSON.parse(plain.toString('utf8')) as number[];
      } catch (error) {
        this.logger.warn(
          '[face] decrypt embedding failed, reason=%s',
          error instanceof Error ? error.message : String(error)
        );
        return null;
      }
    }
    return row.embedding?.length ? row.embedding : null;
  }

}

function euclideanDistance(left: number[], right: number[]): number {
  if (!left?.length || !right?.length || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index] - right[index];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
