import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageType,
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../../interface';
import {
  containsUnsafeAssistantHistoryContent,
  stripPromptLeakageContent,
} from '../../common/message-content-safety';
import { buildDepartedSystemPrompt } from '../../prompt/departed';
import { RetrieveService } from '../rag/retrieve.service';
import {
  AgentMemoryFactService,
  AgentMemoryFactSummary,
} from './agent-memory-fact.service';
import {
  AgentProfileFactService,
  AgentProfileFactSummary,
} from './agent-profile-fact.service';
import {
  AgentRelationshipSignalService,
  AgentRelationshipSignalSummary,
} from './agent-relationship-signal.service';
import {
  AgentEmotionStateService,
  ConversationEmotionStateSummary,
} from './agent-emotion-state.service';
import { ReplyIntentClassifierService } from './reply-intent-classifier.service';
import type { StructuredReplyIntent } from './reply-intent';
import {
  buildReplyBrief,
  ReplyBrief,
  ReplyBriefService,
} from './reply-brief.service';
import { ReplySceneRoute, routeReplyScene } from './reply-scene-router';
import { getSharedFamilyMemberNameFromFactKey } from './shared-family-member';

export interface BuildConversationContextOptions {
  auth: AuthenticatedUserPayload;
  conversation: ConversationEntity;
  agent: AgentEntity | null;
  currentQuery?: string;
  classifyIntent?: boolean;
}

export interface AgentContextLayer {
  key: 'persona' | 'history' | 'longTermHistory';
  messages: ChatCompletionMessageParam[];
}

export interface AgentConversationContext {
  layers: AgentContextLayer[];
  messages: ChatCompletionMessageParam[];
  replyIntent?: StructuredReplyIntent;
  replyRoute: ReplySceneRoute;
  replyBrief: ReplyBrief;
}

export interface RetrievedContextSnippet {
  content: string;
  role?: MessageRole;
  createdAt?: string;
  score?: number;
}

const RECENT_HISTORY_MESSAGE_LIMIT = 12;

@Provide()
export class AgentContextService {
  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  retrieveService: RetrieveService;

  @Inject()
  agentMemoryFactService: AgentMemoryFactService;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  @Inject()
  agentRelationshipSignalService: AgentRelationshipSignalService;

  @Inject()
  agentEmotionStateService: AgentEmotionStateService;

  @Inject()
  replyIntentClassifierService: ReplyIntentClassifierService;

  @Inject()
  replyBriefService: ReplyBriefService;

  async buildConversationContext(
    options: BuildConversationContextOptions
  ): Promise<AgentConversationContext> {
    const conversationMessages = await this.listConversationMessages(
      options.conversation
    );
    const recentHistoryMessages =
      this.buildRecentHistoryMessages(conversationMessages);
    const profileFacts = await this.listProfileFacts(options);
    const knownFamilyMembers = (profileFacts || [])
      .map(fact => getSharedFamilyMemberNameFromFactKey(fact.key))
      .filter((name): name is string => Boolean(name));
    const [
      retrievedMemories,
      hardFacts,
      emotionState,
      replyIntent,
      storedRelationshipSignals,
    ] = await Promise.all([
      this.retrieveLongTermHistory(
        options,
        this.resolveLongTermHistoryCutoff(recentHistoryMessages)
      ),
      this.listHardFacts(options),
      this.getCurrentEmotionState(options),
      this.classifyReplyIntent(
        {
          currentQuery: options.currentQuery || '',
          recentMessages: recentHistoryMessages,
          knownFamilyMembers,
        },
        options.classifyIntent !== false
      ),
      this.listRelationshipSignals(options),
    ]);
    const relationshipSignals =
      this.agentRelationshipSignalService?.selectRelevantSignals(
        storedRelationshipSignals,
        replyIntent
      ) || [];
    const replyRoute = routeReplyScene({
      currentQuery: options.currentQuery,
      recentMessages: recentHistoryMessages,
      emotionState,
      knownFamilyMembers,
      intent: replyIntent,
    });
    const replyBriefOptions = {
      currentQuery: options.currentQuery || '',
      intent: replyRoute.intent ?? replyIntent,
      route: replyRoute,
      confirmedFacts: [...(profileFacts || []), ...(hardFacts || [])]
        .map(fact => fact.value?.trim())
        .filter((value): value is string => Boolean(value)),
      recentMessages: recentHistoryMessages,
      retrievedMemories,
      relationshipSignals,
    };
    const replyBrief = this.replyBriefService
      ? this.replyBriefService.build(replyBriefOptions)
      : buildReplyBrief(replyBriefOptions);
    const layers = [
      this.buildSystemLayer(
        options,
        retrievedMemories,
        hardFacts,
        profileFacts,
        emotionState,
        replyRoute,
        replyBrief
      ),
      this.buildHistoryLayer(recentHistoryMessages),
    ];

    return {
      layers,
      messages: layers.reduce<ChatCompletionMessageParam[]>(
        (result, layer) => result.concat(layer.messages),
        []
      ),
      replyIntent: replyRoute.intent,
      replyRoute,
      replyBrief,
    };
  }

