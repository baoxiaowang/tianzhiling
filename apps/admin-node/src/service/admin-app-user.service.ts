import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminAgentListDTO,
  AdminAgentOwnerDTO,
  AdminAgentRecordDTO,
  AdminAppUserMessengerMessageDTO,
  AdminAppUserMessengerMessageListDTO,
  SendAdminAppUserMessengerMessageRequestDTO,
} from '@tzl/shared';
import {
  AgentEntity,
  AgentProfileFactEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MongoObjectId,
  OrderEntity,
  OrderStatus,
  UserAccountEntity,
  UserEntity,
  UserIdentityProfileEntity,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
  UserMembershipEntity,
  UserMembershipStatus,
  UserRelativeFactEntity,
  UserRelativeProfileEntity,
  UserRelativeProfileStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminAppUserAgentsQueryDTO,
  ListAdminAppUserMemoriesQueryDTO,
  ListAdminAppUserMembersQueryDTO,
  ListAdminAppUsersQueryDTO,
  ListAdminAppUserVoiceServicesQueryDTO,
  UpdateAdminAppUserDTO,
} from '../dto/admin-app-user.dto';
import { AdminAvatarUrlService } from './admin-avatar-url.service';
import { AdminMilvusService } from './admin-milvus.service';

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

export interface AdminAppUserAccountMemory {
  identity: {
    realName: string;
    formerNames: string[];
    aliases: string[];
    source: string;
    sourceText: string;
    updatedAt: string;
  } | null;
  people: Array<{
    id: string;
    realName: string;
    preferredName: string;
    aliases: string[];
    relationToUser: string;
    sourceText: string;
    updatedAt: string;
    profile: {
      lifeStage: string;
      sex: string;
      birthDate: string;
      birthYear?: number;
      relationshipsToAgents: Array<{
        agentId: string;
        relationToAgent: string;
        personCallsAgent: string;
      }>;
    } | null;
    facts: Array<{
      id: string;
      domain: string;
      key: string;
      value: string;
      status: string;
      confidence: string;
      supportCount: number;
      sourceText: string;
      updatedAt: string;
    }>;
  }>;
}

export type AdminAppUserAgentItem = AdminAgentRecordDTO;
export type AdminAppUserAgentListResult = AdminAgentListDTO;

/**
 * 后台「聊天与已留存记忆」右侧面板使用的一条结构化记忆。
 * 只来自确实落库的 agent_profile_fact，不包含抽取/索引任务与事件分组。
 */
export interface AdminAppUserAgentMemoryItem {
  id: string;
  scope: 'agent';
  type: string;
  key: string;
  value: string;
  polarity: string;
  status: string;
  confidence: string;
  assertionPolicy: string;
  priority: number;
  sourceMessageId: string;
  sourceMessageIds: string[];
  sourceConversationId: string;
  sourceText: string;
  retention: string;
  certainty: string;
  timeKind: string;
  validUntil: string;
  sourceOccurredAt: string;
  recordedAt: string;
  updatedAt: string;
}

/** 账号级共享记忆：归属于用户账号、不随聊天对象变化。 */
export interface AdminAppUserAccountSharedMemoryItem {
  id: string;
  scope: 'account';
  type: string;
  key: string;
  value: string;
  status: string;
  confidence: string;
  sourceText: string;
  updatedAt: string;
}

export interface AdminAppUserAgentMemoryListResult {
  items: AdminAppUserAgentMemoryItem[];
  total: number;
  page: number;
  pageSize: number;
  accountSharedItems: AdminAppUserAccountSharedMemoryItem[];
  accountSharedTotal: number;
}

/** 后台“可检索原话”：已进入检索索引、且来源仍有效的聊天证据。 */
export interface AdminAppUserIndexedEvidenceItem {
  id: string;
  sourceMessageId: string;
  conversationId: string;
  role: string;
  text: string;
  createdAt: string;
  sourceValid: boolean;
  sourceContent: string;
  sourceCreatedAt: string;
}

