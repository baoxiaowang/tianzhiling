import { Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { ILogger } from '@midwayjs/logger';
import { randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import { AppError } from '@tzl/shared';
import {
  AgentEntity,
  AgentVoiceTrainingLinkEntity,
  MongoObjectId,
} from '@tzl/entities';

export interface AgentVtLinkInfo {
  token: string;
  userId: string;
  agentId: string;
  agentName?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 声音训练 Agent 工作台唯一链接管理。
 *
 * 每个账号一条生效链接；token 即访问密钥（高熵随机串）。
 * 链接生成时自动选定该账号的默认 AI 亲人（isDefault，无则最近创建），
 * 通过此链接训练完成的音色会直接绑定到该亲人。
 */
@Provide()
export class AgentVtTokenService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentVoiceTrainingLinkEntity)
  linkModel: MongoRepository<AgentVoiceTrainingLinkEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  /**
   * 获取（无则创建）指定用户的声音训练唯一链接。
   * 幂等：同一 userId 只保留一条。
   */
  async getOrCreateLink(userId: string): Promise<AgentVtLinkInfo> {
    const userObjectId = this.parseRequiredUserObjectId(userId);

    const existing = await this.linkModel.findOne({
      where: { userId: userObjectId },
    });
    if (existing) {
      return this.toLinkInfo(existing);
    }

    const targetAgent = await this.resolveDefaultRelative(userObjectId);
    if (!targetAgent) {
      throw new AppError(
        'AGENT_VT_NO_RELATIVE',
        '该用户名下没有可绑定的 AI 亲人，请先为用户创建智能体',
        409
      );
    }

    const now = new Date();
    const link = new AgentVoiceTrainingLinkEntity();
    link.token = this.generateToken();
    link.userId = userObjectId;
    link.agentId = targetAgent.id;
    link.agentName = targetAgent.name?.trim() || '未命名智能体';
    link.createdAt = now;
    link.updatedAt = now;

    await this.linkModel.save(link);

    this.logger.info(
      '[agent-vt] created link for userId=%s agentId=%s',
      userId,
      this.stringifyObjectId(targetAgent.id)
    );

    return this.toLinkInfo(link);
  }

  /**
   * 按 token 解析链接；不存在或格式非法抛 404。
   */
  async resolveByToken(token: string): Promise<AgentVtLinkInfo> {
    const normalized = token?.trim() ?? '';
    if (!normalized || normalized.length < 16 || normalized.length > 128) {
      throw new AppError('AGENT_VT_LINK_NOT_FOUND', 'invalid training link', 404);
    }

    const link = await this.linkModel.findOne({ where: { token: normalized } });
    if (!link) {
      throw new AppError('AGENT_VT_LINK_NOT_FOUND', 'training link not found', 404);
    }

    // 异步更新使用时间，不阻塞请求
    void this.linkModel.update(
      { token: normalized },
      { lastUsedAt: new Date() }
    );

    return this.toLinkInfo(link);
  }

  /** 解析并断言 token 归属的 userId（服务层强制隔离，不接受请求体 userId）。 */
  async resolveUserIdByToken(token: string): Promise<MongoObjectId> {
    const link = await this.resolveByToken(token);
    return link.userId as unknown as MongoObjectId;
  }

  /** 解析并断言 token 归属的目标亲人 agentId。 */
  async resolveAgentIdByToken(token: string): Promise<MongoObjectId> {
    const link = await this.resolveByToken(token);
    return link.agentId as unknown as MongoObjectId;
  }

  private async resolveDefaultRelative(
    userId: MongoObjectId
  ): Promise<AgentEntity | undefined> {
    const defaultAgent = await this.agentModel.findOne({
      where: { createdUserId: userId, isDefault: true },
    });
    if (defaultAgent) {
      return defaultAgent;
    }

    const latest = await this.agentModel.findOne({
      where: { createdUserId: userId },
      order: { createdAt: 'DESC' },
    });
    return latest ?? undefined;
  }

  private generateToken(): string {
    return `avt_${randomBytes(24).toString('hex')}`;
  }

  private toLinkInfo(link: AgentVoiceTrainingLinkEntity): AgentVtLinkInfo {
    return {
      token: link.token,
      userId: this.stringifyObjectId(link.userId),
      agentId: this.stringifyObjectId(link.agentId),
      agentName: link.agentName?.trim() || '未命名智能体',
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }

  private parseRequiredUserObjectId(value: string): MongoObjectId {
    const objectId = value?.trim();
    if (!objectId || !MongoObjectId.isValid(objectId)) {
      throw new AppError('INVALID_USER_ID', 'invalid userId', 400);
    }
    return new MongoObjectId(objectId);
  }

  private stringifyObjectId(value: unknown): string {
    if (value instanceof MongoObjectId) {
      return value.toHexString();
    }
    return String(value ?? '');
  }
}
