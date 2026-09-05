import {
  AgentEntity,
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentChatToolService } from '../../src/service/agents/agent-chat-tool.service';

describe('AgentChatToolService', () => {
  const createContext = () => {
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId(),
      userId: new MongoObjectId(),
      agentId: new MongoObjectId(),
      conversationId: new MongoObjectId(),
      role: MessageRole.user,
      type: MessageType.text,
      status: MessageStatus.sent,
      content: '你还记得小雨和我们去过哪里吗',
      createdAt: new Date('2026-08-02T02:00:00.000Z'),
    });
    return {
      userId: message.userId,
      agentId: message.agentId,
      conversationId: message.conversationId,
      currentMessage: message,
      currentQuery: message.content,
      agent: Object.assign(new AgentEntity(), { name: '爸爸' }),
    };
  };

  it('batches profile and relationship evidence in one lookup', async () => {
    const service = new AgentChatToolService();
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([
        {
          id: 'memory-1',
          content: '用户说秋天和爸爸去过香山',
          createdAt: '2025-10-01T00:00:00.000Z',
          score: 0.86,
        },
      ]),
    } as never;
    service.agentProfileFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          id: 'family-1',
          type: AgentProfileFactType.family,
          key: 'family.shared_member.小雨.age',
          value: '小雨现在十一岁',
          polarity: AgentProfileFactPolarity.positive,
          confidence: AgentProfileFactConfidence.confirmed,
          priority: 3,
          status: AgentProfileFactStatus.active,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]),
    } as never;

    const result = await service.execute(
      'lookup_chat_evidence',
      {
        requests: [
          {
            subjectRef: '小雨',
            need: '年龄和共同经历',
            sources: ['family_facts', 'relationship_memory'],
          },
        ],
      },
      createContext()
    );

    expect(result.status).toBe('ok');
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factKey: 'family.shared_member.小雨.age',
          confidence: 0.92,
        }),
        expect.objectContaining({
          source: 'conversation_memory',
          confidence: 0.65,
          relevanceScore: 0.86,
        }),
      ])
    );
  });

  it('keeps retrieval read-only by rejecting write-shaped arguments', async () => {
    const service = new AgentChatToolService();
    const result = await service.execute(
      'lookup_chat_evidence',
      { rejectedFact: '西山', replacementFact: '香山' },
      createContext()
    );
    expect(result.status).toBe('invalid_arguments');
  });
});