  private buildSystemLayer(
    options: BuildConversationContextOptions,
    memories?: RetrievedContextSnippet[],
    hardFacts?: AgentMemoryFactSummary[],
    profileFacts?: AgentProfileFactSummary[],
    emotionState?: ConversationEmotionStateSummary | null,
    replyRoute?: ReplySceneRoute,
    replyBrief?: ReplyBrief
  ): AgentContextLayer {
    const basePrompt = buildDepartedSystemPrompt({
      userId: options.auth.sub,
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      agent: options.agent,
    });
    const hardFactPrompt = this.buildHardFactPrompt(hardFacts);
    const profileFactPrompt = this.buildProfileFactPrompt(profileFacts);
    const longTermHistoryPrompt = this.buildLongTermHistoryPrompt(memories);
    const emotionStatePrompt = this.buildEmotionStatePrompt(
      emotionState,
      replyRoute
    );
    const replyBriefPrompt = replyBrief?.prompt || '';

    const systemPrompt = [
      basePrompt,
      profileFactPrompt,
      hardFactPrompt,
      longTermHistoryPrompt,
      emotionStatePrompt,
      replyBriefPrompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      key: 'persona',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        } as ChatCompletionMessageParam,
      ],
    };
  }

  private async listHardFacts(
    options: BuildConversationContextOptions
  ): Promise<AgentMemoryFactSummary[]> {
    if (!this.agentMemoryFactService) {
      return [];
    }

    return this.agentMemoryFactService.listFactsForPrompt({
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });
  }

  private async listProfileFacts(
    options: BuildConversationContextOptions
  ): Promise<AgentProfileFactSummary[]> {
    if (!this.agentProfileFactService) {
      return [];
    }

    return this.agentProfileFactService.listFactsForPrompt({
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });
  }

  private async listRelationshipSignals(
    options: BuildConversationContextOptions
  ): Promise<AgentRelationshipSignalSummary[]> {
    if (!this.agentRelationshipSignalService) {
      return [];
    }

    return this.agentRelationshipSignalService.listSignals({
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });
  }

  private async getCurrentEmotionState(
    options: BuildConversationContextOptions
  ): Promise<ConversationEmotionStateSummary | null> {
    if (!this.agentEmotionStateService) {
      return null;
    }

    return this.agentEmotionStateService.getCurrentState({
      conversationId: options.conversation.id,
      userId: options.conversation.userId,
      agentId: options.agent?.id ?? options.conversation.agentId,
    });
  }

  private buildHardFactPrompt(facts?: AgentMemoryFactSummary[]): string {
    const items = (facts || [])
      .map(fact => fact.value?.trim())
      .filter(Boolean)
      .slice(0, 24);

    if (!items.length) {
      return '';
    }

    return (
      '# 已确认关键事实和纠错\n' +
      '以下内容来自用户明确表达或纠错，优先级高于长期历史。涉及对应信息时必须遵守；禁止用历史助手回复覆盖。\n' +
      items.map((item, index) => `${index + 1}. ${item}`).join('\n')
    );
  }

  private buildProfileFactPrompt(facts?: AgentProfileFactSummary[]): string {
    const items = (facts || [])
      .map(fact => fact.value?.trim())
      .filter(Boolean)
      .slice(0, 32);

    const rules = [
      '# 已确认角色事实补充',
      '以下内容来自用户在聊天或反馈中对当前角色的明确补充、纠正或禁忌说明，优先级高于长期历史和历史助手回复。',
      '当用户询问年龄、身份、称呼、职业、亲属关系、说话风格或共同记忆时，必须优先使用这里的 active 角色事实；如果这里和角色资料冲突，按用户后续纠正为准。',
      '用户问年龄时：优先回答“离开时年龄”；没有明确年龄但有生日和离开日期时只能按 dates 计算离开时年龄；缺少必要日期或事实时必须说记不清/不知道，禁止猜。',
      '用户问你是谁、叫什么、怎么称呼时：优先使用 identity.name、identity.userCallsAgent、identity.agentCallsUser 和这里的身份事实，禁止临时创造亲属身份。',
    ];

    if (!items.length) {
      return rules.join('\n');
    }

    return `${rules.join('\n')}\n${items
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n')}`;
  }

  private buildHistoryLayer(messages: MessageEntity[]): AgentContextLayer {
    return {
      key: 'history',
      messages: messages
        .map(message => this.buildChatMessage(message))
        .filter(Boolean) as ChatCompletionMessageParam[],
    };
  }

  private buildLongTermHistoryPrompt(
    memories?: RetrievedContextSnippet[]
  ): string {
    const items = (memories || [])
      .map(memory => {
        const content = memory.content?.trim();

        if (!content) {
          return '';
        }

        const date = memory.createdAt?.trim();
        const roleLabel = this.formatMemoryRoleLabel(memory.role);
        const prefix = [date ? `[${date}]` : '', roleLabel]
          .filter(Boolean)
          .join('');
        return prefix ? `${prefix} ${content}` : content;
      })
      .filter(Boolean)
      .slice(0, 10);
    if (!items.length) {
      return '';
    }

    return (
      '以下是长期久远的历史，仅在与当前问题确实相关时参考。长期历史可能包含用户原话，也可能包含历史助手生成回复；只有用户原话、角色资料、管理员定制上下文和用户明确确认过的信息可以作为事实。历史助手回复只能当作对话氛围参考，不能单独作为共同记忆、菜名、地点、动作或过往经历的证据。\n' +
      items.map((item, index) => `${index + 1}. ${item}`).join('\n')
    );
  }

  private buildEmotionStatePrompt(
    state?: ConversationEmotionStateSummary | null,
    replyRoute?: ReplySceneRoute
  ): string {
    if (!state) {
      return '';
    }

    const emotionLabel = this.formatEmotionLabel(state.primaryEmotion);
    const riskLabel = this.formatRiskLabel(state.riskLevel);
    const lines = [
      '# 当前用户情绪状态',
      `用户最近表现为：${emotionLabel}。风险等级：${riskLabel}。`,
      '回复时必须优先安抚当前情绪，不要忽略风险信号；不要把普通短期情绪当作长期事实或人格画像。',
    ];

    if (
      state.primaryEmotion === ConversationEmotionPrimary.crisisRisk ||
      state.riskLevel === ConversationEmotionRiskLevel.high
    ) {
      if (replyRoute?.primaryScene?.scene !== 'grief_crisis') {
        return '';
      }

      lines.push(
        '用户最近存在轻生/自伤风险。回复必须优先制止、稳定、引导联系现实中的人或急救资源；禁止浪漫化死亡或引导去陪逝者。'
      );
    }

    return lines.join('\n');
  }

  private classifyReplyIntent(
    options: {
      currentQuery: string;
      recentMessages: MessageEntity[];
      knownFamilyMembers: string[];
    },
    enabled = true
  ): Promise<StructuredReplyIntent | undefined> {
    if (!enabled || !this.replyIntentClassifierService) {
      return Promise.resolve(undefined);
    }

    return this.replyIntentClassifierService
      .classify(options)
      .catch(() => undefined);
  }

  private formatEmotionLabel(emotion: ConversationEmotionPrimary): string {
    const labels: Record<ConversationEmotionPrimary, string> = {
      [ConversationEmotionPrimary.stable]: '稳定',
      [ConversationEmotionPrimary.missing]: '强烈思念',
      [ConversationEmotionPrimary.sadness]: '哀伤',
      [ConversationEmotionPrimary.guilt]: '愧疚',
      [ConversationEmotionPrimary.angerBlame]: '责问与不甘',
      [ConversationEmotionPrimary.fear]: '害怕现实存在感',
      [ConversationEmotionPrimary.expectingPresence]: '期待现实确认',
      [ConversationEmotionPrimary.attachment]: '纪念物依恋',
      [ConversationEmotionPrimary.crisisRisk]: '高危风险',
    };

    return labels[emotion] ?? emotion;
  }

  private formatRiskLabel(riskLevel: ConversationEmotionRiskLevel): string {
    const labels: Record<ConversationEmotionRiskLevel, string> = {
      [ConversationEmotionRiskLevel.none]: '无',
      [ConversationEmotionRiskLevel.low]: '低',
      [ConversationEmotionRiskLevel.medium]: '中',
      [ConversationEmotionRiskLevel.high]: '高',
    };

    return labels[riskLevel] ?? riskLevel;
  }

  private async retrieveLongTermHistory(
    options: BuildConversationContextOptions,
    createdBeforeTs?: number
  ): Promise<RetrievedContextSnippet[]> {
    const query = options.currentQuery?.trim();

    if (!query) {
      return [];
    }

    return this.retrieveService.retrieveConversationMemories({
      query,
      userId: options.auth.sub,
      conversationId: this.stringifyObjectId(options.conversation.id),
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      createdBeforeTs,
    });
  }

  private async listConversationMessages(
    conversation: ConversationEntity
  ): Promise<MessageEntity[]> {
    const messages = await this.messageModel.find({
      where: {
        conversationId: conversation.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return messages.filter(message => !message.isArchived);
  }

  private buildRecentHistoryMessages(
    messages: MessageEntity[]
  ): MessageEntity[] {
    return messages
      .filter(message => this.buildChatMessage(message))
      .slice(-RECENT_HISTORY_MESSAGE_LIMIT);
  }

  private resolveLongTermHistoryCutoff(
    recentHistoryMessages: MessageEntity[]
  ): number | undefined {
    if (recentHistoryMessages.length < RECENT_HISTORY_MESSAGE_LIMIT) {
      return undefined;
    }

    const oldestRecentMessage = recentHistoryMessages[0];
    const timestamp = oldestRecentMessage?.createdAt?.getTime?.();

    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      return undefined;
    }

    return Math.floor(timestamp);
  }

  private buildChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    switch (message.role) {
      case MessageRole.assistant: {
        const assistantContent = this.buildAssistantHistoryContent(message);

        if (!assistantContent) {
          return null;
        }
        return {
          role: 'assistant',
          content: assistantContent,
        };
      }
      case MessageRole.user:
        if (message.type === MessageType.voice) {
          return this.buildVoiceChatMessage(message);
        }
        if (message.type === MessageType.image) {
          return this.buildImageChatMessage(message);
        }
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'user',
          content: this.buildUserTextChatContent(message),
        };
      case MessageRole.system:
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'system',
          content: message.content,
        };
      default:
        return null;
    }
  }

  private buildAssistantHistoryContent(message: MessageEntity): string {
    const transcript = stripPromptLeakageContent(message.mediaTranscript);

    if (
      message.type === MessageType.voice &&
      transcript &&
      !containsUnsafeAssistantHistoryContent(transcript)
    ) {
      return transcript;
    }

    if (message.type !== MessageType.text) {
      return '';
    }

    const content = stripPromptLeakageContent(message.content);

    if (!content || containsUnsafeAssistantHistoryContent(content)) {
      return '';
    }

    return content;
  }

  private buildUserTextChatContent(message: MessageEntity): string {
    const content = message.content?.trim() || '';
    const quotedContent = message.quotedMessageContent?.trim();

    if (!quotedContent) {
      return content;
    }

    const roleLabel =
      message.quotedMessageRole === MessageRole.assistant
        ? 'AI回复'
        : message.quotedMessageRole === MessageRole.user
        ? '用户原话'
        : '历史消息';

    return [
      '用户本条消息使用了“引用”操作。',
      `被引用的${roleLabel}：${quotedContent}`,
      `用户本次要表达的内容：${content}`,
      '请优先理解用户是在针对被引用内容回应；不要把被引用内容当作用户本次新说的话。',
    ].join('\n');
  }

  private formatMemoryRoleLabel(role?: MessageRole): string {
    if (role === MessageRole.user) {
      return '[用户原话]';
    }

    if (role === MessageRole.assistant) {
      return '[历史助手回复-非事实来源]';
    }

    if (role === MessageRole.system) {
      return '[系统记录]';
    }

    return '';
  }

  private buildImageChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    const analysis = message.mediaAnalysis?.trim();

    if (!analysis) {
      return null;
    }

    return {
      role: 'user',
      content:
        `用户发送了一张图片。\n图片理解：${analysis}\n` +
        '请只围绕图片里可见的行为、场景、物体和氛围来做自然回应。不要猜测图片中的人是谁，不要做人脸或身份识别，不要追问人物身份、关系或背景。尽量只说你看到的内容，用陈述句回复，不要发出提问。',
    };
  }

  private buildVoiceChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    const transcript = message.mediaTranscript?.trim();

    if (!transcript) {
      return null;
    }

    return {
      role: 'user',
      content:
        `用户发送了一条语音消息。\n语音转写：${transcript}\n` +
        '请把这段转写内容当作用户刚刚说的话，自然回复，不要强调这是转写结果，除非用户自己提到识别错误或转写问题。',
    };
  }

  private stringifyObjectId(value: unknown): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && value) {
      const objectValue = value as {
        toHexString?: () => string;
        toString?: () => string;
      };

      if (typeof objectValue.toHexString === 'function') {
        return objectValue.toHexString();
      }

      if (typeof objectValue.toString === 'function') {
        return objectValue.toString();
      }
    }

    return String(value);
  }
}
