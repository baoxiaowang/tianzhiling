import {
  MessageEntity,
  MessageRole,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { RetrieveService } from '../../src/service/rag/retrieve.service';

describe('RetrieveService', () => {
  it('skips embedding when Milvus retrieval is disabled', async () => {
    const service = new RetrieveService();
    service.logger = {
      warn: jest.fn(),
    } as never;
    service.openAIService = {
      hasEmbeddingConfig: jest.fn().mockReturnValue(true),
      createEmbedding: jest.fn(),
    } as never;
    service.milvusService = {
      isEnabled: jest.fn().mockReturnValue(false),
      searchConversationMemories: jest.fn(),
    } as never;

    await expect(
      service.retrieveConversationMemories({
        query: '爸爸你现在怎么样',
        userId: '665000000000000000000001',
        agentId: '665000000000000000000010',
      })
    ).resolves.toEqual([]);

    expect(service.openAIService.createEmbedding).not.toHaveBeenCalled();
    expect(
      service.milvusService.searchConversationMemories
    ).not.toHaveBeenCalled();
  });

  it('returns only user-authored memories as factual retrieval context', async () => {
    const service = new RetrieveService();
    const activeMessageId = new MongoObjectId('665000000000000000000101');
    const assistantMessageId = new MongoObjectId('665000000000000000000102');
    service.logger = {
      warn: jest.fn(),
    } as never;
    service.openAIService = {
      hasEmbeddingConfig: jest.fn().mockReturnValue(true),
      createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    } as never;
    service.milvusService = {
      searchConversationMemories: jest.fn().mockResolvedValue([
        {
          id: activeMessageId.toHexString(),
          searchableText: '用户想念爸爸做的鱼',
          role: MessageRole.user,
          type: MessageType.text,
          createdAtTs: new Date('2026-06-01T08:00:00.000Z').getTime(),
          score: 0.92,
        },
        {
          id: assistantMessageId.toHexString(),
          searchableText: '用户最爱吃红烧鲫鱼',
          role: MessageRole.assistant,
          type: MessageType.text,
          createdAtTs: new Date('2026-06-01T08:01:00.000Z').getTime(),
          score: 0.91,
        },
      ]),
    } as never;
    service.messageModel = {
      find: jest.fn().mockResolvedValue([
        Object.assign(new MessageEntity(), {
          id: activeMessageId,
          isArchived: false,
        }),
      ]),
    } as never;

    const memories = await service.retrieveConversationMemories({
      query: '想吃你做的鱼',
      userId: '665000000000000000000001',
      agentId: '665000000000000000000010',
    });

    expect(memories).toEqual([
      expect.objectContaining({
        content: '用户想念爸爸做的鱼',
        role: MessageRole.user,
        createdAt: '2026-06-01',
      }),
    ]);
    expect(JSON.stringify(memories)).not.toContain('红烧鲫鱼');
  });

  it('filters archived memories after vector retrieval', async () => {
    const service = new RetrieveService();
    const activeMessageId = new MongoObjectId('665000000000000000000201');
    const archivedMessageId = new MongoObjectId('665000000000000000000202');
    service.logger = {
      warn: jest.fn(),
    } as never;
    service.openAIService = {
      hasEmbeddingConfig: jest.fn().mockReturnValue(true),
      createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    } as never;
    service.milvusService = {
      searchConversationMemories: jest.fn().mockResolvedValue([
        {
          id: activeMessageId.toHexString(),
          searchableText: '用户说很想你',
          role: MessageRole.user,
          type: MessageType.text,
          createdAtTs: new Date('2026-06-01T08:00:00.000Z').getTime(),
          score: 0.92,
        },
        {
          id: archivedMessageId.toHexString(),
          searchableText: '归档掉的错误消息',
          role: MessageRole.user,
          type: MessageType.text,
          createdAtTs: new Date('2026-06-01T08:01:00.000Z').getTime(),
          score: 0.91,
        },
      ]),
    } as never;
    service.messageModel = {
      find: jest.fn().mockResolvedValue([
        Object.assign(new MessageEntity(), {
          id: activeMessageId,
          isArchived: false,
        }),
      ]),
    } as never;

    const memories = await service.retrieveConversationMemories({
      query: '想你',
      userId: '665000000000000000000001',
      agentId: '665000000000000000000010',
    });

    expect(service.messageModel.find).toHaveBeenCalledWith({
      where: {
        id: {
          $in: [activeMessageId, archivedMessageId],
        },
        isArchived: {
          $ne: true,
        },
      },
    });
    expect(memories).toEqual([
      expect.objectContaining({
        content: '用户说很想你',
      }),
    ]);
    expect(JSON.stringify(memories)).not.toContain('归档掉的错误消息');
  });

  it('keeps relevant long-term memories older than ninety days', async () => {
    const service = new RetrieveService();
    const messageId = new MongoObjectId('665000000000000000000301');
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      hasEmbeddingConfig: jest.fn().mockReturnValue(true),
      createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    } as never;
    service.milvusService = {
      searchConversationMemories: jest.fn().mockResolvedValue([
        {
          id: messageId.toHexString(),
          searchableText: '十年前你告诉我最喜欢院子里的桂花树',
          role: MessageRole.user,
          type: MessageType.text,
          createdAtTs: new Date('2016-09-05T00:00:00.000Z').getTime(),
          score: 0.02,
        },
      ]),
    } as never;
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([
          Object.assign(new MessageEntity(), {
            id: messageId,
            isArchived: false,
          }),
        ]),
    } as never;

    await expect(
      service.retrieveConversationMemories({
        query: '院子里的树',
        userId: '665000000000000000000001',
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: messageId.toHexString(),
        createdAt: '2016-09-05',
      }),
    ]);
  });

  it('returns person-scoped units before raw fallback and applies separate score floors', async () => {
    const service = new RetrieveService();
    const sourceA = new MongoObjectId('665000000000000000000401');
    const sourceB = new MongoObjectId('665000000000000000000402');
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      hasEmbeddingConfig: jest.fn().mockReturnValue(true),
      createEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]),
    } as never;
    service.milvusService = {
      getRelevancePolicy: jest.fn().mockReturnValue({
        personMinScore: 0.02,
        rawMinScore: 0.025,
      }),
      searchConversationMemories: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'person-unit-1',
            sourceMessageId: sourceA.toString(),
            personId: 'person-1',
            memoryKind: 'health_update',
            searchableText: '安安：最近退烧了',
            role: MessageRole.user,
            type: MessageType.text,
            createdAtTs: Date.now(),
            score: 0.03,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: sourceB.toString(),
            sourceMessageId: sourceB.toString(),
            memoryKind: 'raw_episode',
            searchableText: '安安以前发烧了',
            role: MessageRole.user,
            type: MessageType.text,
            createdAtTs: Date.now(),
            score: 0.026,
          },
        ]),
    } as never;
    service.messageModel = {
      find: jest.fn(async ({ where }) =>
        where.id.$in.map((id: MongoObjectId) =>
          Object.assign(new MessageEntity(), { id, isArchived: false })
        )
      ),
    } as never;

    const result = await service.retrieveConversationMemoriesDetailed({
      query: '安安身体怎么样',
      userId: 'user-1',
      personId: 'person-1',
      limit: 2,
    });

    expect(result.items.map(item => item.memoryKind)).toEqual([
      'health_update',
      'raw_episode',
    ]);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({ personScopedCount: 1, rawFallbackCount: 1 })
    );
  });
});
