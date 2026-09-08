import { memoryBudgetSnapshot } from '../../src/service/memory-resource-budget';
jest.mock('fs', () => ({ readFileSync: () => 'MemAvailable: 6291456 kB\n' }));
jest.mock('os', () => ({ freemem: () => 6 * 1024 ** 3 }));
jest.mock('v8', () => ({
  getHeapStatistics: () => ({ heap_size_limit: 4 * 1024 ** 3 }),
}));
describe('4GB worker memory budget', () => {
  const original = process.env.NODE_MEMORY_MAX_RSS_MB;
  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.NODE_MEMORY_MAX_RSS_MB;
    else process.env.NODE_MEMORY_MAX_RSS_MB = original;
  });
  function usage(rss: number, heap: number) {
    jest
      .spyOn(process, 'memoryUsage')
      .mockReturnValue({
        rss: rss * 1024 ** 2,
        heapUsed: heap * 1024 ** 2,
        heapTotal: heap * 1024 ** 2,
        external: 0,
        arrayBuffers: 0,
      });
  }
  it('allows a 2GB RSS worker under an explicit 4608MB RSS budget', () => {
    process.env.NODE_MEMORY_MAX_RSS_MB = '4608';
    usage(2048, 1536);
    expect(memoryBudgetSnapshot().allowed).toBe(true);
  });
  it('still pauses near the heap limit', () => {
    process.env.NODE_MEMORY_MAX_RSS_MB = '4608';
    usage(4000, 3500);
    expect(memoryBudgetSnapshot().allowed).toBe(false);
  });
  it('still pauses on RSS pressure or invalid configuration', () => {
    process.env.NODE_MEMORY_MAX_RSS_MB = '4608';
    usage(4700, 2000);
    expect(memoryBudgetSnapshot().allowed).toBe(false);
    process.env.NODE_MEMORY_MAX_RSS_MB = 'invalid';
    expect(memoryBudgetSnapshot().allowed).toBe(false);
  });
});
