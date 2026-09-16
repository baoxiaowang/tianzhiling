import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskStatus,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import {
  MemoryPipelineTaskService,
  resolveBeijingDayKey,
} from '../../src/service/memory-pipeline-task.service';
import { MemoryPipelineProcessor } from '../../src/processor/memory-pipeline.processor';
import { memoryBudgetSnapshot } from '../../src/service/memory-resource-budget';
import { ConversationService } from '../../src/service/conversation.service';

jest.mock('../../src/service/memory-resource-budget', () => ({
  memoryBudgetSnapshot: jest.fn(() => ({ allowed: true })),
}));

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
  beforeEach(() =>
    (memoryBudgetSnapshot as jest.Mock).mockReturnValue({ allowed: true })
  );
  it('leaves durable work deferred when the memory budget is exhausted', async () => {
    (memoryBudgetSnapshot as jest.Mock).mockReturnValue({ allowed: false });
    const processor = new MemoryPipelineProcessor();
    const beginTaskExecution = jest.fn().mockResolvedValue({
      task: null,
      deferredReason: 'resource_guard',
    });
    processor.memoryPipelineTaskService = { beginTaskExecution } as any;
    processor.conversationService = {
      processMemoryPipelineTask: jest.fn(),
    } as any;
    await processor.execute({ taskId: '665000000000000000000411' });
    // 执行前检查资源守卫：未获准只延期，不领取、不调用模型
    expect(beginTaskExecution).toHaveBeenCalledWith(
      '665000000000000000000411',
      { budgetAllowed: false }
    );
    expect(
      processor.conversationService.processMemoryPipelineTask
    ).not.toHaveBeenCalled();
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
    expect(
      processor.memoryPipelineTaskService.claimTask
    ).not.toHaveBeenCalled();
    expect(
      processor.conversationService.processMemoryPipelineTask
    ).not.toHaveBeenCalled();
  });
});

describe('未了结清单的日任务排期', () => {
  function buildService() {
    const service = new MemoryPipelineTaskService();
    const rows: MemoryPipelineTaskEntity[] = [];
    let seq = 0;
    const matches = (
      row: MemoryPipelineTaskEntity,
      where: Record<string, unknown>
    ) =>
      Object.keys(where).every(
        key =>
          String((row as never as Record<string, unknown>)[key]) ===
          String(where[key])
      );
    service.logger = { warn: jest.fn() } as never;
    service.taskModel = {
      findOne: jest.fn(async (options: { where: Record<string, unknown> }) =>
        rows.find(row => matches(row, options.where))
      ),
      save: jest.fn(async (value: MemoryPipelineTaskEntity) => {
        if (!value.id) {
          seq += 1;
          value.id = new MongoObjectId(
            `${String(seq).padStart(24, '0')}`
          ) as never;
        }
        const index = rows.findIndex(
          row => String(row.id) === String(value.id)
        );
        if (index === -1) rows.push(value);
        else rows[index] = value;
        return value;
      }),
    } as never;
    return {
      service,
      getStored: () => rows[0],
      count: () => rows.length,
    };
  }

  const userId = new MongoObjectId('665000000000000000000601');
  const conversationId = new MongoObjectId('665000000000000000000602');
  const agentId = new MongoObjectId('665000000000000000000603');

  it('同一天同一用户只排一条，并把兜底窗口顺延到"最后一条消息 + 5 分钟"', async () => {
    const { service, getStored } = buildService();
    const morning = new Date('2026-09-13T01:00:00.000Z');
    const first = await service.enqueueOpenItemExtraction({
      userId,
      conversationId,
      agentId,
      now: morning,
    });
    expect(first?.kind).toBe(MemoryPipelineTaskKind.openItemExtraction);
    expect(first?.status).toBe(MemoryPipelineTaskStatus.pending);
    // 用 userId 当合成 messageId，配合唯一索引天然去重
    expect(String(first?.messageId)).toBe(String(userId));
    // 兜底任务的合并窗口已从 30 分钟缩到 5 分钟（在线即时抽取是主力）
    expect(first?.nextAttemptAt?.toISOString()).toBe(
      new Date(morning.getTime() + 5 * 60_000).toISOString()
    );

    const evening = new Date('2026-09-13T12:00:00.000Z');
    const second = await service.enqueueOpenItemExtraction({
      userId,
      conversationId,
      agentId,
      now: evening,
    });
    expect(second?.pipelineVersion).toBe(first?.pipelineVersion);
    expect(getStored()?.nextAttemptAt?.toISOString()).toBe(
      new Date(evening.getTime() + 5 * 60_000).toISOString()
    );
  });

  it('日期键按北京时间算（UTC 15:00 之后就是第二天）', () => {
    expect(resolveBeijingDayKey(new Date('2026-09-13T15:30:00.000Z'))).toBe(
      '2026-09-13'
    );
    expect(resolveBeijingDayKey(new Date('2026-09-13T16:30:00.000Z'))).toBe(
      '2026-09-14'
    );
  });

  it('第二天是新的一条任务（日期进了任务版本）', async () => {
    const { service } = buildService();
    const day1 = await service.enqueueOpenItemExtraction({
      userId,
      conversationId,
      agentId,
      now: new Date('2026-09-13T01:00:00.000Z'),
    });
    const day2 = await service.enqueueOpenItemExtraction({
      userId,
      conversationId,
      agentId,
      now: new Date('2026-09-13T17:00:00.000Z'),
    });
    expect(day2?.pipelineVersion).not.toBe(day1?.pipelineVersion);
  });

  it('当天跑过之后最多再重开两次，避免聊天多时反复调用模型', async () => {
    const { service, getStored } = buildService();
    await service.enqueueOpenItemExtraction({
      userId,
      conversationId,
      agentId,
      now: new Date('2026-09-13T01:00:00.000Z'),
    });
    const stored = getStored()!;
    stored.status = MemoryPipelineTaskStatus.completed;
    stored.attemptCount = 3;
    const again = await service.enqueueOpenItemExtraction({
      userId,
      conversationId,
      agentId,
      now: new Date('2026-09-13T08:00:00.000Z'),
    });
    expect(again?.status).toBe(MemoryPipelineTaskStatus.completed);
  });
});

describe('未了结清单任务的分流', () => {
  it('日任务直接交给离线抽取，不按 messageId 去查消息', async () => {
    const service = new ConversationService();
    const extractForUser = jest.fn().mockResolvedValue({ status: 'ok' });
    const findOne = jest.fn();
    service.memoryOpenItemExtractorService = { extractForUser } as never;
    service.messageModel = { findOne } as never;

    const task = Object.assign(new MemoryPipelineTaskEntity(), {
      id: new MongoObjectId('665000000000000000000701'),
      kind: MemoryPipelineTaskKind.openItemExtraction,
      userId: new MongoObjectId('665000000000000000000702'),
      messageId: new MongoObjectId('665000000000000000000702'),
      conversationId: new MongoObjectId('665000000000000000000703'),
      agentId: new MongoObjectId('665000000000000000000704'),
    });

    const outcome = await (
      service as never as {
        executeMemoryPipelineTask: (
          task: MemoryPipelineTaskEntity
        ) => Promise<string>;
      }
    ).executeMemoryPipelineTask(task);

    expect(outcome).toBe('completed');
    expect(extractForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '665000000000000000000702' })
    );
    expect(findOne).not.toHaveBeenCalled();
  });
});
