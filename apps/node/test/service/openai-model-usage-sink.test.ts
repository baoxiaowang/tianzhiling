import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskStatus,
  MongoObjectId,
} from '@tzl/entities';
import { OpenAIService } from '../../src/service/agents/openai';
import { ConversationService } from '../../src/service/conversation.service';
import { MemoryPipelineTaskService } from '../../src/service/memory-pipeline-task.service';

function createOpenAIService(usage: unknown) {
  const service = new OpenAIService();
  (service as any).openAIConfig = {
    memory: {
      apiKey: 'k',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    },
  };
  service.logger = { info: jest.fn(), warn: jest.fn() } as never;
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: '[]' } }],
    usage,
  });
  (service as any).memoryClient = { chat: { completions: { create } } };
  return { service, create };
}

describe('OpenAIService per-call usage sink', () => {
  it('有 usage 时回调 sink，并带存在性感知的 cachedPromptTokens', async () => {
    const { service } = createOpenAIService({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 64 },
    });
    const onModelUsage = jest.fn();
    const attribution = service.createModelCallAttribution();
    attribution.onModelUsage = onModelUsage;

    await service.runWithModelCallAttribution(attribution, () =>
      service.generateMemoryText({ prompt: 'x', systemPrompt: 'y' })
    );

    expect(onModelUsage).toHaveBeenCalledTimes(1);
    expect(onModelUsage).toHaveBeenCalledWith({
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedPromptTokens: 64,
    });
  });

  it('usage 缺失时不触发 sink（不造 0）', async () => {
    const { service } = createOpenAIService(undefined);
    const onModelUsage = jest.fn();
    const attribution = service.createModelCallAttribution();
    attribution.onModelUsage = onModelUsage;

    await service.runWithModelCallAttribution(attribution, () =>
      service.generateMemoryText({ prompt: 'x' })
    );

    expect(onModelUsage).not.toHaveBeenCalled();
  });
});

describe('ConversationService memory task usage wiring', () => {
  it('把 generateMemoryText 的 usage 落到任务 $inc', async () => {
    const { service: openAIService } = createOpenAIService({
      prompt_tokens: 200,
      completion_tokens: 20,
      total_tokens: 220,
      prompt_cache_hit_tokens: 128,
    });

    const taskModel = {
      updateOne: jest.fn(async (_query: unknown, _update: unknown) => ({})),
    };
    const memoryTaskService = new MemoryPipelineTaskService();
    (memoryTaskService as any).taskModel = taskModel;
    (memoryTaskService as any).logger = {
      info: jest.fn(),
      warn: jest.fn(),
    };

    const service = new ConversationService();
    const svc = service as any;
    svc.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    svc.openAIService = openAIService;
    svc.memoryPipelineTaskService = memoryTaskService;
    svc.memoryValueService = undefined;
    svc.executeMemoryPipelineTask = jest.fn(async () => {
      await openAIService.generateMemoryText({
        prompt: 'x',
        systemPrompt: 'y',
      });
      return 'completed';
    });

    const task = new MemoryPipelineTaskEntity();
    Object.assign(task, {
      id: new MongoObjectId('665000000000000000000100'),
      kind: MemoryPipelineTaskKind.structuredMemory,
      status: MemoryPipelineTaskStatus.pending,
      userId: new MongoObjectId('665000000000000000000001'),
    });

    const result = await service.processMemoryPipelineTask(task);
    expect(result).toBe('completed');
    // sink 是 fire-and-forget；等一轮微任务确保旁路 updateOne 已发出。
    await new Promise(resolve => setImmediate(resolve));

    expect(taskModel.updateOne).toHaveBeenCalledTimes(1);
    const update = taskModel.updateOne.mock.calls[0][1] as any;
    expect(update.$inc).toMatchObject({
      modelCalls: 1,
      promptTokens: 200,
      completionTokens: 20,
      cachedPromptTokens: 128,
    });
  });
});
