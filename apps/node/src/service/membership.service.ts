import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntitlementType,
  AgentEntity,
  AgentMembershipEntity,
  AgentMembershipStatus,
  MongoObjectId,
  VipPlanEntity,
  VipPlanStatus,
} from '@tzl/entities';
import type {
  AgentEntitlementSummaryDTO,
  AgentMembershipCenterDTO,
  AgentMembershipRecordDTO,
  AgentMembershipStatusSnapshotDTO,
  VipPlanRecordDTO,
} from '@tzl/shared';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { AuthenticatedUserPayload } from '../interface';

@Provide()
export class MembershipService {
  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentMembershipEntity)
  agentMembershipModel: MongoRepository<AgentMembershipEntity>;

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

  async getMembershipCenter(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentMembershipCenterDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const agentObjectId = this.parseObjectId(agentId, 'INVALID_AGENT_ID');
    await this.ensureAgentBelongsToUser(agentObjectId, userId);

    const now = new Date();
    const [plans, memberships] = await Promise.all([
      this.listActiveVipPlans(),
      this.findActiveMemberships(userId, agentObjectId),
    ]);
    const activeMembership = memberships.find(membership =>
      this.isMembershipAvailable(membership, now)
    );
    const agentIdText = this.stringifyObjectId(agentObjectId);

    if (!activeMembership) {
      return {
        agentId: agentIdText,
        isVip: false,
        plans,
      };
    }

    const membershipPlan = await this.findVipPlanById(
      activeMembership.vipPlanId
    );

    return {
      agentId: agentIdText,
      isVip: true,
      membership: this.buildMembershipRecord(
        activeMembership,
        membershipPlan ? this.buildVipPlanRecord(membershipPlan) : undefined
      ),
      plans,
    };
  }

  async getMembershipStatus(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentMembershipStatusSnapshotDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const agentObjectId = this.parseObjectId(agentId, 'INVALID_AGENT_ID');
    await this.ensureAgentBelongsToUser(agentObjectId, userId);

    const now = new Date();
    const memberships = await this.findActiveMemberships(userId, agentObjectId);
    const activeMembership = memberships.find(membership =>
      this.isMembershipAvailable(membership, now)
    );
    const entitlements = await this.listAvailableEntitlementSummaries(
      userId,
      agentObjectId,
      now
    );
    const agentIdText = this.stringifyObjectId(agentObjectId);

    if (!activeMembership) {
      return {
        agentId: agentIdText,
        isVip: false,
        entitlements,
        serverTime: this.formatDate(now),
      };
    }

    const membershipPlan = await this.findVipPlanById(
      activeMembership.vipPlanId
    );

    return {
      agentId: agentIdText,
      isVip: true,
      membership: this.buildMembershipRecord(
        activeMembership,
        membershipPlan ? this.buildVipPlanRecord(membershipPlan) : undefined
      ),
      entitlements,
      serverTime: this.formatDate(now),
    };
  }

  private async ensureAgentBelongsToUser(
    agentId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<AgentEntity> {
    const agent = await this.agentModel.findOne({
      where: {
        id: agentId,
        createdUserId: userId,
      },
    });

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return agent;
  }

  private async listActiveVipPlans(): Promise<VipPlanRecordDTO[]> {
    const plans = await this.vipPlanModel.find({
      where: {
        status: VipPlanStatus.active,
      },
      order: {
        sort: 'ASC',
        priceAmount: 'ASC',
      },
    });

    return plans.map(plan => this.buildVipPlanRecord(plan));
  }

  private isMembershipAvailable(
    membership: AgentMembershipEntity,
    now: Date
  ): boolean {
    if (membership.lifetime) {
      return true;
    }

    return Boolean(membership.expiredAt && membership.expiredAt > now);
  }

  private findActiveMemberships(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<AgentMembershipEntity[]> {
    return this.agentMembershipModel.find({
      where: {
        userId,
        agentId,
        status: AgentMembershipStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  private async listAvailableEntitlementSummaries(
    userId: MongoObjectId,
    agentId: MongoObjectId,
    now: Date
  ): Promise<AgentEntitlementSummaryDTO[]> {
    const entitlements = await this.agentEntitlementModel.find({
      where: {
        userId,
        agentId,
        status: AgentEntitlementStatus.available,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
    const summaries = new Map<
      AgentEntitlementType,
      AgentEntitlementSummaryDTO
    >();

    entitlements
      .filter(entitlement => this.isEntitlementAvailable(entitlement, now))
      .forEach(entitlement => {
        const usedQuota = Math.max(entitlement.usedQuota ?? 0, 0);
        const totalQuota = Math.max(entitlement.totalQuota ?? 0, 0);
        const availableQuota = Math.max(totalQuota - usedQuota, 0);
        const existing = summaries.get(entitlement.type);

        if (!existing) {
          summaries.set(entitlement.type, {
            type: entitlement.type,
            totalQuota,
            usedQuota,
            availableQuota,
            expiredAt: entitlement.expiredAt
              ? this.formatDate(entitlement.expiredAt)
              : undefined,
          });
          return;
        }

        existing.totalQuota += totalQuota;
        existing.usedQuota += usedQuota;
        existing.availableQuota += availableQuota;
        existing.expiredAt = this.mergeSummaryExpiredAt(
          existing.expiredAt,
          entitlement.expiredAt
        );
      });

    return Array.from(summaries.values()).sort((left, right) =>
      left.type.localeCompare(right.type)
    );
  }

  private isEntitlementAvailable(
    entitlement: AgentEntitlementEntity,
    now: Date
  ): boolean {
    if (!entitlement.expiredAt) {
      return true;
    }

    return entitlement.expiredAt > now;
  }

  private mergeSummaryExpiredAt(
    currentExpiredAt: string | undefined,
    nextExpiredAt: Date | undefined
  ): string | undefined {
    if (!currentExpiredAt || !nextExpiredAt) {
      return undefined;
    }

    const currentTime = Date.parse(currentExpiredAt);
    const nextTime = nextExpiredAt.getTime();

    return nextTime > currentTime
      ? this.formatDate(nextExpiredAt)
      : currentExpiredAt;
  }

  private buildMembershipRecord(
    membership: AgentMembershipEntity,
    plan?: VipPlanRecordDTO
  ): AgentMembershipRecordDTO {
    const vipPlanId = this.stringifyObjectId(membership.vipPlanId);

    return {
      id: this.stringifyObjectId(membership.id),
      agentId: this.stringifyObjectId(membership.agentId),
      vipPlanId,
      vipPlanCode: membership.vipPlanCode,
      status: membership.status,
      startedAt: this.formatDate(membership.startedAt),
      expiredAt: membership.expiredAt
        ? this.formatDate(membership.expiredAt)
        : undefined,
      lifetime: Boolean(membership.lifetime),
      plan,
    };
  }

  private async findVipPlanById(
    vipPlanId: MongoObjectId
  ): Promise<VipPlanEntity | null> {
    return (
      (await this.vipPlanModel.findOne({
        where: {
          id: vipPlanId,
        },
      })) ??
      (await this.vipPlanModel.findOne({
        where: {
          _id: vipPlanId,
        } as never,
      }))
    );
  }

  private buildVipPlanRecord(plan: VipPlanEntity): VipPlanRecordDTO {
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
      couponGrantAmount: plan.couponGrantAmount,
    };
  }

  private parseObjectId(value: string, code: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(
        code,
        'object id is invalid',
        code === 'INVALID_TOKEN' ? 401 : 400
      );
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private formatDate(value: Date): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
