import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminVipPlanListDTO,
  AdminVipPlanRecordDTO,
  SaveAdminVipPlanDTO as SaveAdminVipPlanData,
  VipPlanBenefitDTO,
  VipPlanEntitlementGrantDTO,
} from '@tzl/shared';
import {
  AgentEntitlementType,
  MongoObjectId,
  VipPlanEntity,
  VipPlanStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminVipPlansQueryDTO,
  SaveAdminVipPlanDTO,
} from '../dto/admin-vip-plan.dto';

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminVipPlanService {
  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  async listVipPlans(
    query: ListAdminVipPlansQueryDTO
  ): Promise<AdminVipPlanListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const where = this.buildSearchWhere(query);
    const [total, plans] = await Promise.all([
      this.vipPlanModel.count(where),
      this.vipPlanModel.find({
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
      items: plans.map(plan => this.buildVipPlanRecord(plan)),
      total,
      page,
      pageSize,
    };
  }

  async createVipPlan(
    payload: SaveAdminVipPlanDTO
  ): Promise<AdminVipPlanRecordDTO> {
    const normalized = this.normalizePayload(payload);
    await this.assertCodeAvailable(normalized.code);

    const now = new Date();
    const plan = new VipPlanEntity();
    Object.assign(plan, normalized, {
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.vipPlanModel.save(plan);

    return this.buildVipPlanRecord(saved);
  }

  async updateVipPlan(
    planId: string,
    payload: SaveAdminVipPlanDTO
  ): Promise<AdminVipPlanRecordDTO> {
    const plan = await this.getVipPlanById(planId);
    const normalized = this.normalizePayload(payload);

    if (normalized.code !== plan.code) {
      await this.assertCodeAvailable(normalized.code, plan.id);
    }

    Object.assign(plan, normalized, {
      updatedAt: new Date(),
    });
    const saved = await this.vipPlanModel.save(plan);

    return this.buildVipPlanRecord(saved);
  }

  private buildSearchWhere(query: ListAdminVipPlansQueryDTO): MongoWhere {
    const where: MongoWhere = {};
    const status = this.normalizeOptionalStatus(query?.status);
    const keyword = query?.keyword?.trim() ?? '';

    if (status) {
      where.status = status;
    }

    if (!keyword) {
      return where;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const keywordFilters: MongoWhere[] = [
      { code: { $regex: escapedKeyword, $options: 'i' } },
      { name: { $regex: escapedKeyword, $options: 'i' } },
      { description: { $regex: escapedKeyword, $options: 'i' } },
    ];

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);

      keywordFilters.push({ id: objectId });
      keywordFilters.push({ _id: objectId });
    }

    return {
      ...where,
      $or: keywordFilters,
    };
  }

  private normalizePayload(payload: SaveAdminVipPlanDTO): SaveAdminVipPlanData {
    const lifetime = Boolean(payload.lifetime);
    const durationDays = lifetime
      ? undefined
      : this.normalizeOptionalPositiveInteger(payload.durationDays);

    if (!lifetime && durationDays === undefined) {
      throw new AppError(
        'INVALID_VIP_PLAN_DURATION',
        'durationDays is required when lifetime is false'
      );
    }

    return {
      code: this.normalizeCode(payload.code),
      name: payload.name.trim(),
      description: payload.description?.trim() ?? '',
      priceAmount: this.normalizeAmount(payload.priceAmount),
      originalPriceAmount: this.normalizeOptionalAmount(
        payload.originalPriceAmount
      ),
      currency: payload.currency?.trim() || 'CNY',
      durationDays,
      lifetime,
      benefits: this.normalizeBenefits(payload.benefits),
      entitlementGrants: this.normalizeEntitlementGrants(
        payload.entitlementGrants
      ),
      couponGrantAmount: this.normalizeOptionalAmount(
        payload.couponGrantAmount
      ),
      status: this.normalizeStatus(payload.status),
      sort: this.normalizeNonNegativeInteger(payload.sort, 0),
    };
  }

  private normalizeBenefits(
    benefits?: VipPlanBenefitDTO[]
  ): VipPlanBenefitDTO[] {
    return (benefits ?? [])
      .map(item => ({
        title: item.title?.trim() ?? '',
        description: item.description?.trim() || undefined,
      }))
      .filter(item => item.title);
  }

  private normalizeEntitlementGrants(
    grants?: Array<{
      type: string;
      totalQuota: number;
      durationDays?: number;
    }>
  ): VipPlanEntitlementGrantDTO[] {
    return (grants ?? []).map(item => ({
      type: this.normalizeEntitlementType(item.type),
      totalQuota: this.normalizePositiveInteger(item.totalQuota, 1),
      durationDays: this.normalizeOptionalPositiveInteger(item.durationDays),
    }));
  }

  private normalizeEntitlementType(value: string): AgentEntitlementType {
    if (
      value === AgentEntitlementType.voiceModel ||
      value === AgentEntitlementType.chatImport ||
      value === AgentEntitlementType.interview ||
      value === AgentEntitlementType.familySeat
    ) {
      return value;
    }

    throw new AppError('INVALID_ENTITLEMENT_TYPE', 'invalid entitlement type');
  }

  private async assertCodeAvailable(
    code: string,
    exceptId?: MongoObjectId
  ): Promise<void> {
    const existing = await this.vipPlanModel.findOne({
      where: {
        code,
      },
    });

    if (!existing) {
      return;
    }

    if (
      exceptId &&
      this.stringifyObjectId(existing.id) === this.stringifyObjectId(exceptId)
    ) {
      return;
    }

    throw new AppError('VIP_PLAN_CODE_EXISTS', 'vip plan code already exists');
  }

  private async getVipPlanById(planId: string): Promise<VipPlanEntity> {
    const objectId = this.parseObjectId(planId);
    const plan =
      (await this.vipPlanModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.vipPlanModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!plan) {
      throw new AppError('VIP_PLAN_NOT_FOUND', 'vip plan not found', 404);
    }

    return plan;
  }

  private buildVipPlanRecord(plan: VipPlanEntity): AdminVipPlanRecordDTO {
    return {
      id: this.stringifyObjectId(plan.id),
      code: plan.code,
      name: plan.name,
      description: plan.description ?? '',
      priceAmount: plan.priceAmount,
      originalPriceAmount: plan.originalPriceAmount,
      currency: plan.currency || 'CNY',
      durationDays: plan.durationDays,
      lifetime: Boolean(plan.lifetime),
      benefits: plan.benefits ?? [],
      entitlementGrants: plan.entitlementGrants ?? [],
      couponGrantAmount: plan.couponGrantAmount,
      status: plan.status,
      sort: plan.sort ?? 0,
      createdAt: this.formatDate(plan.createdAt),
      updatedAt: this.formatDate(plan.updatedAt),
    };
  }

  private normalizeCode(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizeStatus(value?: string): VipPlanStatus {
    if (!value) {
      return VipPlanStatus.active;
    }

    return this.normalizeOptionalStatus(value) ?? VipPlanStatus.active;
  }

  private normalizeOptionalStatus(value?: string): VipPlanStatus | undefined {
    if (value === VipPlanStatus.active || value === VipPlanStatus.disabled) {
      return value;
    }

    if (value === undefined || value === '') {
      return undefined;
    }

    throw new AppError('INVALID_VIP_PLAN_STATUS', 'invalid vip plan status');
  }

  private normalizeAmount(value?: number): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new AppError(
        'INVALID_AMOUNT',
        'amount must be a non-negative integer'
      );
    }

    return value;
  }

  private normalizeOptionalAmount(value?: number): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    return this.normalizeAmount(value);
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    return fallback;
  }

  private normalizeOptionalPositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);

    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    throw new AppError(
      'INVALID_POSITIVE_INTEGER',
      'value must be a positive integer'
    );
  }

  private normalizeNonNegativeInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);

    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }

    return fallback;
  }

  private parseObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError('INVALID_VIP_PLAN_ID', 'invalid vip plan id');
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toString?.() ?? '';
  }

  private formatDate(value?: Date): string {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value.toISOString()
      : '';
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