export interface AdminAppUserIndexedEvidenceListResult {
  /** 索引是否可用；false 时前端必须显示“暂不可用”，不能显示“没有记忆”。 */
  available: boolean;
  unavailableReason: string;
  items: AdminAppUserIndexedEvidenceItem[];
  /** 索引内匹配总条数（全量口径，含来源后续失效的行）。 */
  total: number;
  /** 本页从索引取到的行数（来源校验前）。 */
  pageIndexRows: number;
  /** 本页有效来源条数。 */
  pageValidCount: number;
  /** 本页来源失效（缺失/归档/归属不符）条数。 */
  pageInvalidCount: number;
  page: number;
  pageSize: number;
}

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminAppUserService {
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(UserIdentityProfileEntity)
  userIdentityProfileModel: MongoRepository<UserIdentityProfileEntity>;

  @InjectEntityModel(UserKnownPersonEntity)
  userKnownPersonModel: MongoRepository<UserKnownPersonEntity>;

  @InjectEntityModel(UserRelativeProfileEntity)
  userRelativeProfileModel: MongoRepository<UserRelativeProfileEntity>;

  @InjectEntityModel(UserRelativeFactEntity)
  userRelativeFactModel: MongoRepository<UserRelativeFactEntity>;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(AgentProfileFactEntity)
  agentProfileFactModel: MongoRepository<AgentProfileFactEntity>;

  @Inject()
  avatarUrlService: AdminAvatarUrlService;

  @Inject()
  adminMilvusService: AdminMilvusService;

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
        select: [
          'id',
          'createdUserId',
          'name',
          'avatar',
          'sex',
          'agentCallMe',
          'iCallAgent',
          'status',
          'messengerOfAgentId',
          'userMessageCount',
          'userMessageCountBackfilledAt',
          'createdAt',
          'updatedAt',
        ],
        order: {
          updatedAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const messageCountMap = await this.getMessageCountMap(agents);

    return {
      items: agents.map(agent =>
        this.buildAgentItem(
          agent,
          owner,
          messageCountMap.get(this.stringifyObjectId(agent.id)) ?? 0
        )
      ),
      total,
      page,
      pageSize,
    };
  }

  async getAccountMemory(userId: string): Promise<AdminAppUserAccountMemory> {
    const user = await this.getUserById(userId);
    const [identity, people, profiles, facts] = await Promise.all([
      this.userIdentityProfileModel.findOne({ where: { userId: user.id } }),
      this.userKnownPersonModel.find({
        where: {
          userId: user.id,
          status: UserKnownPersonStatus.active,
        },
        order: { updatedAt: 'DESC' },
        take: 100,
      }),
      this.userRelativeProfileModel.find({
        where: {
          userId: user.id,
          status: UserRelativeProfileStatus.active,
        },
        order: { updatedAt: 'DESC' },
        take: 100,
      }),
      this.userRelativeFactModel.find({
        where: { userId: user.id },
        order: { updatedAt: 'DESC' },
        take: 500,
      }),
    ]);
    const profileMap = new Map(
      profiles.map(profile => [
        this.stringifyObjectId(profile.personId),
        profile,
      ])
    );
    const factsMap = new Map<string, UserRelativeFactEntity[]>();

    for (const fact of facts) {
      const personId = this.stringifyObjectId(fact.personId);
      factsMap.set(personId, [...(factsMap.get(personId) ?? []), fact]);
    }

    return {
      identity: identity
        ? {
            realName: identity.realName ?? '',
            formerNames: (identity.formerNames ?? []).map(item => item.value),
            aliases: identity.aliases ?? [],
            source: identity.source ?? '',
            sourceText: identity.sourceText ?? '',
            updatedAt: this.formatDate(identity.updatedAt),
          }
        : null,
      people: people.map(person => {
        const personId = this.stringifyObjectId(person.id);
        const profile = profileMap.get(personId);

        return {
          id: personId,
          realName: person.realName ?? '',
          preferredName: person.preferredName ?? '',
          aliases: person.aliases ?? [],
          relationToUser: person.relationToUser ?? '',
          sourceText: person.sourceText ?? '',
          updatedAt: this.formatDate(person.updatedAt),
          profile: profile
            ? {
                lifeStage: profile.lifeStage ?? 'unknown',
                sex: profile.sex ?? 'unknown',
                birthDate: this.formatDate(profile.birthDate),
                ...(profile.birthYear ? { birthYear: profile.birthYear } : {}),
                relationshipsToAgents: (
                  profile.relationshipsToAgents ?? []
                ).map(relationship => ({
                  agentId: this.stringifyObjectId(relationship.agentId),
                  relationToAgent: relationship.relationToAgent ?? '',
                  personCallsAgent: relationship.personCallsAgent ?? '',
                })),
              }
            : null,
          facts: (factsMap.get(personId) ?? []).map(fact => ({
            id: this.stringifyObjectId(fact.id),
            domain: fact.domain,
            key: fact.key ?? '',
            value: fact.value ?? '',
            status: fact.status,
            confidence: fact.confidence,
            supportCount: fact.supportCount ?? 0,
            sourceText: fact.sourceText ?? '',
            updatedAt: this.formatDate(fact.updatedAt),
          })),
        };
      }),
    };
  }

  /**
   * 后台「聊天与已留存记忆」右侧面板：按 用户 + 聊天对象 分页读取确实落库的结构化记忆。
   * 只读；只查 agent_profile_fact，不触发抽取 / embedding / 索引 / 回填，也不把
   * memory_pipeline_task（处理任务）或 memory_event_group（事件分组）当作记忆正文。
   * 账号级共享记忆（用户身份、已识别人物）单独返回，与角色独有记忆分开标识。
   */
  async listAgentMemories(
    userId: string,
    agentId: string,
    query?: ListAdminAppUserMemoriesQueryDTO
  ): Promise<AdminAppUserAgentMemoryListResult> {
    const user = await this.getUserById(userId);
    const agentObjectId = this.parseObjectId(agentId);

    await this.assertUserOwnedAgent(user.id, agentObjectId);

    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      50
    );
    const where: MongoWhere = {
      userId: user.id,
      agentId: agentObjectId,
    };

    const [total, facts] = await Promise.all([
      this.agentProfileFactModel.count(where as never),
      this.agentProfileFactModel.find({
        where: where as never,
        order: { updatedAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const sourceIdSet = new Set<string>();
    for (const fact of facts) {
      for (const id of this.collectFactSourceIds(fact)) {
        sourceIdSet.add(id);
      }
    }
    const conversationMap = await this.getSourceConversationMap([
      ...sourceIdSet,
    ]);
    const accountShared = await this.buildAccountSharedMemories(
      this.stringifyObjectId(user.id)
    );

    return {
      items: facts.map(fact =>
        this.buildAgentMemoryItem(fact, conversationMap)
      ),
      total,
      page,
      pageSize,
      accountSharedItems: accountShared.items,
      accountSharedTotal: accountShared.total,
    };
  }

  /**
   * 读取用户与某个聊天对象的聊天记录（只读）。
   * 与 messenger-messages 的区别：这里允许该用户创建的任何智能体，用于左右联查；
   * 发送通道仍然只对「小使者」开放。
   */
  async listAgentMessages(
    userId: string,
    agentId: string,
    query?: { before?: string; pageSize?: string | number }
  ): Promise<AdminAppUserMessengerMessageListDTO> {
    const user = await this.getUserById(userId);
    const agentObjectId = this.parseObjectId(agentId);

    await this.assertUserOwnedAgent(user.id, agentObjectId);

    return this.queryUserAgentMessages(user.id, agentObjectId, query);
  }

  /**
   * 后台“可检索原话”：查询检索索引中的 raw_episode 证据，并只保留来源仍有效的条目。
   * 只读；不代表模型在某轮用过；不返回向量数值。
   */
  async listIndexedEvidence(
    userId: string,
    agentId: string,
    query?: { page?: string | number; pageSize?: string | number }
  ): Promise<AdminAppUserIndexedEvidenceListResult> {
    const user = await this.getUserById(userId);
    const agentObjectId = this.parseObjectId(agentId);

    await this.assertUserOwnedAgent(user.id, agentObjectId);

    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      50
    );

    const result =
      await this.adminMilvusService.listConversationMessageMemories({
        userId: this.stringifyObjectId(user.id),
        agentId: this.stringifyObjectId(agentObjectId),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

    if (!result.available) {
      return {
        available: false,
        unavailableReason: result.unavailableReason,
        items: [],
        total: 0,
        pageIndexRows: 0,
        pageValidCount: 0,
        pageInvalidCount: 0,
        page,
        pageSize,
      };
    }

    const sourceIds = result.items
      .map(item => item.sourceMessageId)
      .filter(id => Boolean(id) && MongoObjectId.isValid(id))
      .map(id => new MongoObjectId(id));
    const messages = sourceIds.length
      ? await this.messageModel.find({
          where: { _id: { $in: sourceIds } } as never,
        })
      : [];
    const messageMap = new Map(
      messages.map(message => [this.stringifyObjectId(message.id), message])
    );
    const expectedUserId = this.stringifyObjectId(user.id);
    const expectedAgentId = this.stringifyObjectId(agentObjectId);
    const items: AdminAppUserIndexedEvidenceItem[] = [];
    let pageInvalidCount = 0;

    for (const row of result.items) {
      const message = messageMap.get(row.sourceMessageId);
      const valid =
        Boolean(message) &&
        message.isArchived !== true &&
        this.stringifyObjectId(message.userId) === expectedUserId &&
        this.stringifyObjectId(message.agentId) === expectedAgentId;

      if (!valid || !message) {
        pageInvalidCount += 1;
        continue;
      }

      items.push({
        id: row.id,
        sourceMessageId: row.sourceMessageId,
        conversationId: row.conversationId,
        role: row.role,
        text: row.text,
        createdAt: row.createdAt,
        sourceValid: true,
        sourceContent: message.content ?? '',
        sourceCreatedAt: this.formatDate(message.createdAt),
      });
    }

    return {
      available: true,
      unavailableReason: '',
      items,
      total: result.total,
      pageIndexRows: result.pageIndexRows,
      pageValidCount: items.length,
      pageInvalidCount,
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
    owner: AdminAgentOwnerDTO,
    conversationCount = 0
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
      conversationCount,
      messengerConversationCount: 0,
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

  private async getMessageCountMap(
    agents: AgentEntity[]
  ): Promise<Map<string, number>> {
    if (agents.length === 0) {
      return new Map();
    }

    const countMap = new Map<string, number>();
    const agentsWithoutMaterializedCount = agents.filter(agent => {
      if (
        agent.userMessageCountBackfilledAt &&
        Number.isFinite(agent.userMessageCount)
      ) {
        countMap.set(
          this.stringifyObjectId(agent.id),
          Math.max(0, Number(agent.userMessageCount))
        );
        return false;
      }
      return true;
    });

    if (agentsWithoutMaterializedCount.length === 0) {
      return countMap;
    }

    const rows = (await this.messageModel
      .aggregate([
        {
          $match: {
            agentId: {
              $in: agentsWithoutMaterializedCount.map(agent => agent.id),
            },
            role: MessageRole.user,
          },
        },
        {
          $group: {
            _id: '$agentId',
            count: { $sum: 1 },
          },
        },
      ])
      .toArray()) as Array<{ _id: MongoObjectId; count: number }>;

    rows.forEach(row =>
      countMap.set(this.stringifyObjectId(row._id), row.count)
    );
    return countMap;
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

  /**
   * 读取用户与小使者之间的消息（管理端发消息通道）。
   * 游标分页：按 createdAt 倒序取一页，返回升序消息；`before` 传上一页最早时间可继续往前翻。
   */
  async listMessengerMessages(
    userId: string,
    agentId: string,
    query?: { before?: string; pageSize?: string | number }
  ): Promise<AdminAppUserMessengerMessageListDTO> {
    const userObjectId = this.parseObjectId(userId);
    const agentObjectId = this.parseObjectId(agentId);

    await this.assertUserMessengerAgent(userObjectId, agentObjectId);

    return this.queryUserAgentMessages(userObjectId, agentObjectId, query);
  }

  /**
   * 按 用户 + 聊天对象 游标分页读取消息。
   * 游标：按 createdAt 倒序取一页，返回升序消息；`before` 传上一页最早时间可继续往前翻。
   */
  private async queryUserAgentMessages(
    userObjectId: MongoObjectId,
    agentObjectId: MongoObjectId,
    query?: { before?: string; pageSize?: string | number }
  ): Promise<AdminAppUserMessengerMessageListDTO> {
    const pageSize = Math.min(
      Math.max(this.normalizePositiveInteger(query?.pageSize, 30), 1),
      100
    );
    const before = query?.before?.trim() ? new Date(query.before) : undefined;

    const where: Record<string, unknown> = {
      agentId: agentObjectId,
      userId: userObjectId,
    };
    if (before && !Number.isNaN(before.getTime())) {
      where.createdAt = { $lt: before };
    }

    const messages = await this.messageModel.find({
      where: where as never,
      order: { createdAt: 'DESC' },
      take: pageSize + 1,
    });
    const hasMore = messages.length > pageSize;
    const items = messages
      .slice(0, pageSize)
      .reverse()
      .map(message => this.buildMessengerMessageItem(message));

    return {
      conversationId: items[0]?.conversationId ?? '',
      hasMore,
      items,
    };
  }

  /**
   * 管理端通过小使者给用户发送文本/图片消息。
   * 转交主服务写入消息，保证会话与消息口径一致。
   */
  async sendMessengerMessage(
    userId: string,
    agentId: string,
    payload: SendAdminAppUserMessengerMessageRequestDTO
  ): Promise<AdminAppUserMessengerMessageDTO> {
    const userObjectId = this.parseObjectId(userId);
    const agentObjectId = this.parseObjectId(agentId);

    const type = payload?.type;
    if (type !== 'text' && type !== 'image') {
      throw new AppError('INVALID_MESSAGE_TYPE', 'invalid message type', 400);
    }
    const content = payload?.content?.trim() ?? '';
    if (type === 'text' && !content) {
      throw new AppError(
        'MESSAGE_CONTENT_REQUIRED',
        'content is required',
        400
      );
    }
    if (type === 'image' && !payload?.mediaObjectKey && !payload?.mediaUrl) {
      throw new AppError('MESSAGE_IMAGE_REQUIRED', 'image is required', 400);
    }

    await this.assertUserMessengerAgent(userObjectId, agentObjectId);

    const baseUrl =
      process.env.TZL_NODE_API_URL?.trim() || 'http://tzl_node:7001';
    const secret = process.env.INTERNAL_API_SECRET?.trim();
    if (!secret) {
      throw new AppError(
        'INTERNAL_API_SECRET_MISSING',
        'internal api secret missing',
        500
      );
    }

    const response = await fetch(`${baseUrl}/api/system/messenger-message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({
        userId,
        messengerAgentId: agentId,
        type,
        content,
        mediaObjectKey: payload?.mediaObjectKey,
        mediaUrl: payload?.mediaUrl,
        mediaMimeType: payload?.mediaMimeType,
      }),
    });
    const responseBody = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      result?: {
        conversationId: string;
        messageId: string;
        type: string;
        content: string;
        mediaObjectKey?: string;
        mediaUrl?: string;
        mediaMimeType?: string;
        createdAt: string;
      };
      // node 端全局响应信封：{ success, code, message, data, timestamp }
      success?: boolean;
      data?: unknown;
    } | null;
    // 业务结果位于信封的 data 字段内，先解包再判断；兼容未包装的裸结构
    const result =
      responseBody &&
      typeof responseBody.data === 'object' &&
      responseBody.data !== null &&
      'ok' in responseBody.data
        ? (responseBody.data as typeof responseBody)
        : responseBody;

    if (!response.ok || !result?.ok || !result.result) {
      throw new AppError(
        'MESSENGER_MESSAGE_SEND_FAILED',
        result?.error || 'failed to send messenger message',
        502
      );
    }

    return {
      id: result.result.messageId,
      conversationId: result.result.conversationId,
      role: MessageRole.assistant,
      type: result.result.type,
      content: result.result.content,
      mediaObjectKey: result.result.mediaObjectKey ?? '',
      mediaUrl: result.result.mediaUrl ?? '',
      mediaMimeType: result.result.mediaMimeType ?? '',
      createdAt: result.result.createdAt,
    };
  }

  private async assertUserMessengerAgent(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<void> {
    const agent =
      (await this.agentModel.findOne({ where: { id: agentId } })) ??
      (await this.agentModel.findOne({ where: { _id: agentId } as never }));

    if (
      !agent?.messengerOfAgentId ||
      this.stringifyObjectId(agent.createdUserId) !==
        this.stringifyObjectId(userId)
    ) {
      throw new AppError(
        'MESSENGER_AGENT_NOT_FOUND',
        'messenger agent not found',
        404
      );
    }
  }

  private buildMessengerMessageItem(
    message: MessageEntity
  ): AdminAppUserMessengerMessageDTO {
    return {
      id: this.stringifyObjectId(message.id),
      conversationId: this.stringifyObjectId(message.conversationId),
      role: message.role ?? '',
      type: message.type ?? '',
      content: message.content ?? '',
      mediaObjectKey: message.mediaObjectKey ?? '',
      mediaUrl: message.mediaUrl ?? '',
      mediaMimeType: message.mediaMimeType ?? '',
      createdAt: this.formatDate(message.createdAt),
    };
  }

  /** 校验聊天对象确实属于该用户（不限小使者），用于只读联查。 */
  private async assertUserOwnedAgent(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<AgentEntity> {
    const agent =
      (await this.agentModel.findOne({ where: { id: agentId } })) ??
      (await this.agentModel.findOne({ where: { _id: agentId } as never }));

    if (
      !agent ||
      this.stringifyObjectId(agent.createdUserId) !==
        this.stringifyObjectId(userId)
    ) {
      throw new AppError(
        'APP_USER_AGENT_NOT_FOUND',
        'app user agent not found',
        404
      );
    }

    return agent;
  }

  private collectFactSourceIds(fact: AgentProfileFactEntity): string[] {
    const ids: string[] = [];
    if (fact.sourceMessageId) {
      const primary = this.stringifyObjectId(fact.sourceMessageId);
      if (primary) {
        ids.push(primary);
      }
    }
    for (const id of fact.sourceMessageIds ?? []) {
      if (!id) {
        continue;
      }
      const value = this.stringifyObjectId(id);
      if (value) {
        ids.push(value);
      }
    }

    return ids;
  }

  private async getSourceConversationMap(
    sourceIds: string[]
  ): Promise<Map<string, string>> {
    if (!sourceIds.length) {
      return new Map();
    }

    const objectIds = sourceIds
      .filter(id => MongoObjectId.isValid(id))
      .map(id => new MongoObjectId(id));

    if (!objectIds.length) {
      return new Map();
    }

    const messages = await this.messageModel.find({
      where: { _id: { $in: objectIds } } as never,
    });

    return new Map(
      messages.map(message => [
        this.stringifyObjectId(message.id),
        this.stringifyObjectId(message.conversationId),
      ])
    );
  }

  private buildAgentMemoryItem(
    fact: AgentProfileFactEntity,
    conversationMap: Map<string, string>
  ): AdminAppUserAgentMemoryItem {
    const governance = fact.governance;
    const sourceMessageIds = this.collectFactSourceIds(fact);
    const sourceMessageId = sourceMessageIds[0] ?? '';
    const sourceConversationId = sourceMessageId
      ? conversationMap.get(sourceMessageId) ?? ''
      : '';

    return {
      id: this.stringifyObjectId(fact.id),
      scope: 'agent',
      type: fact.type ?? '',
      key: fact.key ?? '',
      value: fact.value ?? '',
      polarity: fact.polarity ?? '',
      status: fact.status ?? '',
      confidence: fact.confidence ?? '',
      assertionPolicy: fact.assertionPolicy ?? '',
      priority: typeof fact.priority === 'number' ? fact.priority : 0,
      sourceMessageId,
      sourceMessageIds,
      sourceConversationId,
      sourceText: fact.sourceText ?? '',
      retention: governance?.retention ?? '',
      certainty: governance?.certainty ?? '',
      timeKind: governance?.timeKind ?? '',
      validUntil: governance?.validUntil ?? '',
      sourceOccurredAt: governance?.sourceOccurredAt ?? '',
      recordedAt: this.formatDate(fact.createdAt),
      updatedAt: this.formatDate(fact.updatedAt),
    };
  }

  /**
   * 账号级共享记忆：复用现有账号级记忆读取结果，压缩为可单独标识的条目。
   * 这些记忆归属用户账号，跨聊天对象共享，不冒充角色独有记忆。
   */
  private async buildAccountSharedMemories(userId: string): Promise<{
    items: AdminAppUserAccountSharedMemoryItem[];
    total: number;
  }> {
    const account = await this.getAccountMemory(userId);
    const items: AdminAppUserAccountSharedMemoryItem[] = [];

    if (
      account.identity &&
      (account.identity.realName || account.identity.aliases.length)
    ) {
      const aliasSuffix = account.identity.aliases.length
        ? `（别名：${account.identity.aliases.join('、')}）`
        : '';
      items.push({
        id: 'account-identity',
        scope: 'account',
        type: 'identity',
        key: 'account.identity',
        value: `${account.identity.realName || '未命名'}${aliasSuffix}`,
        status: 'active',
        confidence: 'confirmed',
        sourceText: account.identity.sourceText,
        updatedAt: account.identity.updatedAt,
      });
    }

    for (const person of account.people) {
      const name = person.realName || person.preferredName || '未命名';
      const relationSuffix = person.relationToUser
        ? `（${person.relationToUser}）`
        : '';
      items.push({
        id: person.id,
        scope: 'account',
        type: 'relationship',
        key: `account.person.${person.id}`,
        value: `${name}${relationSuffix}`,
        status: 'active',
        confidence: 'confirmed',
        sourceText: person.sourceText,
        updatedAt: person.updatedAt,
      });
    }

    return {
      items: items.slice(0, 50),
      total: items.length,
    };
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
