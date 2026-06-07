import { MessageRole, MessageType } from '@tzl/entities';
import { RetrieveService } from '../../src/service/rag/retrieve.service';

describe('RetrieveService', () => {
  it('returns only user-authored memories as factual retrieval context', async () => {
    const service = new RetrieveService();
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
          searchableText: '用户想念爸爸做的鱼',
          role: MessageRole.user,
          type: MessageType.text,
          createdAtTs: new Date('2026-06-01T08:00:00.000Z').getTime(),
          score: 0.92,
        },
        {
          searchableText: '用户最爱吃红烧鲫鱼',
          role: MessageRole.assistant,
          type: MessageType.text,
          createdAtTs: new Date('2026-06-01T08:01:00.000Z').getTime(),
          score: 0.91,
        },
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
});
