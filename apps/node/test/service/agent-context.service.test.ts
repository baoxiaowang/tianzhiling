import { AgentContextService } from '../../src/service/agents/agent.context';
import {
  AgentEntity,
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
    expect(systemMessage.content).toContain('当前北京时间是');
    expect(systemMessage.content).toContain('以下是长期久远的历史');
    expect(systemMessage.content).toContain('[2026-05-30][用户原话]');
    expect(systemMessage.content).toContain(
      '[2026-05-29][历史助手回复-非事实来源]'
    );
    expect(systemMessage.content).toContain(
      '历史助手回复只能当作对话氛围参考'
    );
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
      content: '早安媳妇儿',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:01:00.000Z'),
      updatedAt: new Date('2026-05-30T08:01:00.000Z'),
    });
    service.messageModel = {
      find: jest.fn().mockResolvedValue([badAssistantMessage, goodAssistantMessage]),
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
          content: expect.stringContaining('早安媳妇儿'),
        }),
      ])
    );
    expect(JSON.stringify(context.messages)).toContain('历史助手回复，仅供理解对话顺序和语气');
    expect(JSON.stringify(context.messages)).toContain('不是事实来源');
    expect(JSON.stringify(context.messages)).not.toContain('aiDeceased');
    expect(JSON.stringify(context.messages)).not.toContain('zk.yaoxuankeji.club');
  });
});
