import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminAgentConversationListDTO,
  AdminAgentConversationMessageListDTO,
  AdminAgentConversationMessageRecordDTO,
  AdminAgentConversationRecordDTO,
  AdminAgentListDTO,
  AdminAgentOwnerDTO,
  AdminAgentRecordDTO,
} from '@tzl/shared';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  AgentSex,
  MongoObjectId,
  UserAccountEntity,
  UserEntity,
  VoiceTimbreEntity,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminAgentConversationMessagesQueryDTO,
  ListAdminAgentConversationsQueryDTO,
  ListAdminAgentsQueryDTO,
  UpdateAdminAgentDTO,
} from '../dto/admin-agent.dto';
import { AdminAvatarUrlService } from './admin-avatar-url.service';

export type AdminAgentOwner = AdminAgentOwnerDTO;
export type AdminAgentItem = AdminAgentRecordDTO;
export type AdminAgentListResult = AdminAgentListDTO;
export type AdminAgentConversationItem = AdminAgentConversationRecordDTO;
export type AdminAgentConversationListResult = AdminAgentConversationListDTO;
export type AdminAgentConversationMessageItem =
  AdminAgentConversationMessageRecordDTO;
export type AdminAgentConversationMessageListResult =
  AdminAgentConversationMessageListDTO;

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminAgentService {
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

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  avatarUrlService: AdminAvatarUrlService;

  async listAgents(
    query: ListAdminAgentsQueryDTO
  ): Promise<AdminAgentListResult> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const keyword = query?.keyword?.trim() ?? '';
    const where = await this.buildAgentSearchWhere(keyword, {
      sex: this.normalizeOptionalNumber(query?.sex),
      status: this.normalizeOptionalNumber(query?.status),
    });
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
    const ownerMap = await this.getOwnerMapByAgents(agents);

    return {
      items: agents.map(agent =>
        this.buildAgentItem(
          agent,
          ownerMap.get(this.stringifyObjectId(agent.createdUserId))
        )
      ),
      total,
      page,
      pageSize,
    };
  }

  async getAgentDetail(agentId: string): Promise<AdminAgentItem> {
    const agent = await this.getAgentById(agentId);
    const ownerMap = await this.getOwnerMapByAgents([agent]);

    return this.buildAgentItem(
      agent,
      ownerMap.get(this.stringifyObjectId(agent.createdUserId))
    );
  }

  async listAgentConversations(
    agentId: string,
    query: ListAdminAgentConversationsQueryDTO
  ): Promise<AdminAgentConversationListResult> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 10),
      100
    );
    const agent = await this.getAgentById(agentId);
    const where = {
      agentId: agent.id,
    };
    const [total, conversations] = await Promise.all([
      this.conversationModel.count(where),
      this.conversationModel.find({
        where: where as never,
        order: {
          updatedAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const ownerMap = await this.getOwnerMapByUserIds(
      conversations.map(conversation => conversation.userId).filter(Boolean)
    );
    const items = await Promise.all(
      conversations.map(async conversation => {
        const [latestMessage, messageCount] = await Promise.all([
          this.findLatestMessage(conversation.id),
          this.messageModel.count({
            conversationId: conversation.id,
          }),
        ]);

        return this.buildConversationItem(
          conversation,
          this.buildConversationOwner(
            ownerMap.get(this.stringifyObjectId(conversation.userId))
          ),
          latestMessage,
          messageCount
        );
      })
    );

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async listAgentConversationMessages(
    agentId: string,
    conversationId: string,
    query: ListAdminAgentConversationMessagesQueryDTO
  ): Promise<AdminAgentConversationMessageListResult> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 50),
      100
    );
    const agent = await this.getAgentById(agentId);
    const conversation = await this.getConversationForAgent(
      agent.id,
      conversationId
    );
    const where = {
      conversationId: conversation.id,
    };
    const [total, messages] = await Promise.all([
      this.messageModel.count(where),
      this.messageModel.find({
        where: where as never,
        order: {
          createdAt: 'ASC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: messages.map(message =>
        this.buildConversationMessageItem(message)
      ),
      total,
      page,
      pageSize,
    };
  }

  async updateAgent(
    agentId: string,
    payload: UpdateAdminAgentDTO
  ): Promise<AdminAgentItem> {
    const agent = await this.getAgentById(agentId);
    let changed = false;

    if (payload.name !== undefined) {
      agent.name = this.normalizeName(payload.name);
      changed = true;
    }

    if (payload.avatar !== undefined) {
      agent.avatar = this.normalizeAvatarForStorage(payload.avatar);
      changed = true;
    }

    if (payload.sex !== undefined) {
      agent.sex = this.normalizeSex(payload.sex);
      changed = true;
    }

    if (payload.agentCallMe !== undefined) {
      agent.agentCallMe = this.normalizeCallName(
        payload.agentCallMe,
        'INVALID_AGENT_CALL_ME'
      );
      changed = true;
    }

    if (payload.iCallAgent !== undefined) {
      agent.iCallAgent = this.normalizeCallName(
        payload.iCallAgent,
        'INVALID_I_CALL_AGENT'
      );
      changed = true;
    }

    if (payload.birthday !== undefined) {
      agent.birthday = this.normalizeOptionalDate(
        payload.birthday,
        'INVALID_AGENT_BIRTHDAY'
      );
      changed = true;
    }

    if (payload.deathDate !== undefined) {
      agent.deathDate = this.normalizeOptionalDate(
        payload.deathDate,
        'INVALID_AGENT_DEATH_DATE'
      );
      changed = true;
    }

    if (payload.description !== undefined) {
      agent.description = this.normalizeDescription(payload.description);
      changed = true;
    }

    if (payload.status !== undefined) {
      agent.status = this.normalizeStatus(payload.status);
      changed = true;
    }

    if (payload.voiceTimbreId !== undefined) {
      agent.voiceTimbreId = await this.normalizeVoiceTimbreId(
        payload.voiceTimbreId
      );
      changed = true;
    }

    if (changed) {
      agent.updatedAt = new Date();
      await this.agentModel.save(agent);
    }

    const ownerMap = await this.getOwnerMapByAgents([agent]);

    return this.buildAgentItem(
      agent,
      ownerMap.get(this.stringifyObjectId(agent.createdUserId))
    );
  }

  private async buildAgentSearchWhere(
    keyword: string,
    filters: {
      sex?: number;
      status?: number;
    }
  ): Promise<MongoWhere> {
    const where: MongoWhere = {};

    if (filters.sex !== undefined) {
      where.sex = this.normalizeSex(filters.sex);
    }

    if (filters.status !== undefined) {
      where.status = this.normalizeStatus(filters.status);
    }

    if (!keyword) {
      return where;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const keywordFilters: MongoWhere[] = [
      { name: { $regex: escapedKeyword, $options: 'i' } },
      { agentCallMe: { $regex: escapedKeyword, $options: 'i' } },
      { iCallAgent: { $regex: escapedKeyword, $options: 'i' } },
      { description: { $regex: escapedKeyword, $options: 'i' } },
    ];
    const ownerIds = await this.findOwnerIdsByKeyword(escapedKeyword);

    if (ownerIds.length > 0) {
      keywordFilters.push({ createdUserId: { $in: ownerIds } });
    }

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);

      keywordFilters.push({ id: objectId });
      keywordFilters.push({ _id: objectId });
      keywordFilters.push({ createdUserId: objectId });
    }

    return {
      ...where,
      $or: keywordFilters,
    };
  }

  private async findOwnerIdsByKeyword(
    escapedKeyword: string
  ): Promise<MongoObjectId[]> {
    const [matchedUsers, matchedAccounts] = await Promise.all([
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
    const ids = [
      ...matchedUsers.map(user => user.id),
      ...matchedAccounts.map(account => account.userId),
    ].filter(Boolean);
    const uniqueIds = new Map<string, MongoObjectId>();

    ids.forEach(id => uniqueIds.set(this.stringifyObjectId(id), id));

    return [...uniqueIds.values()];
  }

  private async getOwnerMapByAgents(
    agents: AgentEntity[]
  ): Promise<Map<string, AdminAgentOwner>> {
    if (agents.length === 0) {
      return new Map();
    }

    const userIds = agents.map(agent => agent.createdUserId).filter(Boolean);
    return this.getOwnerMapByUserIds(userIds);
  }

  private async getOwnerMapByUserIds(
    userIds: MongoObjectId[]
  ): Promise<Map<string, AdminAgentOwner>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const [users, accounts] = await Promise.all([
      this.userModel.find({
        where: {
          id: { $in: userIds },
        } as never,
      }),
      this.userAccountModel.find({
        where: {
          userId: { $in: userIds },
        } as never,
      }),
    ]);
    const accountMap = new Map(
      accounts.map(account => [this.stringifyObjectId(account.userId), account])
    );

    return new Map(
      users.map(user => {
        const id = this.stringifyObjectId(user.id);
        const account = accountMap.get(id);

        return [
          id,
          {
            id,
            account: account?.account ?? user.phone ?? '',
            name: user.name ?? '',
            avatar: this.resolveAvatar(user.avatar),
            phone: user.phone ?? account?.account ?? '',
          },
        ];
      })
    );
  }

  private async findLatestMessage(
    conversationId: MongoObjectId
  ): Promise<MessageEntity | null> {
    return this.messageModel.findOne({
      where: {
        conversationId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  private async getConversationForAgent(
    agentObjectId: MongoObjectId,
    conversationId: string
  ): Promise<ConversationEntity> {
    const objectId = this.parseConversationObjectId(conversationId);
    const conversation =
      (await this.conversationModel.findOne({
        where: {
          id: objectId,
          agentId: agentObjectId,
        },
      })) ??
      (await this.conversationModel.findOne({
        where: {
          _id: objectId,
          agentId: agentObjectId,
        } as never,
      }));

    if (!conversation) {
      throw new AppError(
        'CONVERSATION_NOT_FOUND',
        'conversation not found',
        404
      );
    }

    return conversation;
  }

  private async getAgentById(agentId: string): Promise<AgentEntity> {
    const objectId = this.parseObjectId(agentId);
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

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return agent;
  }

  private buildAgentItem(
    agent: AgentEntity,
    owner?: AdminAgentOwner | null
  ): AdminAgentItem {
    return {
      id: this.stringifyObjectId(agent.id),
      createdUserId: this.stringifyObjectId(agent.createdUserId),
      createdUser: owner ?? null,
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
      status: agent.status,
      voiceTimbreId: this.stringifyOptionalObjectId(agent.voiceTimbreId),
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

  private buildConversationItem(
    conversation: ConversationEntity,
    user?: AdminAgentOwner | null,
    latestMessage?: MessageEntity | null,
    messageCount = 0
  ): AdminAgentConversationItem {
    return {
      id: this.stringifyObjectId(conversation.id),
      agentId: this.stringifyObjectId(conversation.agentId),
      userId: this.stringifyObjectId(conversation.userId),
      user: user ?? null,
      latestMessage: latestMessage
        ? {
            id: this.stringifyObjectId(latestMessage.id),
            role: latestMessage.role,
            type: latestMessage.type,
            content: latestMessage.content ?? '',
            status: latestMessage.status,
            createdAt: this.formatDate(latestMessage.createdAt),
          }
        : null,
      messageCount,
      createdAt: this.formatDate(conversation.createdAt),
      updatedAt: this.formatDate(conversation.updatedAt),
    };
  }

  private buildConversationOwner(
    owner?: AdminAgentOwner | null
  ): AdminAgentOwner | null {
    if (!owner) {
      return null;
    }

    return {
      ...owner,
      account: this.maskSensitiveText(owner.account),
      phone: this.maskSensitiveText(owner.phone),
    };
  }

  private buildConversationMessageItem(
    message: MessageEntity
  ): AdminAgentConversationMessageItem {
    return {
      id: this.stringifyObjectId(message.id),
      conversationId: this.stringifyObjectId(message.conversationId),
      role: message.role,
      type: message.type,
      content: message.content ?? '',
      status: message.status,
      mediaUrl: message.mediaUrl ?? '',
      mediaMimeType: message.mediaMimeType ?? '',
      mediaTranscript: message.mediaTranscript ?? '',
      mediaDurationMs: message.mediaDurationMs,
      createdAt: this.formatDate(message.createdAt),
      updatedAt: this.formatDate(message.updatedAt),
    };
  }

  private normalizeName(rawName?: string): string {
    const name = rawName?.trim() ?? '';

    if (!name) {
      throw new AppError('INVALID_AGENT_NAME', 'agent name is required', 400);
    }

    if (name.length > 30) {
      throw new AppError(
        'INVALID_AGENT_NAME',
        'agent name must be 30 characters or fewer',
        400
      );
    }

    return name;
  }

  private normalizeSex(rawSex?: number): AgentSex {
    if (rawSex === AgentSex.woman || rawSex === AgentSex.man) {
      return rawSex;
    }

    throw new AppError('INVALID_AGENT_SEX', 'agent sex is invalid', 400);
  }

  private normalizeCallName(rawValue?: string, code?: string): string {
    const value = rawValue?.trim() ?? '';

    if (!value) {
      throw new AppError(
        code || 'INVALID_AGENT_CALL_NAME',
        'value is required',
        400
      );
    }

    if (value.length > 20) {
      throw new AppError(
        code || 'INVALID_AGENT_CALL_NAME',
        'value must be 20 characters or fewer',
        400
      );
    }

    return value;
  }

  private normalizeDescription(rawValue?: string): string {
    const value = rawValue?.trim() ?? '';

    if (value.length > 1000) {
      throw new AppError(
        'INVALID_AGENT_DESCRIPTION',
        'description must be 1000 characters or fewer',
        400
      );
    }

    return value;
  }

  private normalizeOptionalDate(
    rawValue: string | undefined,
    code: string
  ): Date | undefined {
    const value = rawValue?.trim?.() ?? '';

    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new AppError(code, 'date is invalid', 400);
    }

    return parsed;
  }

  private normalizeStatus(rawStatus?: number): number {
    if (rawStatus === 0 || rawStatus === 1) {
      return rawStatus;
    }

    throw new AppError('INVALID_AGENT_STATUS', 'agent status is invalid', 400);
  }

  private async normalizeVoiceTimbreId(
    rawValue?: string
  ): Promise<MongoObjectId | undefined> {
    const value = rawValue?.trim() ?? '';

    if (!value) {
      return undefined;
    }

    if (!MongoObjectId.isValid(value)) {
      throw new AppError(
        'INVALID_VOICE_TIMBRE_ID',
        'invalid voice timbre id',
        400
      );
    }

    const objectId = new MongoObjectId(value);
    const timbre =
      (await this.voiceTimbreModel.findOne({
        where: {
          id: objectId,
          status: 'active',
        },
      })) ??
      (await this.voiceTimbreModel.findOne({
        where: {
          _id: objectId,
          status: 'active',
        } as never,
      }));

    if (!timbre) {
      throw new AppError(
        'VOICE_TIMBRE_NOT_FOUND',
        'active voice timbre not found',
        404
      );
    }

    return objectId;
  }

  private normalizeOptionalNumber(
    rawValue: number | string | undefined
  ): number | undefined {
    if (rawValue === undefined || rawValue === '') {
      return undefined;
    }

    const value = Number(rawValue);

    return Number.isFinite(value) ? value : undefined;
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
      throw new AppError('INVALID_AGENT_ID', 'invalid agent id', 400);
    }

    return new MongoObjectId(value);
  }

  private parseConversationObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(
        'INVALID_CONVERSATION_ID',
        'invalid conversation id',
        400
      );
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private stringifyOptionalObjectId(value?: MongoObjectId): string {
    return value ? this.stringifyObjectId(value) : '';
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

  private maskSensitiveText(value?: string): string {
    const text = value?.trim() ?? '';

    if (!text) {
      return '';
    }

    if (/^\d{11}$/.test(text)) {
      return text.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
    }

    if (text.length <= 2) {
      return '*'.repeat(text.length);
    }

    if (text.length <= 6) {
      return `${text.slice(0, 1)}****${text.slice(-1)}`;
    }

    return `${text.slice(0, 3)}****${text.slice(-3)}`;
  }
}
