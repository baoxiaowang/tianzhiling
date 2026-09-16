/**
 * 真实本地 Redis/BullMQ 集成验收（隔离前缀 tzl-offline-mempipe）。
 * 只连本机 Redis，不碰生产前缀、不写业务数据；Redis 不可达时自动跳过。
 */
import { createRequire } from 'module';
import { Queue, Worker } from 'bullmq';
import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskScheduleClass,
  MemoryPipelineTaskStatus,
  MongoObjectId,
} from '@tzl/entities';
import { MemoryPipelineTaskService } from '../../src/service/memory-pipeline-task.service';

const require_ = createRequire(__filename);
const connection = { host: '127.0.0.1', port: 17380 };
const PREFIX = 'tzl-offline-mempipe';

function loadIoredis(): any {
  const path = require_.resolve('ioredis', {
    paths: [require_.resolve('bullmq')],
  });
  return require_(path);
}

async function redisReachable(): Promise<boolean> {
  try {
    const Redis = loadIoredis();
    const client = new Redis({ ...connection, lazyConnect: true, maxRetriesPerRequest: 1 });
    await client.connect();
    await client.ping();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}

describe('记忆后台调度集成（本地 Redis/BullMQ）', () => {
  let available = false;

  beforeAll(async () => {
    available = await redisReachable();
  });

  it('后台额度在真实 Redis 上按窗口原子计数（50/10min）', async () => {
    if (!available) {
      console.warn('skip: local redis unavailable');
      return;
    }
    const Redis = loadIoredis();
    const client = new Redis(connection);
    const service = new MemoryPipelineTaskService();
    service.logger = { warn: jest.fn(), info: jest.fn() } as never;
    service.redisService = client as never;
    process.env.NODE_MEMORY_BACKGROUND_MAX_STARTS = '50';
    process.env.NODE_MEMORY_BACKGROUND_WINDOW_MS = '600000';
    const now = new Date();
    const { backgroundWindowStart } = require('../../src/service/memory-background-throttle');
    const key = `memory-pipeline:background:admission:${backgroundWindowStart(now, 600000)}`;
    await client.del(key);
    try {
      for (let i = 1; i <= 50; i += 1) {
        expect((await service.tryAcquireBackgroundStart(now)).allowed).toBe(
          true
        );
      }
      expect((await service.tryAcquireBackgroundStart(now)).allowed).toBe(
        false
      );
    } finally {
      await client.del(key);
      delete process.env.NODE_MEMORY_BACKGROUND_MAX_STARTS;
      delete process.env.NODE_MEMORY_BACKGROUND_WINDOW_MS;
      await client.quit();
    }
  });

  it('后台队列先到的低优先级不抢占后到的实时任务（真实 BullMQ）', async () => {
    if (!available) {
      console.warn('skip: local redis unavailable');
      return;
    }
    const queue = new Queue('memory-pipeline', { prefix: PREFIX, connection });
    await queue.obliterate({ force: true }).catch(() => undefined);
    const order: string[] = [];
    const worker = new Worker(
      'memory-pipeline',
      async job => {
        order.push(String(job.data.tag));
      },
      { prefix: PREFIX, connection, concurrency: 1 }
    );
    try {
      await queue.add(
        'jobName',
        { tag: 'background' },
        { jobId: 'bg-1', priority: 1000, removeOnComplete: 1000 }
      );
      await queue.add(
        'jobName',
        { tag: 'realtime' },
        { jobId: 'rt-1', priority: 1, removeOnComplete: 1000 }
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
      // 后台先入队，但实时优先级更高：并发 1 下应先进 realtime
      expect(order[0]).toBe('realtime');
      expect(order).toContain('background');
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });

  it('固定 jobId 的终态完成记录不阻挡后续重排（真实 BullMQ）', async () => {
    if (!available) {
      console.warn('skip: local redis unavailable');
      return;
    }
    const queue = new Queue('memory-pipeline', { prefix: PREFIX, connection });
    await queue.obliterate({ force: true }).catch(() => undefined);
    let processed = 0;
    const worker = new Worker(
      'memory-pipeline',
      async () => {
        processed += 1;
      },
      { prefix: PREFIX, connection, concurrency: 1 }
    );
    try {
      const taskId = String(new MongoObjectId());
      await queue.add(
        'jobName',
        { taskId },
        {
          jobId: `memory-${taskId}`,
          attempts: 5,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        }
      );
      const deadline = Date.now() + 5000;
      let state = '';
      while (Date.now() < deadline) {
        state = (await (await queue.getJob(`memory-${taskId}`))?.getState()) || '';
        if (state === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(state).toBe('completed');

      const service = new MemoryPipelineTaskService();
      service.logger = { warn: jest.fn(), info: jest.fn() } as never;
      service.bullmqFramework = {
        getQueue: () => ({
          getJob: (id: string) => queue.getJob(id),
          addJobToQueue: (data: unknown, options: Record<string, unknown>) =>
            queue.add('jobName', data, options),
        }),
      } as never;
      const task = Object.assign(new MemoryPipelineTaskEntity(), {
        id: new MongoObjectId(taskId),
        kind: MemoryPipelineTaskKind.semanticIndex,
        status: MemoryPipelineTaskStatus.pending,
        scheduleClass: MemoryPipelineTaskScheduleClass.background,
      });
      expect(processed).toBe(1);
      await service.requeueDueTask(task);

      // 终态记录被清掉后重新入队并被 worker 再次执行（同 jobId 不会永久 pending/completed）
      const deadline2 = Date.now() + 5000;
      while (processed < 2 && Date.now() < deadline2) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(processed).toBeGreaterThanOrEqual(2);
      const requeued = await queue.getJob(`memory-${taskId}`);
      expect(requeued).toBeTruthy();
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });
});
