import { OpenAIService } from '../../src/service/agents/openai';

function createService() {
  const service = new OpenAIService();
  service.logger = { info: jest.fn(), warn: jest.fn() } as never;
  (service as unknown as Record<string, unknown>).openAIConfig = {};
  (service as unknown as Record<string, unknown>).getClient = () => ({
    name: 'primary',
  });
  (service as unknown as Record<string, unknown>).resolveFallbackProvider =
    () => ({ client: { name: 'fallback' }, model: 'deepseek-v4-flash' });
  (
    service as unknown as Record<string, unknown>
  ).resolveSecondaryFallbackProvider = () => ({
    client: { name: 'secondary' },
    model: 'qwen-plus',
  });
  return service;
}

function runChain(
  service: OpenAIService,
  task: (client: unknown, body: unknown, label: string) => Promise<unknown>
) {
  const runner = (
    service as unknown as {
      tryPrimaryThenFallback<T>(
        task: (client: unknown, body: unknown, label: string) => Promise<T>,
        primaryBody: unknown,
        fallbackBody?: unknown
      ): Promise<T>;
    }
  ).tryPrimaryThenFallback.bind(service);

  return runner(task, {}, {});
}

describe('OpenAIService provider fallback chain', () => {
  it('falls through primary -> fallback -> secondary until one succeeds', async () => {
    const service = createService();
    const labels: string[] = [];
    const task = jest.fn(
      async (_client: unknown, _body: unknown, label: string) => {
        labels.push(label);
        if (label !== 'secondary') {
          throw new Error(`${label} provider unavailable`);
        }
        return { ok: true };
      }
    );

    await expect(runChain(service, task)).resolves.toEqual({ ok: true });
    expect(labels).toEqual(['primary', 'fallback', 'secondary']);
  });

  it('does not touch later providers when the primary succeeds', async () => {
    const service = createService();
    const labels: string[] = [];
    const task = jest.fn(
      async (_client: unknown, _body: unknown, label: string) => {
        labels.push(label);
        return { ok: true };
      }
    );

    await expect(runChain(service, task)).resolves.toEqual({ ok: true });
    expect(labels).toEqual(['primary']);
  });

  it('uses the fallback when the primary fails', async () => {
    const service = createService();
    const labels: string[] = [];
    const task = jest.fn(
      async (_client: unknown, _body: unknown, label: string) => {
        labels.push(label);
        if (label === 'primary') {
          throw new Error('primary unavailable');
        }
        return { ok: true };
      }
    );

    await expect(runChain(service, task)).resolves.toEqual({ ok: true });
    expect(labels).toEqual(['primary', 'fallback']);
  });

  it('throws the last provider error when every provider fails', async () => {
    const service = createService();
    const task = jest.fn(
      async (_client: unknown, _body: unknown, label: string) => {
        throw new Error(`${label} unavailable`);
      }
    );

    await expect(runChain(service, task)).rejects.toThrow(
      'secondary unavailable'
    );
  });
});
