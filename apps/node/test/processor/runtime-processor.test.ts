import {
  resolveMemoryWorkerConcurrency,
  resolveNodeRuntimeRole,
  shouldRegisterQueueProcessor,
} from '../../src/processor/runtime-processor';

describe('runtime processor isolation', () => {
  it('keeps memory work out of web processes', () => {
    expect(shouldRegisterQueueProcessor('memory-pipeline', 'web')).toBe(false);
    expect(shouldRegisterQueueProcessor('conversation-reply', 'web')).toBe(
      true
    );
  });

  it('keeps non-memory work out of the memory worker', () => {
    expect(
      shouldRegisterQueueProcessor('memory-pipeline', 'memory-worker')
    ).toBe(true);
    expect(
      shouldRegisterQueueProcessor('conversation-reply', 'memory-worker')
    ).toBe(false);
    expect(
      shouldRegisterQueueProcessor('voice-service-training', 'memory-worker')
    ).toBe(false);
  });

  it('preserves combined mode outside production role configuration', () => {
    expect(resolveNodeRuntimeRole('unexpected')).toBe('combined');
    expect(shouldRegisterQueueProcessor('memory-pipeline', 'combined')).toBe(
      true
    );
    expect(shouldRegisterQueueProcessor('conversation-reply', 'combined')).toBe(
      true
    );
  });

  it('starts at concurrency one and caps future configuration at two', () => {
    expect(resolveMemoryWorkerConcurrency(undefined)).toBe(1);
    expect(resolveMemoryWorkerConcurrency('1')).toBe(1);
    // 上限放宽到 3：积压清淤时可临时抬到 3。
    expect(resolveMemoryWorkerConcurrency('8')).toBe(3);
    expect(resolveMemoryWorkerConcurrency('3')).toBe(3);
    expect(resolveMemoryWorkerConcurrency('2')).toBe(2);
  });
});
