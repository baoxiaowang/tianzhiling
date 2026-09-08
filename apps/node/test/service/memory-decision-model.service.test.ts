import { MemoryDecisionModelService } from '../../src/service/agents/memory-decision-model.service';

describe('independent memory model configuration', () => {
  const keys = [
    'NODE_MEMORY_MODEL',
    'NODE_MEMORY_API_KEY',
    'NODE_MEMORY_BASE_URL',
    'NODE_MEMORY_PROVIDER',
  ];
  let previous: Record<string, string | undefined>;
  beforeEach(() => {
    previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    keys.forEach(k => delete process.env[k]);
  });
  afterEach(() =>
    keys.forEach(k => {
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    })
  );
  it('reuses only provider credentials, not chat creativity, A/B or fallback settings', () => {
    const service = new MemoryDecisionModelService();
    const base = {
      enabled: true,
      model: 'character-model',
      apiKey: 'chat-test-key',
      temperature: 1,
      presencePenalty: 0.6,
      frequencyPenalty: 0.3,
      abModel: 'chat-b',
      secondaryFallback: {
        model: 'memory-model',
        apiKey: 'memory-test-key',
        baseURL: 'https://memory.example.invalid',
      },
    };
    service.providerConfig = base;
    service.configureMemoryModel();
    expect(service.openAIConfig).toMatchObject({
      enabled: true,
      model: 'memory-model',
      temperature: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      maxRetries: 0,
    });
    expect(service.openAIConfig.abModel).toBeUndefined();
    expect(service.openAIConfig.fallback).toBeUndefined();
    expect(base.temperature).toBe(1);
    expect(base.presencePenalty).toBe(0.6);
  });
  it('does not silently fall back to the visible chat model when unconfigured', () => {
    const service = new MemoryDecisionModelService();
    service.providerConfig = {
      enabled: true,
      model: 'character-model',
      apiKey: 'chat-test-key',
      baseURL: 'https://chat.example.invalid',
    };
    service.configureMemoryModel();
    expect(service.isEnabled()).toBe(false);
    expect(service.openAIConfig.model).toBeUndefined();
  });
  it('uses only its configured model and counts calls independently', async () => {
    const service = new MemoryDecisionModelService();
    service.providerConfig = {
      secondaryFallback: {
        model: 'memory-only',
        apiKey: 'fake',
        baseURL: 'https://example.invalid',
      },
    };
    service.configureMemoryModel();
    const create = jest
      .fn()
      .mockResolvedValue({
        choices: [{ message: { content: '{"decisions":[]}' } }],
      });
    (service as any).client = { chat: { completions: { create } } };
    const state = service.createModelCallAttribution();
    const result = await service.runWithModelCallAttribution(state, () =>
      service.generateText({ prompt: 'synthetic', model: 'character-model' })
    );
    expect(result.content).toBe('{"decisions":[]}');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'memory-only',
        response_format: { type: 'json_object' },
      })
    );
    expect(state.chatCompletions).toBe(1);
    expect(state.providerAttempts).toBe(1);
  });
});
