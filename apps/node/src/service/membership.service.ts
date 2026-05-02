import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  MongoObjectId,
  UserEntitlementEntity,
  UserEntitlementStatus,
  UserEntitlementType,
  UserMembershipEntity,
  UserMembershipStatus,
  VipPlanEntity,
  VipPlanStatus,
} from '@tzl/entities';
import type {
  UserEntitlementSummaryDTO,
  UserMembershipCenterDTO,
  UserMembershipRecordDTO,
  UserMembershipStatusSnapshotDTO,
  VipPlanRecordDTO,
} from '@tzl/shared';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { AuthenticatedUserPayload } from '../interface';

@Provide()
export class MembershipService {
  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(UserEntitlementEntity)
  userEntitlementModel: MongoRepository<UserEntitlementEntity>;

  async getMembershipCenter(
    auth: AuthenticatedUserPayload
  ): Promise<UserMembershipCenterDTO> {
    const userId = this.parseObjectId(auth.sub);
    const now = new Date();
    const [plans, memberships] = await Promise.all([
      this.listActiveVipPlans(),
      this.userMembershipModel.find({
        where: {
          userId,
          status: UserMembershipStatus.active,
        },
        order: {
          updatedAt: 'DESC',
        },
      }),
    ]);
    const activeMembership = memberships.find(membership =>
      this.isMembershipAvailable(membership, now)
    );

    if (!activeMembership) {
      return {
        isVip: false,
        plans,
      };
    }

    const membershipPlan = await this.findVipPlanById(
      activeMembership.vipPlanId
    );

    return {
      isVip: true,
      membership: this.buildMembershipRecord(
        activeMembership,
        membershipPlan ? this.buildVipPlanRecord(membershipPlan) : undefined
      ),
      plans,
    };
  }

  async getMembershipStatus(
    auth: AuthenticatedUserPayload
  ): Promise<UserMembershipStatusSnapshotDTO> {
    const userId = this.parseObjectId(auth.sub);
    const now = new Date();
    const memberships = await this.findActiveMemberships(userId);
    const activeMembership = memberships.find(membership =>
      this.isMembershipAvailable(membership, now)
    );
    const entitlements = await this.listAvailableEntitlementSummaries(
      userId,
      now
    );

    if (!activeMembership) {
      return {
        isVip: false,
        entitlements,
        serverTime: this.formatDate(now),
      };
    }

    const membershipPlan = await this.findVipPlanById(
      activeMembership.vipPlanId
    );

    return {
      isVip: true,
      membership: this.buildMembershipRecord(
        activeMembership,
        membershipPlan ? this.buildVipPlanRecord(membershipPlan) : undefined
      ),
      entitlements,
      serverTime: this.formatDate(now),
    };
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
    membership: UserMembershipEntity,
    now: Date
  ): boolean {
    if (membership.lifetime) {
      return true;
    }

    return Boolean(membership.expiredAt && membership.expiredAt > now);
  }

  private findActiveMemberships(
    userId: MongoObjectId
  ): Promise<UserMembershipEntity[]> {
    return this.userMembershipModel.find({
      where: {
        userId,
        status: UserMembershipStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
  }

  private async listAvailableEntitlementSummaries(
    userId: MongoObjectId,
    now: Date
  ): Promise<UserEntitlementSummaryDTO[]> {
    const entitlements = await this.userEntitlementModel.find({
      where: {
        userId,
        status: UserEntitlementStatus.available,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
    const summaries = new Map<UserEntitlementType, UserEntitlementSummaryDTO>();

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
    entitlement: UserEntitlementEntity,
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
    membership: UserMembershipEntity,
    plan?: VipPlanRecordDTO
  ): UserMembershipRecordDTO {
    const vipPlanId = this.stringifyObjectId(membership.vipPlanId);

    return {
      id: this.stringifyObjectId(membership.id),
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

  private parseObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError('INVALID_TOKEN', 'token subject is invalid', 401);
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
