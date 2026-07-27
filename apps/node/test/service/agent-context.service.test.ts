import { AgentContextService } from '../../src/service/agents/agent.context';
import {
  AgentEntity,
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

  it('injects only matched reply scene strategies into the system prompt', async () => {
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

    expect(systemMessage.content).toContain('本轮命中的回复策略');
    expect(systemMessage.content).toContain('主场景：旧事回忆/共同经历');
    expect(systemMessage.content).toContain('不要反复让用户“讲讲/多说点”');
    expect(systemMessage.content).not.toContain('主场景：那边/离世状态/祭扫');
    expect(systemMessage.content).not.toContain('策略：用户问“那边/天堂/过得好吗');
  });

  it('injects current high-risk emotion state into system prompt and scene routing', async () => {
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

    expect(systemMessage.content).toContain('当前用户情绪状态');
    expect(systemMessage.content).toContain('风险等级：高');
    expect(systemMessage.content).toContain('优先制止、稳定');
    expect(systemMessage.content).toContain('主场景：情绪崩溃/轻生危机');
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
    expect(systemMessage.content).toContain('主场景：家庭近况/亲属事务');
    expect(systemMessage.content).not.toContain('主场景：思念倾诉');
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
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([badAssistantMessage, goodAssistantMessage]),
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
    expect(historyMessage?.content).toContain(
      '被引用的AI回复：你以前总爱吃辣'
    );
    expect(historyMessage?.content).toContain(
      '用户本次要表达的内容：我不爱吃辣'
    );
    expect(historyMessage?.content).toContain(
      '不要把被引用内容当作用户本次新说的话'
    );
  });
});
