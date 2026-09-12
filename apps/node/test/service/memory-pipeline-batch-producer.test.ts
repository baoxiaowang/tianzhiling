import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { MemoryPipelineTaskService } from '../../src/service/memory-pipeline-task.service';

// 本文件测的是攒批机制本身，固定用 10 条触发，不依赖生产默认值（生产默认为 5）。
// 批量大小对记忆覆盖的影响见 memory-pipeline-task.service.ts 里的实测注释。
const TEST_BATCH_SIZE = '10';
let previousBatchSize: string | undefined;
beforeAll(() => {
  previousBatchSize = process.env.MEMORY_PIPELINE_BATCH_SIZE;
  process.env.MEMORY_PIPELINE_BATCH_SIZE = TEST_BATCH_SIZE;
});
afterAll(() => {
  if (previousBatchSize === undefined)
    delete process.env.MEMORY_PIPELINE_BATCH_SIZE;
  else process.env.MEMORY_PIPELINE_BATCH_SIZE = previousBatchSize;
});

const CONVERSATION_ID = new MongoObjectId('665000000000000000000800');
const USER_ID = new MongoObjectId('665000000000000000000801');
const AGENT_ID = new MongoObjectId('665000000000000000000802');

function messageId(n: number): string {
  return `6650000000000000000008${String(n).padStart(2, '0')}`;
}

function createMessage(n: number): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: new MongoObjectId(messageId(n)),
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    createdAt: new Date(1700000000000 + n),
    updatedAt: new Date(1700000000000 + n),
    status: 'sent',
  });
}

function createService() {
  const service = new MemoryPipelineTaskService();
  const redisStore: Record<string, string[]> = {};
  const saved: MemoryPipelineTaskEntity[] = [];
  const jobs: Array<{
    data: Record<string, unknown>;
    opts: Record<string, unknown>;
  }> = [];

  service.logger = { warn: jest.fn(), info: jest.fn() } as never;
  service.taskModel = {
    findOne: jest.fn(async (query: any) => {
      const where = query?.where || {};
      return (
        saved.find(
          task =>
            String(task.messageId) === String(where.messageId) &&
            task.kind === where.kind
        ) || null
      );
    }),
    save: jest.fn(async (value: any) => {
      value.id = new MongoObjectId('665000000000000000000899');
      saved.push(value);
      return value;
    }),
  } as never;
  service.messageModel = {
    findOne: jest.fn(async (query: any) => {
      const id = String(query?.where?._id);
      return Object.assign(new MessageEntity(), {
        id: new MongoObjectId(id),
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        agentId: AGENT_ID,
      });
    }),
  } as never;
  service.bullmqFramework = {
    getQueue: jest.fn(() => ({
      addJobToQueue: jest.fn(async (data: any, opts: any) => {
        jobs.push({ data, opts });
      }),
    })),
    createQueue: jest.fn(() => ({
      addJobToQueue: jest.fn(async (data: any, opts: any) => {
        jobs.push({ data, opts });
      }),
    })),
  } as never;
  service.redisService = {
    rpush: jest.fn(async (key: string, value: string) => {
      redisStore[key] = redisStore[key] || [];
      redisStore[key].push(value);
      return redisStore[key].length;
    }),
    expire: jest.fn(async () => 1),
    llen: jest.fn(async (key: string) => (redisStore[key] || []).length),
    lrange: jest.fn(async (key: string) => [...(redisStore[key] || [])]),
    del: jest.fn(async (key: string) => {
      delete redisStore[key];
      return 1;
    }),
  } as never;

  return { service, redisStore, saved, jobs };
}

