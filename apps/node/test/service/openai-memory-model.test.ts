import { OpenAIService } from '../../src/service/agents/openai';

describe('OpenAIService memory model channel', () => {
  function createService(memory?: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
  }) {
    const service = new OpenAIService();
    (service as any).openAIConfig = memory ? { memory } : {};
    return service;
  }

  it('reports disabled when the memory provider is incomplete', () => {
    expect(createService().isMemoryModelEnabled()).toBe(false);
    expect(
      createService({ apiKey: 'k', baseURL: 'https://api.deepseek.com' })
        .isMemoryModelEnabled()
    ).toBe(false);
  });

  it('routes memory extraction to the dedicated provider and disables thinking', async () => {
    const service = createService({
      apiKey: 'k',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    });
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '[]' } }],
      usage: { total_tokens: 12 },
    });
    (service as any).memoryClient = {
      chat: { completions: { create } },
    };

    await expect(
      service.generateMemoryText({
        systemPrompt: '只输出 JSON',
        prompt: '抽取事实',
        temperature: 0,
        topP: 0.1,
        maxTokens: 400,
      })
    ).resolves.toMatchObject({ content: '[]' });
    expect(service.isMemoryModelEnabled()).toBe(true);
    expect(service.getMemoryModel()).toBe('deepseek-flash');
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0][0];
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      max_tokens: 400,
      thinking: { type: 'disabled' },
    });
    expect(body.messages[0]).toMatchObject({
      role: 'system',
      content: '只输出 JSON',
    });
  });

  it('throws when the memory provider is not configured', async () => {
    const service = createService();
    await expect(
      service.generateMemoryText({ prompt: 'x' })
    ).rejects.toThrow('memory model is not configured');
  });
});
