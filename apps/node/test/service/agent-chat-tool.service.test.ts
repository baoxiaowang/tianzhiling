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
  const createContext = (query = '不是西山，是香山') => {
    const message = new MessageEntity();
    message.id = new MongoObjectId();
    message.userId = new MongoObjectId();
    message.agentId = new MongoObjectId();
    message.conversationId = new MongoObjectId();
    message.role = MessageRole.user;
    message.type = MessageType.text;
    message.status = MessageStatus.sent;
    message.content = query;
    message.createdAt = new Date('2026-08-02T02:00:00.000Z');

    return {
      userId: message.userId,
      agentId: message.agentId,
      conversationId: message.conversationId,
      currentMessage: message,
      currentQuery: query,
      previousAssistantContent: '那年我们去过西山。',
      agent: Object.assign(new AgentEntity(), { name: '爸爸' }),
    };
  };

  it('returns relationship memories with source, time and confidence', async () => {
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
    } as any;

    const result = await service.execute(
      'lookup_chat_evidence',
      {
        requests: [
          {
            subjectRef: '爸爸',
            need: '秋天去过的地方',
            sources: ['relationship_memory'],
          },
        ],
      },
      createContext()
    );

    expect(result.status).toBe('ok');
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        source: 'conversation_memory',
        sourceAt: '2025-10-01T00:00:00.000Z',
        confidence: 0.86,
        conflictStatus: 'unknown',
      })
    );
  });

  it('returns confirmed family facts without mixing persona evidence', async () => {
    const service = new AgentChatToolService();
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
        {
          id: 'style-1',
          type: AgentProfileFactType.style,
          key: 'style.tone',
          value: '说话直接',
          polarity: AgentProfileFactPolarity.positive,
          confidence: AgentProfileFactConfidence.confirmed,
          priority: 2,
          status: AgentProfileFactStatus.active,
        },
      ]),
    } as any;

    const result = await service.execute(
      'lookup_chat_evidence',
      {
        requests: [
          {
            subjectRef: '小雨',
            need: '年龄',
            sources: ['family_facts'],
          },
        ],
      },
      createContext()
    );

    expect(result.status).toBe('ok');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        factKey: 'family.shared_member.小雨.age',
        value: '小雨现在十一岁',
        conflictStatus: 'none',
      })
    );
  });

  it('rejects the retired correction write interface', async () => {
    const service = new AgentChatToolService();

    const result = await service.execute(
      'lookup_chat_evidence',
      {
        subjectRef: '爸爸',
        correctionKind: 'memory',
        rejectedFact: '西山',
        replacementFact: '香山',
      },
      createContext()
    );

    expect(result.status).toBe('invalid_arguments');
  });

  it('rejects an evidence request without an allowed source', async () => {
    const service = new AgentChatToolService();

    const result = await service.execute(
      'lookup_chat_evidence',
      {
        requests: [{ subjectRef: '爸爸', need: '地点', sources: ['write'] }],
      },
      createContext('我们还去过香山')
    );

    expect(result.status).toBe('invalid_arguments');
  });
});