describe('memory-pipeline 生产端（enqueueForMessage）', () => {
  it('索引类任务逐条即时处理，启用完整 logger 也不会被吞掉', async () => {
    const { service, saved } = createService();

    const tasks = await service.enqueueForMessage(
      createMessage(1),
      '今天聊了很多',
      [MemoryPipelineTaskKind.semanticIndex]
    );

    expect(tasks).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].kind).toBe(MemoryPipelineTaskKind.semanticIndex);
    expect(saved[0].messageIds).toBeUndefined();
  });

  it('抽取类任务按 kind 独立攒批：满 10 条才触发，且每个 id 只出现一次', async () => {
    const { service, saved } = createService();

    for (let n = 1; n <= 9; n += 1) {
      const tasks = await service.enqueueForMessage(
        createMessage(n),
        `第 ${n} 条`,
        [MemoryPipelineTaskKind.structuredMemory]
      );
      expect(tasks).toHaveLength(0);
    }

    const triggered = await service.enqueueForMessage(
      createMessage(10),
      '第 10 条',
      [MemoryPipelineTaskKind.structuredMemory]
    );

    expect(triggered).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(triggered[0].messageIds?.map(String)).toEqual(
      Array.from({ length: 10 }, (_, index) => messageId(index + 1))
    );
  });

  it('不同 kind 不共用攒批计数，互不干扰', async () => {
    const { service, redisStore } = createService();

    for (let n = 1; n <= 5; n += 1) {
      await service.enqueueForMessage(createMessage(n), `第 ${n} 条`, [
        MemoryPipelineTaskKind.structuredMemory,
      ]);
    }

    // 同样的 5 条消息走索引任务，必须每条都立即出任务。
    for (let n = 1; n <= 5; n += 1) {
      const tasks = await service.enqueueForMessage(
        createMessage(n),
        `第 ${n} 条`,
        [MemoryPipelineTaskKind.semanticIndex]
      );
      expect(tasks).toHaveLength(1);
    }

    const structuredKey = `memory-pipeline:batch:${
      MemoryPipelineTaskKind.structuredMemory
    }:${CONVERSATION_ID.toString()}`;
    const semanticKey = `memory-pipeline:batch:${
      MemoryPipelineTaskKind.semanticIndex
    }:${CONVERSATION_ID.toString()}`;
    expect(redisStore[structuredKey]).toHaveLength(5);
    // 索引类任务不攒批，因此不会产生额外的 batch key。
    expect(redisStore[semanticKey]).toBeUndefined();
  });

  it('不足一批时登记超时兜底任务', async () => {
    const { service, jobs } = createService();

    await service.enqueueForMessage(createMessage(1), '只有一条', [
      MemoryPipelineTaskKind.structuredMemory,
    ]);

    const flushJob = jobs.find(job => job.data.flushBatch === true);
    expect(flushJob).toBeDefined();
    expect(flushJob?.data.flushKind).toBe(
      MemoryPipelineTaskKind.structuredMemory
    );
    expect(flushJob?.data.flushConversationId).toBe(CONVERSATION_ID.toString());
    expect(Number(flushJob?.opts.delay)).toBeGreaterThan(0);
  });

  it('超时兜底会把不足一批的消息提交处理，不会丢', async () => {
    const { service, saved, redisStore } = createService();

    for (let n = 1; n <= 3; n += 1) {
      await service.enqueueForMessage(createMessage(n), `第 ${n} 条`, [
        MemoryPipelineTaskKind.structuredMemory,
      ]);
    }
    expect(saved).toHaveLength(0);

    const flushed = await service.flushBatch(
      MemoryPipelineTaskKind.structuredMemory,
      CONVERSATION_ID.toString()
    );

    expect(flushed).not.toBeNull();
    expect(flushed?.messageIds?.map(String)).toEqual([
      messageId(1),
      messageId(2),
      messageId(3),
    ]);
    const batchKey = `memory-pipeline:batch:${
      MemoryPipelineTaskKind.structuredMemory
    }:${CONVERSATION_ID.toString()}`;
    expect(redisStore[batchKey]).toBeUndefined();
  });

  it('同一条消息被重复入队时，批量任务内会去重', async () => {
    const { service } = createService();
    const repeated = createMessage(1);

    await service.enqueueForMessage(repeated, '重复内容', [
      MemoryPipelineTaskKind.structuredMemory,
    ]);
    await service.enqueueForMessage(repeated, '重复内容', [
      MemoryPipelineTaskKind.structuredMemory,
    ]);

    const flushed = await service.flushBatch(
      MemoryPipelineTaskKind.structuredMemory,
      CONVERSATION_ID.toString()
    );

    expect(flushed?.messageIds?.map(String)).toEqual([messageId(1)]);
  });

  it('没有 Redis 时降级为逐条任务，保证不丢', async () => {
    const { service, saved } = createService();
    service.redisService = undefined as never;

    const tasks = await service.enqueueForMessage(
      createMessage(1),
      '没有 Redis',
      [MemoryPipelineTaskKind.structuredMemory]
    );

    expect(tasks).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });

  it('并发重复触发同一批量任务时复用同一条记录', async () => {
    const { service, saved } = createService();

    for (let n = 1; n <= 10; n += 1) {
      await service.enqueueForMessage(createMessage(n), `第 ${n} 条`, [
        MemoryPipelineTaskKind.structuredMemory,
      ]);
    }
    const firstTask = saved[0];

    // 用同一锚点（触发批量任务的那条消息）再次创建，应该复用而不是新增。
    const again = await service['ensureBatchTask'](
      createMessage(10),
      '第 10 条',
      MemoryPipelineTaskKind.structuredMemory,
      Array.from({ length: 10 }, (_, index) => messageId(index + 1))
    );

    expect(again).toBe(firstTask);
    expect(saved).toHaveLength(1);
  });
});
