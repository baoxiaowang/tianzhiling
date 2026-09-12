import { MemoryPipelineTaskKind, MongoObjectId } from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';
import { MemoryValueService } from '../../src/service/agents/memory-value.service';
import { memoryValueModeForUser } from '../../src/service/agents/memory-value-rollout';

const uid = '665000000000000000000001';
describe('account memory rollout and shadow isolation', () => {
  const original = {
    mode: process.env.NODE_MEMORY_VALUE_MODE,
    users: process.env.NODE_MEMORY_VALUE_USER_IDS,
  };
  afterEach(() => {
    for (const [key, value] of [
      ['NODE_MEMORY_VALUE_MODE', original.mode],
      ['NODE_MEMORY_VALUE_USER_IDS', original.users],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  });
  it('requires both an explicit mode and an exact account allowlist; no wildcard or implicit all', () => {
    process.env.NODE_MEMORY_VALUE_MODE = 'active';
    for (const users of ['', '*', 'weapp:example']) {
      process.env.NODE_MEMORY_VALUE_USER_IDS = users;
      expect(memoryValueModeForUser(uid)).toBe('off');
    }
    process.env.NODE_MEMORY_VALUE_USER_IDS = uid;
    expect(memoryValueModeForUser(new MongoObjectId(uid))).toBe('active');
    expect(memoryValueModeForUser('665000000000000000000009')).toBe('off');
    expect(memoryValueModeForUser()).toBe('off');
    process.env.NODE_MEMORY_VALUE_MODE = 'off';
    expect(memoryValueModeForUser(uid)).toBe('off');
  });
  it('refuses a direct process call outside the allowlist before reading or writing', async () => {
    process.env.NODE_MEMORY_VALUE_MODE = 'active';
    process.env.NODE_MEMORY_VALUE_USER_IDS = '';
    await expect(
      new MemoryValueService().process(
        { userId: new MongoObjectId(uid) } as any,
        'test',
        {} as any
      )
    ).rejects.toThrow('ACCOUNT_NOT_ENABLED');
  });
  it.each([
    { fails: false, messenger: false },
    { fails: true, messenger: false },
    { fails: false, messenger: true },
    { fails: true, messenger: true },
  ])(
    'shadow preserves legacy writes: $fails failure, $messenger messenger',
    async ({ fails, messenger }) => {
      process.env.NODE_MEMORY_VALUE_MODE = 'shadow';
      process.env.NODE_MEMORY_VALUE_USER_IDS = uid;
      const service = new ConversationService();
      const memory = new MemoryValueService();
      memory.process = jest.fn(async () => {
        if (fails) throw Error('model unavailable');
        return { count: 0, changedAgents: [], audit: {} } as any;
      });
      service.memoryValueService = memory;
      service.logger = { warn: jest.fn() } as any;
      const message = {
        id: new MongoObjectId(),
        userId: new MongoObjectId(uid),
        agentId: new MongoObjectId(),
        status: 'sent',
        role: 'user',
        type: 'text',
        content: '我小时候在树下听爸爸讲故事',
      };
      service.messageModel = { findOne: jest.fn(async () => message) } as any;
      (service as any).findAgentById = jest.fn(async () => ({
        id: message.agentId,
        messengerOfAgentId: messenger ? new MongoObjectId() : undefined,
      }));
      (service as any).buildSearchableTextFromMessage = () => message.content;
      (service as any).enrichUserMessageForReply = jest.fn();
      (service as any).enrichMessengerUserMessage = jest.fn();
      service.userRelativeProfileService = {
        listSemanticUnitsForSourceMessage: jest.fn(async () => [{}]),
      } as any;
      service.memoryPipelineTaskService = {
        enqueueForMessage: jest.fn(),
      } as any;
      await expect(
        (service as any).executeMemoryPipelineTask({
          kind: MemoryPipelineTaskKind.structuredMemory,
          messageId: message.id,
        })
      ).resolves.toBe('completed');
      expect(memory.process).toHaveBeenCalledWith(
        message,
        message.content,
        expect.anything(),
        { shadow: true }
      );
      expect(
        messenger
          ? (service as any).enrichMessengerUserMessage
          : (service as any).enrichUserMessageForReply
      ).toHaveBeenCalledTimes(1);
      // 索引任务已经在消息落库时派发过一次（semantic_index 里同时完成原话入库、
      // 人物标签与结构化事实入库），这里不应再为同一条消息另派任务。
      expect(
        service.memoryPipelineTaskService.enqueueForMessage
      ).not.toHaveBeenCalled();
    }
  );
});
