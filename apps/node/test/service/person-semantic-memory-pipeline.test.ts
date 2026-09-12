import {
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';

describe('person semantic memory pipeline', () => {
  const message = Object.assign(new MessageEntity(), {
    id: new MongoObjectId('665000000000000000000701'),
    userId: new MongoObjectId('665000000000000000000001'),
    agentId: new MongoObjectId('665000000000000000000010'),
    conversationId: new MongoObjectId('665000000000000000000020'),
    role: MessageRole.user,
    type: MessageType.text,
    status: MessageStatus.sent,
    content: '安安今天已经退烧了',
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    updatedAt: new Date('2026-09-05T00:00:00.000Z'),
  });

  it('indexes raw part, person anchors and governed facts in one semantic_index pass', async () => {
    // 三种任务合并成两种：semantic_index 一次做完原话入库、人物标签、结构化事实。
    const service = new ConversationService();
    const personId = new MongoObjectId('665000000000000000000301');
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(message),
    } as never;
    service.logger = { warn: jest.fn(), info: jest.fn() } as never;
    (service as any).buildSearchableTextFromMessage = () => message.content;
    service.userIdentityMemoryService = {
      listRelevantKnownPeople: jest.fn().mockResolvedValue([
        {
          id: `person:${personId.toString()}`,
          realName: '安安',
          aliases: ['安安'],
          relationToUser: '女儿',
        },
      ]),
    } as never;
    service.memoryValueService = {
      active: jest.fn(() => true),
      indexMessage: jest.fn().mockResolvedValue(undefined),
    } as never;
    service.milvusService = {
      indexConversationMessage: jest.fn().mockResolvedValue(true),
    } as never;

    const task = Object.assign(new MemoryPipelineTaskEntity(), {
      kind: MemoryPipelineTaskKind.semanticIndex,
      messageId: message.id,
      sourceHash: 'source-hash',
    });
    await expect(service.processMemoryPipelineTask(task)).resolves.toBe(
      'completed'
    );
    const calls = (service.milvusService.indexConversationMessage as jest.Mock)
      .mock.calls.map(call => call[0]);
    // ① 原话（不区分人物）
    expect(calls.some(call => !call.personId)).toBe(true);
    // ② 按人物标签
    expect(
      calls.some(
        call =>
          call.personId === personId.toString() &&
          call.memoryKind === 'raw_episode' &&
          call.searchableText === message.content
      )
    ).toBe(true);
    // ③ 结构化事实（第一层）
    expect(service.memoryValueService.indexMessage).toHaveBeenCalledWith(
      message,
      service.milvusService
    );
  });

  it('writes a deterministic person-scoped row without replacing the raw row', async () => {
    const service = new ConversationService();
    const personId = new MongoObjectId('665000000000000000000201');
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(message),
    } as never;
    service.userRelativeProfileService = {
      listSemanticUnitsForSourceMessage: jest.fn().mockResolvedValue([
        {
          personId,
          memoryKind: 'health_update',
          stableKey: 'health:health.fever',
          searchableText: '安安、赵安宁、女儿：今天已经退烧',
        },
      ]),
    } as never;
    service.milvusService = {
      indexConversationMessage: jest.fn().mockResolvedValue(true),
    } as never;

    const task = Object.assign(new MemoryPipelineTaskEntity(), {
      kind: MemoryPipelineTaskKind.personSemanticIndex,
      messageId: message.id,
      sourceHash: 'source-hash',
    });
    await expect(service.processMemoryPipelineTask(task)).resolves.toBe(
      'completed'
    );
    expect(service.milvusService.indexConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: message.id.toString(),
        sourceMessageId: message.id.toString(),
        personId: personId.toString(),
        memoryKind: 'health_update',
        memoryId: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
  });
});
