import { MemoryPipelineTaskKind, MongoObjectId } from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';
import { OpenAIService } from '../../src/service/agents/openai';

describe('memory pipeline observability', () => {
  it('includes calls from the separate memory client in job attribution', async () => {
    const service = new ConversationService();
    service.logger = { info: jest.fn() } as any;
    service.openAIService = new OpenAIService();
    const memoryModel = new OpenAIService();
    memoryModel.openAIConfig = { embeddingModel: 'embedding-test', embeddingDimensions: 2 };
    (memoryModel as any).getEmbeddingClient = () => ({ embeddings: { create: jest.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] }) } });
    service.memoryValueService = { openAIService: memoryModel } as any;
    (service as any).executeMemoryPipelineTask = async () => { await memoryModel.createEmbedding({ input: 'test' }); return 'completed'; };
    await service.processMemoryPipelineTask({ id: new MongoObjectId(), kind: MemoryPipelineTaskKind.structuredMemory } as any);
    const args = (service.logger.info as jest.Mock).mock.calls[0];
    expect(args[5]).toBe(1);
    expect(args[8]).toBe(1);
  });
  it('attributes embedding model calls within the current async job', async () => {
    const service = new OpenAIService();
    service.openAIConfig = {
      embeddingModel: 'embedding-test',
      embeddingDimensions: 2,
    };
    (
      service as unknown as { getEmbeddingClient: () => unknown }
    ).getEmbeddingClient = () => ({
      embeddings: {
        create: jest.fn().mockResolvedValue({
          data: [{ embedding: [0.1, 0.2] }],
        }),
      },
    });
    const attribution = service.createModelCallAttribution();

    await service.runWithModelCallAttribution(attribution, () =>
      service.createEmbedding({ input: 'family memory' })
    );

    expect(attribution.embeddings).toBe(1);
    expect(attribution.providerAttempts).toBe(0);
  });

  it('records task outcome, model calls and memory deltas', async () => {
    const service = new ConversationService();
    const logger = { info: jest.fn() };
    service.logger = logger as never;
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(null),
    } as never;
    service.openAIService = new OpenAIService();
    const task = {
      id: new MongoObjectId(),
      kind: MemoryPipelineTaskKind.structuredMemory,
    } as never;

    await expect(service.processMemoryPipelineTask(task)).resolves.toBe(
      'skipped'
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[memory-pipeline-metrics]'),
      expect.any(String),
      MemoryPipelineTaskKind.structuredMemory,
      'skipped',
      expect.any(Number),
      0,
      0,
      0,
      0,
      0,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });
});
