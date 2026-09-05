import { promises as dns } from 'dns';
import { MessageRole, MessageType } from '@tzl/entities';
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
    expect(service.isEnabled()).toBe(false);

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
    expect(service.isEnabled()).toBe(false);
  });

  it('permanently disables the process after an SDK timeout', () => {
    (
      service as unknown as {
        recordMilvusFailure(context: string, error: Error): void;
      }
    ).recordMilvusFailure(
      'search',
      new Error('milvus hasCollection timed out after 15000ms')
    );

    expect(service.isEnabled()).toBe(false);
  });
});
