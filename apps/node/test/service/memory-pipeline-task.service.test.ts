import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskStatus,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { MemoryPipelineTaskService } from '../../src/service/memory-pipeline-task.service';
import { MemoryPipelineProcessor } from '../../src/processor/memory-pipeline.processor';

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

describe('MemoryPipelineProcessor', () => {
  it('continues a reconciliation batch after one task fails', async () => {
    const processor = new MemoryPipelineProcessor();
    const first = Object.assign(new MemoryPipelineTaskEntity(), {
      id: new MongoObjectId('665000000000000000000411'),
    });
    const second = Object.assign(new MemoryPipelineTaskEntity(), {
      id: new MongoObjectId('665000000000000000000412'),
    });
    processor.memoryPipelineTaskService = {
      getDueTasks: jest.fn().mockResolvedValue([first, second]),
      claimTask: jest
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    } as never;
    processor.conversationService = {
      processMemoryPipelineTask: jest
        .fn()
        .mockRejectedValueOnce(new Error('poison message'))
        .mockResolvedValueOnce('completed'),
    } as never;

    await expect(processor.execute({ reconcile: true })).resolves.toBeUndefined();
    expect(
      processor.conversationService.processMemoryPipelineTask
    ).toHaveBeenCalledTimes(2);
    expect(processor.memoryPipelineTaskService.markFailed).toHaveBeenCalled();
    expect(processor.memoryPipelineTaskService.markCompleted).toHaveBeenCalledWith(
      second,
      MemoryPipelineTaskStatus.completed
    );
  });
});
