import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntitlementType,
  AgentEntity,
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
  UserMembershipEntity,
  UserMembershipStatus,
  VipPlanEntity,
  VipPlanGroup,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

export type VoiceUsageAccessSource =
  | 'voice_membership_order'
  | 'voice_package_order'
  | 'admin_voice_order'
  | 'voice_membership_record'
  | 'voice_model_entitlement'
  | 'legacy_voice_task'
  | 'existing_voice_binding';

export interface VoiceUsageAccessDecision {
  eligible: boolean;
  source?: VoiceUsageAccessSource;
  referenceId?: string;
}

const PAID_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.paid,
  OrderStatus.granting,
  OrderStatus.completed,
  OrderStatus.refundRequested,
  OrderStatus.grantFailed,
]);

@Provide()
export class VoiceUsageAccessService {
  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  async resolve(userId: MongoObjectId): Promise<VoiceUsageAccessDecision> {
    const orders = await this.orderModel.find({ where: { userId } });
    const voiceMembershipDowngradedAt =
      this.getLatestVoiceMembershipDowngradeAt(orders);

    for (const order of this.sortNewestFirst(orders)) {
      if (!this.isPaidOrder(order)) {
        continue;
      }

      if (order.orderType === OrderType.voicePackage) {
        return {
          eligible: true,
          source:
            order.source === OrderSource.admin
              ? 'admin_voice_order'
              : 'voice_package_order',
          referenceId: this.idOf(order),
        };
      }

      if (
        order.orderType === OrderType.vipPlan &&
        !this.hasEffectiveVoiceMembershipDowngrade(order) &&
        (!voiceMembershipDowngradedAt ||
          this.getOrderPaidAt(order) > voiceMembershipDowngradedAt) &&
        (this.hasVoicePlanSnapshot(order) ||
          (await this.isLinkedVoicePlan(order.targetId)))
      ) {
        return {
          eligible: true,
          source: 'voice_membership_order',
          referenceId: this.idOf(order),
        };
      }
    }

    const memberships = await this.userMembershipModel.find({
      where: { userId },
    });
    for (const membership of this.sortNewestFirst(memberships)) {
      if (
        membership.status !== UserMembershipStatus.refunded &&
        membership.status !== UserMembershipStatus.canceled &&
        (!voiceMembershipDowngradedAt ||
          this.getEntityUpdatedAt(membership) > voiceMembershipDowngradedAt) &&
        ((await this.isLinkedVoicePlan(membership.vipPlanId)) ||
          this.hasLegacyVoicePlanMarker(membership.vipPlanCode))
      ) {
        return {
          eligible: true,
          source: 'voice_membership_record',
          referenceId: this.idOf(membership),
        };
      }
    }

    const entitlements = await this.agentEntitlementModel.find({
      where: {
        userId,
        type: AgentEntitlementType.voiceModel,
      },
    });
    const entitlement = this.sortNewestFirst(entitlements).find(
      item =>
        item.status !== AgentEntitlementStatus.refunded &&
        (!voiceMembershipDowngradedAt ||
          this.getEntityUpdatedAt(item) > voiceMembershipDowngradedAt)
    );
    if (entitlement) {
      return {
        eligible: true,
        source: 'voice_model_entitlement',
        referenceId: this.idOf(entitlement),
      };
    }

    if (!voiceMembershipDowngradedAt) {
      const tasks = await this.voiceTrainingTaskModel.find({
        where: { userId },
      });
      const task = this.sortNewestFirst(tasks).find(
        item => item.status !== VoiceTrainingTaskStatus.refunded
      );
      if (task) {
        return {
          eligible: true,
          source: 'legacy_voice_task',
          referenceId: this.idOf(task),
        };
      }

      const agents = await this.agentModel.find({
        where: { createdUserId: userId },
      });
      const boundAgent = agents.find(agent => Boolean(agent.voiceTimbreId));
      if (boundAgent) {
        return {
          eligible: true,
          source: 'existing_voice_binding',
          referenceId: this.idOf(boundAgent),
        };
      }
    }

    return { eligible: false };
  }

  private isPaidOrder(order: OrderEntity): boolean {
    if (
      order.status === OrderStatus.closed ||
      order.status === OrderStatus.refunded
    ) {
      return false;
    }

    return PAID_ORDER_STATUSES.has(order.status) || Boolean(order.paidAt);
  }

