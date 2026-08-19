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
  'weapp/messenger-avatar-20260818-5c48467a.png';

const PROFILE_MEMORY_FIELDS = [
  'lifeExperience',
  'personalityTraits',
  'languageHabits',
  'hobbies',
  'sharedMemories',
] as const;

const MESSENGER_MEMORY_TASK_DEFINITIONS: ReadonlyArray<{
  key: AgentProfileMemoryField;
  title: string;
  description: string;
}> = [
  {
    key: 'personalityTraits',
    title: 'TA 的样子',
    description: '性格、脾气和待人方式',
  },
  {
    key: 'lifeExperience',
    title: '人生经历',
    description: '重要的人、地方和经历',
  },
  {
    key: 'hobbies',
    title: '喜欢的事',
    description: '爱好、手艺和日常习惯',
  },
  {
    key: 'languageHabits',
    title: '熟悉的话语',
    description: '口头禅、语气和方言',
  },
  {
    key: 'sharedMemories',
    title: '你们的回忆',
    description: '一起经历过的人和事',
  },
];

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

export interface MessengerMemoryTaskItem {
  key: AgentProfileMemoryField;
  title: string;
  description: string;
  status: 'pending' | 'completed';
}

export interface MessengerMemoryTaskPlan {
  parentAgentId: string;
  parentName: string;
  completedCount: number;
  totalCount: number;
  isComplete: boolean;
  currentTaskKey?: AgentProfileMemoryField;
  currentTaskTitle?: string;
  tasks: MessengerMemoryTaskItem[];
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

  buildMemoryTaskPlan(
    parentAgent: AgentEntity,
    latestAssistantReply = ''
  ): MessengerMemoryTaskPlan {
    const tasks = MESSENGER_MEMORY_TASK_DEFINITIONS.map(definition => ({
      ...definition,
      status: parentAgent[definition.key]?.trim()
        ? ('completed' as const)
        : ('pending' as const),
    }));
    const activeField = this.inferAskedInterviewField(latestAssistantReply);
    const currentTask =
      tasks.find(
        task => task.key === activeField && task.status === 'pending'
      ) || tasks.find(task => task.status === 'pending');
    const completedCount = tasks.filter(
      task => task.status === 'completed'
    ).length;

    return {
      parentAgentId: String(parentAgent.id || ''),
      parentName: parentAgent.name?.trim() || 'TA',
      completedCount,
      totalCount: tasks.length,
      isComplete: completedCount === tasks.length,
      currentTaskKey: currentTask?.key,
      currentTaskTitle: currentTask?.title,
      tasks,
    };
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
      const userMessages = conversationMessages.filter(
        message => message.role === MessageRole.user
      );
      sourceMessage = userMessages[0];
      const previousUserInputs = userMessages
        .slice(1)
        .map(message => message.content?.trim() || '')
        .filter(Boolean);
      const askedFields = this.collectAskedInterviewFields(previousReplies);
      const memoryTaskPlan = this.buildMemoryTaskPlan(
        options.agent,
        previousReplies[0] || ''
      );
      const directReply = this.buildDirectCapabilityReply(
        options.agent,
        options.input
      );
      const shortContextReply = this.buildShortContextReply(
        options.agent,
        options.input,
        previousReplies
      );

      if (directReply || shortContextReply) {
        await this.recordCallEvent(options, {
          status: MessengerCallStatus.skipped,
          skipReason: directReply
            ? 'direct_capability_reply'
            : 'short_context_reply',
          sourceMessageId: sourceMessage?.id,
          durationMs: Date.now() - startedAt,
          telemetry,
          changedProfileFields: [],
          profileSaved: false,
        });
        return directReply || shortContextReply || '';
      }

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
        previousUserInputs,
        taskField: memoryTaskPlan.currentTaskKey || '',
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

  private buildDirectCapabilityReply(
    agent: AgentEntity,
    input: string
  ): string | undefined {
    const query = input.trim();
    const parentName = agent.name?.trim() || 'TA';

    if (
      /(?:小使者|你).{0,8}(?:是干嘛的|干什么的|做什么|能做什么|有什么用|作用是什么)/.test(
        query
      )
    ) {
      return `我是来帮你把${parentName}的经历、性格和你们的回忆补完整的。平时聊天还是去找${parentName}。`;
    }

    if (
      /(?:说多少|要说多少|说多久|聊多久|什么时候同步|多久同步|为什么没反应|怎么没反应|补齐.{0,4}记忆.{0,6}(?:会怎样|有用吗|生效吗)|记忆.{0,4}(?:怎么|何时|什么时候)(?:同步|生效))/.test(
        query
      )
    ) {
      return `没有固定要说多少。保存成功的内容会用于你之后和${parentName}的聊天，不会改掉已经发出的回复。`;
    }

    if (
      /(?:我是不是|我会不会|这是|算不算).{0,8}(?:抑郁|焦虑)|(?:抑郁|焦虑).{0,8}(?:怎么办|怎么判断)|你.{0,5}(?:专业吗|是医生吗|能诊断吗)/.test(
        query
      )
    ) {
      return '我不是医生，不能替你诊断。如果低落或焦虑持续影响睡眠、吃饭或生活，尽快找心理咨询师或精神科做专业评估。';
    }

    if (
      /(?:他|她|爸爸|妈妈|爸|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,8}(?:在(?:哪|那)边|去那边|离开后).{0,8}(?:好吗|好不好|怎么样|过得好吗|过的好不好|受苦吗)/.test(
        query
      )
    ) {
      return `听得出来你很想${parentName}。我不能确认那边的真实情况，但可以陪你把关于${parentName}的记忆慢慢补完整。`;
    }

    if (
      /(?:照片|头像|影像).{0,12}(?:复活|通话|视频|说话)|(?:复活|通话|视频).{0,12}(?:照片|头像|影像)/.test(
        query
      )
    ) {
      return `我懂你想再见${parentName}。目前小使者不能用照片复活或视频通话，但可以帮${parentName}补全记忆。`;
    }

    return undefined;
  }

  private buildShortContextReply(
    agent: AgentEntity,
    input: string,
    previousReplies: string[]
  ): string | undefined {
    const answer = input.trim().replace(/[。！!~～]+$/g, '');
    const latestReply = previousReplies[0]?.trim() || '';
    if (!latestReply || !/[？?]/.test(latestReply)) {
      return undefined;
    }

    const name = agent.name?.trim() || 'TA';
    if (/^(?:有|有的|有啊|有呀)$/.test(answer)) {
      const field = this.collectAskedInterviewFields([latestReply])[0];
      const followUps: Partial<Record<AgentProfileMemoryField, string>> = {
        personalityTraits: `具体是哪一种性格，让你最先想到${name}？`,
        lifeExperience: '是哪一段经历呢？你可以从最清楚的地方说。',
        hobbies: `${name}最喜欢的具体是什么呢？`,
        languageHabits: `有的话，${name}最常说的是哪一句？`,
        sharedMemories: '是哪一段回忆呢？你可以慢慢说。',
      };
      return field ? followUps[field] : '有的话，你可以把具体内容慢慢告诉我。';
    }

    if (/^(?:对|是|是的|对的|嗯|确认|没错)$/.test(answer)) {
      return `明白，我接着听。关于${name}，你想从哪里继续都可以。`;
    }

    return undefined;
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
    if (
      /先想起谁|最先想到的是哪一次|最先想到哪个画面|在一起的哪段往事|哪一次最开心/.test(
        reply
      )
    ) {
      return 'sharedMemories';
    }
    return '';
  }
}
