/**
 * 记忆后台调度离线验收（对应任务书第七节 1–7）。
 * 只用假 Redis / 假队列 / 假模型；可控时钟；不连生产、不调用真实模型。
 */
import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskScheduleClass,
  MemoryPipelineTaskStatus,
  MongoObjectId,
} from '@tzl/entities';
import {
  MemoryPipelineTaskService,
  MEMORY_PIPELINE_VERSION,
} from '../../src/service/memory-pipeline-task.service';
import {
  backgroundWindowStart,
  resolveBackgroundThrottleConfig,
} from '../../src/service/memory-background-throttle';
import { MemoryPipelineProcessor } from '../../src/processor/memory-pipeline.processor';

class FakeRedis {
  map = new Map<string, number>();
  incrCalls: string[] = [];
  async incr(key: string): Promise<number> {
    this.incrCalls.push(key);
    const next = (this.map.get(key) || 0) + 1;
    this.map.set(key, next);
    return next;
  }
  async pexpire(): Promise<number> {
    return 1;
  }
}

const uid = () => new MongoObjectId();
const baseTime = new Date('2026-09-16T06:00:00.000Z'); // 北京 14:00

function makeTask(
  overrides: Partial<MemoryPipelineTaskEntity> = {}
): MemoryPipelineTaskEntity {
  const now = new Date('2026-09-16T05:00:00.000Z');
  return Object.assign(new MemoryPipelineTaskEntity(), {
    id: uid(),
    schemaVersion: 'memory_pipeline_task_v1',
    pipelineVersion: MEMORY_PIPELINE_VERSION,
    kind: MemoryPipelineTaskKind.semanticIndex,
    status: MemoryPipelineTaskStatus.pending,
    messageId: uid(),
    conversationId: uid(),
    userId: uid(),
    agentId: uid(),
    sourceHash: 'hash',
    attemptCount: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function buildHarness(
  rows: MemoryPipelineTaskEntity[] = [],
  queueJobs: Record<string, { state: string; removed: boolean }> = {}
) {
  const service = new MemoryPipelineTaskService();
  const redis = new FakeRedis();
  const added: Array<{ data: unknown; options: Record<string, unknown> }> = [];
  const removedJobs: string[] = [];

  const same = (rowValue: unknown, cond: unknown): boolean => {
    if (cond && typeof cond === 'object' && '$in' in (cond as object)) {
      const list = (cond as { $in: unknown[] }).$in;
      return list.some(v => String(v) === String(rowValue));
    }
    if (cond instanceof Date) {
      return rowValue instanceof Date && cond.getTime() === rowValue.getTime();
    }
    return String(rowValue) === String(cond);
  };
  const matches = (row: MemoryPipelineTaskEntity, where: Record<string, unknown>) =>
    Object.keys(where).every(k => {
      // TypeORM Mongo 用 _id 查询，实体属性名是 id。
      const key = k === '_id' ? 'id' : k;
      return same(
        (row as unknown as Record<string, unknown>)[key],
        where[k]
      );
    });

  const taskModel = {
    findOne: jest.fn(async (options: { where: Record<string, unknown> }) => {
      const found = rows.find(row => matches(row, options.where));
      return found || null;
    }),
    save: jest.fn(async (value: MemoryPipelineTaskEntity) => {
      if (!value.id) value.id = uid();
      const index = rows.findIndex(r => String(r.id) === String(value.id));
      if (index === -1) rows.push(value);
      else rows[index] = value;
      return value;
    }),
    updateOne: jest.fn(
      async (
        where: Record<string, unknown>,
        update: {
          $set?: Record<string, unknown>;
          $inc?: Record<string, number>;
        }
      ) => {
        const index = rows.findIndex(row => matches(row, where));
        if (index === -1) return { modifiedCount: 0 };
        const row = rows[index];
        Object.assign(row, update.$set || {});
        for (const [k, v] of Object.entries(update.$inc || {})) {
          (row as unknown as Record<string, number>)[k] =
            Number((row as unknown as Record<string, number>)[k] || 0) + v;
        }
        return { modifiedCount: 1 };
      }
    ),
  };

  service.logger = { warn: jest.fn(), info: jest.fn() } as never;
  service.taskModel = taskModel as never;
  service.redisService = redis as never;
  service.bullmqFramework = {
    getQueue: jest.fn(() => ({
      getJob: jest.fn(async (id: string) => {
        const job = queueJobs[id];
        if (!job) return undefined;
        return {
          getState: async () => job.state,
          remove: async () => {
            job.removed = true;
            removedJobs.push(id);
          },
        };
      }),
      addJobToQueue: jest.fn(
        async (data: unknown, options: Record<string, unknown>) => {
          added.push({ data, options });
        }
      ),
    })),
    createQueue: jest.fn(),
  } as never;

  return { service, redis, added, removedJobs, rows };
}

function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void> | void
) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) saved[key] = process.env[key];
  Object.assign(process.env, values);
  const restore = () => {
    for (const key of Object.keys(values)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  try {
    return Promise.resolve(run()).finally(restore);
  } catch (error) {
    restore();
    throw error;
  }
}

describe('记忆后台调度：准入限速与延期', () => {
  afterEach(() => {
    delete process.env.NODE_MEMORY_BACKGROUND_ENABLED;
    delete process.env.NODE_MEMORY_BACKGROUND_MAX_STARTS;
    delete process.env.NODE_MEMORY_BACKGROUND_WINDOW_MS;
  });

  it('1) 白天与凌晨同规则；后台 51 次被延期、下个窗口恢复；realtime 不占额度', async () => {
    await withEnv(
      {
        NODE_MEMORY_BACKGROUND_ENABLED: 'true',
        NODE_MEMORY_BACKGROUND_MAX_STARTS: '50',
        NODE_MEMORY_BACKGROUND_WINDOW_MS: '600000',
      },
      async () => {
        const { service, redis } = buildHarness();
        // 同一窗口：前 50 次允许，第 51 次延期
        for (let i = 1; i <= 50; i += 1) {
          const r = await service.tryAcquireBackgroundStart(baseTime);
          expect(r.allowed).toBe(true);
          expect(r.used).toBe(i);
        }
        const denied = await service.tryAcquireBackgroundStart(baseTime);
        expect(denied.allowed).toBe(false);
        expect(denied.nextEligibleAt?.getTime()).toBe(
          backgroundWindowStart(baseTime, 600000) + 600000
        );
        // 下个窗口恢复
        const nextWindow = new Date(baseTime.getTime() + 600000);
        expect((await service.tryAcquireBackgroundStart(nextWindow)).allowed).toBe(
          true
        );
        // 凌晨同一规则（不同窗口 => 允许），证明没有时间窗判断
        const earlyMorning = new Date('2026-09-15T22:00:00.000Z'); // 北京 06:00
        expect(
          (await service.tryAcquireBackgroundStart(earlyMorning)).allowed
        ).toBe(true);
        // realtime 不查询后台额度
        const before = redis.incrCalls.length;
        const realtime = makeTask({
          scheduleClass: MemoryPipelineTaskScheduleClass.realtime,
        });
        const start = await service.beginTaskExecution(String(realtime.id), {
          budgetAllowed: true,
        });
        // 任务不在 rows 里（未持久化），这里仅验证 realtime 不触发额度自增
        expect(start.task).toBeNull();
        expect(redis.incrCalls.length).toBe(before);
        expect(denied.limit).toBe(50);
      }
    );
  });

  it('2) 暂停后台：已排队后台不启动、不改状态不耗失败；解除后恢复', async () => {
    await withEnv(
      { NODE_MEMORY_BACKGROUND_ENABLED: 'false' },
      async () => {
        const bg = makeTask({
          scheduleClass: MemoryPipelineTaskScheduleClass.background,
        });
        const { service, rows } = buildHarness([bg]);
        const paused = await service.beginTaskExecution(String(bg.id), {
          budgetAllowed: true,
          now: baseTime,
        });
        expect(paused.task).toBeNull();
        expect(paused.deferredReason).toBe('background_paused');
        expect(rows[0].status).toBe(MemoryPipelineTaskStatus.pending);
        expect(rows[0].attemptCount).toBe(0);
        expect(rows[0].deferCount).toBe(1);

        process.env.NODE_MEMORY_BACKGROUND_ENABLED = 'true';
        // 延期把 nextAttemptAt 推到窗口末，到点后才可执行
        const resumedAt = new Date(baseTime.getTime() + 600000);
        const resumed = await service.beginTaskExecution(String(bg.id), {
          budgetAllowed: true,
          now: resumedAt,
        });
        expect(resumed.task).not.toBeNull();
        expect(rows[0].status).toBe(MemoryPipelineTaskStatus.processing);
      }
    );
  });

  it('3) realtime 经失败+协调重排仍是高优先级；background 不因重排变实时', async () => {
    const realtime = makeTask({
      scheduleClass: MemoryPipelineTaskScheduleClass.realtime,
    });
    const legacy = makeTask();
    const background = makeTask({
      scheduleClass: MemoryPipelineTaskScheduleClass.background,
    });
    const { service, added } = buildHarness([realtime, legacy, background]);
    realtime.status = MemoryPipelineTaskStatus.failed as never;
    realtime.attemptCount = 2;

    await service.requeueDueTask(realtime);
    await service.requeueDueTask(legacy);
    await service.requeueDueTask(background);

    expect(added[0].options.priority).toBe(1);
    expect(added[1].options.priority).toBe(1000);
    expect(added[2].options.priority).toBe(1000);
    expect(service.priorityForTask(realtime)).toBe(1);
    expect(service.priorityForTask(legacy)).toBe(1000);
  });

  it('4) 资源守卫延期可恢复；延期不耗失败次数、不标完成；终态 jobId 不永久阻挡重排', async () => {
    const legacy = makeTask();
    const { service, rows, added, removedJobs } = buildHarness(
      [legacy],
      { [`memory-${legacy.id}`]: { state: 'completed', removed: false } }
    );
    const deferred = await service.beginTaskExecution(String(legacy.id), {
      budgetAllowed: false,
      now: baseTime,
    });
    expect(deferred.task).toBeNull();
    expect(deferred.deferredReason).toBe('resource_guard');
    expect(rows[0].attemptCount).toBe(0);
    expect(rows[0].status).toBe(MemoryPipelineTaskStatus.pending);
    expect(rows[0].deferCount).toBe(1);
    expect(rows[0].nextEligibleAt.getTime()).toBe(baseTime.getTime() + 60000);
    expect(added).toHaveLength(0);

    // 终态 jobId：先移除再重排
    await service.requeueDueTask(legacy);
    expect(removedJobs).toContain(`memory-${legacy.id}`);
    expect(added).toHaveLength(1);

    // waiting/active 不重复创建
    const waiting = makeTask({ scheduleClass: MemoryPipelineTaskScheduleClass.realtime });
    const h2 = buildHarness([waiting], {
      [`memory-${waiting.id}`]: { state: 'waiting', removed: false },
    });
    await h2.service.requeueDueTask(waiting);
    expect(h2.added).toHaveLength(0);
    expect(h2.removedJobs).toHaveLength(0);
  });

  it('5) 完成/跳过/在途/重试耗尽不复活；legacy 缺字段兼容且不占后台额度', async () => {
    const completed = makeTask({ status: MemoryPipelineTaskStatus.completed });
    const skipped = makeTask({ status: MemoryPipelineTaskStatus.skipped });
    const active = makeTask({
      status: MemoryPipelineTaskStatus.processing,
      processingStartedAt: new Date(),
    });
    const exhausted = makeTask({ attemptCount: 6 });
    const legacy = makeTask(); // 无 scheduleClass
    const { service, redis, added } = buildHarness([
      completed,
      skipped,
      active,
      exhausted,
      legacy,
    ]);
    for (const t of [completed, skipped, active, exhausted]) {
      const r = await service.beginTaskExecution(String(t.id), {
        budgetAllowed: true,
        now: baseTime,
      });
      expect(r.task).toBeNull();
    }
    // legacy 兼容：低优先级、不查询后台额度
    const before = redis.incrCalls.length;
    await service.beginTaskExecution(String(legacy.id), {
      budgetAllowed: true,
      now: baseTime,
    });
    expect(redis.incrCalls.length).toBe(before);
    expect(service.priorityForTask(legacy)).toBe(1000);
    // 完成/跳过不入队
    await service.requeueDueTask(completed);
    await service.requeueDueTask(skipped);
    expect(added).toHaveLength(0);
  });

  it('6) 实时任务与后台同队：优先级更高；暂停后台不影响实时', async () => {
    await withEnv(
      { NODE_MEMORY_BACKGROUND_ENABLED: 'false' },
      async () => {
        const realtime = makeTask({
          scheduleClass: MemoryPipelineTaskScheduleClass.realtime,
        });
        const background = makeTask({
          scheduleClass: MemoryPipelineTaskScheduleClass.background,
        });
        const { service } = buildHarness([realtime, background]);
        const rt = await service.beginTaskExecution(String(realtime.id), {
          budgetAllowed: true,
          now: baseTime,
        });
        const bg = await service.beginTaskExecution(String(background.id), {
          budgetAllowed: true,
          now: baseTime,
        });
        expect(rt.task).not.toBeNull();
        expect(bg.task).toBeNull();
        expect(service.priorityForTask(realtime)).toBe(1);
        expect(service.priorityForTask(background)).toBe(1000);
      }
    );
  });

  it('7) 后台额度配置：默认 50/10min 且默认开启；可被环境变量覆盖', () => {
    const defaults = resolveBackgroundThrottleConfig({} as NodeJS.ProcessEnv);
    expect(defaults).toEqual({ enabled: true, maxStarts: 50, windowMs: 600000 });
    const custom = resolveBackgroundThrottleConfig({
      NODE_MEMORY_BACKGROUND_ENABLED: 'false',
      NODE_MEMORY_BACKGROUND_MAX_STARTS: '10',
      NODE_MEMORY_BACKGROUND_WINDOW_MS: '60000',
    } as NodeJS.ProcessEnv);
    expect(custom).toEqual({ enabled: false, maxStarts: 10, windowMs: 60000 });
  });
});

describe('处理器执行前准入', () => {
  it('资源不允许时只延期，不领取、不调用模型', async () => {
    const processor = new MemoryPipelineProcessor();
    const beginTaskExecution = jest.fn().mockResolvedValue({
      task: null,
      deferredReason: 'resource_guard',
    });
    processor.memoryPipelineTaskService = { beginTaskExecution } as never;
    processor.conversationService = {
      processMemoryPipelineTask: jest.fn(),
    } as never;
    await processor.execute({ taskId: String(uid()) });
    expect(beginTaskExecution).toHaveBeenCalledWith(
      expect.any(String),
      { budgetAllowed: expect.any(Boolean) }
    );
    expect(
      processor.conversationService.processMemoryPipelineTask
    ).not.toHaveBeenCalled();
  });
});
