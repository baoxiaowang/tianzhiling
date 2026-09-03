import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminAgentListDTO,
  AdminAgentOwnerDTO,
  AdminAgentRecordDTO,
} from '@tzl/shared';
import {
  AgentEntity,
  MongoObjectId,
  OrderEntity,
  OrderStatus,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminAppUserAgentsQueryDTO,
  ListAdminAppUserMembersQueryDTO,
  ListAdminAppUsersQueryDTO,
  ListAdminAppUserVoiceServicesQueryDTO,
  UpdateAdminAppUserDTO,
} from '../dto/admin-app-user.dto';
import { AdminAvatarUrlService } from './admin-avatar-url.service';

export interface AdminAppUserItem {
  id: string;
  account: string;
  name: string;
  avatar: string;
  phone: string;
  phoneVerified: boolean;
  isVip: boolean;
  isRiskControlled: boolean;
  riskControlUntilAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAppUserListResult {
  items: AdminAppUserItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminAppUserMembershipType = 'one_year' | 'three_year' | 'lifetime';

export interface AdminAppUserMemberItem extends AdminAppUserItem {
  membershipType: AdminAppUserMembershipType;
  membershipStartedAt: string;
  membershipExpiredAt: string;
}

export interface AdminAppUserVoiceServiceItem extends AdminAppUserItem {
  serviceStatus: 'pending' | 'servicing' | 'refunded';
  purchasedAmounts: number[];
  latestPurchasedAt: string;
}

export type AdminAppUserAgentItem = AdminAgentRecordDTO;
export type AdminAppUserAgentListResult = AdminAgentListDTO;

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminAppUserService {
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @Inject()
  avatarUrlService: AdminAvatarUrlService;

  async listUsers(
    query: ListAdminAppUsersQueryDTO
  ): Promise<AdminAppUserListResult> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const keyword = query?.keyword?.trim() ?? '';
    const where = await this.buildUserSearchWhere(keyword);
    const [total, users] = await Promise.all([
      this.userModel.count(where),
      this.userModel.find({
        where: where as never,
        order: {
          createdAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const accountMap = await this.getAccountMapByUsers(users);
    const vipUserIdSet = await this.getVipUserIdSet(users);

    return {
      items: users.map(user =>
        this.buildUserItem(
          user,
          accountMap.get(this.stringifyObjectId(user.id)),
          vipUserIdSet.has(this.stringifyObjectId(user.id))
        )
      ),
      total,
      page,
      pageSize,
    };
  }

  async getUserDetail(userId: string): Promise<AdminAppUserItem> {
    const user = await this.getUserById(userId);
    const account = await this.findAccountByUserId(user.id);

    return this.buildUserItem(user, account, await this.isUserVip(user.id));
  }

  async listMembers(query: ListAdminAppUserMembersQueryDTO) {
    const now = new Date();
    const memberships = await this.userMembershipModel.find({
      where: { status: UserMembershipStatus.active },
      order: { updatedAt: 'DESC' },
    });
    const membershipByUserId = new Map<
      string,
      { membership: UserMembershipEntity; type: AdminAppUserMembershipType }
    >();

    for (const membership of memberships) {
      if (
        !membership.lifetime &&
        (!membership.expiredAt || membership.expiredAt <= now)
      ) {
        continue;
      }
      const userId = this.stringifyObjectId(membership.userId);
      if (membershipByUserId.has(userId)) continue;
      const type = this.classifyMembership(membership);
      if (query.membershipType && query.membershipType !== type) continue;
      membershipByUserId.set(userId, { membership, type });
    }

    const result = await this.listUsersByIds(
      [...membershipByUserId.keys()],
      query
    );
    return {
      ...result,
      items: result.items.map(user => {
        const detail = membershipByUserId.get(user.id)!;
        return {
          ...user,
          membershipType: detail.type,
          membershipStartedAt: this.formatDate(detail.membership.startedAt),
          membershipExpiredAt: detail.membership.lifetime
            ? ''
            : this.formatDate(detail.membership.expiredAt),
        } as AdminAppUserMemberItem;
      }),
    };
  }

  async listVoiceServiceUsers(query: ListAdminAppUserVoiceServicesQueryDTO) {
    const orders = (
      await this.orderModel.find({
        order: { updatedAt: 'DESC' },
      })
    ).filter(order => this.isQualifyingVoiceServiceOrder(order));
    const ordersByUserId = new Map<string, OrderEntity[]>();
    for (const order of orders) {
      const userId = this.stringifyObjectId(order.userId);
      const records = ordersByUserId.get(userId) ?? [];
      records.push(order);
      ordersByUserId.set(userId, records);
    }
    const candidateUserIds = [...ordersByUserId.keys()]
      .filter(userId => MongoObjectId.isValid(userId))
      .map(userId => new MongoObjectId(userId));
    const existingVoiceAgents = candidateUserIds.length
      ? await this.agentModel.find({
          where: {
            createdUserId: { $in: candidateUserIds },
          } as never,
        })
      : [];
    const existingVoiceUserIds = new Set(
      existingVoiceAgents
        .filter(agent => Boolean(agent.voiceTimbreId))
        .map(agent => this.stringifyObjectId(agent.createdUserId))
    );
    const serviceDetails = new Map<
      string,
      Pick<
        AdminAppUserVoiceServiceItem,
        'serviceStatus' | 'purchasedAmounts' | 'latestPurchasedAt'
      >
    >();

    for (const [userId, userOrders] of ordersByUserId) {
      const hasNonRefundedOrder = userOrders.some(
        order => order.status !== OrderStatus.refunded
      );
      const serviceStatus = hasNonRefundedOrder
        ? existingVoiceUserIds.has(userId) ||
          userOrders.some(
            order =>
              order.status !== OrderStatus.refunded &&
              Boolean(order.voiceServiceStartedAt)
          )
          ? 'servicing'
          : 'pending'
        : 'refunded';
      if (
        query.serviceStatus
          ? query.serviceStatus !== serviceStatus
          : serviceStatus === 'refunded'
      ) {
        continue;
      }
      serviceDetails.set(userId, {
        serviceStatus,
        purchasedAmounts: [
          ...new Set(
            userOrders.map(
              order =>
                (order.paidAmount ?? order.payableAmount ?? order.amount) / 100
            )
          ),
        ].sort((left, right) => left - right),
        latestPurchasedAt: this.formatDate(
          userOrders[0].paidAt || userOrders[0].createdAt
        ),
      });
    }

    const result = await this.listUsersByIds([...serviceDetails.keys()], query);
    return {
      ...result,
      items: result.items.map(user => ({
        ...user,
        ...serviceDetails.get(user.id)!,
      })),
    };
  }

  async startVoiceService(userId: string) {
    const user = await this.getUserById(userId);
    const orders = (
      await this.orderModel.find({
        where: { userId: user.id },
        order: { updatedAt: 'DESC' },
      })
    ).filter(
      order =>
        this.isQualifyingVoiceServiceOrder(order) &&
        order.status !== OrderStatus.refunded
    );
    if (!orders.length) {
      throw new AppError(
        'VOICE_SERVICE_ORDER_NOT_FOUND',
        '未找到可开始服务的声音产品订单',
        404
      );
    }

    const order = orders[0];
    if (!order.voiceServiceStartedAt) {
      const now = new Date();
      order.voiceServiceStartedAt = now;
      order.updatedAt = now;
      await this.orderModel.save(order);
    }
    return {
      userId: this.stringifyObjectId(user.id),
      serviceStatus: 'servicing' as const,
      startedAt: this.formatDate(order.voiceServiceStartedAt),
    };
  }

  async listUserAgents(
    userId: string,
    query: ListAdminAppUserAgentsQueryDTO
  ): Promise<AdminAppUserAgentListResult> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 10),
      100
    );
    const user = await this.getUserById(userId);
    const [account, isVip] = await Promise.all([
      this.findAccountByUserId(user.id),
      this.isUserVip(user.id),
    ]);
    const owner = this.buildAgentOwner(user, account, isVip);
    const keyword = query?.keyword?.trim() ?? '';
    const where: MongoWhere = {
      createdUserId: user.id,
    };

    if (keyword) {
      where.name = { $regex: this.escapeRegExp(keyword), $options: 'i' };
    }

    const [total, agents] = await Promise.all([
      this.agentModel.count(where),
      this.agentModel.find({
        where: where as never,
        order: {
          updatedAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: agents.map(agent => this.buildAgentItem(agent, owner)),
      total,
      page,
      pageSize,
    };
  }

  async updateUser(
    userId: string,
    payload: UpdateAdminAppUserDTO
  ): Promise<AdminAppUserItem> {
    const user = await this.getUserById(userId);
    let changed = false;

    if (payload.name !== undefined) {
      user.name = this.normalizeName(payload.name);
      changed = true;
    }

    if (payload.avatar !== undefined) {
      user.avatar = this.normalizeAvatarForStorage(payload.avatar);
      changed = true;
    }

    if (payload.riskControlUntilAt !== undefined) {
      user.riskControlUntilAt = this.normalizeRiskControlUntilAt(
        payload.riskControlUntilAt
      );
      changed = true;
    }

    if (changed) {
      user.updatedAt = new Date();
      await this.userModel.save(user);
    }

    const account = await this.findAccountByUserId(user.id);

    return this.buildUserItem(user, account, await this.isUserVip(user.id));
  }

  private async listUsersByIds(
    userIds: string[],
    query: ListAdminAppUsersQueryDTO
  ): Promise<AdminAppUserListResult> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    if (!userIds.length) {
      return { items: [], total: 0, page, pageSize };
    }

    const objectIds = userIds
      .filter(id => MongoObjectId.isValid(id))
      .map(id => new MongoObjectId(id));
    const idWhere = { _id: { $in: objectIds } };
    const keyword = query?.keyword?.trim() ?? '';
    const keywordWhere = await this.buildUserSearchWhere(keyword);
    const where = keyword ? { $and: [idWhere, keywordWhere] } : idWhere;
    const [total, users] = await Promise.all([
      this.userModel.count(where),
      this.userModel.find({
        where: where as never,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const accountMap = await this.getAccountMapByUsers(users);
    const vipUserIdSet = await this.getVipUserIdSet(users);

    return {
      items: users.map(user =>
        this.buildUserItem(
          user,
          accountMap.get(this.stringifyObjectId(user.id)),
          vipUserIdSet.has(this.stringifyObjectId(user.id))
        )
      ),
      total,
      page,
      pageSize,
    };
  }

  private classifyMembership(
    membership: UserMembershipEntity
  ): AdminAppUserMembershipType {
    if (membership.lifetime) return 'lifetime';
    const durationMs =
      new Date(membership.expiredAt || membership.startedAt).getTime() -
      new Date(membership.startedAt).getTime();
    return durationMs >= 900 * 24 * 60 * 60 * 1000 ? 'three_year' : 'one_year';
  }

  private isQualifyingVoiceServiceOrder(order: OrderEntity): boolean {
    const purchasedStatuses = new Set<OrderStatus>([
      OrderStatus.paid,
      OrderStatus.granting,
      OrderStatus.completed,
      OrderStatus.grantFailed,
      OrderStatus.refundRequested,
      OrderStatus.refunded,
    ]);
    const paidAmount = order.paidAmount ?? order.payableAmount ?? order.amount;
    return (
      purchasedStatuses.has(order.status) &&
      [12000, 16900, 18000].includes(paidAmount)
    );
  }

  private async buildUserSearchWhere(keyword: string): Promise<MongoWhere> {
    if (!keyword) {
      return {};
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const filters: Record<string, unknown>[] = [
      { name: { $regex: escapedKeyword, $options: 'i' } },
      { phone: { $regex: escapedKeyword, $options: 'i' } },
    ];

    const matchedAccounts = await this.userAccountModel.find({
      where: {
        account: { $regex: escapedKeyword, $options: 'i' },
      } as never,
      take: 200,
    });
    const accountUserIds = matchedAccounts
      .map(account => account.userId)
      .filter(Boolean);

    if (accountUserIds.length > 0) {
      filters.push({ id: { $in: accountUserIds } });
      filters.push({ _id: { $in: accountUserIds } });
    }

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);
      filters.push({ id: objectId });
      filters.push({ _id: objectId });
    }

    return { $or: filters };
  }

  private async getAccountMapByUsers(
    users: UserEntity[]
  ): Promise<Map<string, UserAccountEntity>> {
    if (users.length === 0) {
      return new Map();
    }

    const userIds = users.map(user => user.id);
    const accounts = await this.userAccountModel.find({
      where: {
        userId: { $in: userIds },
      } as never,
    });

    return new Map(
      accounts.map(account => [this.stringifyObjectId(account.userId), account])
    );
  }

  private async getUserById(userId: string): Promise<UserEntity> {
    const objectId = this.parseObjectId(userId);
    const user =
      (await this.userModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.userModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!user) {
      throw new AppError('APP_USER_NOT_FOUND', 'app user not found', 404);
    }

    return user;
  }

  private findAccountByUserId(
    userId: MongoObjectId
  ): Promise<UserAccountEntity | null> {
    return this.userAccountModel.findOne({
      where: {
        userId,
      },
    });
  }

  private buildUserItem(
    user: UserEntity,
    account?: UserAccountEntity | null,
    isVip = false
  ): AdminAppUserItem {
    const riskControlUntilAt = this.normalizeDate(user.riskControlUntilAt);

    return {
      id: this.stringifyObjectId(user.id),
      account: account?.account ?? user.phone ?? '',
      name: user.name ?? '',
      avatar: this.resolveAvatar(user.avatar),
      phone: user.phone ?? account?.account ?? '',
      phoneVerified: Boolean(user.phoneVerified),
      isVip,
      isRiskControlled: this.isRiskControlled(riskControlUntilAt),
      riskControlUntilAt: this.formatDate(riskControlUntilAt),
      createdAt: this.formatDate(user.createdAt),
      updatedAt: this.formatDate(user.updatedAt),
    };
  }

  private async getVipUserIdSet(users: UserEntity[]): Promise<Set<string>> {
    if (users.length === 0) {
      return new Set();
    }

    const userIds = users.map(user => user.id);
    const memberships = await this.userMembershipModel.find({
      where: {
        userId: { $in: userIds },
        status: UserMembershipStatus.active,
      } as never,
    });
    const now = new Date();

    return new Set(
      memberships
        .filter(
          membership =>
            membership.lifetime ||
            Boolean(membership.expiredAt && membership.expiredAt > now)
        )
        .map(membership => this.stringifyObjectId(membership.userId))
    );
  }

  private async isUserVip(userId: MongoObjectId): Promise<boolean> {
    const memberships = await this.userMembershipModel.find({
      where: {
        userId,
        status: UserMembershipStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
    });
    const now = new Date();

    return memberships.some(
      membership =>
        membership.lifetime ||
        Boolean(membership.expiredAt && membership.expiredAt > now)
    );
  }

  private buildAgentOwner(
    user: UserEntity,
    account?: UserAccountEntity | null,
    isVip = false
  ): AdminAgentOwnerDTO {
    return {
      id: this.stringifyObjectId(user.id),
      account: account?.account ?? user.phone ?? '',
      name: user.name ?? '',
      avatar: this.resolveAvatar(user.avatar),
      phone: user.phone ?? account?.account ?? '',
      isVip,
    };
  }

  private buildAgentItem(
    agent: AgentEntity,
    owner: AdminAgentOwnerDTO
  ): AdminAppUserAgentItem {
    const agentId = this.stringifyObjectId(agent.id);

    return {
      id: agentId,
      createdUserId: this.stringifyObjectId(agent.createdUserId),
      createdUser: owner,
      name: agent.name ?? '',
      avatar: this.resolveAvatar(agent.avatar),
      sex: agent.sex,
      agentCallMe: agent.agentCallMe ?? '',
      iCallAgent: agent.iCallAgent ?? '',
      birthday: this.formatDate(agent.birthday),
      deathDate: this.formatDate(agent.deathDate),
      description: agent.description ?? '',
      lifeExperience: agent.lifeExperience ?? '',
      personalityTraits: agent.personalityTraits ?? '',
      languageHabits: agent.languageHabits ?? '',
      hobbies: agent.hobbies ?? '',
      sharedMemories: agent.sharedMemories ?? '',
      hasUnreadAgentHomeGuide: Boolean(
        agent.profileCompletionGuideCreatedAt && !agent.agentHomeGuideSeenAt
      ),
      hasUnreadAgentProfileGuide: Boolean(
        agent.profileCompletionGuideCreatedAt && !agent.agentProfileGuideSeenAt
      ),
      customContext: agent.customContext ?? '',
      conversationCount: 0,
      status: agent.status,
      isDefault: Boolean(agent.isDefault),
      voiceTimbreId: this.stringifyOptionalObjectId(agent.voiceTimbreId),
      ...(agent.messengerOfAgentId
        ? {
            messengerOfAgentId: this.stringifyObjectId(
              agent.messengerOfAgentId
            ),
          }
        : {}),
      createdAt: this.formatDate(agent.createdAt),
      updatedAt: this.formatDate(agent.updatedAt),
    };
  }

  private resolveAvatar(value?: string): string {
    return this.avatarUrlService?.resolve(value) ?? value?.trim() ?? '';
  }

  private normalizeAvatarForStorage(value?: string): string {
    return (
      this.avatarUrlService?.normalizeForStorage?.(value) ?? value?.trim() ?? ''
    );
  }

  private normalizeName(rawName?: string): string {
    const name = rawName?.trim() ?? '';

    if (!name) {
      throw new AppError('INVALID_APP_USER_NAME', 'user name is required', 400);
    }

    if (name.length > 50) {
      throw new AppError(
        'INVALID_APP_USER_NAME',
        'user name must be 50 characters or less',
        400
      );
    }

    return name;
  }

  private normalizeRiskControlUntilAt(rawValue?: string): Date | undefined {
    const value = rawValue?.trim() ?? '';

    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(
        'INVALID_RISK_CONTROL_UNTIL_AT',
        'risk control until time is invalid',
        400
      );
    }

    return parsed;
  }

  private normalizeDate(value?: Date): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = value instanceof Date ? value : new Date(value);

    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private isRiskControlled(riskControlUntilAt?: Date): boolean {
    return Boolean(riskControlUntilAt && riskControlUntilAt > new Date());
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

  private parseObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError('INVALID_APP_USER_ID', 'invalid app user id', 400);
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private stringifyOptionalObjectId(value?: MongoObjectId): string | undefined {
    return value ? this.stringifyObjectId(value) : undefined;
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
