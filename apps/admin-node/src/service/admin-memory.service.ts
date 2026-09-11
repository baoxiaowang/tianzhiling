import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentProfileFactEntity,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { ListAdminMemoriesQueryDTO } from '../dto/admin-memory.dto';

type MongoWhere = Record<string, unknown>;

/**
 * 记忆系统修复：后台记忆事实管理服务。
 * 提供记忆事实列表查询，支持按 status 筛选（默认返回所有状态，含 archived），
 * 便于后台排查 candidate / conflicted / rejected 等中间态事实。
 */
@Provide()
export class AdminMemoryService {
  @InjectEntityModel(AgentProfileFactEntity)
  agentProfileFactModel: MongoRepository<AgentProfileFactEntity>;

  async listFacts(query: ListAdminMemoriesQueryDTO) {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      200
    );
    const skip = (page - 1) * pageSize;

    const where: MongoWhere = {};

    // 记忆系统修复：默认返回所有状态；仅当显式传入 status 时才过滤
    if (query?.status) {
      where.status = query.status;
    }

    if (query?.agentId) {
      where.agentId = this.toObjectIdOrString(query.agentId);
    }

    if (query?.userId) {
      where.userId = this.toObjectIdOrString(query.userId);
    }

    if (query?.type) {
      where.type = query.type;
    }

    const keyword = query?.keyword?.trim();
    if (keyword) {
      const regex = new RegExp(this.escapeRegExp(keyword), 'i');
      where.$or = [{ key: regex }, { value: regex }, { sourceText: regex }];
    }

    const [total, facts] = await Promise.all([
      this.agentProfileFactModel.count(where as never),
      this.agentProfileFactModel.find({
        where: where as never,
        order: { updatedAt: 'DESC' },
        skip,
        take: pageSize,
      }),
    ]);

    return {
      items: facts.map(fact => ({
        id: this.stringifyObjectId(fact.id as MongoObjectId),
        userId: this.stringifyObjectId(fact.userId),
        agentId: this.stringifyObjectId(fact.agentId),
        type: fact.type,
        key: fact.key ?? '',
        value: fact.value ?? '',
        polarity: fact.polarity,
        confidence: fact.confidence,
        status: fact.status,
        assertionPolicy: fact.assertionPolicy ?? '',
        priority: fact.priority ?? 0,
        supportCount: fact.supportCount ?? 0,
        sourceText: fact.sourceText ?? '',
        sourceMessageId: fact.sourceMessageId
          ? this.stringifyObjectId(fact.sourceMessageId)
          : '',
        conflictingValues: fact.conflictingValues ?? [],
        createdAt: this.formatDate(fact.createdAt),
        updatedAt: this.formatDate(fact.updatedAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  private normalizePositiveInteger(
    rawValue: string | number | undefined,
    fallback: number
  ): number {
    const value = Number(rawValue);

    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }

  private toObjectIdOrString(value: string): MongoObjectId | string {
    return MongoObjectId.isValid(value) ? new MongoObjectId(value) : value;
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value ?? '');
  }

  private formatDate(value?: Date): string {
    if (!value) {
      return '';
    }

    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
