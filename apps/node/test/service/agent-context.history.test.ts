import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentContextService } from '../../src/service/agents/agent.context';

const CONVERSATION_ID = new MongoObjectId('665000000000000000000020');
const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');
const BASE_TIME = 1_700_000_000_000;

function createMessage(index: number, role?: MessageRole): MessageEntity {
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId(
      `6650000000000000000${String(index).padStart(5, '0')}`
    ),
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    role: role ?? (index % 2 === 0 ? MessageRole.user : MessageRole.assistant),
    type: MessageType.text,
    content: `历史消息${index}`,
    status: MessageStatus.sent,
    createdAt: new Date(BASE_TIME + index * 1000),
    updatedAt: new Date(BASE_TIME + index * 1000),
  });
  return message;
}

function buildService(messages: MessageEntity[]): AgentContextService {
  const service = new AgentContextService();
  service.messageModel = {
    find: jest.fn().mockResolvedValue(messages),
  } as never;
  service.retrieveService = {
    retrieveConversationMemories: jest.fn().mockResolvedValue([]),
  } as never;
  service.agentProfileFactService = {
    listFactsForPrompt: jest.fn().mockResolvedValue([]),
  } as never;
  return service;
}

function createConversation(): ConversationEntity {
  const conversation = new ConversationEntity();
  conversation.id = CONVERSATION_ID;
  conversation.agentId = AGENT_ID;
  conversation.userId = USER_ID;
  return conversation;
}

function buildOptions(conversation: ConversationEntity, currentQuery: string) {
  return {
    auth: {
      sub: String(USER_ID),
      accountId: '665000000000000000000101',
      account: 'test-account',
      iat: 0,
      exp: 0,
      nonce: 'test-nonce',
    },
    conversation,
    agent: null,
    currentQuery,
  } as never;
}

describe('AgentContextService history selection', () => {
  it('keeps complete recent turns and reports turn diagnostics', async () => {
    // 12 轮 × 2 条 = 24 条；最近 8 轮应保留为 16 条完整历史。
    const messages = Array.from({ length: 24 }, (_, index) =>
      createMessage(index)
    );
    const service = buildService(messages);

    const context = await service.buildConversationContext(
      buildOptions(createConversation(), '今天在家随便聊聊')
    );

    expect(context.diagnostics.historyTurnCount).toBe(8);
    expect(context.diagnostics.historyMessageCount).toBe(16);
    expect(context.diagnostics.historyPartialTurnRetained).toBe(false);
    expect(context.diagnostics.historyCoverageBoundaryVerifiable).toBe(true);
    expect(context.diagnostics.historyCoversSummaryBoundary).toBe(true);
    expect(context.diagnostics.historySummaryGapMessageCount).toBe(0);
    expect(context.diagnostics.historyLoadBoundaryTruncated).toBe(false);
    expect(context.diagnostics.historyLoadBoundaryTurnUnconfirmed).toBe(false);

    const contents = context.messages.map(message => message.content);
    expect(contents).toContain('历史消息8');
    expect(contents).not.toContain('历史消息0');
  });

  it('marks the load boundary incomplete when the oldest loaded message is an assistant', async () => {
    // 70 条超过 50+16 的有界加载量，且最早一条是助手消息。
    const messages = Array.from({ length: 70 }, (_, index) =>
      createMessage(index, index === 0 ? MessageRole.assistant : undefined)
    );
    const service = buildService(messages);

    const context = await service.buildConversationContext(
      buildOptions(createConversation(), '今天在家随便聊聊')
    );

    expect(context.diagnostics.historyLoadBoundaryTruncated).toBe(true);
    // 受截断影响的第 0 轮不在最近 8 轮窗口内，不折减确认完整轮数。
    expect(context.diagnostics.historyLoadBoundaryTurnUnconfirmed).toBe(false);
    expect(context.diagnostics.historyTurnCount).toBe(8);
  });

  it('marks coverage unverifiable when the summary covered id is not loaded', async () => {
    const messages = Array.from({ length: 24 }, (_, index) =>
      createMessage(index)
    );
    const service = buildService(messages);
    const conversation = createConversation();
    conversation.continuitySummary = '当前话题：测试';
    conversation.continuitySummaryCoveredMessageId = new MongoObjectId(
      '6650000000000000000009ff'
    );

    const context = await service.buildConversationContext(
      buildOptions(conversation, '今天在家随便聊聊')
    );

    expect(context.diagnostics.historyCoverageBoundaryVerifiable).toBe(false);
    expect(context.diagnostics.historyCoversSummaryBoundary).toBe(false);
  });
});
