import { MainConfiguration } from '../src/configuration';
import { MEMORY_PIPELINE_QUEUE } from '../src/service/memory-pipeline-task.service';

describe('memory pipeline startup reconciliation', () => {
  it('recreates a stale scheduler and dispatches an immediate reconciliation', async () => {
    const now = 1_788_659_800_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const queue = {
      name: MEMORY_PIPELINE_QUEUE,
      getJobScheduler: jest.fn().mockResolvedValue({ next: now - 120_000 }),
      removeJobScheduler: jest.fn().mockResolvedValue(true),
      addJobToQueue: jest.fn().mockResolvedValue({}),
    };
    const configuration = new MainConfiguration();
    configuration.logger = { warn: jest.fn() } as never;
    configuration.bullmqFramework = {
      getQueue: jest.fn((name: string) =>
        name === MEMORY_PIPELINE_QUEUE ? queue : undefined
      ),
    } as never;

    await configuration.onServerReady();

    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      MEMORY_PIPELINE_QUEUE
    );
    expect(queue.addJobToQueue).toHaveBeenCalledTimes(2);
    expect(queue.addJobToQueue).toHaveBeenLastCalledWith(
      { reconcile: true },
      expect.objectContaining({
        jobId: expect.stringContaining('-startup-'),
        removeOnComplete: true,
      })
    );
  });

  it('keeps a healthy scheduler and still performs startup reconciliation', async () => {
    const now = 1_788_659_800_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const queue = {
      name: MEMORY_PIPELINE_QUEUE,
      getJobScheduler: jest.fn().mockResolvedValue({ next: now + 30_000 }),
      removeJobScheduler: jest.fn(),
      addJobToQueue: jest.fn().mockResolvedValue({}),
    };
    const configuration = new MainConfiguration();
    configuration.logger = { warn: jest.fn() } as never;
    configuration.bullmqFramework = {
      getQueue: jest.fn((name: string) =>
        name === MEMORY_PIPELINE_QUEUE ? queue : undefined
      ),
    } as never;

    await configuration.onServerReady();

    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    expect(queue.addJobToQueue).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
