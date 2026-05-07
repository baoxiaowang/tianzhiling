import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminVoicePackageListDTO,
  AdminVoicePackageRecordDTO,
  AdminVoiceTrainingTaskListDTO,
  AdminVoiceTrainingTaskRecordDTO,
  CompleteAdminVoiceTrainingTaskDTO as CompleteTaskData,
  SaveAdminVoicePackageDTO as SavePackageData,
  VoicePackageDeliverableDTO,
  VoiceTrainingTaskAgentDTO,
  VoiceTrainingTaskUserDTO,
} from '@tzl/shared';
import {
  AgentEntity,
  MongoObjectId,
  OrderEntity,
  UserAccountEntity,
  UserEntity,
  VoicePackageEntity,
  VoicePackageStatus,
  VoiceTimbreEntity,
  VoiceTimbreStatus,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminVoicePackagesQueryDTO,
  ListAdminVoiceTrainingTasksQueryDTO,
  SaveAdminVoicePackageDTO,
  UpdateAdminVoiceTrainingTaskDTO,
} from '../dto/admin-voice-package.dto';

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminVoicePackageService {
  @InjectEntityModel(VoicePackageEntity)
  voicePackageModel: MongoRepository<VoicePackageEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  async listVoicePackages(
    query: ListAdminVoicePackagesQueryDTO
  ): Promise<AdminVoicePackageListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const where = this.buildPackageSearchWhere(query);
    const [total, packages] = await Promise.all([
      this.voicePackageModel.count(where),
      this.voicePackageModel.find({
        where: where as never,
        order: {
          sort: 'ASC',
          updatedAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: packages.map(item => this.buildPackageRecord(item)),
      total,
      page,
      pageSize,
    };
  }

  async createVoicePackage(
    payload: SaveAdminVoicePackageDTO
  ): Promise<AdminVoicePackageRecordDTO> {
    const normalized = this.normalizePackagePayload(payload);
    await this.assertPackageCodeAvailable(normalized.code);

    const now = new Date();
    const voicePackage = new VoicePackageEntity();
    Object.assign(voicePackage, normalized, {
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.voicePackageModel.save(voicePackage);

    return this.buildPackageRecord(saved);
  }

  async updateVoicePackage(
    packageId: string,
    payload: SaveAdminVoicePackageDTO
  ): Promise<AdminVoicePackageRecordDTO> {
    const voicePackage = await this.getPackageById(packageId);
    const normalized = this.normalizePackagePayload(payload);

    if (normalized.code !== voicePackage.code) {
      await this.assertPackageCodeAvailable(normalized.code, voicePackage.id);
    }

    Object.assign(voicePackage, normalized, {
      updatedAt: new Date(),
    });
    const saved = await this.voicePackageModel.save(voicePackage);

    return this.buildPackageRecord(saved);
  }

  async listTrainingTasks(
    query: ListAdminVoiceTrainingTasksQueryDTO
  ): Promise<AdminVoiceTrainingTaskListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const where = await this.buildTaskSearchWhere(query);
    const [total, tasks] = await Promise.all([
      this.voiceTrainingTaskModel.count(where),
      this.voiceTrainingTaskModel.find({
        where: where as never,
        order: {
          updatedAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const context = await this.buildTaskContext(tasks);

    return {
      items: tasks.map(task => this.buildTaskRecord(task, context)),
      total,
      page,
      pageSize,
    };
  }

  async updateTrainingTask(
    taskId: string,
    payload: UpdateAdminVoiceTrainingTaskDTO
  ): Promise<AdminVoiceTrainingTaskRecordDTO> {
    const task = await this.getTaskById(taskId);
    let changed = false;

    if (payload.status !== undefined) {
      task.status = this.normalizeEditableTaskStatus(payload.status);
      changed = true;
    }

    if (payload.assigneeName !== undefined) {
      task.assigneeName = payload.assigneeName.trim();
      changed = true;
    }

    if (payload.materialObjectKeys !== undefined) {
      task.materialObjectKeys = payload.materialObjectKeys
        .map(item => item.trim())
        .filter(Boolean);
      changed = true;
    }

    if (payload.remark !== undefined) {
      task.remark = payload.remark.trim();
      changed = true;
    }

    if (changed) {
      task.updatedAt = new Date();
      await this.voiceTrainingTaskModel.save(task);
    }

    const context = await this.buildTaskContext([task]);
    return this.buildTaskRecord(task, context);
  }

  async completeTrainingTask(
    taskId: string,
    payload: CompleteTaskData
  ): Promise<AdminVoiceTrainingTaskRecordDTO> {
    const task = await this.getTaskById(taskId);
    const timbre = await this.getActiveVoiceTimbre(payload.voiceTimbreId);
    const agent = await this.getAgentById(task.agentId);

    if (task.status === VoiceTrainingTaskStatus.refunded) {
      throw new AppError(
        'VOICE_TRAINING_TASK_REFUNDED',
        'refunded task cannot be completed',
        400
      );
    }

    agent.voiceTimbreId = timbre.id;
    agent.updatedAt = new Date();
    task.voiceTimbreId = timbre.id;
    task.status = VoiceTrainingTaskStatus.completed;
    task.remark = payload.remark?.trim() ?? task.remark ?? '';
    task.completedAt = new Date();
    task.updatedAt = new Date();

    await this.agentModel.save(agent);
    await this.voiceTrainingTaskModel.save(task);

    const context = await this.buildTaskContext([task]);
    return this.buildTaskRecord(task, context);
  }

  private buildPackageSearchWhere(
    query: ListAdminVoicePackagesQueryDTO
  ): MongoWhere {
    const where: MongoWhere = {};
    const status = this.normalizeOptionalPackageStatus(query?.status);
    const keyword = query?.keyword?.trim() ?? '';

    if (status) {
      where.status = status;
    }

    if (!keyword) {
      return where;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const filters: MongoWhere[] = [
      { code: { $regex: escapedKeyword, $options: 'i' } },
      { name: { $regex: escapedKeyword, $options: 'i' } },
      { description: { $regex: escapedKeyword, $options: 'i' } },
      { materialRequirement: { $regex: escapedKeyword, $options: 'i' } },
    ];

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);
      filters.push({ id: objectId });
      filters.push({ _id: objectId });
    }

    return Object.keys(where).length ? { $and: [where, { $or: filters }] } : { $or: filters };
  }

  private async buildTaskSearchWhere(
    query: ListAdminVoiceTrainingTasksQueryDTO
  ): Promise<MongoWhere> {
    const where: MongoWhere = {};
    const status = this.normalizeOptionalTaskStatus(query?.status);
    const agentId = this.normalizeOptionalObjectId(query?.agentId);
    const userId = this.normalizeOptionalObjectId(query?.userId);
    const keyword = query?.keyword?.trim() ?? '';

    if (status) {
      where.status = status;
    }

    if (agentId) {
      where.agentId = agentId;
    }

    if (userId) {
      where.userId = userId;
    }

    if (!keyword) {
      return where;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const filters: MongoWhere[] = [
      { voicePackageCode: { $regex: escapedKeyword, $options: 'i' } },
      { assigneeName: { $regex: escapedKeyword, $options: 'i' } },
      { remark: { $regex: escapedKeyword, $options: 'i' } },
    ];
    const [matchedOrderIds, matchedAgentIds, matchedUserIds] =
      await Promise.all([
        this.findOrderIdsByKeyword(escapedKeyword),
        this.findAgentIdsByKeyword(escapedKeyword),
        this.findUserIdsByKeyword(escapedKeyword),
      ]);

    if (matchedOrderIds.length > 0) {
      filters.push({ orderId: { $in: matchedOrderIds } });
    }

    if (matchedAgentIds.length > 0) {
      filters.push({ agentId: { $in: matchedAgentIds } });
    }

    if (matchedUserIds.length > 0) {
      filters.push({ userId: { $in: matchedUserIds } });
    }

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);
      filters.push({ id: objectId });
      filters.push({ _id: objectId });
      filters.push({ orderId: objectId });
      filters.push({ agentId: objectId });
      filters.push({ userId: objectId });
      filters.push({ voicePackageId: objectId });
    }

    return Object.keys(where).length ? { $and: [where, { $or: filters }] } : { $or: filters };
  }

  private normalizePackagePayload(
    payload: SaveAdminVoicePackageDTO
  ): SavePackageData {
    return {
      code: this.normalizeCode(payload.code),
      name: payload.name.trim(),
      description: payload.description?.trim() ?? '',
      priceAmount: this.normalizeAmount(payload.priceAmount),
      originalPriceAmount: this.normalizeOptionalAmount(
        payload.originalPriceAmount
      ),
      currency: payload.currency?.trim() || 'CNY',
      deliverables: this.normalizeDeliverables(payload.deliverables),
      materialRequirement: payload.materialRequirement?.trim() ?? '',
      estimatedServiceDays: this.normalizeOptionalPositiveInteger(
        payload.estimatedServiceDays
      ),
      status: this.normalizePackageStatus(payload.status),
      sort: this.normalizeNonNegativeInteger(payload.sort, 0),
    };
  }

  private normalizeDeliverables(
    deliverables?: VoicePackageDeliverableDTO[]
  ): VoicePackageDeliverableDTO[] {
    return (deliverables ?? [])
      .map(item => ({
        title: item.title?.trim() ?? '',
        description: item.description?.trim() || undefined,
      }))
      .filter(item => item.title);
  }

  private buildPackageRecord(
    voicePackage: VoicePackageEntity
  ): AdminVoicePackageRecordDTO {
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
      status: voicePackage.status,
      sort: voicePackage.sort,
      createdAt: this.formatDate(voicePackage.createdAt),
      updatedAt: this.formatDate(voicePackage.updatedAt),
    };
  }

  private async buildTaskContext(tasks: VoiceTrainingTaskEntity[]): Promise<{
    userMap: Map<string, VoiceTrainingTaskUserDTO>;
    agentMap: Map<string, VoiceTrainingTaskAgentDTO>;
    orderMap: Map<string, OrderEntity>;
    packageMap: Map<string, VoicePackageEntity>;
  }> {
    const userIds = this.uniqueObjectIds(tasks.map(task => task.userId));
    const agentIds = this.uniqueObjectIds(tasks.map(task => task.agentId));
    const orderIds = this.uniqueObjectIds(tasks.map(task => task.orderId));
    const packageIds = this.uniqueObjectIds(
      tasks.map(task => task.voicePackageId)
    );
    const [users, accounts, agents, orders, packages] = await Promise.all([
      userIds.length
        ? this.userModel.find({ where: { $or: [{ id: { $in: userIds } }, { _id: { $in: userIds } }] } as never })
        : [],
      userIds.length
        ? this.userAccountModel.find({ where: { userId: { $in: userIds } } as never })
        : [],
      agentIds.length
        ? this.agentModel.find({ where: { $or: [{ id: { $in: agentIds } }, { _id: { $in: agentIds } }] } as never })
        : [],
      orderIds.length
        ? this.orderModel.find({ where: { $or: [{ id: { $in: orderIds } }, { _id: { $in: orderIds } }] } as never })
        : [],
      packageIds.length
        ? this.voicePackageModel.find({ where: { $or: [{ id: { $in: packageIds } }, { _id: { $in: packageIds } }] } as never })
        : [],
    ]);
    const accountMap = new Map<string, string>();
    accounts.forEach(account => {
      accountMap.set(this.stringifyObjectId(account.userId), account.account);
    });

    const userMap = new Map<string, VoiceTrainingTaskUserDTO>();
    users.forEach(user => {
      const id = this.stringifyObjectId(this.getEntityObjectId(user));
      userMap.set(id, {
        id,
        account: accountMap.get(id) ?? user.phone ?? '',
        name: user.name ?? '',
        phone: user.phone ?? accountMap.get(id) ?? '',
      });
    });

    const agentMap = new Map<string, VoiceTrainingTaskAgentDTO>();
    agents.forEach(agent => {
      const id = this.stringifyObjectId(this.getEntityObjectId(agent));
      agentMap.set(id, {
        id,
        name: agent.name ?? '',
        avatar: agent.avatar ?? '',
      });
    });

    const orderMap = new Map<string, OrderEntity>();
    orders.forEach(order => {
      orderMap.set(this.stringifyObjectId(this.getEntityObjectId(order)), order);
    });

    const packageMap = new Map<string, VoicePackageEntity>();
    packages.forEach(item => {
      packageMap.set(this.stringifyObjectId(this.getEntityObjectId(item)), item);
    });

    return { userMap, agentMap, orderMap, packageMap };
  }

  private buildTaskRecord(
    task: VoiceTrainingTaskEntity,
    context: {
      userMap: Map<string, VoiceTrainingTaskUserDTO>;
      agentMap: Map<string, VoiceTrainingTaskAgentDTO>;
      orderMap: Map<string, OrderEntity>;
      packageMap: Map<string, VoicePackageEntity>;
    }
  ): AdminVoiceTrainingTaskRecordDTO {
    const userId = this.stringifyObjectId(task.userId);
    const agentId = this.stringifyObjectId(task.agentId);
    const orderId = this.stringifyObjectId(task.orderId);
    const voicePackageId = this.stringifyObjectId(task.voicePackageId);
    const order = context.orderMap.get(orderId);
    const voicePackage = context.packageMap.get(voicePackageId);

    return {
      id: this.stringifyObjectId(task.id),
      userId,
      user: context.userMap.get(userId),
      agentId,
      agent: context.agentMap.get(agentId),
      orderId,
      orderNo: order?.orderNo,
      voicePackageId,
      voicePackageCode: task.voicePackageCode,
      voicePackageName: voicePackage?.name ?? order?.title,
      status: task.status,
      assigneeName: task.assigneeName ?? '',
      materialObjectKeys: task.materialObjectKeys ?? [],
      voiceTimbreId: task.voiceTimbreId
        ? this.stringifyObjectId(task.voiceTimbreId)
        : undefined,
      remark: task.remark ?? '',
      paidAt: this.formatDate(task.paidAt),
      completedAt: this.formatDate(task.completedAt),
      createdAt: this.formatDate(task.createdAt),
      updatedAt: this.formatDate(task.updatedAt),
    };
  }

  private async assertPackageCodeAvailable(
    code: string,
    exceptId?: MongoObjectId
  ): Promise<void> {
    const existing = await this.voicePackageModel.findOne({
      where: {
        code,
      },
    });

    if (
      existing &&
      (!exceptId ||
        this.stringifyObjectId(existing.id) !== this.stringifyObjectId(exceptId))
    ) {
      throw new AppError(
        'VOICE_PACKAGE_CODE_EXISTS',
        'voice package code already exists',
        400
      );
    }
  }

  private async getPackageById(packageId: string): Promise<VoicePackageEntity> {
    const objectId = this.parseObjectId(packageId, 'INVALID_VOICE_PACKAGE_ID');
    const voicePackage =
      (await this.voicePackageModel.findOne({ where: { id: objectId } })) ??
      (await this.voicePackageModel.findOne({
        where: { _id: objectId } as never,
      }));

    if (!voicePackage) {
      throw new AppError('VOICE_PACKAGE_NOT_FOUND', 'voice package not found', 404);
    }

    return voicePackage;
  }

  private async getTaskById(taskId: string): Promise<VoiceTrainingTaskEntity> {
    const objectId = this.parseObjectId(taskId, 'INVALID_VOICE_TRAINING_TASK_ID');
    const task =
      (await this.voiceTrainingTaskModel.findOne({ where: { id: objectId } })) ??
      (await this.voiceTrainingTaskModel.findOne({
        where: { _id: objectId } as never,
      }));

    if (!task) {
      throw new AppError(
        'VOICE_TRAINING_TASK_NOT_FOUND',
        'voice training task not found',
        404
      );
    }

    return task;
  }

  private async getAgentById(agentId: MongoObjectId): Promise<AgentEntity> {
    const agent =
      (await this.agentModel.findOne({ where: { id: agentId } })) ??
      (await this.agentModel.findOne({ where: { _id: agentId } as never }));

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return agent;
  }

  private async getActiveVoiceTimbre(
    timbreId: string
  ): Promise<VoiceTimbreEntity> {
    const objectId = this.parseObjectId(timbreId, 'INVALID_VOICE_TIMBRE_ID');
    const timbre =
      (await this.voiceTimbreModel.findOne({ where: { id: objectId } })) ??
      (await this.voiceTimbreModel.findOne({
        where: { _id: objectId } as never,
      }));

    if (!timbre || timbre.status !== VoiceTimbreStatus.active) {
      throw new AppError(
        'VOICE_TIMBRE_NOT_ACTIVE',
        'voice timbre is not active',
        400
      );
    }

    return timbre;
  }

  private async findOrderIdsByKeyword(
    escapedKeyword: string
  ): Promise<MongoObjectId[]> {
    const orders = await this.orderModel.find({
      where: {
        $or: [
          { orderNo: { $regex: escapedKeyword, $options: 'i' } },
          { title: { $regex: escapedKeyword, $options: 'i' } },
          { targetCode: { $regex: escapedKeyword, $options: 'i' } },
          { paymentTradeNo: { $regex: escapedKeyword, $options: 'i' } },
        ],
      } as never,
      take: 200,
    });

    return this.uniqueObjectIds(orders.map(order => this.getEntityObjectId(order)));
  }

  private async findAgentIdsByKeyword(
    escapedKeyword: string
  ): Promise<MongoObjectId[]> {
    const agents = await this.agentModel.find({
      where: {
        name: { $regex: escapedKeyword, $options: 'i' },
      } as never,
      take: 200,
    });

    return this.uniqueObjectIds(agents.map(agent => this.getEntityObjectId(agent)));
  }

  private async findUserIdsByKeyword(
    escapedKeyword: string
  ): Promise<MongoObjectId[]> {
    const [users, accounts] = await Promise.all([
      this.userModel.find({
        where: {
          $or: [
            { name: { $regex: escapedKeyword, $options: 'i' } },
            { phone: { $regex: escapedKeyword, $options: 'i' } },
          ],
        } as never,
        take: 200,
      }),
      this.userAccountModel.find({
        where: {
          account: { $regex: escapedKeyword, $options: 'i' },
        } as never,
        take: 200,
      }),
    ]);

    return this.uniqueObjectIds([
      ...users.map(user => this.getEntityObjectId(user)),
      ...accounts.map(account => account.userId),
    ]);
  }

  private normalizeEditableTaskStatus(value: string): VoiceTrainingTaskStatus {
    const status = this.normalizeOptionalTaskStatus(value);

    if (status && status !== VoiceTrainingTaskStatus.completed) {
      return status;
    }

    throw new AppError(
      'INVALID_VOICE_TRAINING_TASK_STATUS',
      'invalid voice training task status',
      400
    );
  }

  private normalizeOptionalTaskStatus(
    value?: string
  ): VoiceTrainingTaskStatus | undefined {
    return Object.values(VoiceTrainingTaskStatus).includes(
      value as VoiceTrainingTaskStatus
    )
      ? (value as VoiceTrainingTaskStatus)
      : undefined;
  }

  private normalizeOptionalPackageStatus(
    value?: string
  ): VoicePackageStatus | undefined {
    return Object.values(VoicePackageStatus).includes(
      value as VoicePackageStatus
    )
      ? (value as VoicePackageStatus)
      : undefined;
  }

  private normalizePackageStatus(value?: string): VoicePackageStatus {
    return this.normalizeOptionalPackageStatus(value) ?? VoicePackageStatus.active;
  }

  private normalizeCode(value: string): string {
    const code = value?.trim().toLowerCase();

    if (!code) {
      throw new AppError('INVALID_VOICE_PACKAGE_CODE', 'code is required');
    }

    return code;
  }

  private normalizeAmount(value?: number): number {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0) {
      throw new AppError('INVALID_AMOUNT', 'amount is invalid');
    }

    return Math.round(amount);
  }

  private normalizeOptionalAmount(value?: number): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    return this.normalizeAmount(value);
  }

  private normalizePositiveInteger(
    value: unknown,
    fallback: number
  ): number {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private normalizeOptionalPositiveInteger(value?: number): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private normalizeNonNegativeInteger(
    value: unknown,
    fallback: number
  ): number {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private normalizeOptionalObjectId(value?: string): MongoObjectId | undefined {
    const normalized = value?.trim();

    if (!normalized) {
      return undefined;
    }

    return this.parseObjectId(normalized, 'INVALID_OBJECT_ID');
  }

  private parseObjectId(value: string, code: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(code, 'object id is invalid', 400);
    }

    return new MongoObjectId(value);
  }

  private uniqueObjectIds(values: Array<MongoObjectId | undefined>): MongoObjectId[] {
    const seen = new Set<string>();

    return values.filter((value): value is MongoObjectId => {
      if (!value) {
        return false;
      }

      const id = this.stringifyObjectId(value);

      if (seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });
  }

  private getEntityObjectId(entity: { id?: MongoObjectId; _id?: MongoObjectId }): MongoObjectId {
    return entity.id ?? entity._id;
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private formatDate(value?: Date): string {
    return value
      ? value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString()
      : '';
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
