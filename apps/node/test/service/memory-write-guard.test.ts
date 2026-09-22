import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskScheduleClass,
  MemoryPipelineTaskStatus,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import {
  MemoryPipelineTaskService,
  type MemoryTaskDeferReason,
} from '../../src/service/memory-pipeline-task.service';
import {
  isMemoryWriteDisabled,
  isMemoryWritePaused,
} from '../../src/service/memory-write-guard';
import { ConversationService } from '../../src/service/conversation.service';
import { ConversationChatImportService } from '../../src/service/conversation-chat-import.service';
import { AgentChatToolService } from '../../src/service/agents/agent-chat-tool.service';

jest.mock('../../src/service/memory-resource-budget', () => ({
  memoryBudgetSnapshot: jest.fn(() => ({ allowed: true })),
}));

const FLAG = 'MEMORY_WRITE_DISABLED';

describe('记忆写入总闸（MEMORY_WRITE_DISABLED）', () => {
  const original = process.env[FLAG];

  beforeEach(() => {
    delete process.env[FLAG];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = original;
    }
  });

  describe('isMemoryWriteDisabled', () => {
    it('识别 true/1/yes，且对大小写与首尾空格不敏感', () => {
      for (const value of ['true', 'TRUE', '  true  ', '1', 'yes', 'Yes']) {
        expect(isMemoryWriteDisabled({ [FLAG]: value } as never)).toBe(true);
      }
    });

    it('未设置、空串或其他取值一律视为未开启', () => {
      expect(isMemoryWriteDisabled({} as never)).toBe(false);
      expect(isMemoryWriteDisabled({ [FLAG]: '' } as never)).toBe(false);
      expect(isMemoryWriteDisabled({ [FLAG]: 'false' } as never)).toBe(false);
      expect(isMemoryWriteDisabled({ [FLAG]: '0' } as never)).toBe(false);
      expect(isMemoryWriteDisabled({ [FLAG]: 'off' } as never)).toBe(false);
    });
  });

  describe('isMemoryWritePaused（总闸 + 旧开关合并）', () => {
    it('总闸或旧开关任一打开即暂停', () => {
      expect(isMemoryWritePaused({ [FLAG]: 'true' } as never)).toBe(true);
      expect(
        isMemoryWritePaused({ CHAT_SKIP_MEMORY_WRITE: 'true' } as never)
      ).toBe(true);
      expect(
        isMemoryWritePaused({
          [FLAG]: 'true',
          CHAT_SKIP_MEMORY_WRITE: 'true',
        } as never)
      ).toBe(true);
    });

    it('两者都未打开时不暂停', () => {
      expect(isMemoryWritePaused({} as never)).toBe(false);
      expect(
        isMemoryWritePaused({
          [FLAG]: 'false',
          CHAT_SKIP_MEMORY_WRITE: 'false',
        } as never)
      ).toBe(false);
    });
  });

  describe('记忆任务消费：统一延后而不是删除或标成功', () => {
    it('开关打开时延迟为 write_paused，任务保持 pending 且不消耗重试次数', async () => {
      process.env[FLAG] = 'true';
      const service = new MemoryPipelineTaskService();
      const updateOne = jest.fn().mockResolvedValue({});
      const task = Object.assign(new MemoryPipelineTaskEntity(), {
        id: new MongoObjectId('665000000000000000000901'),
        kind: MemoryPipelineTaskKind.semanticIndex,
        status: MemoryPipelineTaskStatus.pending,
        scheduleClass: MemoryPipelineTaskScheduleClass.realtime,
        attemptCount: 0,
        deferCount: 0,
        nextAttemptAt: new Date(Date.now() - 60_000),
        createdAt: new Date(Date.now() - 120_000),
      });
      service.logger = { warn: jest.fn() } as never;
      service.taskModel = {
        findOne: jest.fn(async () => task),
        updateOne,
      } as never;

      const start = await service.beginTaskExecution(String(task.id), {
        budgetAllowed: true,
      });

      expect(start.task).toBeNull();
      expect(start.deferredReason as MemoryTaskDeferReason).toBe('write_paused');
      expect(updateOne).toHaveBeenCalledTimes(1);
      const update = updateOne.mock.calls[0][1] as {
        $set: Record<string, unknown>;
        $inc: Record<string, number>;
      };
      expect(update.$set.lastDeferReason).toBe('write_paused');
      expect(update.$set.status).toBe(MemoryPipelineTaskStatus.pending);
      expect(update.$inc).toEqual({ deferCount: 1 });
      expect(update.$inc.attemptCount).toBeUndefined();
    });

    it('开关关闭时不走 write_paused（保持既有准入路径）', async () => {
      const service = new MemoryPipelineTaskService();
      const updateOne = jest.fn().mockResolvedValue({});
      const task = Object.assign(new MemoryPipelineTaskEntity(), {
        id: new MongoObjectId('665000000000000000000902'),
        kind: MemoryPipelineTaskKind.semanticIndex,
        status: MemoryPipelineTaskStatus.pending,
        scheduleClass: MemoryPipelineTaskScheduleClass.realtime,
        attemptCount: 0,
        deferCount: 0,
        nextAttemptAt: new Date(Date.now() - 60_000),
        createdAt: new Date(Date.now() - 120_000),
      });
      service.logger = { warn: jest.fn() } as never;
      service.taskModel = {
        findOne: jest.fn(async () => task),
        updateOne,
      } as never;
      // 让后续 claimTask 走"未抢到"的分支，避免依赖真实 Mongo。
      const claimTask = jest
        .spyOn(service, 'claimTask')
        .mockResolvedValue(null as never);

      await service.beginTaskExecution(String(task.id), {
        budgetAllowed: true,
      });

      expect(claimTask).toHaveBeenCalled();
      for (const call of updateOne.mock.calls) {
        const update = call[1] as { $set?: Record<string, unknown> };
        expect(update.$set?.lastDeferReason).not.toBe('write_paused');
      }
      claimTask.mockRestore();
    });
  });

  describe('聊天侧自动写入入口全部短路', () => {
    it('结构化记忆入队被拦住', async () => {
      process.env[FLAG] = 'true';
      const service = new ConversationService();
      const enqueueForMessage = jest.fn();
      service.memoryPipelineTaskService = { enqueueForMessage } as never;

      await (
        service as unknown as {
          scheduleUserMessageEnrichment: (
            m: unknown,
            t: string
          ) => Promise<void>;
        }
      ).scheduleUserMessageEnrichment({ id: 'm1' }, '用户说了新的家人情况');

      expect(enqueueForMessage).not.toHaveBeenCalled();
    });

    it('视觉外观事实直写被拦住', () => {
      process.env[FLAG] = 'true';
      const service = new ConversationService();
      const upsertVisualAppearanceObservations = jest.fn();
      service.agentProfileFactService = {
        upsertVisualAppearanceObservations,
      } as never;

      (
        service as unknown as {
          scheduleVisualAppearanceMemory: (
            m: unknown,
            o: unknown[]
          ) => void;
        }
      ).scheduleVisualAppearanceMemory({ id: 'm1' }, [{ kind: 'hair' }]);

      expect(upsertVisualAppearanceObservations).not.toHaveBeenCalled();
    });

    it('检索触发的懒回填返回 0（不产生任务）', async () => {
      process.env[FLAG] = 'true';
      const service = new AgentChatToolService();
      const enqueueForMessage = jest.fn();
      service.messageModel = { findOne: jest.fn() } as never;
      service.memoryPipelineTaskService = { enqueueForMessage } as never;

      const queued = await (
        service as unknown as {
          queueLazyBackfill: (
            c: unknown,
            r: unknown[],
            res: unknown[]
          ) => Promise<number>;
        }
      ).queueLazyBackfill({ userId: 'u1' }, [{ id: 'x' }], [{ items: [] }]);

      expect(queued).toBe(0);
      expect(enqueueForMessage).not.toHaveBeenCalled();
    });
  });

  describe('导入路径：自动写入暂停，用户确认写入保留', () => {
    it('updateAgentLanguageProfile 在开关打开时不写风格事实与画像', async () => {
      process.env[FLAG] = 'true';
      const service = new ConversationChatImportService();
      const upsertFromHistoricalImport = jest.fn();
      service.agentProfileFactService = {
        upsertFromHistoricalImport,
      } as never;

      await (
        service as unknown as {
          updateAgentLanguageProfile: (
            b: unknown,
            i: unknown[]
          ) => Promise<void>;
        }
      ).updateAgentLanguageProfile({ id: 'b1', userId: 'u1', agentId: 'a1' }, []);

      expect(upsertFromHistoricalImport).not.toHaveBeenCalled();
    });
  });

  describe('任务创建原语：暂停期间一个任务都不落', () => {
    const makeMessage = () =>
      Object.assign(new MessageEntity(), {
        id: new MongoObjectId('665000000000000000000a01'),
        conversationId: new MongoObjectId('665000000000000000000a02'),
        userId: new MongoObjectId('665000000000000000000a03'),
        agentId: new MongoObjectId('665000000000000000000a04'),
      });

    it('enqueueForMessage 返回空数组且不写库', async () => {
      process.env[FLAG] = 'true';
      const service = new MemoryPipelineTaskService();
      const save = jest.fn();
      service.logger = { warn: jest.fn() } as never;
      service.taskModel = { findOne: jest.fn(), save } as never;

      const tasks = await service.enqueueForMessage(
        makeMessage(),
        '用户说了新的家人情况',
        [MemoryPipelineTaskKind.semanticIndex]
      );

      expect(tasks).toEqual([]);
      expect(save).not.toHaveBeenCalled();
    });

    it('flushBatch 返回 null 且不消费 Redis 批次（批次键保留给恢复后）', async () => {
      process.env[FLAG] = 'true';
      const service = new MemoryPipelineTaskService();
      const lrange = jest.fn();
      const del = jest.fn();
      service.logger = { warn: jest.fn(), info: jest.fn() } as never;
      service.redisService = { lrange, del } as never;

      const task = await service.flushBatch(
        MemoryPipelineTaskKind.structuredMemory,
        '6ab2711d0ae0e319dd85163d'
      );

      expect(task).toBeNull();
      expect(lrange).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('enqueueBackgroundTask 返回 null', async () => {
      process.env[FLAG] = 'true';
      const service = new MemoryPipelineTaskService();
      const save = jest.fn();
      service.logger = { warn: jest.fn() } as never;
      service.taskModel = { findOne: jest.fn(), save } as never;

      const task = await service.enqueueBackgroundTask({
        message: makeMessage(),
        searchableText: '用户说了新的家人情况',
        kind: MemoryPipelineTaskKind.openItemExtraction,
        batchId: 'batch-1',
      });

      expect(task).toBeNull();
      expect(save).not.toHaveBeenCalled();
    });

    it('enqueueOpenItemExtraction 返回 undefined', async () => {
      process.env[FLAG] = 'true';
      const service = new MemoryPipelineTaskService();
      const save = jest.fn();
      service.logger = { warn: jest.fn() } as never;
      service.taskModel = { findOne: jest.fn(), save } as never;

      const task = await service.enqueueOpenItemExtraction({
        userId: new MongoObjectId('665000000000000000000a03'),
        conversationId: new MongoObjectId('665000000000000000000a02'),
        agentId: new MongoObjectId('665000000000000000000a04'),
      });

      expect(task).toBeUndefined();
      expect(save).not.toHaveBeenCalled();
    });
  });
});
