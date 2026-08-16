import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  AgentSubEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
} from '@tzl/entities';
import type { AgentProfileInterviewDraftDTO } from '@tzl/shared';
import { AgentMemoryProfileService } from './agent-memory-profile.service';

export const AGENT_SUB_KIND_MESSENGER = 'messenger';
export const AGENT_SUB_STATUS_ACTIVE = 1;

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

@Provide()
export class MessengerService {
  @InjectEntityModel(AgentSubEntity)
  agentSubModel: MongoRepository<AgentSubEntity>;

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

  async ensureMessengerForAgent(agent: AgentEntity): Promise<AgentSubEntity> {
    const now = new Date();
    const existing = await this.agentSubModel.findOne({
      where: {
        agentId: agent.id,
        kind: AGENT_SUB_KIND_MESSENGER,
      },
    });

    if (existing) {
      return existing;
    }

    const messenger = new AgentSubEntity();
    messenger.agentId = agent.id;
    messenger.kind = AGENT_SUB_KIND_MESSENGER;
    messenger.name = this.buildMessengerName(agent.name);
    messenger.avatar = '';
    messenger.status = AGENT_SUB_STATUS_ACTIVE;
    messenger.agentCallMe = '';
    messenger.iCallAgent = messenger.name;
    messenger.createdAt = now;
    messenger.updatedAt = now;

    return this.agentSubModel.save(messenger);
  }

  async ensureMessengerConversation(
    agent: AgentEntity,
    messenger: AgentSubEntity
  ): Promise<ConversationEntity> {
    const now = new Date();
    const existing = await this.conversationModel.findOne({
      where: {
        agentId: agent.id,
        subAgentId: messenger.id,
        userId: agent.createdUserId,
      },
    });

    if (existing) {
      return existing;
    }

    const conversation = new ConversationEntity();
    conversation.agentId = agent.id;
    conversation.subAgentId = messenger.id;
    conversation.userId = agent.createdUserId;
    conversation.accessRole = 'owner';
    conversation.agentCallsUser = '';
    conversation.userCallsAgent = messenger.name?.trim() || '';
    conversation.createdAt = now;
    conversation.updatedAt = now;

    const saved = await this.conversationModel.save(conversation);
    await this.createInitialMessengerGreeting(saved, agent, messenger, now);
    return saved;
  }

  async resolveMessengerForConversation(
    conversation: ConversationEntity
  ): Promise<AgentSubEntity | null> {
    if (!conversation.subAgentId) {
      return null;
    }

    const messenger = await this.agentSubModel.findOne({
      where: {
        id: conversation.subAgentId,
        kind: AGENT_SUB_KIND_MESSENGER,
      },
    });

    if (messenger) {
      return messenger;
    }

    return this.agentSubModel.findOne({
      where: {
        _id: conversation.subAgentId,
        kind: AGENT_SUB_KIND_MESSENGER,
      } as never,
    });
  }

  buildMessengerIdentity(
    agent: AgentEntity,
    messenger: AgentSubEntity
  ): AgentEntity {
    return {
      ...agent,
      id: messenger.id,
      name: messenger.name?.trim() || this.buildMessengerName(agent.name),
      avatar: messenger.avatar?.trim() || '',
      agentCallMe: '',
      iCallAgent: messenger.name?.trim() || this.buildMessengerName(agent.name),
      isDefault: false,
      status: messenger.status ?? AGENT_SUB_STATUS_ACTIVE,
      profileCompletionGuideCreatedAt: undefined,
      agentHomeGuideSeenAt: undefined,
      agentProfileGuideSeenAt: undefined,
    } as AgentEntity;
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
    agent: AgentEntity,
    messenger: AgentSubEntity,
    now: Date
  ): Promise<void> {
    const name = messenger.name?.trim() || this.buildMessengerName(agent.name);
    const message = new MessageEntity();
    message.conversationId = conversation.id;
    message.userId = conversation.userId;
    message.agentId = agent.id;
    message.role = MessageRole.assistant;
    message.type = MessageType.text;
    message.content = `你好，我是${name}。关于他/她的故事，你都可以慢慢告诉我，我会帮你整理进资料里。`;
    message.status = MessageStatus.sent;
    message.createdAt = now;
    message.updatedAt = now;

    await this.messageModel.save(message);
  }
}
