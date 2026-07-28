import { AgentContextService } from '../../src/service/agents/agent.context';
import {
  AgentEntity,
  AgentRelationshipSignalAssertionPolicy,
  AgentRelationshipSignalStatus,
  AgentRelationshipSignalSubject,
  AgentRelationshipSignalTopic,
  AgentRelationshipSignalType,
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';

describe('AgentContextService', () => {
  it('builds system prompt as a plain string for chat completions', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([
        {
          content: '记得用户说过最近睡得晚',
          role: MessageRole.user,
          createdAt: '2026-05-30',
        },
        {
          content: '用户最爱吃红烧鲫鱼',
          role: MessageRole.assistant,
          createdAt: '2026-05-29',
        },
      ]),
    } as never;
    service.agentMemoryFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          value: '用户是女生',
          priority: 3,
        },
        {
          value: '用户不爱吃辣，禁止说用户爱吃辣',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '现在几点了',
    });

    const systemMessage = context.messages[0];

    expect(systemMessage.role).toBe('system');
    expect(typeof systemMessage.content).toBe('string');
    expect(systemMessage.content).toContain('当前北京时间');
    expect(systemMessage.content).toContain('已确认关键事实和纠错');
    expect(systemMessage.content).toContain('用户是女生');
    expect(systemMessage.content).toContain('用户不爱吃辣，禁止说用户爱吃辣');
    expect(systemMessage.content).toContain('以下是长期久远的历史');
    expect(systemMessage.content).toContain('[2026-05-30][用户原话]');
    expect(systemMessage.content).toContain(
      '[2026-05-29][历史助手回复-非事实来源]'
    );
    expect(systemMessage.content).toContain('历史助手回复只能当作对话氛围参考');
  });

  it('injects one grounded reply brief instead of scene strategy prompts', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '你还记得我小时候你带我钓鱼吗',
    });

    const systemMessage = context.messages[0];

    expect(context.replyBrief.mode).toBe('memory');
    expect(context.replyBrief.strictGrounding).toBe(true);
    expect(systemMessage.content).toContain('本轮唯一回复简报');
    expect(systemMessage.content).toContain('模式：memory');
    expect(systemMessage.content).toContain(
      '[当前用户原话] 你还记得我小时候你带我钓鱼吗'
    );
    expect(systemMessage.content).toContain(
      '只确认用户明确提到的共同经历，不补写当时的动作或细节'
    );
    expect(systemMessage.content).not.toContain('本轮命中的回复策略');
    expect(systemMessage.content).not.toContain('主场景：');
  });

  it('keeps structured semantic intent metadata without injecting open-scene reply brief', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;
    service.replyIntentClassifierService = {
      classify: jest.fn().mockResolvedValue({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.95,
          },
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.88,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.93,
        source: 'semantic_model',
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '爸，身子可还遭罪？我真想你',
    });

    const systemMessage = context.messages[0];

    expect(context.replyRoute.routingSource).toBe('semantic');
    expect(context.replyRoute.primaryScene?.scene).toBe('afterlife_status');
    expect(context.replyRoute.secondaryScenes[0]?.scene).toBe('miss_longing');
    expect(context.replyIntent?.intents).toHaveLength(2);
    expect(context.replyBrief.mode).toBe('status');
    expect(context.replyBrief.replyMoves).toEqual([
      '回答用户对当前角色状态的询问，不编造具体生活',
      '直接回应想念或团聚愿望',
    ]);
    expect(systemMessage.content).not.toContain('模式：status');
    expect(systemMessage.content).not.toContain(
      '回答用户对当前角色状态的询问，不编造具体生活'
    );
    expect(systemMessage.content).not.toContain('直接回应想念或团聚愿望');
    expect(systemMessage.content).not.toContain('本轮结构化意图');
  });

  it('does not let a stale high-risk state override a new neutral message', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue({
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '嗯',
    });

    const systemMessage = context.messages[0];

    expect(systemMessage.content).not.toContain('风险等级：高');
    expect(systemMessage.content).not.toContain('模式：safety');
    expect(context.replyRoute.primaryScene?.scene).toBe('comfort_request');
  });

  it('injects high-risk state when the current message has explicit crisis intent', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue({
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '我不想活了，我想去陪你',
    });
    const systemMessage = context.messages[0];

    expect(systemMessage.content).toContain('当前用户情绪状态');
    expect(systemMessage.content).toContain('风险等级：高');
    expect(systemMessage.content).toContain('优先制止、稳定');
    expect(context.replyBrief.mode).toBe('safety');
    expect(systemMessage.content).toContain('模式：safety');
    expect(systemMessage.content).toContain(
      '明确制止通过伤害自己去找当前角色'
    );
  });

  it('uses confirmed shared family members for scene routing', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentProfileFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          type: 'family',
          key: 'family.shared_member.大宝',
          value:
            '大宝是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue({
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing', 'grief.sadness'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '大宝想你想得哭了',
    });
    const systemMessage = context.messages[0];

    expect(systemMessage.content).toContain(
      '大宝是用户与当前角色共同的重要家人'
    );
    expect(context.replyBrief.mode).toBe('family');
    expect(systemMessage.content).not.toContain('模式：family');
    expect(context.replyBrief.replyMoves).toEqual([
      '回应家人的当前处境',
      '表达牵挂，但不给用户追加责任',
    ]);
    expect(systemMessage.content).not.toContain('主场景：');
  });

  it('does not include legacy media url assistant messages in chat history', async () => {
    const service = new AgentContextService();
    const badAssistantMessage = new MessageEntity();
    Object.assign(badAssistantMessage, {
      id: new MongoObjectId('665000000000000000000031'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content:
        'https://zk.yaoxuankeji.club:8199/images/aiDeceased/b9a71d6a9e144fbca8d99ba89a6ec036.mp3 1',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:00:00.000Z'),
      updatedAt: new Date('2026-05-30T08:00:00.000Z'),
    });
    const goodAssistantMessage = new MessageEntity();
    Object.assign(goodAssistantMessage, {
      id: new MongoObjectId('665000000000000000000032'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content:
        '【历史助手回复，仅供理解对话顺序和语气，不是事实来源；其中具体回忆、菜名、地点、动作必须有用户原话或角色资料确认才可使用】早安媳妇儿',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:01:00.000Z'),
      updatedAt: new Date('2026-05-30T08:01:00.000Z'),
    });
    const spatialOverclaimMessage = new MessageEntity();
    Object.assign(spatialOverclaimMessage, {
      id: new MongoObjectId('665000000000000000000033'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '爸爸一直在天上看着你，你的事我都看在眼里。',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:02:00.000Z'),
      updatedAt: new Date('2026-05-30T08:02:00.000Z'),
    });
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([
          badAssistantMessage,
          goodAssistantMessage,
          spatialOverclaimMessage,
        ]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '早安',
    });

    expect(context.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: '早安媳妇儿',
        }),
      ])
    );
    const assistantHistoryMessage = context.messages.find(
      message => message.role === 'assistant'
    );
    expect(assistantHistoryMessage?.content).not.toContain('历史助手回复');
    expect(assistantHistoryMessage?.content).not.toContain('不是事实来源');
    expect(JSON.stringify(context.messages)).not.toContain('aiDeceased');
    expect(JSON.stringify(context.messages)).not.toContain(
      'zk.yaoxuankeji.club'
    );
    expect(JSON.stringify(context.messages)).not.toContain('在天上看着你');
    expect(JSON.stringify(context.messages)).not.toContain('看在眼里');
  });

  it('does not include assistant image messages or let them crowd recent chat history', async () => {
    const service = new AgentContextService();
    const textAssistantMessage = new MessageEntity();
    Object.assign(textAssistantMessage, {
      id: new MongoObjectId('665000000000000000000051'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '这是真正的聊天内容',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:04:00.000Z'),
      updatedAt: new Date('2026-05-30T08:04:00.000Z'),
    });
    const assistantImageMessages = Array.from({ length: 12 }, (_, index) => {
      const message = new MessageEntity();
      Object.assign(message, {
        id: new MongoObjectId(
          `6650000000000000000000${String(52 + index).padStart(2, '0')}`
        ),
        conversationId: new MongoObjectId('665000000000000000000020'),
        userId: new MongoObjectId('665000000000000000000001'),
        agentId: new MongoObjectId('665000000000000000000010'),
        role: MessageRole.assistant,
        type: MessageType.image,
        content: 'AI生成纪念合照',
        mediaAnalysis: 'AI生成纪念合照',
        mediaObjectKey: `memorial-photos/generated-${index}.png`,
        status: MessageStatus.sent,
        createdAt: new Date(
          `2026-05-30T08:${String(5 + index).padStart(2, '0')}:00.000Z`
        ),
        updatedAt: new Date(
          `2026-05-30T08:${String(5 + index).padStart(2, '0')}:00.000Z`
        ),
      });
      return message;
    });

    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([textAssistantMessage, ...assistantImageMessages]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '方方';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '继续说',
    });

    const serializedMessages = JSON.stringify(context.messages);
    expect(serializedMessages).toContain('这是真正的聊天内容');
    expect(serializedMessages).not.toContain('AI生成纪念合照');
    expect(serializedMessages).not.toContain('memorial-photos');
  });

  it('does not include archived messages in recent chat history', async () => {
    const service = new AgentContextService();
    const archivedAssistantMessage = new MessageEntity();
    Object.assign(archivedAssistantMessage, {
      id: new MongoObjectId('665000000000000000000041'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '傻孩子 爸也想你',
      status: MessageStatus.sent,
      isArchived: true,
      archivedAt: new Date('2026-05-30T08:02:00.000Z'),
      createdAt: new Date('2026-05-30T08:02:00.000Z'),
      updatedAt: new Date('2026-05-30T08:02:00.000Z'),
    });
    const activeAssistantMessage = new MessageEntity();
    Object.assign(activeAssistantMessage, {
      id: new MongoObjectId('665000000000000000000042'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '我也想你',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:03:00.000Z'),
      updatedAt: new Date('2026-05-30T08:03:00.000Z'),
    });
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([archivedAssistantMessage, activeAssistantMessage]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '方方';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '我很想你',
    });

    const assistantHistoryMessages = context.messages.filter(
      message => message.role === 'assistant'
    );
    expect(JSON.stringify(assistantHistoryMessages)).toContain('我也想你');
    expect(JSON.stringify(assistantHistoryMessages)).not.toContain('爸也想你');
  });

  it('formats quoted user messages so the model understands the reference target', async () => {
    const service = new AgentContextService();
    const userMessage = new MessageEntity();
    Object.assign(userMessage, {
      id: new MongoObjectId('665000000000000000000061'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.user,
      type: MessageType.text,
      content: '我不爱吃辣',
      quotedMessageRole: MessageRole.assistant,
      quotedMessageContent: '你以前总爱吃辣',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:05:00.000Z'),
      updatedAt: new Date('2026-05-30T08:05:00.000Z'),
    });

    service.messageModel = {
      find: jest.fn().mockResolvedValue([userMessage]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '我不爱吃辣',
    });

    const historyMessage = context.messages.find(
      message => message.role === 'user'
    );

    expect(historyMessage?.content).toContain('用户本条消息使用了“引用”操作。');
    expect(historyMessage?.content).toContain('被引用的AI回复：你以前总爱吃辣');
    expect(historyMessage?.content).toContain(
      '用户本次要表达的内容：我不爱吃辣'
    );
    expect(historyMessage?.content).toContain(
      '不要把被引用内容当作用户本次新说的话'
    );
  });

  it('injects stored concern as relationship context for a pain query', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.replyIntentClassifierService = {
      classify: jest.fn().mockResolvedValue({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.99,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      }),
    } as never;
    const storedSignal = {
      key: 'concern.agent_physical_suffering',
      signalType: AgentRelationshipSignalType.concern,
      topic: AgentRelationshipSignalTopic.agentPhysicalSuffering,
      subject: AgentRelationshipSignalSubject.agent,
      confidence: 0.99,
      supportCount: 2,
      status: AgentRelationshipSignalStatus.active,
      assertionPolicy:
        AgentRelationshipSignalAssertionPolicy.userStateOnly,
      firstSeenAt: new Date('2026-07-27T08:00:00.000Z'),
      lastSeenAt: new Date('2026-07-28T08:00:00.000Z'),
    };
    service.agentRelationshipSignalService = {
      listSignals: jest.fn().mockResolvedValue([storedSignal]),
      selectRelevantSignals: jest.fn().mockReturnValue([storedSignal]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = conversation.agentId;
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '那你呢？现在身上还疼吗？',
    });

    expect(context.replyBrief.relationshipContext).toEqual([
      expect.objectContaining({
        key: 'concern.agent_physical_suffering',
        assertionPolicy: 'user_state_only',
      }),
    ]);
    expect(context.replyBrief.evidence).not.toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('多次表达'),
      })
    );
    expect(context.replyBrief.prompt).toContain('关系背景（不是主体事实）');
    expect(context.replyBrief.prompt).toContain(
      '不得据此推断疾病、伤口、病因或治疗经历'
    );
    expect(context.messages[0].content).not.toContain('关系背景（不是主体事实）');
    expect(context.messages[0].content).not.toContain(
      '不得据此推断疾病、伤口、病因或治疗经历'
    );
  });
});
