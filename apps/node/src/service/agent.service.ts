import { InjectEntityModel } from '@midwayjs/typeorm';
import { Inject, Provide } from '@midwayjs/core';
import type { AgentProfileDTO } from '@tzl/shared';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentProfileDTO,
} from '../dto/agent.dto';
import {
  AgentEntity,
  AgentMembershipEntity,
  AgentMembershipStatus,
  AgentSex,
  ConversationEntity,
  MongoObjectId,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { PostImageService } from './post-image.service';

export type AgentProfile = AgentProfileDTO;

@Provide()
export class AgentService {
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(AgentMembershipEntity)
  agentMembershipModel: MongoRepository<AgentMembershipEntity>;

  @Inject()
  postImageService: PostImageService;

  async listAgents(auth: AuthenticatedUserPayload): Promise<AgentProfile[]> {
    const createdUserId = this.parseUserId(auth.sub);
    const agents = await this.agentModel.find({
      where: {
        createdUserId,
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    return Promise.all(agents.map(agent => this.buildAgentProfile(agent)));
  }

  async getAgentDetail(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return this.buildAgentProfile(agent);
  }

  async createAgent(
    auth: AuthenticatedUserPayload,
    payload: CreateAgentDTO
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const name = this.normalizeName(payload?.name);
    const sex = this.normalizeSex(payload?.sex);
    const iCallAgent = this.normalizeCallName(
      payload?.iCallAgent,
      'INVALID_I_CALL_AGENT'
    );
    const agentCallMe = this.normalizeCallName(
      payload?.agentCallMe,
      'INVALID_AGENT_CALL_ME'
    );
    const now = new Date();

    const agent = new AgentEntity();
    agent.createdUserId = createdUserId;
    agent.name = name;
    agent.avatar = '';
    agent.sex = sex;
    agent.iCallAgent = iCallAgent;
    agent.agentCallMe = agentCallMe;
    agent.description = this.buildDescription({
      name,
      sex,
      iCallAgent,
      agentCallMe,
    });
    agent.status = 1;
    agent.createdAt = now;
    agent.updatedAt = now;

    const savedAgent = await this.agentModel.save(agent);
    await this.createConversation(savedAgent, createdUserId, now);

    return this.buildAgentProfile(savedAgent);
  }

  async updateAgentAvatar(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: UpdateAgentAvatarDTO
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    agent.avatar = this.normalizeAgentAvatar(payload?.avatar);
    agent.updatedAt = new Date();

    const savedAgent = await this.agentModel.save(agent);
    return this.buildAgentProfile(savedAgent);
  }

  async updateAgentProfile(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: UpdateAgentProfileDTO
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const previousAutoDescription = this.buildDescription({
      name: agent.name,
      sex: agent.sex,
      iCallAgent: agent.iCallAgent?.trim() || '',
      agentCallMe: agent.agentCallMe?.trim() || '',
    });
    const shouldRegenerateDescription =
      payload?.description === undefined &&
      (!agent.description?.trim() ||
        agent.description.trim() === previousAutoDescription);

    if (payload?.name !== undefined) {
      agent.name = this.normalizeName(payload.name);
    }

    if (payload?.sex !== undefined) {
      agent.sex = this.normalizeSex(payload.sex);
    }

    if (payload?.iCallAgent !== undefined) {
      agent.iCallAgent = this.normalizeCallName(
        payload.iCallAgent,
        'INVALID_I_CALL_AGENT'
      );
    }

    if (payload?.agentCallMe !== undefined) {
      agent.agentCallMe = this.normalizeCallName(
        payload.agentCallMe,
        'INVALID_AGENT_CALL_ME'
      );
    }

    if (payload?.birthday !== undefined) {
      agent.birthday = this.normalizeOptionalDate(
        payload.birthday,
        'INVALID_AGENT_BIRTHDAY'
      );
    }

    if (payload?.deathDate !== undefined) {
      agent.deathDate = this.normalizeOptionalDate(
        payload.deathDate,
        'INVALID_AGENT_DEATH_DATE'
      );
    }

    if (payload?.description !== undefined) {
      agent.description = this.normalizeDescription(payload.description);
    } else if (shouldRegenerateDescription) {
      agent.description = this.buildDescription({
        name: agent.name,
        sex: agent.sex,
        iCallAgent: agent.iCallAgent?.trim() || '',
        agentCallMe: agent.agentCallMe?.trim() || '',
      });
    }

    agent.updatedAt = new Date();

    const savedAgent = await this.agentModel.save(agent);
    return this.buildAgentProfile(savedAgent);
  }

  private async createConversation(
    agent: AgentEntity,
    userId: MongoObjectId,
    now: Date
  ): Promise<void> {
    const conversation = new ConversationEntity();
    conversation.agentId = agent.id;
    conversation.userId = userId;
    conversation.createdAt = now;
    conversation.updatedAt = now;

    await this.conversationModel.save(conversation);
  }

  private async buildAgentProfile(agent: AgentEntity): Promise<AgentProfile> {
    return {
      id: this.stringifyObjectId(agent.id),
      name: agent.name,
      avatar: this.postImageService.resolveForResponse(
        agent.avatar?.trim() || ''
      ),
      sex: agent.sex,
      agentCallMe: agent.agentCallMe ?? '',
      iCallAgent: agent.iCallAgent ?? '',
      birthday: agent.birthday?.toISOString?.() ?? '',
      deathDate: agent.deathDate?.toISOString?.() ?? '',
      description: agent.description,
      status: agent.status,
      voiceTimbreId: this.stringifyOptionalObjectId(agent.voiceTimbreId),
      isVip: await this.isAgentVip(agent),
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    };
  }

  private async isAgentVip(agent: AgentEntity): Promise<boolean> {
    const memberships = await this.agentMembershipModel.find({
      where: {
        userId: agent.createdUserId,
        agentId: agent.id,
        status: AgentMembershipStatus.active,
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

  private buildDescription(options: {
    name: string;
    sex: AgentSex;
    iCallAgent: string;
    agentCallMe: string;
  }): string {
    const sexText = options.sex === AgentSex.man ? '男性' : '女性';
    return `${options.name}，${sexText}，你称呼TA为${options.iCallAgent}，TA会称呼你为${options.agentCallMe}。`;
  }

  private normalizeName(rawName?: string): string {
    const name = rawName?.trim();

    if (!name) {
      throw new AppError('INVALID_AGENT_NAME', 'agent name is required');
    }

    if (name.length > 30) {
      throw new AppError(
        'INVALID_AGENT_NAME',
        'agent name must be 30 characters or fewer'
      );
    }

    return name;
  }

  private normalizeSex(rawSex?: number): AgentSex {
    if (rawSex === AgentSex.woman || rawSex === AgentSex.man) {
      return rawSex;
    }

    throw new AppError('INVALID_AGENT_SEX', 'agent sex is invalid');
  }

  private normalizeCallName(rawValue?: string, code?: string): string {
    const value = rawValue?.trim();

    if (!value) {
      throw new AppError(
        code || 'INVALID_AGENT_CALL_NAME',
        'value is required'
      );
    }

    if (value.length > 20) {
      throw new AppError(
        code || 'INVALID_AGENT_CALL_NAME',
        'value must be 20 characters or fewer'
      );
    }

    return value;
  }

  private normalizeAgentAvatar(rawAvatar?: string): string {
    const avatar = rawAvatar?.trim() ?? '';

    if (!avatar) {
      throw new AppError(
        'INVALID_AGENT_AVATAR',
        'agent avatar is required',
        400
      );
    }

    if (avatar.length > 1000) {
      throw new AppError(
        'INVALID_AGENT_AVATAR',
        'agent avatar reference is too long',
        400
      );
    }

    return this.postImageService.normalizeForStorage(avatar);
  }

  private normalizeOptionalDate(
    rawValue: string,
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

  private parseObjectId(value: string): MongoObjectId {
    try {
      return new MongoObjectId(value);
    } catch {
      throw new AppError('INVALID_ID', 'id is invalid', 400);
    }
  }

  private parseUserId(value: string): MongoObjectId {
    try {
      return new MongoObjectId(value);
    } catch {
      throw new AppError('INVALID_TOKEN', 'token subject is invalid', 401);
    }
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private stringifyOptionalObjectId(value?: MongoObjectId): string {
    return value ? this.stringifyObjectId(value) : '';
  }

  private async findAgentByIdForUser(
    agentId: MongoObjectId,
    createdUserId: MongoObjectId
  ): Promise<AgentEntity | null> {
    const agentById = await this.agentModel.findOne({
      where: {
        id: agentId,
        createdUserId,
      },
    });

    if (agentById) {
      return agentById;
    }

    return this.agentModel.findOne({
      where: {
        _id: agentId,
        createdUserId,
      },
    });
  }
}
