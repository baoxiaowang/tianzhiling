import { InjectEntityModel } from '@midwayjs/typeorm';
import { Inject, Provide } from '@midwayjs/core';
import { createHash, randomBytes } from 'crypto';
import type {
  AcceptAgentShareInviteResultDTO,
  AgentCreateGuideResultDTO,
  AgentProfileDTO,
  AgentProfileInterviewResultDTO,
  AgentProfileMessengerSpeechResultDTO,
  AgentShareInviteDTO,
  AgentShareInvitePreviewDTO,
  AgentShareQRCodeDTO,
} from '@tzl/shared';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import {
  AcceptAgentShareInviteDTO,
  AgentShareQRCodeDTO as AgentShareQRCodeRequestDTO,
  AgentCreateGuideDTO,
  AgentProfileInterviewDTO,
  AgentProfileMessengerSpeechDTO,
  CreateAgentDTO,
  UpdateAgentAvatarDTO,
  UpdateAgentDefaultDTO,
  UpdateAgentProfileDTO,
  UpdateAgentShareContextDTO,
} from '../dto/agent.dto';
import {
  AgentEntity,
  AgentShareInviteEntity,
  AgentShareInviteStatus,
  AgentShareMemberEntity,
  AgentShareMemberStatus,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  UserEntity,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { PostImageService } from './post-image.service';
import { AgentMemoryProfileService } from './agents/agent-memory-profile.service';
import { AgentCreateGuideService } from './agents/agent-create-guide.service';
import { AgentProfileMemorySourceField } from './agents/agent-profile-fact.service';
import { WechatPayService } from './wechat-pay.service';

export type AgentProfile = AgentProfileDTO;
export type AgentGuideSeenTarget = 'agent-home' | 'agent-profile';

const AGENT_SHARE_INVITE_TOKEN_BYTES = 24;
const AGENT_SHARE_INVITE_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;
const AGENT_SHARE_MINI_PROGRAM_PAGE = 'pages/agent-share/index';

type AgentAccessRole = 'owner' | 'shared';

interface AgentAccess {
  agent: AgentEntity;
  role: AgentAccessRole;
}

@Provide()
export class AgentService {
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(AgentShareInviteEntity)
  agentShareInviteModel: MongoRepository<AgentShareInviteEntity>;

  @InjectEntityModel(AgentShareMemberEntity)
  agentShareMemberModel: MongoRepository<AgentShareMemberEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @Inject()
  postImageService: PostImageService;

  @Inject()
  agentMemoryProfileService: AgentMemoryProfileService;

  @Inject()
  agentCreateGuideService: AgentCreateGuideService;

  @Inject()
  wechatPayService: WechatPayService;

  async interviewAgentCreation(
    _auth: AuthenticatedUserPayload,
    payload: AgentCreateGuideDTO
  ): Promise<AgentCreateGuideResultDTO> {
    return this.agentCreateGuideService.buildTurn({
      input: payload.input,
      draft: payload.draft,
      focusField: payload.focusField,
      turnCount: payload.turnCount,
    });
  }

  async createAgentCreationMessengerSpeech(
    _auth: AuthenticatedUserPayload,
    payload: AgentProfileMessengerSpeechDTO
  ): Promise<AgentProfileMessengerSpeechResultDTO> {
    return this.agentMemoryProfileService.createMessengerSpeech(payload.text);
  }

  async listAgents(auth: AuthenticatedUserPayload): Promise<AgentProfile[]> {
    const userId = this.parseUserId(auth.sub);
    const agents = await this.agentModel.find({
      where: {
        createdUserId: userId,
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    return this.buildAgentProfiles(agents, userId);
  }

  async listAccessibleAgents(
    auth: AuthenticatedUserPayload
  ): Promise<AgentProfile[]> {
    const userId = this.parseUserId(auth.sub);
    const [ownedAgents, sharedMembers] = await Promise.all([
      this.agentModel.find({
        where: {
          createdUserId: userId,
        },
        order: {
          updatedAt: 'DESC',
        },
      }),
      this.agentShareMemberModel.find({
        where: {
          userId,
          status: AgentShareMemberStatus.active,
        },
        order: {
          updatedAt: 'DESC',
        },
      }),
    ]);
    const sharedAgents = await Promise.all(
      sharedMembers.map(member => this.findAgentById(member.agentId))
    );
    const agentsById = new Map<string, AgentEntity>();

    for (const agent of [...ownedAgents, ...sharedAgents.filter(Boolean)]) {
      if (agent) {
        agentsById.set(this.stringifyObjectId(agent.id), agent);
      }
    }

    const agents = Array.from(agentsById.values()).sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
    );

    return this.buildAgentProfiles(agents, userId);
  }

  async getAgentDetail(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentProfile> {
    const userId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const access = await this.findAgentAccessByIdForUser(objectId, userId);

    if (!access) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return this.buildAgentProfile(access.agent, {
      viewerUserId: userId,
    });
  }

  async createAgentShareInvite(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentShareInviteDTO> {
    const userId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const access = await this.findAgentAccessByIdForUser(objectId, userId);

    if (!access) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    if (access.role !== 'owner') {
      throw new AppError(
        'AGENT_SHARE_OWNER_REQUIRED',
        'only the owner can create share invites',
        403
      );
    }

    const token = this.generateShareInviteToken();
    const now = new Date();
    const invite = new AgentShareInviteEntity();

    invite.agentId = access.agent.id;
    invite.ownerUserId = access.agent.createdUserId;
    invite.createdByUserId = userId;
    invite.tokenHash = this.hashShareInviteToken(token);
    invite.status = AgentShareInviteStatus.active;
    invite.expiresAt = new Date(now.getTime() + AGENT_SHARE_INVITE_EXPIRES_MS);
    invite.acceptedCount = 0;
    invite.createdAt = now;
    invite.updatedAt = now;

    const savedInvite = await this.agentShareInviteModel.save(invite);

    return {
      token,
      agentId: this.stringifyObjectId(savedInvite.agentId),
      ownerUserId: this.stringifyObjectId(savedInvite.ownerUserId),
      createdByUserId: this.stringifyObjectId(savedInvite.createdByUserId),
      expiresAt: savedInvite.expiresAt.toISOString(),
    };
  }

  async getAgentShareInvitePreview(
    rawToken: string
  ): Promise<AgentShareInvitePreviewDTO> {
    const token = this.normalizeShareInviteToken(rawToken);
    const invite = await this.requireActiveShareInvite(token);
    const [agent, inviter] = await Promise.all([
      this.findAgentById(invite.agentId),
      this.userModel.findOne({
        where: {
          id: invite.createdByUserId,
        },
      }),
    ]);

    if (
      !agent ||
      !this.sameObjectId(agent.createdUserId, invite.ownerUserId)
    ) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return {
      inviter: {
        name: inviter?.name?.trim() || '一位亲友',
        avatar: this.postImageService.resolveForResponse(
          inviter?.avatar?.trim() || ''
        ),
      },
      agent: {
        name: agent.name?.trim() || '未命名天之灵',
        realName: agent.realName?.trim() || '',
        avatar: this.postImageService.resolveForResponse(
          agent.avatar?.trim() || ''
        ),
        sex: agent.sex,
        description: '',
      },
      expiresAt: new Date(invite.expiresAt).toISOString(),
    };
  }

  async createAgentShareQRCode(
    auth: AuthenticatedUserPayload,
    payload: AgentShareQRCodeRequestDTO
  ): Promise<AgentShareQRCodeDTO> {
    const userId = this.parseUserId(auth.sub);
    const token = this.normalizeShareInviteToken(payload?.token);
    const invite = await this.requireActiveShareInvite(token);

    if (!this.sameObjectId(invite.ownerUserId, userId)) {
      throw new AppError(
        'AGENT_SHARE_OWNER_REQUIRED',
        'only the owner can create a share qr code',
        403
      );
    }

    const result = await this.wechatPayService.createUnlimitedMiniProgramCode({
      scene: token,
      page: AGENT_SHARE_MINI_PROGRAM_PAGE,
    });

    return {
      imageBase64: result.buffer.toString('base64'),
      mimeType: result.mimeType,
      expiresAt: new Date(invite.expiresAt).toISOString(),
    };
  }

  async acceptAgentShareInvite(
    auth: AuthenticatedUserPayload,
    payload: AcceptAgentShareInviteDTO
  ): Promise<AcceptAgentShareInviteResultDTO> {
    const userId = this.parseUserId(auth.sub);
    const token = this.normalizeShareInviteToken(payload?.token);
    const now = new Date();
    const invite = await this.requireActiveShareInvite(token, now);

    const agent = await this.findAgentById(invite.agentId);

    if (
      !agent ||
      !this.sameObjectId(agent.createdUserId, invite.ownerUserId)
    ) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const isOwner = this.sameObjectId(agent.createdUserId, userId);
    const conversation = await this.ensureConversationForAgent(agent, userId, {
      now,
      usePersonalCallName: isOwner,
    });
    const existingMember = isOwner
      ? null
      : await this.findShareMemberByAgentAndUser(agent.id, userId);
    const wasActive =
      existingMember?.status === AgentShareMemberStatus.active;
    const member = isOwner
      ? null
      : await this.ensureShareMember(agent, invite, userId, now);

    if (!isOwner && !wasActive) {
      invite.acceptedCount = (invite.acceptedCount ?? 0) + 1;
      invite.lastAcceptedAt = now;
      invite.updatedAt = now;
      await this.agentShareInviteModel.save(invite);
    }

    return {
      agent: await this.buildAgentProfile(agent, {
        viewerUserId: userId,
      }),
      conversationId: this.stringifyObjectId(conversation.id),
      share: {
        agentId: this.stringifyObjectId(agent.id),
        ownerUserId: this.stringifyObjectId(agent.createdUserId),
        userId: this.stringifyObjectId(userId),
        status: isOwner ? 'owner' : 'active',
        acceptedAt: (member?.acceptedAt ?? now).toISOString(),
      },
    };
  }

  async updateAgentShareContext(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: UpdateAgentShareContextDTO
  ): Promise<AgentProfile> {
    const userId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const member = await this.findActiveShareMemberByAgentAndUser(
      objectId,
      userId
    );

    if (!member) {
      throw new AppError(
        'AGENT_SHARE_MEMBER_NOT_FOUND',
        'active share member not found',
        404
      );
    }

    if (payload.agentCallsUser !== undefined) {
      member.agentCallsUser = this.normalizeOptionalShareCallName(
        payload.agentCallsUser
      );
    }

    if (payload.userCallsAgent !== undefined) {
      member.userCallsAgent = this.normalizeOptionalShareCallName(
        payload.userCallsAgent
      );
    }

    member.updatedAt = new Date();
    await this.agentShareMemberModel.save(member);
    const conversation = await this.findConversationByAgentAndUser(
      objectId,
      userId
    );

    if (conversation) {
      conversation.accessRole = 'shared';
      conversation.agentCallsUser = member.agentCallsUser?.trim() || '';
      conversation.userCallsAgent = member.userCallsAgent?.trim() || '';
      conversation.updatedAt = member.updatedAt;
      await this.conversationModel.save(conversation);
    }

    const agent = await this.findAgentById(objectId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return this.buildAgentProfile(agent, {
      viewerUserId: userId,
    });
  }

  async getAgentMemoryProfile(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const refreshedAgent =
      await this.agentMemoryProfileService.refreshFromMemoryForView({
        agent,
        userId: createdUserId,
      });

    return this.buildAgentProfile(refreshedAgent);
  }

  async interviewAgentProfile(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: AgentProfileInterviewDTO
  ): Promise<AgentProfileInterviewResultDTO> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return this.agentMemoryProfileService.buildInterviewTurn({
      agent,
      input: payload.input,
      draft: payload.draft,
      focusField: payload.focusField,
      turnCount: payload.turnCount,
    });
  }

  async createAgentProfileMessengerSpeech(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: AgentProfileMessengerSpeechDTO
  ): Promise<AgentProfileMessengerSpeechResultDTO> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    return this.agentMemoryProfileService.createMessengerSpeech(payload.text);
  }

  async markAgentGuideSeen(
    auth: AuthenticatedUserPayload,
    agentId: string,
    target: string
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    if (target !== 'agent-home' && target !== 'agent-profile') {
      throw new AppError(
        'INVALID_AGENT_GUIDE_TARGET',
        'agent guide target is invalid',
        400
      );
    }

    if (!agent.profileCompletionGuideCreatedAt) {
      return this.buildAgentProfile(agent);
    }

    const field =
      target === 'agent-home'
        ? 'agentHomeGuideSeenAt'
        : 'agentProfileGuideSeenAt';

    if (!agent[field]) {
      agent[field] = new Date();
      await this.agentModel.save(agent);
    }

    return this.buildAgentProfile(agent);
  }

  async createAgent(
    auth: AuthenticatedUserPayload,
    payload: CreateAgentDTO
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const name = this.normalizeName(payload?.name);
    const realName = this.normalizeOptionalRealName(payload?.realName);
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
    agent.realName = realName;
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
    agent.lifeExperience = '';
    agent.personalityTraits = '';
    agent.languageHabits = '';
    agent.hobbies = '';
    agent.sharedMemories = '';
    agent.profileCompletionGuideCreatedAt = now;
    agent.status = 1;
    agent.isDefault = await this.shouldSetCreatedAgentAsDefault(createdUserId);
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
    const profileMemorySources: Partial<
      Record<AgentProfileMemorySourceField, string>
    > = {};

    if (payload?.name !== undefined) {
      agent.name = this.normalizeName(payload.name);
    }

    if (payload?.realName !== undefined) {
      agent.realName = this.normalizeOptionalRealName(payload.realName);
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

    if (payload?.lifeExperience !== undefined) {
      agent.lifeExperience = this.normalizeProfileMemory(
        payload.lifeExperience,
        'INVALID_AGENT_LIFE_EXPERIENCE'
      );
      profileMemorySources.lifeExperience = agent.lifeExperience;
    }

    if (payload?.personalityTraits !== undefined) {
      agent.personalityTraits = this.normalizeProfileMemory(
        payload.personalityTraits,
        'INVALID_AGENT_PERSONALITY_TRAITS'
      );
      profileMemorySources.personalityTraits = agent.personalityTraits;
    }

    if (payload?.languageHabits !== undefined) {
      agent.languageHabits = this.normalizeProfileMemory(
        payload.languageHabits,
        'INVALID_AGENT_LANGUAGE_HABITS'
      );
      profileMemorySources.languageHabits = agent.languageHabits;
    }

    if (payload?.hobbies !== undefined) {
      agent.hobbies = this.normalizeProfileMemory(
        payload.hobbies,
        'INVALID_AGENT_HOBBIES'
      );
      profileMemorySources.hobbies = agent.hobbies;
    }

    if (payload?.sharedMemories !== undefined) {
      agent.sharedMemories = this.normalizeProfileMemory(
        payload.sharedMemories,
        'INVALID_AGENT_SHARED_MEMORIES'
      );
      profileMemorySources.sharedMemories = agent.sharedMemories;
    }

    agent.updatedAt = new Date();

    let savedAgent = await this.agentModel.save(agent);
    if (Object.keys(profileMemorySources).length) {
      savedAgent = await this.agentMemoryProfileService.alignManualProfileEdits(
        {
          agent: savedAgent,
          userId: createdUserId,
          sources: profileMemorySources,
        }
      );
    }
    return this.buildAgentProfile(savedAgent);
  }

  async updateAgentDefault(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: UpdateAgentDefaultDTO
  ): Promise<AgentProfile> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const nextIsDefault = Boolean(payload?.isDefault);
    const now = new Date();

    if (nextIsDefault) {
      const userAgents = await this.agentModel.find({
        where: {
          createdUserId,
        },
      });

      await Promise.all(
        userAgents
          .filter(item => {
            return (
              this.stringifyObjectId(item.id) !==
              this.stringifyObjectId(agent.id)
            );
          })
          .filter(item => item.isDefault)
          .map(item => {
            item.isDefault = false;
            item.updatedAt = now;
            return this.agentModel.save(item);
          })
      );
    }

    agent.isDefault = nextIsDefault;
    agent.updatedAt = now;

    const savedAgent = await this.agentModel.save(agent);
    return this.buildAgentProfile(savedAgent);
  }

  async deleteAgent(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<void> {
    const createdUserId = this.parseUserId(auth.sub);
    const objectId = this.parseObjectId(agentId);
    const agent = await this.findAgentByIdForUser(objectId, createdUserId);

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const conversations = await this.conversationModel.find({
      where: {
        agentId: agent.id,
      },
    });

    await Promise.all(
      conversations.map(async conversation => {
        const messages = await this.messageModel.find({
          where: {
            conversationId: conversation.id,
          },
        });

        await Promise.all(
          messages.map(message => this.messageModel.remove(message))
        );
        await this.conversationModel.remove(conversation);
      })
    );
    await this.removeAgentShareRecords(agent.id);
    await this.agentModel.remove(agent);
  }

  private async createConversation(
    agent: AgentEntity,
    userId: MongoObjectId,
    now: Date,
    options: {
      usePersonalCallName?: boolean;
    } = {}
  ): Promise<ConversationEntity> {
    const conversation = new ConversationEntity();
    conversation.agentId = agent.id;
    conversation.userId = userId;
    conversation.accessRole =
      options.usePersonalCallName === false ? 'shared' : 'owner';
    conversation.agentCallsUser =
      options.usePersonalCallName === false
        ? ''
        : agent.agentCallMe?.trim() || '';
    conversation.userCallsAgent =
      options.usePersonalCallName === false
        ? agent.name?.trim() || ''
        : agent.iCallAgent?.trim() || agent.name?.trim() || '';
    conversation.createdAt = now;
    conversation.updatedAt = now;

    const savedConversation = await this.conversationModel.save(conversation);
    await this.createInitialAgentMessage(
      savedConversation,
      agent,
      userId,
      now,
      options
    );

    return savedConversation;
  }

  private async createInitialAgentMessage(
    conversation: ConversationEntity,
    agent: AgentEntity,
    userId: MongoObjectId,
    now: Date,
    options: {
      usePersonalCallName?: boolean;
    } = {}
  ): Promise<void> {
    const message = new MessageEntity();
    const callMe =
      options.usePersonalCallName === false
        ? ''
        : agent.agentCallMe?.trim() || '我';

    message.conversationId = conversation.id;
    message.userId = userId;
    message.agentId = agent.id;
    message.role = MessageRole.assistant;
    message.type = MessageType.text;
    message.content = callMe
      ? `${callMe}，好想你啊，过得好吗？`
      : '好想你啊，过得好吗？';
    message.status = MessageStatus.sent;
    message.createdAt = now;
    message.updatedAt = now;

    await this.messageModel.save(message);
  }

  private async buildAgentProfile(
    agent: AgentEntity,
    options: {
      viewerUserId?: MongoObjectId;
    } = {}
  ): Promise<AgentProfile> {
    const isOwner =
      !options.viewerUserId ||
      this.sameObjectId(agent.createdUserId, options.viewerUserId);
    const shareMember =
      !isOwner && options.viewerUserId
        ? await this.findActiveShareMemberByAgentAndUser(
            agent.id,
            options.viewerUserId
          )
        : null;
    const agentCallsUser = isOwner
      ? agent.agentCallMe ?? ''
      : shareMember?.agentCallsUser?.trim() || '';
    const userCallsAgent = isOwner
      ? agent.iCallAgent ?? ''
      : shareMember?.userCallsAgent?.trim() || agent.name?.trim() || '';

    return {
      id: this.stringifyObjectId(agent.id),
      name: agent.name,
      realName: agent.realName?.trim() || '',
      avatar: this.postImageService.resolveForResponse(
        agent.avatar?.trim() || ''
      ),
      sex: agent.sex,
      agentCallMe: agentCallsUser,
      iCallAgent: userCallsAgent,
      birthday: agent.birthday?.toISOString?.() ?? '',
      deathDate: agent.deathDate?.toISOString?.() ?? '',
      description: agent.description,
      lifeExperience: agent.lifeExperience ?? '',
      personalityTraits: agent.personalityTraits ?? '',
      languageHabits: agent.languageHabits ?? '',
      hobbies: agent.hobbies ?? '',
      sharedMemories: agent.sharedMemories ?? '',
      hasUnreadAgentHomeGuide: Boolean(
        isOwner &&
          agent.profileCompletionGuideCreatedAt &&
          !agent.agentHomeGuideSeenAt
      ),
      hasUnreadAgentProfileGuide: Boolean(
        isOwner &&
          agent.profileCompletionGuideCreatedAt &&
          !agent.agentProfileGuideSeenAt
      ),
      status: agent.status,
      isDefault: isOwner && Boolean(agent.isDefault),
      voiceTimbreId: this.stringifyOptionalObjectId(agent.voiceTimbreId),
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
      accessRole: isOwner ? 'owner' : 'shared',
    };
  }

  private async buildAgentProfiles(
    agents: AgentEntity[],
    viewerUserId?: MongoObjectId
  ): Promise<AgentProfile[]> {
    return Promise.all(
      agents.map(agent =>
        this.buildAgentProfile(agent, {
          viewerUserId,
        })
      )
    );
  }

  private async ensureShareMember(
    agent: AgentEntity,
    invite: AgentShareInviteEntity,
    userId: MongoObjectId,
    now: Date
  ): Promise<AgentShareMemberEntity> {
    const existingMember = await this.findShareMemberByAgentAndUser(
      agent.id,
      userId
    );
    const member = existingMember ?? new AgentShareMemberEntity();

    member.agentId = agent.id;
    member.ownerUserId = agent.createdUserId;
    member.userId = userId;
    member.status = AgentShareMemberStatus.active;
    member.acceptedInviteId = invite.id;
    member.acceptedAt =
      existingMember?.status === AgentShareMemberStatus.active &&
      existingMember.acceptedAt
        ? existingMember.acceptedAt
        : now;
    member.revokedAt = undefined;
    member.createdAt = existingMember?.createdAt ?? now;
    member.updatedAt = now;

    return this.agentShareMemberModel.save(member);
  }

  private async ensureConversationForAgent(
    agent: AgentEntity,
    userId: MongoObjectId,
    options: {
      now: Date;
      usePersonalCallName?: boolean;
    }
  ): Promise<ConversationEntity> {
    const existingConversation = await this.findConversationByAgentAndUser(
      agent.id,
      userId
    );

    if (existingConversation) {
      if (options.usePersonalCallName === false) {
        existingConversation.accessRole = 'shared';
        existingConversation.agentCallsUser = '';
        existingConversation.userCallsAgent =
          existingConversation.userCallsAgent?.trim() || agent.name?.trim() || '';
        existingConversation.updatedAt = options.now;
        await this.conversationModel.save(existingConversation);
      }

      return existingConversation;
    }

    return this.createConversation(agent, userId, options.now, {
      usePersonalCallName: options.usePersonalCallName,
    });
  }

  private async findConversationByAgentAndUser(
    agentId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<ConversationEntity | null> {
    return this.conversationModel.findOne({
      where: {
        agentId,
        userId,
      },
    });
  }

  private async removeAgentShareRecords(
    agentId: MongoObjectId
  ): Promise<void> {
    const [invites, members] = await Promise.all([
      this.agentShareInviteModel.find({
        where: {
          agentId,
        },
      }),
      this.agentShareMemberModel.find({
        where: {
          agentId,
        },
      }),
    ]);

    await Promise.all([
      ...invites.map(invite => this.agentShareInviteModel.remove(invite)),
      ...members.map(member => this.agentShareMemberModel.remove(member)),
    ]);
  }

  private async findAgentAccessByIdForUser(
    agentId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<AgentAccess | null> {
    const ownedAgent = await this.findAgentByIdForUser(agentId, userId);

    if (ownedAgent) {
      return {
        agent: ownedAgent,
        role: 'owner',
      };
    }

    const member = await this.findActiveShareMemberByAgentAndUser(
      agentId,
      userId
    );

    if (!member) {
      return null;
    }

    const sharedAgent = await this.findAgentById(agentId);

    if (
      !sharedAgent ||
      !this.sameObjectId(sharedAgent.createdUserId, member.ownerUserId)
    ) {
      return null;
    }

    return {
      agent: sharedAgent,
      role: 'shared',
    };
  }

  private async findShareMemberByAgentAndUser(
    agentId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<AgentShareMemberEntity | null> {
    return this.agentShareMemberModel.findOne({
      where: {
        agentId,
        userId,
      },
    });
  }

  private async requireActiveShareInvite(
    token: string,
    now: Date = new Date()
  ): Promise<AgentShareInviteEntity> {
    const invite = await this.agentShareInviteModel.findOne({
      where: {
        tokenHash: this.hashShareInviteToken(token),
      },
    });

    if (!invite || invite.status !== AgentShareInviteStatus.active) {
      throw new AppError(
        'AGENT_SHARE_INVITE_NOT_FOUND',
        'share invite not found',
        404
      );
    }

    const expiresAt = new Date(invite.expiresAt);

    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= now.getTime()
    ) {
      throw new AppError(
        'AGENT_SHARE_INVITE_EXPIRED',
        'share invite has expired',
        410
      );
    }

    return invite;
  }

  private async findActiveShareMemberByAgentAndUser(
    agentId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<AgentShareMemberEntity | null> {
    return this.agentShareMemberModel.findOne({
      where: {
        agentId,
        userId,
        status: AgentShareMemberStatus.active,
      },
    });
  }

  private async shouldSetCreatedAgentAsDefault(
    createdUserId: MongoObjectId
  ): Promise<boolean> {
    const existingDefault = await this.agentModel.findOne({
      where: {
        createdUserId,
        isDefault: true,
      },
    });

    if (existingDefault) {
      return false;
    }

    const existingAgent = await this.agentModel.findOne({
      where: {
        createdUserId,
      },
    });

    return !existingAgent;
  }

  private buildDescription(options: {
    name: string;
    sex: AgentSex;
    iCallAgent: string;
    agentCallMe: string;
  }): string {
    const sexText =
      options.sex === AgentSex.man
        ? '男性'
        : options.sex === AgentSex.woman
        ? '女性'
        : '性别未确定';
    return `${options.name}，${sexText}，你称呼他为${options.iCallAgent}，他会称呼你为${options.agentCallMe}。`;
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

  private normalizeOptionalRealName(rawName?: string): string {
    const name = rawName?.trim() || '';

    if (name.length > 30) {
      throw new AppError(
        'INVALID_AGENT_REAL_NAME',
        'agent real name must be 30 characters or fewer'
      );
    }

    return name;
  }

  private normalizeSex(rawSex?: number): AgentSex {
    if (
      rawSex === AgentSex.woman ||
      rawSex === AgentSex.man ||
      rawSex === AgentSex.unknown
    ) {
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

  private normalizeProfileMemory(rawValue: string, code: string): string {
    const value = rawValue?.trim() ?? '';

    if (value.length > 1000) {
      throw new AppError(
        code,
        'profile memory must be 1000 characters or fewer',
        400
      );
    }

    return value;
  }

  private normalizeShareInviteToken(rawValue?: string): string {
    const value = rawValue?.trim() ?? '';

    if (
      value.length < 20 ||
      value.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    ) {
      throw new AppError(
        'INVALID_AGENT_SHARE_INVITE_TOKEN',
        'share invite token is invalid',
        400
      );
    }

    return value;
  }

  private normalizeOptionalShareCallName(rawValue?: string): string {
    const value = rawValue?.trim() || '';

    if (value.length > 20) {
      throw new AppError(
        'INVALID_AGENT_CALL_NAME',
        'value must be 20 characters or fewer',
        400
      );
    }

    return value;
  }

  private generateShareInviteToken(): string {
    return randomBytes(AGENT_SHARE_INVITE_TOKEN_BYTES)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private hashShareInviteToken(token: string): string {
    return createHash('sha256')
      .update(`agent-share:${token}`)
      .digest('hex');
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

  private sameObjectId(
    left?: MongoObjectId,
    right?: MongoObjectId
  ): boolean {
    return Boolean(
      left &&
        right &&
        this.stringifyObjectId(left) === this.stringifyObjectId(right)
    );
  }

  private async findAgentById(
    agentId: MongoObjectId
  ): Promise<AgentEntity | null> {
    const agentById = await this.agentModel.findOne({
      where: {
        id: agentId,
      },
    });

    if (agentById) {
      return agentById;
    }

    return this.agentModel.findOne({
      where: {
        _id: agentId,
      },
    });
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
