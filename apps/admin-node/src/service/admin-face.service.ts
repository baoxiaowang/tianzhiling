import { Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ILogger } from '@midwayjs/logger';
import { MongoRepository } from 'typeorm';
import {
  MongoObjectId,
  UserKnownPersonEntity,
  UserKnownPersonFaceEntity,
  UserKnownPersonFaceStatus,
  UserKnownPersonStatus,
} from '@tzl/entities';
import { AppError } from '@tzl/shared';

interface NodeEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface AdminFacePersonDTO {
  personId: string;
  name: string;
  relation?: string;
  aliases?: string[];
  linkedAgentId?: string;
  faceCount: number;
  lastRegisteredAt?: string;
}

/**
 * 管理端「家人相册」：读取 user_known_person + 人脸模板，写操作转发到 node 内部接口
 * （识别/编码逻辑只保留在 node 侧，避免两套实现漂移）。
 */
@Provide()
export class AdminFaceService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(UserKnownPersonEntity)
  personModel: MongoRepository<UserKnownPersonEntity>;

  @InjectEntityModel(UserKnownPersonFaceEntity)
  faceModel: MongoRepository<UserKnownPersonFaceEntity>;

  async listPersons(userId: string): Promise<AdminFacePersonDTO[]> {
    if (!MongoObjectId.isValid(userId)) {
      throw new AppError('INVALID_USER_ID', 'user id is invalid', 400);
    }
    const uid = new MongoObjectId(userId);
    const persons = await this.personModel.find({
      where: { userId: uid, status: UserKnownPersonStatus.active } as never,
      order: { createdAt: 'DESC' } as never,
    } as never);
    if (!persons.length) {
      return [];
    }
    const faces = await this.faceModel.find({
      where: {
        userId: uid,
        status: UserKnownPersonFaceStatus.active,
      } as never,
    } as never);
    const byPerson = new Map<string, { count: number; last?: Date }>();
    for (const face of faces) {
      const key = String(face.personId);
      const current = byPerson.get(key) || { count: 0 };
      current.count += 1;
      if (!current.last || (face.createdAt && face.createdAt > current.last)) {
        current.last = face.createdAt;
      }
      byPerson.set(key, current);
    }

    return persons.map(person => {
      const key = String(person.id ?? (person as unknown as { _id: MongoObjectId })._id);
      const stats = byPerson.get(key);
      return {
        personId: key,
        name:
          person.preferredName?.trim() ||
          person.realName?.trim() ||
          person.relationToUser?.trim() ||
          '(未命名)',
        relation: person.relationToUser,
        aliases: person.aliases,
        linkedAgentId: person.linkedAgentId
          ? String(person.linkedAgentId)
          : undefined,
        faceCount: stats?.count ?? 0,
        lastRegisteredAt: stats?.last ? stats.last.toISOString() : undefined,
      };
    });
  }

  async registerFaces(input: {
    userId: string;
    personId: string;
    objectKeys?: string[];
    imageBase64s?: string[];
  }) {
    return this.callNode<{ stored: number; skipped: number }>(
      '/api/system/face/register',
      {
        userId: input.userId,
        personId: input.personId,
        objectKeys: input.objectKeys,
        imageBase64s: input.imageBase64s,
      }
    );
  }

  async mergePersons(input: {
    userId: string;
    sourcePersonId: string;
    targetPersonId: string;
  }) {
    return this.callNode<{ moved: number }>('/api/system/face/person/merge', input);
  }

  async deleteFaces(input: { userId: string; personId: string }) {
    return this.callNode<{ deleted: number }>('/api/system/face/person/delete', {
      userId: input.userId,
      personId: input.personId,
    });
  }

  async recognize(input: {
    userId: string;
    agentId?: string;
    objectKey?: string;
    imageBase64?: string;
  }) {
    return this.callNode<unknown>('/api/system/face/recognize', input);
  }

  private async callNode<T>(path: string, body: unknown): Promise<T> {
    const baseUrl =
      process.env.TZL_NODE_API_URL?.trim() || 'http://tzl_node:7001';
    const secret = process.env.INTERNAL_API_SECRET?.trim();
    if (!secret) {
      throw new AppError('INTERNAL_API_SECRET_MISSING', 'internal api secret not configured', 500);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
      // node 侧统一被 FormatMiddleware 包了一层 { success, code, data }，
      // 真正的业务结果在 data 里（{ ok, data | error }）。
      const raw = (await response.json()) as
        | NodeEnvelope<T>
        | { data?: NodeEnvelope<T> };
      const payload =
        (raw as { data?: NodeEnvelope<T> }).data ?? (raw as NodeEnvelope<T>);
      if (!payload?.ok) {
        const message = payload?.error || 'face service call failed';
        // 把 node 侧的业务错误映射成合理状态码，避免全部变成 502
        const status = /not found/i.test(message)
          ? 404
          : /cannot|invalid|same person|required/i.test(message)
            ? 400
            : 502;
        throw new AppError('FACE_NODE_CALL_FAILED', message, status);
      }
      return payload.data as T;
    } catch (error) {
      this.logger.error('[admin-face] node call failed, path=%s', path, error);
      throw new AppError(
        'FACE_SERVICE_UNAVAILABLE',
        error instanceof Error ? error.message : '人脸服务暂不可用',
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
