import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
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
  MessengerCallEventEntity,
  MessengerCallStatus,
  MongoObjectId,
} from '@tzl/entities';
import type {
  AgentProfileInterviewDraftDTO,
  AgentProfileMemoryField,
} from '@tzl/shared';
import {
  AgentMemoryProfileService,
  MessengerInterviewTelemetry,
} from './agent-memory-profile.service';

export const MESSENGER_DEFAULT_AVATAR_KEY =
  'weapp/messenger-avatar-20260817.png';

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
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(MessengerCallEventEntity)
  messengerCallEventModel: MongoRepository<MessengerCallEventEntity>;

  @Inject()
  agentMemoryProfileService: AgentMemoryProfileService;

  buildMessengerName(agentName?: string): string {
    const name = agentName?.trim() || 'TA';
    return `${name}的小使者`;
  }

  async ensureMessengerForAgent(
    parentAgent: AgentEntity
  ): Promise<AgentEntity> {
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
      await this.ensureInitialMessengerGreeting(
        existing,
        parentAgent,
        messengerAgent,
        now
      );
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
    const startedAt = Date.now();
    let sourceMessage: MessageEntity | undefined;
    let telemetry: MessengerInterviewTelemetry = {
      modelCalled: false,
      modelSucceeded: false,
      fallbackUsed: false,
    };

    try {
      const draft = this.buildDraft(options.agent);
      const [userMessageCount, conversationMessages] = await Promise.all([
        this.messageModel.count({
          conversationId: options.conversation.id,
          role: MessageRole.user,
        }),
        this.messageModel.find({
          where: {
            conversationId: options.conversation.id,
          },
          order: { createdAt: 'DESC' },
          take: 100,
        }),
      ]);
      const previousReplies = conversationMessages
        .filter(message => message.role === MessageRole.assistant)
        .map(message => message.content?.trim() || '')
        .filter(Boolean);
      sourceMessage = conversationMessages.find(
        message => message.role === MessageRole.user
      );
      const askedFields = this.collectAskedInterviewFields(previousReplies);

      if (!this.isMeaningfulInterviewInput(options.input)) {
        await this.recordCallEvent(options, {
          status: MessengerCallStatus.skipped,
          skipReason: 'low_information',
          sourceMessageId: sourceMessage?.id,
          durationMs: Date.now() - startedAt,
          telemetry,
          changedProfileFields: [],
          profileSaved: false,
        });
        return this.buildLowPressureReply(options.agent, options.input);
      }

      const result = await this.agentMemoryProfileService.buildInterviewTurn({
        agent: options.agent,
        input: options.input,
        draft,
        focusField: askedFields[0] || '',
        askedFields,
        previousReplies,
        turnCount: userMessageCount,
        onTelemetry: value => {
          telemetry = value;
        },
      });
      const changedSources = this.buildChangedDraft(draft, result.draft);
      const changedProfileFields = Object.keys(
        changedSources
      ) as AgentProfileMemoryField[];
      let profileSaved = false;

      if (changedProfileFields.length) {
        this.applyDraft(options.agent, result.draft);
        await this.agentMemoryProfileService.alignManualProfileEdits({
          agent: options.agent,
          userId: options.agent.createdUserId,
          sources: changedSources,
          sourceMessageId: sourceMessage?.id,
          sourceText: options.input,
        });
        profileSaved = true;
      }

      await this.recordCallEvent(options, {
        status: MessengerCallStatus.completed,
        sourceMessageId: sourceMessage?.id,
        durationMs: Date.now() - startedAt,
        telemetry,
        changedProfileFields,
        profileSaved,
      });
      return result.reply || this.buildFallbackReply(options.agent);
    } catch (error) {
      await this.recordCallEvent(options, {
        status: MessengerCallStatus.failed,
        sourceMessageId: sourceMessage?.id,
        durationMs: Date.now() - startedAt,
        telemetry,
        changedProfileFields: [],
        profileSaved: false,
        error,
      });
      throw error;
    }
  }

  private async recordCallEvent(
    options: RunMessengerInterviewTurnOptions,
    event: {
      status: MessengerCallStatus;
      skipReason?: string;
      sourceMessageId?: MongoObjectId;
      durationMs: number;
      telemetry: MessengerInterviewTelemetry;
      changedProfileFields: AgentProfileMemoryField[];
      profileSaved: boolean;
      error?: unknown;
    }
  ): Promise<void> {
    if (!this.messengerCallEventModel?.save) {
      return;
    }

    const errorCode = event.error
      ? this.resolveCallErrorCode(event.error)
      : event.telemetry.errorCode;
    const errorMessage = event.error
      ? this.describeCallError(event.error)
      : event.telemetry.errorMessage;

    try {
      await this.messengerCallEventModel.save({
        userId: options.conversation.userId || options.agent.createdUserId,
        conversationId: options.conversation.id,
        messengerAgentId: options.conversation.agentId,
        parentAgentId: options.agent.id,
        sourceMessageId: event.sourceMessageId,
        status: event.status,
        skipReason: event.skipReason,
        modelCalled: event.telemetry.modelCalled,
        modelSucceeded: event.telemetry.modelSucceeded,
        fallbackUsed: event.telemetry.fallbackUsed,
        model: event.telemetry.model,
        promptTokens: event.telemetry.promptTokens,
        completionTokens: event.telemetry.completionTokens,
        totalTokens: event.telemetry.totalTokens,
        durationMs: Math.max(0, Math.floor(event.durationMs)),
        profileSaved: event.profileSaved,
        changedProfileFields: event.changedProfileFields,
        releaseVersion: process.env.RELEASE_VERSION || process.env.GIT_SHA,
        errorCode,
        errorMessage,
        createdAt: new Date(),
      } as MessengerCallEventEntity);
    } catch (error) {
      this.logger?.warn?.(
        '[messenger] call telemetry save failed, conversationId=%s, reason=%s',
        String(options.conversation.id || ''),
        this.describeCallError(error)
      );
    }
  }

  private resolveCallErrorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code?: unknown }).code || '').trim();
      if (code) {
        return code.slice(0, 80);
      }
    }
    return error instanceof Error && error.name
      ? error.name.slice(0, 80)
      : 'MESSENGER_CALL_FAILED';
  }

  private describeCallError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/\s+/g, ' ').trim().slice(0, 240);
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

  private buildChangedDraft(
    previous: AgentProfileInterviewDraftDTO,
    current: AgentProfileInterviewDraftDTO
  ): Partial<AgentProfileInterviewDraftDTO> {
    return PROFILE_MEMORY_FIELDS.reduce((result, field) => {
      if ((previous[field]?.trim() || '') !== (current[field]?.trim() || '')) {
        result[field] = current[field];
      }
      return result;
    }, {} as Partial<AgentProfileInterviewDraftDTO>);
  }

  private isMeaningfulInterviewInput(input: string): boolean {
    const compact = (input || '')
      .replace(/[\s，。！？、,.!?~～…·]/g, '')
      .trim();

    if (!compact) {
      return false;
    }

    return !/^(?:我)?(?:不知道(?:说什么)?|不清楚|没想好|想不到|没什么(?:可说)?)(?:了|呢|啊)?$/.test(
      compact
    );
  }

  private buildLowPressureReply(agent: AgentEntity, input: string): string {
    const name = agent.name?.trim() || 'TA';
    const compact = (input || '').replace(/[\s，。！？、,.!?~～…·]/g, '');

    return compact
      ? `没关系，不用勉强想。等一个关于${name}的画面浮上来，再慢慢告诉我。`
      : `我在。你不用急着回答，想到${name}的一个小片段时再告诉我。`;
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
    const greetings = this.buildMessengerGreetings(parentName, messengerName);
    const messages = greetings.map((content, index) => {
      const message = new MessageEntity();
      message.conversationId = conversation.id;
      message.userId = conversation.userId;
      message.agentId = messengerAgent.id;
      message.role = MessageRole.assistant;
      message.type = MessageType.text;
      message.content = content;
      message.status = MessageStatus.sent;
      message.createdAt = new Date(now.getTime() + index);
      message.updatedAt = message.createdAt;
      return message;
    });

    await this.messageModel.save(messages);
  }

  private async ensureInitialMessengerGreeting(
    conversation: ConversationEntity,
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity,
    now: Date
  ): Promise<void> {
    const existingMessage = await this.messageModel.findOne({
      where: {
        conversationId: conversation.id,
      },
    });

    if (existingMessage) {
      return;
    }

    await this.createInitialMessengerGreeting(
      conversation,
      parentAgent,
      messengerAgent,
      now
    );
  }

  private buildMessengerGreetings(
    parentName: string,
    messengerName: string
  ): string[] {
    return [
      `你好，我是${messengerName}。关于${parentName}的事，都可以慢慢跟我讲。`,
      `你最想先让我了解${parentName}的哪一面？`,
    ];
  }

  private collectAskedInterviewFields(
    replies: string[]
  ): AgentProfileMemoryField[] {
    const fields: AgentProfileMemoryField[] = [];

    for (const reply of replies) {
      const field = this.inferAskedInterviewField(reply);
      if (field && !fields.includes(field)) {
        fields.push(field);
      }
    }

    return fields;
  }

  private inferAskedInterviewField(
    reply: string
  ): AgentProfileMemoryField | '' {
    if (/怎么说话|常说的一句话|口头禅|什么样的语气/.test(reply)) {
      return 'languageHabits';
    }
    if (/怎样的性格|看出.*性格|什么性格/.test(reply)) {
      return 'personalityTraits';
    }
    if (/重要的经历|哪段经历|人生.*经历/.test(reply)) {
      return 'lifeExperience';
    }
    if (/喜欢做什么|小爱好|喜欢的事|让 TA 开心/.test(reply)) {
      return 'hobbies';
    }
    if (/共同记忆|最想留住|哪段回忆|回忆里.*小细节/.test(reply)) {
      return 'sharedMemories';
    }
    return '';
  }
}
