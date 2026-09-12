import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskStatus,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { MemoryPipelineTaskService } from '../../src/service/memory-pipeline-task.service';
import { MemoryPipelineProcessor } from '../../src/processor/memory-pipeline.processor';
import { memoryBudgetSnapshot } from '../../src/service/memory-resource-budget';

jest.mock('../../src/service/memory-resource-budget', () => ({ memoryBudgetSnapshot: jest.fn(() => ({ allowed: true })) }));

describe('MemoryPipelineTaskService', () => {
  it('persists an idempotent task before dispatching it', async () => {
    const service = new MemoryPipelineTaskService();
    let stored: MemoryPipelineTaskEntity | null = null;
    const addJobToQueue = jest.fn().mockResolvedValue(undefined);
    service.logger = { warn: jest.fn() } as never;
    service.taskModel = {
      findOne: jest.fn(async () => stored),
      save: jest.fn(async value => {
        value.id = new MongoObjectId('665000000000000000000401');
        stored = value;
        return value;
      }),
    } as never;
    service.bullmqFramework = {
      getQueue: jest.fn(() => ({ addJobToQueue })),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000402'),
      conversationId: new MongoObjectId('665000000000000000000403'),
      userId: new MongoObjectId('665000000000000000000404'),
      agentId: new MongoObjectId('665000000000000000000405'),
    });

    const first = await service.enqueueForMessage(
      message,
      ' 需要   长期记住的内容 ',
      [MemoryPipelineTaskKind.semanticIndex]
    );
    const second = await service.enqueueForMessage(
      message,
      '需要 长期记住的内容',
      [MemoryPipelineTaskKind.semanticIndex]
    );

    expect(first[0]).toBe(second[0]);
    expect(first[0]).toMatchObject({
      status: MemoryPipelineTaskStatus.pending,
      attemptCount: 0,
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(service.taskModel.save).toHaveBeenCalledTimes(1);
    expect(addJobToQueue).toHaveBeenCalled();
  });
});

describe('MemoryPipelineTaskService queue resolution', () => {
  it('resolves the queue once and reuses it', async () => {
    // createQueue 每次都会 new 一个队列并覆盖缓存，旧实例的连接与定时器不会关闭；
    // 这条路径在每条消息上，所以必须只解析一次。
    const service = new MemoryPipelineTaskService();
    const addJobToQueue = jest.fn().mockResolvedValue(undefined);
    const queue = { addJobToQueue };
    const createQueue = jest.fn(() => queue);
    service.logger = { warn: jest.fn() } as never;
    service.bullmqFramework = {
      getQueue: jest.fn(() => undefined),
      createQueue,
    } as never;
    const task = Object.assign(new MemoryPipelineTaskEntity(), {
      id: new MongoObjectId('665000000000000000000421'),
      status: MemoryPipelineTaskStatus.pending,
    });

    await service.requeueDueTask(task);
    await service.requeueDueTask(task);

    expect(createQueue).toHaveBeenCalledTimes(1);
    expect(addJobToQueue).toHaveBeenCalledTimes(2);
    // 积压重排走低优先级（数字越大越靠后）。
    expect(addJobToQueue.mock.calls[0][1].priority).toBe(1000);
  });

  it('enqueues a fresh message task with the highest priority', async () => {
    const service = new MemoryPipelineTaskService();
    const addJobToQueue = jest.fn().mockResolvedValue(undefined);
    service.logger = { warn: jest.fn() } as never;
    let stored: MemoryPipelineTaskEntity | null = null;
    service.taskModel = {
      findOne: jest.fn(async () => stored),
      save: jest.fn(async value => {
        value.id = new MongoObjectId('665000000000000000000431');
        stored = value;
        return value;
      }),
    } as never;
    service.bullmqFramework = {
      getQueue: jest.fn(() => ({ addJobToQueue })),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000432'),
      conversationId: new MongoObjectId('665000000000000000000433'),
      userId: new MongoObjectId('665000000000000000000434'),
      agentId: new MongoObjectId('665000000000000000000435'),
    });

    await service.enqueueForMessage(message, '刚说的一句话', [
      MemoryPipelineTaskKind.semanticIndex,
    ]);

    expect(addJobToQueue).toHaveBeenCalledTimes(1);
    // 新消息的任务优先级最高，保证"刚说的话"排到积压之前。
    expect(addJobToQueue.mock.calls[0][1].priority).toBe(1);
  });
});

describe('MemoryPipelineProcessor', () => {
  beforeEach(() => (memoryBudgetSnapshot as jest.Mock).mockReturnValue({ allowed: true }));
  it('leaves durable work unclaimed when the memory budget is exhausted', async () => {
    (memoryBudgetSnapshot as jest.Mock).mockReturnValue({ allowed: false });
    const processor = new MemoryPipelineProcessor();
    processor.memoryPipelineTaskService = { claimTask: jest.fn() } as any;
    processor.conversationService = { processMemoryPipelineTask: jest.fn() } as any;
    await processor.execute({ taskId: '665000000000000000000411' });
    expect(processor.memoryPipelineTaskService.claimTask).not.toHaveBeenCalled();
    expect(processor.conversationService.processMemoryPipelineTask).not.toHaveBeenCalled();
  });
  it('re-enqueues due tasks during reconciliation instead of running them inline', async () => {
    // 协调任务必须只入队：过去它在这里逐个 await 处理（25 个任务 × 3–5 秒），
    // 一次协调要跑 1–2 分钟，超过它自己 60 秒的周期，于是互相堆叠、CPU 打满。
    const processor = new MemoryPipelineProcessor();
    const first = Object.assign(new MemoryPipelineTaskEntity(), {
      id: new MongoObjectId('665000000000000000000411'),
    });
    const second = Object.assign(new MemoryPipelineTaskEntity(), {
      id: new MongoObjectId('665000000000000000000412'),
    });
    const requeueDueTask = jest
      .fn()
      .mockRejectedValueOnce(new Error('queue hiccup'))
      .mockResolvedValueOnce(undefined);
    processor.memoryPipelineTaskService = {
      getDueTasks: jest.fn().mockResolvedValue([first, second]),
      requeueDueTask,
      claimTask: jest.fn(),
    } as never;
    processor.conversationService = {
      processMemoryPipelineTask: jest.fn(),
    } as never;

    await expect(
      processor.execute({ reconcile: true })
    ).resolves.toBeUndefined();
    expect(requeueDueTask).toHaveBeenCalledTimes(2);
    // 一个坏任务不影响其余任务重排。
    expect(requeueDueTask).toHaveBeenNthCalledWith(1, first);
    expect(requeueDueTask).toHaveBeenNthCalledWith(2, second);
    // 协调任务自己不执行任何任务。
    expect(processor.memoryPipelineTaskService.claimTask).not.toHaveBeenCalled();
    expect(
      processor.conversationService.processMemoryPipelineTask
    ).not.toHaveBeenCalled();
  });
});
