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
  UserAccountEntity,
  UserEntity,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminAppUserAgentsQueryDTO,
  ListAdminAppUsersQueryDTO,
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
  createdAt: string;
  updatedAt: string;
}

export interface AdminAppUserListResult {
  items: AdminAppUserItem[];
  total: number;
  page: number;
  pageSize: number;
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

    return {
      items: users.map(user =>
        this.buildUserItem(
          user,
          accountMap.get(this.stringifyObjectId(user.id))
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

    return this.buildUserItem(user, account);
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
    const account = await this.findAccountByUserId(user.id);
    const owner = this.buildAgentOwner(user, account);
    const where = {
      createdUserId: user.id,
    };
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

    if (changed) {
      user.updatedAt = new Date();
      await this.userModel.save(user);
    }

    const account = await this.findAccountByUserId(user.id);

    return this.buildUserItem(user, account);
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
    account?: UserAccountEntity | null
  ): AdminAppUserItem {
    return {
      id: this.stringifyObjectId(user.id),
      account: account?.account ?? user.phone ?? '',
      name: user.name ?? '',
      avatar: this.resolveAvatar(user.avatar),
      phone: user.phone ?? account?.account ?? '',
      phoneVerified: Boolean(user.phoneVerified),
      createdAt: this.formatDate(user.createdAt),
      updatedAt: this.formatDate(user.updatedAt),
    };
  }

  private buildAgentOwner(
    user: UserEntity,
    account?: UserAccountEntity | null
  ): AdminAgentOwnerDTO {
    return {
      id: this.stringifyObjectId(user.id),
      account: account?.account ?? user.phone ?? '',
      name: user.name ?? '',
      avatar: this.resolveAvatar(user.avatar),
      phone: user.phone ?? account?.account ?? '',
    };
  }

  private buildAgentItem(
    agent: AgentEntity,
    owner: AdminAgentOwnerDTO
  ): AdminAppUserAgentItem {
    return {
      id: this.stringifyObjectId(agent.id),
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
      status: agent.status,
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
