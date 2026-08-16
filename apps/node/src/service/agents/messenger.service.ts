import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import type { AgentProfileInterviewDraftDTO } from '@tzl/shared';
import { AgentMemoryProfileService } from './agent-memory-profile.service';

export const MESSENGER_DEFAULT_AVATAR_KEY = 'weapp/messenger-avatar.png';

const PROFILE_MEMORY_FIELDS = [
  'lifeExperience',
  'personalityTraits',
  'languageHabits',
  'hobbies',
  'sharedMemories',
] as const;

interface RunMessengerInterviewTurnOptions {
  agent: AgentEntity;
  conversation: ConversationEntity;
  input: string;
}

export interface ProvisionMessengersForUserResult {
  processed: number;
  messengersCreated: number;
  conversationsCreated: number;
}

@Provide()
export class MessengerService {
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  agentMemoryProfileService: AgentMemoryProfileService;

  buildMessengerName(agentName?: string): string {
    const name = agentName?.trim() || 'TA';
    return `${name}的小使者`;
  }

  async ensureMessengerForAgent(parentAgent: AgentEntity): Promise<AgentEntity> {
    const now = new Date();
    const messengerName = this.buildMessengerName(parentAgent.name);
    const existing = await this.agentModel.findOne({
      where: {
        createdUserId: parentAgent.createdUserId,
        messengerOfAgentId: parentAgent.id,
      },
    });

    if (existing) {
      let changed = false;

      if ((existing.name?.trim() || '') !== messengerName) {
        existing.name = messengerName;
        changed = true;
      }

      if ((existing.avatar?.trim() || '') !== MESSENGER_DEFAULT_AVATAR_KEY) {
        existing.avatar = MESSENGER_DEFAULT_AVATAR_KEY;
        changed = true;
      }

      if (existing.iCallAgent?.trim() !== messengerName) {
        existing.iCallAgent = messengerName;
        changed = true;
      }

      if (changed) {
        existing.updatedAt = now;
        return this.agentModel.save(existing);
      }

      return existing;
    }

    const messenger = new AgentEntity();
    messenger.createdUserId = parentAgent.createdUserId;
    messenger.name = messengerName;
    messenger.realName = '';
    messenger.avatar = MESSENGER_DEFAULT_AVATAR_KEY;
    messenger.sex = parentAgent.sex ?? AgentSex.unknown;
    messenger.iCallAgent = messengerName;
    messenger.agentCallMe = '';
    messenger.description = '';
    messenger.status = 1;
    messenger.isDefault = false;
    messenger.messengerOfAgentId = parentAgent.id;
    messenger.createdAt = now;
    messenger.updatedAt = now;

    return this.agentModel.save(messenger);
  }

  async ensureMessengersForUser(
    userId: MongoObjectId
  ): Promise<ProvisionMessengersForUserResult> {
    const parentAgents = await this.agentModel.find({
      where: {
        createdUserId: userId,
        messengerOfAgentId: { $exists: false },
      },
    });

    let messengersCreated = 0;
    let conversationsCreated = 0;

    for (const parentAgent of parentAgents) {
      const hadMessenger = Boolean(
        await this.agentModel.findOne({
          where: {
            createdUserId: parentAgent.createdUserId,
            messengerOfAgentId: parentAgent.id,
          },
        })
      );
      const messenger = await this.ensureMessengerForAgent(parentAgent);

      if (!hadMessenger) {
        messengersCreated += 1;
      }

      const hadConversation = Boolean(
        await this.conversationModel.findOne({
          where: {
            agentId: messenger.id,
            userId: parentAgent.createdUserId,
          },
        })
      );
      await this.ensureMessengerConversation(parentAgent, messenger);

      if (!hadConversation) {
        conversationsCreated += 1;
      }
    }

    return {
      processed: parentAgents.length,
      messengersCreated,
      conversationsCreated,
    };
  }

  async ensureMessengerConversation(
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity
  ): Promise<ConversationEntity> {
    const now = new Date();
    const existing = await this.conversationModel.findOne({
      where: {
        agentId: messengerAgent.id,
        userId: parentAgent.createdUserId,
      },
    });

    if (existing) {
      return existing;
    }

    const conversation = new ConversationEntity();
    conversation.agentId = messengerAgent.id;
    conversation.userId = parentAgent.createdUserId;
    conversation.accessRole = 'owner';
    conversation.agentCallsUser = '';
    conversation.userCallsAgent = messengerAgent.name?.trim() || '';
    conversation.createdAt = now;
    conversation.updatedAt = now;

    const saved = await this.conversationModel.save(conversation);
    await this.createInitialMessengerGreeting(
      saved,
      parentAgent,
      messengerAgent,
      now
    );
    return saved;
  }

  async runInterviewTurn(
    options: RunMessengerInterviewTurnOptions
  ): Promise<string> {
    const draft = this.buildDraft(options.agent);
    const userMessageCount = await this.messageModel.count({
      conversationId: options.conversation.id,
      role: MessageRole.user,
    });
    const result = await this.agentMemoryProfileService.buildInterviewTurn({
      agent: options.agent,
      input: options.input,
      draft,
      focusField: '',
      turnCount: userMessageCount,
    });

    this.applyDraft(options.agent, result.draft);
    await this.agentMemoryProfileService.alignManualProfileEdits({
      agent: options.agent,
      userId: options.agent.createdUserId,
      sources: result.draft,
    });

    return result.reply || this.buildFallbackReply(options.agent);
  }

  private buildDraft(agent: AgentEntity): AgentProfileInterviewDraftDTO {
    return PROFILE_MEMORY_FIELDS.reduce((result, field) => {
      result[field] = agent[field]?.trim() || '';
      return result;
    }, {} as AgentProfileInterviewDraftDTO);
  }

  private applyDraft(
    agent: AgentEntity,
    draft: AgentProfileInterviewDraftDTO
  ): void {
    for (const field of PROFILE_MEMORY_FIELDS) {
      agent[field] = draft[field];
    }
    agent.updatedAt = new Date();
  }

  private buildFallbackReply(agent: AgentEntity): string {
    const name = agent.name?.trim() || 'TA';
    return `我在听，你想到${name}的什么，都可以慢慢讲给我。`;
  }

  private async createInitialMessengerGreeting(
    conversation: ConversationEntity,
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity,
    now: Date
  ): Promise<void> {
    const parentName = parentAgent.name?.trim() || 'TA';
    const messengerName =
      messengerAgent.name?.trim() || this.buildMessengerName(parentAgent.name);
    const message = new MessageEntity();
    message.conversationId = conversation.id;
    message.userId = conversation.userId;
    message.agentId = messengerAgent.id;
    message.role = MessageRole.assistant;
    message.type = MessageType.text;
    message.content = `你好，我是${messengerName}。关于${parentName}，你都可以慢慢告诉我，我会帮你整理进资料里。`;
    message.status = MessageStatus.sent;
    message.createdAt = now;
    message.updatedAt = now;

    await this.messageModel.save(message);
  }
}
