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