  private hasVoicePlanSnapshot(order: OrderEntity): boolean {
    const snapshot = order.snapshot?.vipPlan;
    if (!snapshot || typeof snapshot !== 'object') {
      return this.hasLegacyVoicePlanMarker(order.targetCode, order.title);
    }

    const plan = snapshot as Record<string, unknown>;
    if (
      plan.planGroup === VipPlanGroup.voice ||
      Boolean(plan.voicePackageId) ||
      Boolean(plan.voicePackageCode)
    ) {
      return true;
    }

    if (
      Array.isArray(plan.entitlementGrants) &&
      plan.entitlementGrants.some(item => {
        return (
          Boolean(item) &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).type ===
            AgentEntitlementType.voiceModel
        );
      })
    ) {
      return true;
    }

    return this.hasLegacyVoicePlanMarker(
      String(plan.code ?? order.targetCode ?? ''),
      String(plan.name ?? order.title ?? '')
    );
  }

  private hasEffectiveVoiceMembershipDowngrade(order: OrderEntity): boolean {
    const downgrade = order.snapshot?.voiceMembershipDowngrade;

    if (!downgrade || typeof downgrade !== 'object') {
      return false;
    }

    const raw = downgrade as Record<string, unknown>;

    return (
      raw.status === 'completed' ||
      (raw.status === 'benefits_failed' &&
        (Boolean(raw.refundRecordedAt) || raw.wechatRefundStatus === 'SUCCESS'))
    );
  }

  private getLatestVoiceMembershipDowngradeAt(
    orders: OrderEntity[]
  ): number | undefined {
    const timestamps = orders
      .map(order => {
        const downgrade = order.snapshot?.voiceMembershipDowngrade;

        if (
          !downgrade ||
          typeof downgrade !== 'object' ||
          !this.hasEffectiveVoiceMembershipDowngrade(order)
        ) {
          return 0;
        }

        const raw = downgrade as Record<string, unknown>;
        const value = raw.completedAt ?? raw.refundRecordedAt ?? raw.updatedAt;
        const timestamp = new Date(String(value ?? '')).getTime();

        return Number.isFinite(timestamp) ? timestamp : 0;
      })
      .filter(Boolean);

    return timestamps.length ? Math.max(...timestamps) : undefined;
  }

  private getOrderPaidAt(order: OrderEntity): number {
    return (
      order.paidAt?.getTime() ??
      order.createdAt?.getTime() ??
      order.updatedAt?.getTime() ??
      0
    );
  }

  private getEntityUpdatedAt(entity: {
    createdAt?: Date;
    updatedAt?: Date;
  }): number {
    return entity.updatedAt?.getTime() ?? entity.createdAt?.getTime() ?? 0;
  }

  private async isLinkedVoicePlan(planId?: MongoObjectId): Promise<boolean> {
    if (!planId) {
      return false;
    }

    const plan =
      (await this.vipPlanModel.findOne({ where: { id: planId } })) ??
      (await this.vipPlanModel.findOne({
        where: { _id: planId } as never,
      }));

    return Boolean(
      plan &&
        (plan.planGroup === VipPlanGroup.voice ||
          plan.voicePackageId ||
          plan.voicePackageCode ||
          plan.entitlementGrants?.some(
            item => item.type === AgentEntitlementType.voiceModel
          ))
    );
  }

  private hasLegacyVoicePlanMarker(code?: string, title?: string): boolean {
    const normalizedCode = String(code ?? '')
      .trim()
      .toLowerCase();
    if (/(^|[_-])voice([_-]|$)/.test(normalizedCode)) {
      return true;
    }

    const normalizedTitle = String(title ?? '').replace(/\s+/g, '');
    if (/不含声音|无声音/.test(normalizedTitle)) {
      return false;
    }

    return /声音版|含声音|声音会员|语音版|声音模型/.test(normalizedTitle);
  }

  private sortNewestFirst<T extends { createdAt?: Date; updatedAt?: Date }>(
    items: T[]
  ): T[] {
    return [...items].sort((left, right) => {
      const leftTime =
        left.updatedAt?.getTime() ?? left.createdAt?.getTime() ?? 0;
      const rightTime =
        right.updatedAt?.getTime() ?? right.createdAt?.getTime() ?? 0;
      return rightTime - leftTime;
    });
  }

  private idOf(entity?: { id?: MongoObjectId }): string | undefined {
    return entity?.id ? String(entity.id) : undefined;
  }
}
