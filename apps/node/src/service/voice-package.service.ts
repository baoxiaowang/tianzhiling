import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  MongoObjectId,
  OrderEntity,
  VoicePackageEntity,
  VoicePackageStatus,
  VoiceTrainingTaskEntity,
} from '@tzl/entities';
import type {
  AgentVoicePackageCenterDTO,
  VoicePackageRecordDTO,
  VoiceTrainingTaskRecordDTO,
} from '@tzl/shared';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { AuthenticatedUserPayload } from '../interface';

@Provide()
export class VoicePackageService {
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(VoicePackageEntity)
  voicePackageModel: MongoRepository<VoicePackageEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  async getAgentVoicePackageCenter(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentVoicePackageCenterDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const agent = await this.getUserAgent(userId, agentId);
    const [packages, task] = await Promise.all([
      this.listActiveVoicePackages(),
      this.findLatestTaskByAgent(agent.id),
    ]);

    return {
      packages,
      task: task ? await this.buildTaskRecord(task) : undefined,
    };
  }

  private async listActiveVoicePackages(): Promise<VoicePackageRecordDTO[]> {
    const packages = await this.voicePackageModel.find({
      where: {
        status: VoicePackageStatus.active,
      },
      order: {
        sort: 'ASC',
        priceAmount: 'ASC',
      },
    });

    return packages.map(item => this.buildPackageRecord(item));
  }

  private async findLatestTaskByAgent(
    agentId: MongoObjectId
  ): Promise<VoiceTrainingTaskEntity | null> {
    const tasks = await this.voiceTrainingTaskModel.find({
      where: {
        agentId,
      },
      order: {
        updatedAt: 'DESC',
      },
      take: 1,
    });

    return tasks[0] ?? null;
  }

  private async getUserAgent(
    userId: MongoObjectId,
    agentId: string
  ): Promise<AgentEntity> {
    const objectId = this.parseObjectId(agentId, 'INVALID_AGENT_ID');
    const agent =
      (await this.agentModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.agentModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!agent || this.stringifyObjectId(agent.createdUserId) !== String(userId)) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return agent;
  }

  private buildPackageRecord(
    voicePackage: VoicePackageEntity
  ): VoicePackageRecordDTO {
    return {
      id: this.stringifyObjectId(voicePackage.id),
      code: voicePackage.code,
      name: voicePackage.name,
      description: voicePackage.description ?? '',
      priceAmount: voicePackage.priceAmount,
      originalPriceAmount: voicePackage.originalPriceAmount,
      currency: voicePackage.currency || 'CNY',
      deliverables: voicePackage.deliverables ?? [],
      materialRequirement: voicePackage.materialRequirement ?? '',
      estimatedServiceDays: voicePackage.estimatedServiceDays,
    };
  }

  private async buildTaskRecord(
    task: VoiceTrainingTaskEntity
  ): Promise<VoiceTrainingTaskRecordDTO> {
    const order = await this.orderModel.findOne({
      where: {
        id: task.orderId,
      },
    });
    const packageSnapshot = order?.snapshot?.voicePackage as
      | Record<string, unknown>
      | undefined;

    return {
      id: this.stringifyObjectId(task.id),
      agentId: this.stringifyObjectId(task.agentId),
      orderId: this.stringifyObjectId(task.orderId),
      voicePackageId: this.stringifyObjectId(task.voicePackageId),
      voicePackageCode: task.voicePackageCode,
      voicePackageName:
        typeof packageSnapshot?.name === 'string'
          ? packageSnapshot.name
          : undefined,
      status: task.status,
      voiceTimbreId: task.voiceTimbreId
        ? this.stringifyObjectId(task.voiceTimbreId)
        : undefined,
      remark: task.remark ?? '',
      paidAt: this.formatDate(task.paidAt),
      completedAt: this.formatDate(task.completedAt),
      createdAt: this.formatDate(task.createdAt) ?? '',
      updatedAt: this.formatDate(task.updatedAt) ?? '',
    };
  }

  private parseObjectId(value: string, code: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(code, 'object id is invalid', code === 'INVALID_TOKEN' ? 401 : 400);
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private formatDate(value?: Date): string | undefined {
    if (!value) {
      return undefined;
    }

    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
