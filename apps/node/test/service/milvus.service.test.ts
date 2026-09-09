import { promises as dns } from 'dns';
import { MessageRole, MessageType, MongoObjectId } from '@tzl/entities';
import { MilvusService } from '../../src/service/rag/milvus.service';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

const mockedLookup = dns.lookup as jest.MockedFunction<typeof dns.lookup>;

describe('MilvusService endpoint protection', () => {
  let service: MilvusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MilvusService();
    service.milvusConfig = {
      enabled: true,
      address: 'standalone:19530',
      retrievalMode: 'active',
    };
    service.openAIConfig = {};
    service.openAIService = {
      hasEmbeddingConfig: jest.fn(() => true),
      createEmbedding: jest.fn(async () => [0.1, 0.2]),
    } as never;
    service.logger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    } as never;
  });

  it('suppresses revoked, expired, stale and wrong-person derived memories', async () => {
    const userId = '665000000000000000000001';
    const personId = '665000000000000000000002';
    const factId = '665000000000000000000003';
    const expiredId = '665000000000000000000004';
    const current = { id: new MongoObjectId(factId), agentId: new MongoObjectId(personId), value: '具体共同经历', governance: { version: 'memory_value_v1', revision: 2 } };
    service.governedFactModel = { find: jest.fn().mockResolvedValue([current, { ...current, id: new MongoObjectId(expiredId), governance: { ...current.governance, validUntil: '2000-01-01T00:00:00.000Z' } }]) } as any;
    const valid = { id: factId, personId, memoryKind: 'governed_fact', searchableText: current.value, sourceHash: '2' };
    const raw = { id: 'raw-message', memoryKind: 'raw_episode', searchableText: '原始消息' };
    const candidates = [raw, valid, { ...valid, sourceHash: '1' }, { ...valid, searchableText: '已过时的内容' }, { ...valid, personId: userId }, { ...valid, id: expiredId }, { ...valid, id: '665000000000000000000005' }];
    expect(await (service as any).filterGovernedEvidence(candidates, userId)).toEqual([raw, valid]);
    expect(service.governedFactModel.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: new MongoObjectId(userId), status: 'active' }), take: 6 }));
  });

  it('does not trip the vector circuit when source verification is unavailable', async () => {
    service.governedFactModel = { find: jest.fn().mockRejectedValue(new Error('source unavailable')) } as any;
    const raw = { id: 'raw-message', memoryKind: 'raw_episode', searchableText: '原始消息' };
    const derived = { id: '665000000000000000000003', memoryKind: 'governed_fact' };
    const failure = jest.spyOn(service as any, 'recordMilvusFailure');
    expect(await (service as any).filterGovernedEvidence([raw, derived], '665000000000000000000001')).toEqual([raw]);
    expect(failure).not.toHaveBeenCalled();
  });

  it('excludes legacy derived rows only for an explicitly enabled account', async () => {
    const userId='665000000000000000000001';
    const mode=process.env.NODE_MEMORY_VALUE_MODE, users=process.env.NODE_MEMORY_VALUE_USER_IDS;
    const raw={id:'raw',memoryKind:'raw_episode'}, legacy={id:'old',memoryKind:'relative_health'};
    try {
      process.env.NODE_MEMORY_VALUE_MODE='active';process.env.NODE_MEMORY_VALUE_USER_IDS=userId;
      expect(await (service as any).filterGovernedEvidence([raw,legacy],userId)).toEqual([raw]);
      expect(await (service as any).filterGovernedEvidence([raw,legacy],'665000000000000000000099')).toEqual([raw,legacy]);
    } finally {
      if(mode===undefined)delete process.env.NODE_MEMORY_VALUE_MODE;else process.env.NODE_MEMORY_VALUE_MODE=mode;
      if(users===undefined)delete process.env.NODE_MEMORY_VALUE_USER_IDS;else process.env.NODE_MEMORY_VALUE_USER_IDS=users;
    }
  });

  it('fails closed before creating embeddings or a Milvus client when DNS is unavailable', async () => {
    mockedLookup.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND standalone'), {
        code: 'ENOTFOUND',
      })
    );

    await service.indexConversationMessage({
      messageId: 'message-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      role: MessageRole.user,
      type: MessageType.text,
      searchableText: '需要记住的内容',
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    });

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(service.openAIService.createEmbedding).not.toHaveBeenCalled();
    expect(service.isEnabled()).toBe(true);

    await service.searchConversationMemories({
      query: '再次查询',
      userId: 'user-1',
      queryEmbedding: [0.1, 0.2],
    });

    expect(mockedLookup).toHaveBeenCalledTimes(1);
  });

  it('shares one DNS preflight across concurrent calls', async () => {
    let rejectLookup: (error: Error) => void = () => undefined;
    mockedLookup.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectLookup = reject;
        })
    );

    const first = service.searchConversationMemories({
      query: '第一条',
      userId: 'user-1',
      queryEmbedding: [0.1, 0.2],
    });
    const second = service.searchConversationMemories({
      query: '第二条',
      userId: 'user-1',
      queryEmbedding: [0.1, 0.2],
    });
    await Promise.resolve();
    rejectLookup(new Error('getaddrinfo ENOTFOUND standalone'));

    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(service.isEnabled()).toBe(true);
  });

  it('keeps a worker recoverable after one SDK timeout', () => {
    (
      service as unknown as {
        recordMilvusFailure(context: string, error: Error): void;
      }
    ).recordMilvusFailure(
      'search',
      new Error('milvus hasCollection timed out after 15000ms')
    );

    expect(service.isEnabled()).toBe(true);
  });

  it('deletes all semantic memories for one user with a scoped filter', async () => {
    const deleteEntities = jest.fn().mockResolvedValue({});
    (service as any).client = {
      connectPromise: Promise.resolve(),
      hasCollection: jest.fn().mockResolvedValue({ value: true }),
      delete: deleteEntities,
    };

    await expect(service.deleteUserMemories('user-1')).resolves.toBe(true);
    expect(deleteEntities).toHaveBeenCalledWith({
      collection_name: 'conversation_message_memory_v2',
      filter: 'userId == "user-1"',
    });
  });

  it('creates v2 storage with a user partition and Chinese analyzer', async () => {
    const createCollection = jest.fn().mockResolvedValue({});
    (service as any).client = {
      connectPromise: Promise.resolve(),
      hasCollection: jest.fn().mockResolvedValue({ value: false }),
      createCollection,
      loadCollection: jest.fn().mockResolvedValue({}),
    };

    await (service as any).doEnsureCollection(1536);
    const definition = createCollection.mock.calls[0][0];
    expect(definition.collection_name).toBe('conversation_message_memory_v2');
    expect(definition.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'userId', is_partition_key: true }),
        expect.objectContaining({
          name: 'searchableText',
          enable_analyzer: true,
          analyzer_params: { type: 'chinese' },
        }),
      ])
    );
  });
});
