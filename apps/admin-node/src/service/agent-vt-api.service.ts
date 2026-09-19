import { Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { ILogger } from '@midwayjs/logger';
import { MongoRepository } from 'typeorm';
import { AppError } from '@tzl/shared';
import {
  AgentEntity,
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { AdminVoiceTimbreService } from './admin-voice-timbre.service';
import { AdminVoiceClippingService } from './admin-voice-clipping.service';
import { AdminVoiceTimbreMaterialService } from './admin-voice-timbre-material.service';

export interface AgentVtCreateTrainingInput {
  audioObjectKey?: string;
  audioObjectKeys?: string[];
  name?: string;
  provider?: string;
  speechDialect?: string;
  speechInstruction?: string;
  previewText?: string;
  speechSpeed?: number;
  speechVolume?: number;
}

export interface AgentVtBindResult {
  agentId: string;
  agentName?: string;
  timbreId: string;
}

/**
 * 声音训练 Agent 工作台受限操作。
 *
 * 安全边界（三重防线，调用方 controller 负责第一重 token 鉴权）：
 * 1. 所有方法只接受由 token 解析出的 userId / agentId，不接受请求体身份；
 * 2. 写操作前强制断言资源归属（timbre.userId === token.userId）；
 * 3. 越权一律 404（不暴露资源是否存在）。
 */
@Provide()
export class AgentVtApiService {
  @Logger()
  logger: ILogger;

  @Inject()
  adminVoiceTimbreService: AdminVoiceTimbreService;

  @Inject()
  adminVoiceClippingService: AdminVoiceClippingService;

  @Inject()
  adminVoiceTimbreMaterialService: AdminVoiceTimbreMaterialService;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  /** 该用户全部音色（受限视图）。 */
  async listTimbres(userId: MongoObjectId): Promise<unknown[]> {
    const result = await this.adminVoiceTimbreService.listVoiceTimbres({
      userId: userId.toHexString(),
      all: true,
    } as never);
    return result.items;
  }

  /** 豆包槽位（只读展示用）。 */
  async listSlots(): Promise<unknown> {
    return this.adminVoiceTimbreService.listDoubaoVoiceSlots();
  }

  /** 保存声音素材（与管理后台一致，同一用户同一 objectKey 去重）。 */
  async saveMaterial(
    userId: MongoObjectId,
    payload: { name?: string; objectKey: string; publicUrl?: string }
  ): Promise<unknown> {
    const objectKey = payload.objectKey?.trim();
    if (!objectKey) {
      throw new AppError('AGENT_VT_MATERIAL_REQUIRED', '缺少素材 objectKey', 400);
    }
    return this.adminVoiceTimbreMaterialService.create({
      userId: userId.toHexString(),
      name: payload.name?.trim() || `对话上传-${new Date().toISOString().slice(0, 10)}`,
      objectKey,
      publicUrl: payload.publicUrl?.trim(),
    });
  }

  /** 剪辑素材为训练片段（与管理后台第二步一致，走 node 底层剪辑工作流）。 */
  async clipMaterials(
    userId: MongoObjectId,
    payload: { materials: Array<{ name?: string; objectKey: string; publicUrl?: string }> }
  ): Promise<unknown> {
    const materials = (payload.materials || [])
      .map(m => ({ name: m.name?.trim(), objectKey: m.objectKey?.trim(), publicUrl: m.publicUrl?.trim() }))
      .filter(m => m.objectKey);
    if (!materials.length) {
      throw new AppError('AGENT_VT_MATERIAL_REQUIRED', '缺少待剪辑素材', 400);
    }
    return this.adminVoiceClippingService.createClips({
      userId: userId.toHexString(),
      materials,
    });
  }

  /** 创建训练：身份强制取自 token.userId，忽略请求体 userId。 */
  async createTraining(
    userId: MongoObjectId,
    payload: AgentVtCreateTrainingInput
  ): Promise<unknown> {
    const audioObjectKey = payload.audioObjectKey?.trim();
    const audioObjectKeys = (payload.audioObjectKeys || [])
      .map(k => k?.trim())
      .filter(Boolean);
    if (!audioObjectKey && !audioObjectKeys.length) {
      throw new AppError('AGENT_VT_AUDIO_REQUIRED', '请先上传训练音频', 400);
    }

    const provider = payload.provider?.trim() || 'qwen';
    const name =
      payload.name?.trim() ||
      `对话训练-${new Date().toISOString().slice(0, 10)}`;

    const common = {
      userId: userId.toHexString(),
      name,
      provider,
      speechDialect: payload.speechDialect?.trim(),
      speechInstruction: payload.speechInstruction?.trim(),
      previewText: payload.previewText?.trim(),
      speechSpeed: payload.speechSpeed,
      speechVolume: payload.speechVolume,
    };

    // 与管理后台一致：勾选片段走多段合并训练，无片段时按单段音频创建
    if (audioObjectKeys.length) {
      return await this.adminVoiceTimbreService.mergeCreateVoiceTimbre({
        ...common,
        audioObjectKeys,
      } as never);
    }

    return await this.adminVoiceTimbreService.createVoiceTimbre({
      ...common,
      audioObjectKey: audioObjectKey as string,
    } as never);
  }

  /** 重试训练：先断言归属，越权 404。 */
  async retryTraining(
    userId: MongoObjectId,
    timbreId: string
  ): Promise<unknown> {
    const timbre = await this.findOwnedTimbre(userId, timbreId);
    if (!timbre) {
      throw new AppError('AGENT_VT_TIMBRE_NOT_FOUND', '音色不存在', 404);
    }
    return this.adminVoiceTimbreService.retryVoiceTimbreCreate(timbreId);
  }

  /**
   * 绑定音色到该账号的目标 AI 亲人（agentId 由 token 决定，不接受请求体）。
   * 不限服务商：音色 active 即可绑定。
   */
  async bindToRelative(
    userId: MongoObjectId,
    timbreId: string,
    agentId: MongoObjectId
  ): Promise<AgentVtBindResult> {
    const timbre = await this.findOwnedTimbre(userId, timbreId);
    if (!timbre) {
      throw new AppError('AGENT_VT_TIMBRE_NOT_FOUND', '音色不存在', 404);
    }
    if (timbre.status !== VoiceTimbreStatus.active) {
      throw new AppError(
        'AGENT_VT_TIMBRE_NOT_ACTIVE',
        '音色训练完成后才能绑定，请稍后再试',
        409
      );
    }

    const agent =
      (await this.agentModel.findOne({ where: { id: agentId } })) ??
      (await this.agentModel.findOne({
        where: { _id: agentId } as never,
      }));
    if (!agent) {
      throw new AppError('AGENT_VT_RELATIVE_NOT_FOUND', 'AI 亲人不存在', 404);
    }
    if (
      agent.createdUserId?.toHexString?.() !== userId.toHexString() &&
      String(agent.createdUserId ?? '') !== userId.toHexString()
    ) {
      throw new AppError('AGENT_VT_RELATIVE_NOT_FOUND', 'AI 亲人不存在', 404);
    }

    agent.voiceTimbreId = timbre.id;
    agent.pendingVoiceTimbreId = undefined;
    agent.voiceTimbreSelectedAt = new Date();
    agent.updatedAt = new Date();
    await this.agentModel.save(agent);

    this.logger.info(
      '[agent-vt] bound timbre=%s to agent=%s',
      timbreId,
      agentId.toHexString()
    );

    return {
      agentId: agentId.toHexString(),
      agentName: agent.name?.trim() || '未命名智能体',
      timbreId: this.stringifyObjectId(timbre.id),
    };
  }

  /** 归属断言：音色必须属于 token.userId；不属于返回 undefined（统一 404）。 */
  private async findOwnedTimbre(
    userId: MongoObjectId,
    timbreId: string
  ): Promise<VoiceTimbreEntity | undefined> {
    const objectId = timbreId?.trim();
    if (!objectId || !MongoObjectId.isValid(objectId)) {
      return undefined;
    }
    const timbre =
      (await this.voiceTimbreModel.findOne({
        where: { id: new MongoObjectId(objectId) },
      })) ??
      (await this.voiceTimbreModel.findOne({
        where: { _id: new MongoObjectId(objectId) } as never,
      }));
    if (!timbre) {
      return undefined;
    }
    const owned =
      timbre.userId?.toHexString?.() === userId.toHexString() ||
      String(timbre.userId ?? '') === userId.toHexString();
    if (!owned) {
      return undefined;
    }
    return timbre;
  }

  private stringifyObjectId(value: unknown): string {
    if (value instanceof MongoObjectId) {
      return value.toHexString();
    }
    return String(value ?? '');
  }
}
