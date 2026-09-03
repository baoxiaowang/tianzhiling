import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageSource,
  MessageStatus,
  MessageType,
  MessengerCallEventEntity,
  MessengerCallStatus,
  MongoObjectId,
  VipPlanGroup,
} from '@tzl/entities';
import { buildOssMediaUrl } from '@tzl/shared';
import { OpenAIService } from './openai';
import { brandConfig } from '../../config/brand';
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
export const MESSENGER_REVEAL_USER_TURN_THRESHOLD = 10;
export const MESSENGER_REVEAL_WAIT_MS = 24 * 60 * 60 * 1000;
const MESSENGER_REVEAL_LOCK_TTL_MS = 15 * 1000;

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
    title: '亲人的样子',
    description: '性格、脾气、语气和关心方式',
  },
  {
    key: 'lifeExperience',
    title: '人生经历',
    description: '人生节点、工作、家人和重要经历',
  },
  {
    key: 'hobbies',
    title: '喜欢的事',
    description: '爱好、手艺、饮食、宠物和日常习惯',
  },
  {
    key: 'languageHabits',
    title: '熟悉的话语',
    description: '双方称呼、口头禅、语气和方言',
  },
  {
    key: 'sharedMemories',
    title: '你们的回忆',
    description: '相处、情感、共同大事和特殊日子',
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

export interface RevealEligibleMessengersResult {
  processed: number;
  alreadyVisible: number;
  revealed: number;
  revealedByTurns: number;
  revealedByAge: number;
}

interface EnsureVisibleMessengerConversationResult {
  visible: boolean;
  created: boolean;
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

export type MessengerEventNoticeType =
  | 'membership_purchase'
  | 'voice_purchase'
  | 'voice_package_purchase'
  | 'membership_downgrade';

export interface SendEventNoticeOptions {
  /** 事件类型 */
  eventType: MessengerEventNoticeType;
  /** 触发事件的用户 */
  userId: MongoObjectId;
  /** 关联订单（用于幂等与追溯） */
  orderId: string;
  /** 套餐名称（购买场景） */
  planName?: string;
  /** 套餐分组（购买场景，basic / voice） */
  planGroup?: VipPlanGroup;
  /** 退款金额，单位分（降级场景） */
  refundAmount?: number;
}

export interface SendEventNoticeResult {
  processed: number;
  sentConversations: number;
  skippedDuplicate: boolean;
}

interface EventNoticeContext {
  eventType: MessengerEventNoticeType;
  /** 用户对亲人的日常称呼，如"爸爸" */
  relation: string;
  parentName: string;
  messengerName: string;
  isFirstContact: boolean;
  planName: string;
  refundAmountYuan?: number;
  wechatId: string;
  wechatQrUrl: string;
  needQr: boolean;
}

const EVENT_NOTICE_MAX_MESSAGES = 4;
const EVENT_NOTICE_MAX_MESSAGE_LENGTH = 140;
const EVENT_NOTICE_DEDUPE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  redisService: RedisService;

  /**
   * 业务事件触发的小使者提示（购买会员 / 购买声音版 / 降级退款）。
   * 由大模型按场景生成真人语气消息，关键事实通过占位符由程序注入，
   * 命中护栏或模型失败时回退固定模板。
   */
  async sendEventNotice(
    options: SendEventNoticeOptions
  ): Promise<SendEventNoticeResult> {
    const startedAt = Date.now();
    const dedupeKey = this.getEventNoticeDedupeKey(options);
    const acquired = await this.acquireEventNoticeDedupe(dedupeKey);

    if (!acquired) {
      this.logger?.info?.(
        '[messenger] event notice skipped (duplicate), eventType=%s orderId=%s',
        options.eventType,
        options.orderId
      );
      return {
        processed: 0,
        sentConversations: 0,
        skippedDuplicate: true,
      };
    }

    try {
      const parentAgents = await this.agentModel.find({
        where: {
          createdUserId: options.userId,
          messengerOfAgentId: { $exists: false },
        },
      });

      let sentConversations = 0;
      for (const parentAgent of parentAgents) {
        const sent = await this.sendEventNoticeForParent(options, parentAgent);
        if (sent) {
          sentConversations += 1;
        }
      }

      this.logger?.info?.(
        '[messenger] event notice sent, eventType=%s orderId=%s processed=%d sent=%d durationMs=%d',
        options.eventType,
        options.orderId,
        parentAgents.length,
        sentConversations,
        Date.now() - startedAt
      );

      return {
        processed: parentAgents.length,
        sentConversations,
        skippedDuplicate: false,
      };
    } catch (error) {
      await this.releaseEventNoticeDedupe(dedupeKey);
      this.logger?.warn?.(
        '[messenger] event notice failed, eventType=%s orderId=%s reason=%s',
        options.eventType,
        options.orderId,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async sendEventNoticeForParent(
    options: SendEventNoticeOptions,
    parentAgent: AgentEntity
  ): Promise<boolean> {
    const messenger = await this.ensureMessengerForAgent(parentAgent);
    let conversation = await this.conversationModel.findOne({
      where: {
        agentId: messenger.id,
        userId: parentAgent.createdUserId,
      },
    });

    if (!conversation) {
      await this.ensureMessengerConversation(parentAgent, messenger);
      conversation = await this.conversationModel.findOne({
        where: {
          agentId: messenger.id,
          userId: parentAgent.createdUserId,
        },
      });
    }

    if (!conversation) {
      return false;
    }

    const tracePrefix = `event_notice:${options.eventType}:${options.orderId}`;
    const existingNotice = await this.messageModel.findOne({
      where: {
        conversationId: conversation.id,
        traceId: { $regex: `^${this.escapeRegex(tracePrefix)}` },
      },
    });
    if (existingNotice) {
      return false;
    }

    const messageCount = await this.messageModel.count({
      conversationId: conversation.id,
    });
    const context = this.buildEventNoticeContext(
      options,
      parentAgent,
      messenger,
      messageCount === 0
    );

    let notices: string[] | null = null;
    try {
      notices = await this.generateEventNotices(context);
    } catch (error) {
      this.logger?.warn?.(
        '[messenger] event notice generation failed, fallback to template, eventType=%s reason=%s',
        options.eventType,
        error instanceof Error ? error.message : String(error)
      );
    }

    if (!notices || notices.length === 0) {
      notices = this.buildFallbackEventNotices(context);
    }

    await this.writeEventNotices(
      conversation,
      messenger,
      options,
      context,
      notices
    );
    return true;
  }

  private buildEventNoticeContext(
    options: SendEventNoticeOptions,
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity,
    isFirstContact: boolean
  ): EventNoticeContext {
    const parentName = this.normalizeParentDisplayName(parentAgent.name);
    const brand = brandConfig();
    const relation =
      this.resolveUserCallsAgent(parentAgent) || parentName || '亲人';

    return {
      eventType: options.eventType,
      relation,
      parentName,
      messengerName:
        messengerAgent.name?.trim() ||
        this.buildMessengerName(parentAgent.name),
      isFirstContact,
      planName: options.planName || '',
      refundAmountYuan:
        options.refundAmount != null
          ? Number((options.refundAmount / 100).toFixed(2))
          : undefined,
      wechatId: brand.customerService.wechatId,
      wechatQrUrl: buildOssMediaUrl(brand.customerService.wechatQr),
      needQr:
        options.eventType === 'voice_purchase' ||
        options.eventType === 'voice_package_purchase',
    };
  }

  /** 用户对亲人的日常称呼（relationToThem），如"爸爸" */
  private resolveUserCallsAgent(agent: AgentEntity): string {
    const explicit = agent?.iCallAgent?.trim();
    if (explicit) {
      return explicit;
    }
    const profile =
      agent?.personaProfile?.demographics?.relationshipType?.trim?.();
    if (profile) {
      return profile;
    }
    return '';
  }

  private async generateEventNotices(
    context: EventNoticeContext
  ): Promise<string[] | null> {
    const systemPrompt = this.buildEventNoticeSystemPrompt(context);
    const result = await this.openAIService.generateText({
      systemPrompt,
      prompt:
        '请按上面的要求输出一组短消息（JSON 字符串数组）。只输出 JSON 数组本身。',
      temperature: 0.7,
      maxTokens: 600,
    });
    const parsed = this.parseNoticeArray(result.content);
    if (!parsed) {
      return null;
    }
    return this.sanitizeEventNotices(parsed, context);
  }

  private buildEventNoticeSystemPrompt(context: EventNoticeContext): string {
    const eventText =
      context.eventType === 'membership_purchase'
        ? '刚刚购买了基础版会员'
        : context.eventType === 'voice_purchase'
        ? '刚刚购买了包含声音模型的会员'
        : context.eventType === 'voice_package_purchase'
        ? `刚刚购买了声音模型服务（${context.planName || '普通话/方言模型'}）`
        : '声音版会员被调整为普通基础版，并已原路退款';
    const selfIntro = context.isFirstContact
      ? '这是小使者第一次联系用户，第一条消息必须先自我介绍："我是{{relation}}的小使者"。'
      : '小使者之前已经联系过用户，不要再自我介绍，直接说正事。';

    const facts: string[] = ['用户对亲人的日常称呼：{{relation}}'];
    if (context.eventType !== 'membership_downgrade') {
      facts.push('会员套餐名称：{{planName}}');
    }
    if (context.eventType === 'membership_downgrade') {
      facts.push('退款金额：{{refundAmount}}元（原路退回）');
    }
    if (context.needQr) {
      facts.push(
        '客服微信号：{{wechatId}}；客服微信二维码会随消息单独发送一张图片，文字里只需引导用户添加客服微信。'
      );
    }

    const sceneRequirement =
      context.eventType === 'membership_purchase'
        ? '告诉用户会员已开通、和亲人聊天不再限额度、想聊多久都行，并欢迎随时找小使者。'
        : context.eventType === 'voice_purchase'
        ? '必须说明：声音模型服务是人工做的；后台无法直接联系用户；需要用户主动添加客服微信并把亲人的声音素材发过来，人工客服会一步步帮忙弄好。语气要感谢用户的信任。'
        : context.eventType === 'voice_package_purchase'
        ? '必须说明：声音模型服务是人工做的；后台无法直接联系用户；需要用户主动添加客服微信并把亲人的声音素材发过来，人工客服会一步步帮忙弄好；可以提一下订单已经安排、会尽快跟进。语气要感谢用户的信任。'
        : '语气温和：告知已调整为基础版、退款会原路退回；如果声音服务未达预期要表达歉意；结尾给一个温暖的期待——AI 技术发展很快，不久的将来还有机会再听到亲人的声音。';

    return [
      `你是${context.relation}的小使者，是${
        brandConfig().name
      }里的一个温暖、可信、说话自然的真人客服。用户刚刚触发了一个业务事件：${eventText}。`,
      '',
      `现在你需要给用户发一组短消息（1-${EVENT_NOTICE_MAX_MESSAGES}条），一次性全部发出，不要等用户回复。`,
      '',
      '【必须传达的事实】涉及这些信息时，只能使用给定占位符，禁止自行改写、补充或编造：',
      ...facts.map(fact => `- ${fact}`),
      '',
      `【场景要求】${sceneRequirement}`,
      '',
      `【自我介绍】${selfIntro}`,
      '',
      '【风格】真人客服语气，口语自然，有温度；短句，每条消息独立成句；不要"会员已生效"这类官方通知腔。',
      '【禁止】不得模拟或模仿亲人说话；不得自称"平台""官方"；不得承诺声音能100%还原或完全一致；不得编造价格、时效、套餐；不得推销其他套餐或引导续费。',
      '',
      '【输出】只输出一个 JSON 字符串数组，例如：["第一条","第二条"]。不要输出任何其他文字。',
    ].join('\n');
  }

  private parseNoticeArray(content: string): string[] | null {
    if (!content?.trim()) {
      return null;
    }
    const text = content.trim();
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    try {
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) {
        return null;
      }
      try {
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }

  private sanitizeEventNotices(
    notices: string[],
    context: EventNoticeContext
  ): string[] | null {
    const cleaned: string[] = [];
    for (const raw of notices) {
      if (typeof raw !== 'string') {
        continue;
      }
      let text = raw.trim();
      if (!text) {
        continue;
      }
      if (text.length > EVENT_NOTICE_MAX_MESSAGE_LENGTH) {
        text = text.slice(0, EVENT_NOTICE_MAX_MESSAGE_LENGTH);
      }
      if (this.matchesNoticeBlacklist(text)) {
        return null;
      }
      text = text.replace(/\{\{relation\}\}/g, context.relation);
      text = text.replace(/\{\{planName\}\}/g, context.planName || '会员');
      if (context.refundAmountYuan != null) {
        text = text.replace(
          /\{\{refundAmount\}\}/g,
          String(context.refundAmountYuan)
        );
      }
      text = text.replace(/\{\{wechatId\}\}/g, context.wechatId || '客服微信');
      if (/\{\{/.test(text)) {
        return null;
      }
      cleaned.push(text);
      if (cleaned.length >= EVENT_NOTICE_MAX_MESSAGES) {
        break;
      }
    }
    return cleaned.length ? cleaned : null;
  }

  private matchesNoticeBlacklist(text: string): boolean {
    if (/100%|百分之百|完全一致|一模一样|完全还原|绝对像|保真/.test(text)) {
      return true;
    }
    if (/(我是平台|官方平台|代表平台|本平台)/.test(text)) {
      return true;
    }
    if (
      /立即购买|马上购买|现在购买|限时优惠|优惠价|续费请|快去购买/.test(text)
    ) {
      return true;
    }
    return false;
  }

  private buildFallbackEventNotices(context: EventNoticeContext): string[] {
    const selfIntro = context.isFirstContact
      ? `你好，我是${context.relation}的小使者～`
      : '';

    if (context.eventType === 'membership_purchase') {
      return [
        `${selfIntro}你的会员已经开通好了，以后和${context.relation}聊天不再限额度，想聊多久都行。有什么需要随时找我。`,
      ];
    }

    if (context.eventType === 'voice_purchase') {
      return [
        `${selfIntro}看到你开通了声音版，先跟你说声谢谢。`,
        '跟你说明一下：声音模型这块是人工做的，我们后台没法直接联系你。',
        `所以需要你主动加一下客服微信，把${context.relation}的声音素材发过来，人工客服会一步步帮你弄好。`,
      ];
    }

    if (context.eventType === 'voice_package_purchase') {
      return [
        `${selfIntro}看到你购买了声音模型服务，先跟你说声谢谢。`,
        '跟你说明一下：声音模型这块是人工做的，我们后台没法直接联系你。',
        `所以需要你主动加一下客服微信，把${context.relation}的声音素材发过来，人工客服会一步步帮你弄好。`,
      ];
    }

    return [
      `${selfIntro}你的声音版会员已经调整为基础版，差价会原路退回，留意查收。`,
      `如果这次声音服务没能达到你的预期，我们很抱歉。不过现在 AI 技术发展很快，相信不久的将来，还有机会再听到${context.relation}的声音。`,
    ];
  }

  private async writeEventNotices(
    conversation: ConversationEntity,
    messengerAgent: AgentEntity,
    options: SendEventNoticeOptions,
    context: EventNoticeContext,
    notices: string[]
  ): Promise<void> {
    const now = new Date();
    const messages: MessageEntity[] = notices.map((content, index) => {
      const message = new MessageEntity();
      message.conversationId = conversation.id;
      message.userId = conversation.userId;
      message.agentId = messengerAgent.id;
      message.role = MessageRole.assistant;
      message.type = MessageType.text;
      message.content = content;
      message.status = MessageStatus.sent;
      message.traceId = `event_notice:${options.eventType}:${options.orderId}:${index}`;
      message.createdAt = new Date(now.getTime() + index);
      message.updatedAt = message.createdAt;
      return message;
    });

    if (context.needQr && context.wechatQrUrl) {
      const qrMessage = new MessageEntity();
      qrMessage.conversationId = conversation.id;
      qrMessage.userId = conversation.userId;
      qrMessage.agentId = messengerAgent.id;
      qrMessage.role = MessageRole.assistant;
      qrMessage.type = MessageType.image;
      qrMessage.content = context.wechatId
        ? `客服微信：${context.wechatId}`
        : '客服微信二维码';
      qrMessage.mediaUrl = context.wechatQrUrl;
      qrMessage.mediaMimeType = 'image/png';
      qrMessage.status = MessageStatus.sent;
      qrMessage.traceId = `event_notice:${options.eventType}:${options.orderId}:qr`;
      qrMessage.createdAt = new Date(now.getTime() + notices.length);
      qrMessage.updatedAt = qrMessage.createdAt;
      messages.push(qrMessage);
    }

    if (messages.length) {
      await this.messageModel.save(messages);
    }
  }

  private getEventNoticeDedupeKey(options: SendEventNoticeOptions): string {
    return `messenger:event:sent:${options.eventType}:${options.orderId}`;
  }

  private async acquireEventNoticeDedupe(key: string): Promise<boolean> {
    try {
      const result = await this.redisService?.set(
        key,
        String(Date.now()),
        'PX',
        EVENT_NOTICE_DEDUPE_TTL_MS,
        'NX'
      );
      return result === undefined || result === 'OK';
    } catch (error) {
      this.logger?.warn?.(
        '[messenger] event notice dedupe unavailable, key=%s reason=%s',
        key,
        error instanceof Error ? error.message : String(error)
      );
      return true;
    }
  }

  private async releaseEventNoticeDedupe(key: string): Promise<void> {
    try {
      if (this.redisService) {
        await this.redisService.del(key);
      }
    } catch {
      // 幂等键释放失败不影响主流程
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  buildMessengerName(agentName?: string): string {
    const name = this.normalizeParentDisplayName(agentName);
    return `${name}的小使者`;
  }

  buildMemoryTaskPlan(
    parentAgent: AgentEntity,
    latestAssistantReply = ''
  ): MessengerMemoryTaskPlan {
    const parentName = this.normalizeParentDisplayName(parentAgent.name);
    const tasks = MESSENGER_MEMORY_TASK_DEFINITIONS.map(definition => ({
      ...definition,
      title:
        definition.key === 'personalityTraits'
          ? `${parentName}的样子`
          : definition.title,
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
      parentName,
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

  async revealEligibleMessengersForUser(
    userId: MongoObjectId,
    now = new Date()
  ): Promise<RevealEligibleMessengersResult> {
    const messengers = await this.agentModel.find({
      where: {
        createdUserId: userId,
        messengerOfAgentId: { $exists: true },
      },
    });
    let alreadyVisible = 0;
    let revealed = 0;
    let revealedByTurns = 0;
    let revealedByAge = 0;

    for (const messenger of messengers) {
      if (!messenger.messengerOfAgentId) {
        continue;
      }

      const existingConversation = await this.conversationModel.findOne({
        where: {
          agentId: messenger.id,
          userId,
        },
      });
      if (existingConversation) {
        alreadyVisible += 1;
        continue;
      }

      const parentAgent = await this.agentModel.findOne({
        where: {
          id: messenger.messengerOfAgentId,
          createdUserId: userId,
        },
      });
      if (!parentAgent) {
        continue;
      }

      const ageEligible =
        parentAgent.createdAt instanceof Date &&
        now.getTime() - parentAgent.createdAt.getTime() >=
          MESSENGER_REVEAL_WAIT_MS;
      let turnEligible = false;

      if (!ageEligible) {
        const userTurnCount = await this.countEffectiveUserTurns(
          userId,
          parentAgent.id
        );
        turnEligible = userTurnCount >= MESSENGER_REVEAL_USER_TURN_THRESHOLD;
      }

      if (!ageEligible && !turnEligible) {
        continue;
      }

      const result = await this.ensureVisibleMessengerConversation(
        parentAgent,
        messenger
      );
      if (result.created) {
        revealed += 1;
        if (ageEligible) {
          revealedByAge += 1;
        } else {
          revealedByTurns += 1;
        }
      } else if (result.visible) {
        alreadyVisible += 1;
      }
    }

    return {
      processed: messengers.length,
      alreadyVisible,
      revealed,
      revealedByTurns,
      revealedByAge,
    };
  }

  async revealMessengerAfterUserMessage(
    parentAgent: AgentEntity,
    userMessage: MessageEntity
  ): Promise<boolean> {
    if (!this.isEffectiveParentUserMessage(parentAgent, userMessage)) {
      return false;
    }

    const userTurnCount = await this.countEffectiveUserTurns(
      userMessage.userId,
      parentAgent.id
    );
    if (userTurnCount < MESSENGER_REVEAL_USER_TURN_THRESHOLD) {
      return false;
    }

    const messenger = await this.ensureMessengerForAgent(parentAgent);
    const result = await this.ensureVisibleMessengerConversation(
      parentAgent,
      messenger
    );
    return result.visible;
  }

  private async ensureVisibleMessengerConversation(
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity
  ): Promise<EnsureVisibleMessengerConversationResult> {
    const existingConversation = await this.conversationModel.findOne({
      where: {
        agentId: messengerAgent.id,
        userId: parentAgent.createdUserId,
      },
    });
    if (existingConversation) {
      await this.repairInitialMessengerGreetingIfEmpty(
        existingConversation,
        parentAgent,
        messengerAgent
      );
      return {
        visible: true,
        created: false,
      };
    }

    const lock = await this.acquireMessengerRevealLock(messengerAgent.id);
    if (!lock.acquired) {
      return {
        visible: false,
        created: false,
      };
    }

    try {
      const conversationBeforeEnsure = await this.conversationModel.findOne({
        where: {
          agentId: messengerAgent.id,
          userId: parentAgent.createdUserId,
        },
      });

      await this.ensureMessengerConversation(parentAgent, messengerAgent);
      return {
        visible: true,
        created: !conversationBeforeEnsure,
      };
    } finally {
      await this.releaseMessengerRevealLock(messengerAgent.id, lock.token);
    }
  }

  private async repairInitialMessengerGreetingIfEmpty(
    conversation: ConversationEntity,
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity
  ): Promise<void> {
    const existingMessage = await this.messageModel.findOne({
      where: {
        conversationId: conversation.id,
      },
    });
    if (existingMessage) {
      return;
    }

    const lock = await this.acquireMessengerRevealLock(messengerAgent.id);
    if (!lock.acquired) {
      return;
    }

    try {
      await this.ensureInitialMessengerGreeting(
        conversation,
        parentAgent,
        messengerAgent,
        new Date()
      );
    } finally {
      await this.releaseMessengerRevealLock(messengerAgent.id, lock.token);
    }
  }

  private countEffectiveUserTurns(
    userId: MongoObjectId,
    parentAgentId: MongoObjectId
  ): Promise<number> {
    return this.messageModel.count({
      userId,
      agentId: parentAgentId,
      role: MessageRole.user,
      status: MessageStatus.sent,
      source: { $ne: MessageSource.wechatImport },
      isArchived: { $ne: true },
    });
  }

  private isEffectiveParentUserMessage(
    parentAgent: AgentEntity,
    message: MessageEntity
  ): boolean {
    return Boolean(
      parentAgent?.id &&
        parentAgent.createdUserId &&
        message?.userId &&
        message.agentId &&
        String(parentAgent.createdUserId) === String(message.userId) &&
        String(parentAgent.id) === String(message.agentId) &&
        message.role === MessageRole.user &&
        message.status === MessageStatus.sent &&
        message.source !== MessageSource.wechatImport &&
        message.isArchived !== true
    );
  }

  private async acquireMessengerRevealLock(
    messengerAgentId: MongoObjectId
  ): Promise<{ acquired: boolean; token: string }> {
    const token = `${Date.now()}:${Math.random().toString(16).slice(2)}`;

    try {
      const result = await this.redisService?.set(
        this.getMessengerRevealLockKey(messengerAgentId),
        token,
        'PX',
        MESSENGER_REVEAL_LOCK_TTL_MS,
        'NX'
      );
      return {
        acquired: result === undefined || result === 'OK',
        token,
      };
    } catch (error) {
      this.logger?.warn?.(
        '[messenger] reveal lock unavailable, messengerAgentId=%s, reason=%s',
        String(messengerAgentId),
        error instanceof Error ? error.message : String(error)
      );
      return { acquired: true, token: '' };
    }
  }

  private async releaseMessengerRevealLock(
    messengerAgentId: MongoObjectId,
    token: string
  ): Promise<void> {
    if (!token || !this.redisService) {
      return;
    }

    try {
      const key = this.getMessengerRevealLockKey(messengerAgentId);
      if ((await this.redisService.get(key)) === token) {
        await this.redisService.del(key);
      }
    } catch (error) {
      this.logger?.warn?.(
        '[messenger] reveal lock release failed, messengerAgentId=%s, reason=%s',
        String(messengerAgentId),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private getMessengerRevealLockKey(messengerAgentId: MongoObjectId): string {
    return `messenger:reveal:lock:${String(messengerAgentId)}`;
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
      const previousTurns = conversationMessages
        .filter(
          message =>
            String(message.id || '') !== String(sourceMessage?.id || '') &&
            (message.role === MessageRole.user ||
              message.role === MessageRole.assistant) &&
            Boolean(message.content?.trim())
        )
        .slice(0, 12)
        .reverse()
        .map(message => ({
          role:
            message.role === MessageRole.user
              ? ('user' as const)
              : ('assistant' as const),
          content: message.content?.trim() || '',
        }));
      const askedFields = this.collectAskedInterviewFields(previousReplies);
      const memoryTaskPlan = this.buildMemoryTaskPlan(
        options.agent,
        previousReplies[0] || ''
      );
      const directReply = this.buildDirectCapabilityReply(
        options.agent,
        options.input
      );
      if (directReply) {
        await this.recordCallEvent(options, {
          status: MessengerCallStatus.skipped,
          skipReason: 'direct_capability_reply',
          sourceMessageId: sourceMessage?.id,
          durationMs: Date.now() - startedAt,
          telemetry,
          changedProfileFields: [],
          profileSaved: false,
        });
        return directReply;
      }

      if (this.isInterviewPauseInput(options.input)) {
        await this.recordCallEvent(options, {
          status: MessengerCallStatus.skipped,
          skipReason: 'user_paused_interview',
          sourceMessageId: sourceMessage?.id,
          durationMs: Date.now() - startedAt,
          telemetry,
          changedProfileFields: [],
          profileSaved: false,
        });
        return this.buildInterviewPauseReply(options.agent);
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
        previousTurns,
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
    const parentName = this.normalizeParentDisplayName(agent.name);

    if (this.isMemoryReceiptQuestion(query)) {
      return this.buildMemoryReceiptReply(agent);
    }

    if (
      /(?:小使者|你).{0,8}(?:是干嘛的|干什么的|做什么|能做什么|有什么用|作用是什么)/.test(
        query
      )
    ) {
      return `我是${parentName}的小使者，专门帮你收集、核实并补全${parentName}的经历、性格和家人回忆。`;
    }

    if (
      /^(?:你是谁|你是什么|这是(?:谁|什么)|你叫什么)[？?。！!\s]*$/.test(query)
    ) {
      return `我是${parentName}的小使者，负责帮${parentName}找回和补全真实记忆。`;
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
      return `听得出来你很想${parentName}。我不能确认那边的真实情况，但可以帮${parentName}把真实记忆补完整。`;
    }

    if (
      /(?:能不能|可以|能|想|希望|怎么|如何|用).{0,8}(?:照片|头像|影像).{0,12}(?:复活|通话|视频|说话)|(?:照片|头像|影像).{0,12}(?:能不能|可以|能|怎么|如何).{0,8}(?:复活|通话|视频|说话)|(?:复活|视频通话).{0,12}(?:照片|头像|影像)/.test(
        query
      )
    ) {
      return `我懂你想再见${parentName}。目前小使者不能用照片复活或视频通话，但可以帮${parentName}补全记忆。`;
    }

    if (
      /(?:声音|音色|语音).{0,10}(?:复刻|克隆|合成|怎么做|能不能|可以吗)|(?:复刻|克隆).{0,8}(?:声音|音色|语音)/.test(
        query
      )
    ) {
      return `声音复刻需要${parentName}生前的声音素材，具体能否制作和费用以声音服务页面为准；我这里不替平台报价。`;
    }

    return undefined;
  }

  private isMemoryReceiptQuestion(query: string): boolean {
    return (
      /(?:你|小使者).{0,8}(?:记住|记得|记下|记录|保存).{0,8}(?:什么|哪些|多少|了吗|没有)/.test(
        query
      ) ||
      /(?:你|小使者).{0,8}记了.{0,4}(?:什么|哪些)/.test(query) ||
      /(?:你|小使者).{0,8}(?:怎么|如何).{0,6}(?:记(?:的|住|下|录)|保存)/.test(
        query
      ) ||
      /(?:你|小使者).{0,8}(?:记到|存到|保存到).{0,6}(?:哪里|哪儿|什么地方)/.test(
        query
      ) ||
      /(?:刚才|现在|目前).{0,8}(?:记住|记得|记下|记录|保存|记了).{0,8}(?:什么|哪些)/.test(
        query
      )
    );
  }

  private buildMemoryReceiptReply(agent: AgentEntity): string {
    const name = this.normalizeParentDisplayName(agent.name);
    const receiptFields: ReadonlyArray<{
      key: AgentProfileMemoryField;
      label: string;
    }> = [
      { key: 'lifeExperience', label: '人生经历' },
      { key: 'personalityTraits', label: '性格特点' },
      { key: 'hobbies', label: '喜欢的事' },
      { key: 'languageHabits', label: '说话习惯' },
      { key: 'sharedMemories', label: '共同回忆' },
    ];
    const saved = receiptFields
      .map(field => ({
        ...field,
        value: this.summarizeMemoryReceiptValue(agent[field.key] || '', name),
      }))
      .filter(field => Boolean(field.value));
    const missing = receiptFields
      .filter(field => !String(agent[field.key] || '').trim())
      .map(field => field.label);

    if (!saved.length) {
      return `目前还没有保存到${name}的具体记忆。我会把你明确讲过或确认过的内容按人生经历、性格、爱好、说话习惯和共同回忆，分别保存到${name}的记忆资料里；不确定的不会当成事实。`;
    }

    const lines = saved.map(field => `${field.label}：${field.value}`);
    const missingHint = missing.length
      ? `\n还没补到：${missing.join('、')}。`
      : '';

    return `我目前这样帮${name}记着：\n${lines.join(
      '\n'
    )}\n这些是已经按五类保存到${name}的记忆资料里的内容；我不会在回执里补写没有保存的细节。${missingHint}`;
  }

  private summarizeMemoryReceiptValue(value: string, name: string): string {
    const normalized = value
      .replace(/用户/g, '你')
      .replace(/TA/gi, name)
      .replace(/当前角色/g, name)
      .replace(/\s+/g, ' ')
      .trim();
    const characters = Array.from(normalized);
    return characters.length > 48
      ? `${characters.slice(0, 48).join('')}…`
      : normalized;
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

    return !/^(?:(?:这个|这件事|这方面))?(?:我)?(?:实在|真的|暂时|现在)?(?:不知道(?:说什么)?|不清楚|没想好|想不到|想不起来|记不得|不记得|没什么(?:可说)?)(?:了|呢|啊)?$/.test(
      compact
    );
  }

  private isInterviewPauseInput(input: string): boolean {
    const compact = (input || '')
      .replace(/[\s，。！？、,.!?~～…·]/g, '')
      .trim();
    return /^(?:我)?(?:不想说了?|不说了|先这样|先不说了?|下次再说|以后再说|回头再说|再想起来再说吧?|今天不聊了?|不聊了|到这里吧|就这样吧|算了|(?:和你)?聊也没(?:有)?什么了)$/.test(
      compact
    );
  }

  private buildInterviewPauseReply(agent: AgentEntity): string {
    const name = this.normalizeParentDisplayName(agent.name);
    return `好，我们先说到这里。以后想起${name}的什么，再来告诉我就好。`;
  }

  private buildLowPressureReply(agent: AgentEntity, input: string): string {
    const name = this.normalizeParentDisplayName(agent.name);
    const compact = (input || '').replace(/[\s，。！？、,.!?~～…·]/g, '');

    return compact
      ? `没关系，不用勉强想。等一个关于${name}的画面浮上来，再慢慢告诉我。`
      : `我在。你不用急着回答，想到${name}的一个小片段时再告诉我。`;
  }

  private buildFallbackReply(agent: AgentEntity): string {
    const name = this.normalizeParentDisplayName(agent.name);
    return `我在听，你想到${name}的什么，都可以慢慢讲给我。`;
  }

  private async createInitialMessengerGreeting(
    conversation: ConversationEntity,
    parentAgent: AgentEntity,
    messengerAgent: AgentEntity,
    now: Date
  ): Promise<void> {
    const parentName = this.normalizeParentDisplayName(parentAgent.name);
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
      `你好，我是${messengerName}，可以帮${parentName}找回记忆。`,
      `你最想让${parentName}想起来的是？`,
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
    if (/喜欢做什么|小爱好|喜欢的事|开心/.test(reply)) {
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

  private normalizeParentDisplayName(value?: string): string {
    const raw = value?.trim() || '';
    const firstPart = raw.split(/[。！？!?\n]/, 1)[0]?.trim() || '';
    return firstPart && firstPart.length <= 20 ? firstPart : '亲人';
  }
}
