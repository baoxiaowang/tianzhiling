import {
  ConversationChatImportBatchEntity,
  ConversationChatImportConfidence,
  ConversationChatImportItemEntity,
  ConversationChatImportItemType,
  ConversationChatImportSide,
  ConversationChatImportSpeaker,
  ConversationChatImportStatus,
  ConversationChatImportTimePrecision,
  ConversationEntity,
  MessageEntity,
  MessageSource,
  MongoObjectId,
} from '@tzl/entities';
import { ConversationChatImportService } from '../../src/service/conversation-chat-import.service';

describe('ConversationChatImportService', () => {
  it('persists imported messages without quota or reply triggers', async () => {
    const userId = new MongoObjectId();
    const agentId = new MongoObjectId();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.userId = userId;
    conversation.agentId = agentId;

    const batch = new ConversationChatImportBatchEntity();
    batch.id = new MongoObjectId();
    batch.userId = userId;
    batch.agentId = agentId;
    batch.conversationId = conversation.id;
    batch.status = ConversationChatImportStatus.needsReview;
    batch.leftSpeaker = ConversationChatImportSpeaker.agent;
    batch.rightSpeaker = ConversationChatImportSpeaker.user;
    batch.createdAt = new Date('2026-08-01T00:00:00.000Z');
    batch.updatedAt = batch.createdAt;

    const importedItem = new ConversationChatImportItemEntity();
    importedItem.id = new MongoObjectId();
    importedItem.batchId = batch.id;
    importedItem.userId = userId;
    importedItem.agentId = agentId;
    importedItem.conversationId = conversation.id;
    importedItem.screenshotId = 'screenshot-1';
    importedItem.screenshotSequence = 0;
    importedItem.bubbleSequence = 0;
    importedItem.side = ConversationChatImportSide.right;
    importedItem.speaker = ConversationChatImportSpeaker.user;
    importedItem.type = ConversationChatImportItemType.text;
    importedItem.content = '我到家了';
    importedItem.occurredAt = new Date('2020-05-03T13:18:00.000Z');
    importedItem.timePrecision = ConversationChatImportTimePrecision.minute;
    importedItem.timeConfidence = ConversationChatImportConfidence.high;
    importedItem.textConfidence = 0.96;
    importedItem.speakerConfidence = 0.98;
    importedItem.recognitionConfidence = 0.96;
    importedItem.createdAt = batch.createdAt;
    importedItem.updatedAt = batch.createdAt;

    const savedMessages: MessageEntity[] = [];
    const service = new ConversationChatImportService();
    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.batchModel = {
      findOne: jest.fn().mockResolvedValue(batch),
      save: jest.fn().mockImplementation(async value => value),
    } as never;
    service.itemModel = {
      find: jest.fn().mockResolvedValue([importedItem]),
      save: jest.fn().mockImplementation(async value => value),
    } as never;
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async value => {
        value.id = value.id || new MongoObjectId();
        savedMessages.push(value);
        return value;
      }),
    } as never;
    service.bullmqFramework = {
      getQueue: jest.fn().mockReturnValue({
        addJobToQueue: jest.fn().mockResolvedValue(undefined),
      }),
    } as never;

    await service.confirm(
      {
        sub: userId.toHexString(),
        accountId: new MongoObjectId().toHexString(),
        account: 'test',
        iat: 0,
        exp: 0,
        nonce: 'test',
      },
      conversation.id.toHexString(),
      batch.id.toHexString()
    );

    const importedMessage = savedMessages.find(message =>
      message.importItemId?.equals(importedItem.id)
    );
    expect(importedMessage).toBeDefined();
    expect(importedMessage?.source).toBe(MessageSource.wechatImport);
    expect(importedMessage?.quotaExempt).toBe(true);
    expect(importedMessage?.replyTrigger).toBe(false);
    expect(importedMessage?.sourceOccurredAt).toEqual(importedItem.occurredAt);
  });

  it('only confirms reviewed memories that still have source messages', async () => {
    const userId = new MongoObjectId();
    const agentId = new MongoObjectId();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.userId = userId;
    conversation.agentId = agentId;

    const batch = new ConversationChatImportBatchEntity();
    batch.id = new MongoObjectId();
    batch.userId = userId;
    batch.agentId = agentId;
    batch.conversationId = conversation.id;
    batch.status = ConversationChatImportStatus.needsMemoryReview;
    batch.memoryStatus = 'needs_review';
    batch.createdAt = new Date('2026-08-01T00:00:00.000Z');
    batch.updatedAt = batch.createdAt;

    const availableItem = new ConversationChatImportItemEntity();
    availableItem.id = new MongoObjectId();
    availableItem.messageId = new MongoObjectId();
    availableItem.content = '小时候我们常去河边散步';
    availableItem.isDeleted = false;
    availableItem.memoryFactIds = [];

    const deletedItem = new ConversationChatImportItemEntity();
    deletedItem.id = new MongoObjectId();
    deletedItem.messageId = new MongoObjectId();
    deletedItem.content = '这条已经被用户删除';
    deletedItem.isDeleted = true;

    batch.memoryCandidates = [
      {
        id: 'memory-1',
        type: 'memory',
        key: 'shared.riverside_walk',
        value: '过去两人常去河边散步',
        priority: 2,
        status: 'pending',
        sourceItemIds: [availableItem.id.toHexString()],
        sourceMessageIds: [availableItem.messageId.toHexString()],
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
      {
        id: 'memory-2',
        type: 'memory',
        key: 'deleted.evidence',
        value: '不应写入',
        priority: 1,
        status: 'pending',
        sourceItemIds: [deletedItem.id.toHexString()],
        sourceMessageIds: [deletedItem.messageId.toHexString()],
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
    ];

    const factId = new MongoObjectId();
    const service = new ConversationChatImportService();
    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.batchModel = {
      findOne: jest.fn().mockResolvedValue(batch),
      save: jest.fn().mockImplementation(async value => value),
    } as never;
    service.itemModel = {
      find: jest.fn().mockResolvedValue([availableItem, deletedItem]),
      save: jest.fn().mockImplementation(async value => value),
    } as never;
    service.agentProfileFactService = {
      upsertFromHistoricalImport: jest.fn().mockResolvedValue({ id: factId }),
    } as never;

    const result = await service.confirmMemoryCandidates(
      {
        sub: userId.toHexString(),
        accountId: new MongoObjectId().toHexString(),
        account: 'test',
        iat: 0,
        exp: 0,
        nonce: 'test',
      },
      conversation.id.toHexString(),
      batch.id.toHexString()
    );

    expect(
      service.agentProfileFactService.upsertFromHistoricalImport
    ).toHaveBeenCalledTimes(1);
    expect(batch.memoryCandidates[0]).toEqual(
      expect.objectContaining({
        status: 'confirmed',
        factId: factId.toHexString(),
      })
    );
    expect(batch.memoryCandidates[1].status).toBe('rejected');
    expect(availableItem.memoryFactIds?.[0]).toEqual(factId);
    expect(result.batch.status).toBe(ConversationChatImportStatus.completed);
  });
});
