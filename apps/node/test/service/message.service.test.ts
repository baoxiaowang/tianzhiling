import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { MessageService } from '../../src/service/message.service';

const USER_ID = '665000000000000000000001';
const CONVERSATION_ID = '665000000000000000000102';
const AUTH = {
  sub: USER_ID,
  accountId: 'account-1',
  account: 'user',
  iat: 1777795200,
  exp: 1777824000,
  nonce: 'nonce',
};

function createTextMessage(
  content: string,
  options: { id?: string; createdAt?: string } = {}
): MessageEntity {
  const message = new MessageEntity();
  message.id = new MongoObjectId(options.id ?? '665000000000000000000101');
  message.conversationId = new MongoObjectId('665000000000000000000102');
  message.role = MessageRole.assistant;
  message.type = MessageType.text;
  message.content = content;
  message.status = MessageStatus.sent;
  message.createdAt = new Date(options.createdAt ?? '2026-05-03T08:00:00.000Z');
  message.updatedAt = message.createdAt;

  return message;
}

describe('MessageService buildConversationMessageItem', () => {
  it('omits quote data when a message has no quoted snapshot', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('没有引用任何消息')
    );

    expect(item.quote).toBeUndefined();
  });

  it('normalizes malformed legacy fenge separators for old messages', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('第一段</fenge]第二段 [fenge] 第三段')
    );

    expect(item.content).toBe('第一段</fenge>第二段</fenge>第三段');
    expect(item.segments).toEqual(['第一段', '第二段', '第三段']);
  });

  it('normalizes accented incomplete fenge separators for old messages', () => {
    const service = new MessageService();
    const malformedSeparator = '</f' + String.fromCharCode(0x00e8) + 'ge';
    const item = service.buildConversationMessageItem(
      createTextMessage(`第一段${malformedSeparator}第二段`)
    );

    expect(item.content).toBe('第一段</fenge>第二段');
    expect(item.segments).toEqual(['第一段', '第二段']);
  });

  it('keeps paragraph splitting as a fallback when no separator exists', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('第一段\n\n第二段')
    );

    expect(item.content).toBe('第一段</fenge>第二段');
    expect(item.segments).toEqual(['第一段', '第二段']);
  });

  it('does not split stored assistant reply segments again for the client', () => {
    const service = new MessageService();
    const message = createTextMessage('第一句</fenge>第二句');
    message.replyGroupId = 'reply-group-1';
    message.replySegmentIndex = 0;

    const item = service.buildConversationMessageItem(message);

    expect(item.content).toBe('第一句 第二句');
    expect(item.segments).toEqual(['第一句 第二句']);
  });

  it('strips a trailing malformed separator from a single segment', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('第一段</fenge]')
    );

    expect(item.content).toBe('第一段');
    expect(item.segments).toEqual(['第一段']);
  });

  it('exposes generated voice audio on assistant text messages', () => {
    const service = new MessageService();
    const message = createTextMessage('第一段</fenge>第二段');
    message.mediaObjectKey = 'conversation-voice-replies/reply.mp3';
    message.mediaMimeType = 'audio/mpeg';
    message.mediaTranscript = '第一段。第二段。';
    message.mediaDurationMs = 2400;

    const item = service.buildConversationMessageItem(message);

    expect(item.type).toBe(MessageType.text);
    expect(item.voice).toEqual({
      objectKey: 'conversation-voice-replies/reply.mp3',
      url: undefined,
      mimeType: 'audio/mpeg',
      transcript: '第一段。第二段。',
      durationMs: 2400,
    });
  });

  it('does not expose media fields on user text messages as voice audio', () => {
    const service = new MessageService();
    const message = createTextMessage('用户文字');
    message.role = MessageRole.user;
    message.mediaObjectKey = 'conversation-voice-replies/reply.mp3';
    message.mediaMimeType = 'audio/mpeg';

    const item = service.buildConversationMessageItem(message);

    expect(item.voice).toBeUndefined();
  });

  it('exposes generated memorial photos as image payloads', () => {
    const service = new MessageService();
    const message = createTextMessage('AI生成纪念合照');
    message.type = MessageType.image;
    message.mediaObjectKey = 'memorial-photos/generated.png';
    message.mediaMimeType = 'image/png';
    message.mediaAnalysis = 'AI生成纪念合照';

    const item = service.buildConversationMessageItem(message);

    expect(item.type).toBe(MessageType.image);
    expect(item.image).toEqual({
      objectKey: 'memorial-photos/generated.png',
      url: undefined,
      mimeType: 'image/png',
      analysis: 'AI生成纪念合照',
    });
  });

  it('exposes quoted message snapshots', () => {
    const service = new MessageService();
    const message = createTextMessage('不是这个意思');
    message.role = MessageRole.user;
    message.quotedMessageId = new MongoObjectId('665000000000000000000111');
    message.quotedMessageRole = MessageRole.assistant;
    message.quotedMessageContent = '你以前总爱吃辣';

    const item = service.buildConversationMessageItem(message);

    expect(item.quote).toEqual({
      messageId: '665000000000000000000111',
      role: MessageRole.assistant,
      content: '你以前总爱吃辣',
    });
  });
});

describe('MessageService listMessages', () => {
  it('loads only non-archived conversation messages', async () => {
    const service = new MessageService();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId(CONVERSATION_ID);
    conversation.userId = new MongoObjectId(USER_ID);
    const activeMessage = createTextMessage('还在的消息');

    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.messageModel = {
      find: jest.fn().mockResolvedValue([activeMessage]),
    } as never;

    const result = await service.listMessages(AUTH, CONVERSATION_ID);

    expect(service.messageModel.find).toHaveBeenCalledWith({
      where: {
        conversationId: conversation.id,
        isArchived: { $ne: true },
      },
      order: {
        createdAt: 'ASC',
      },
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          content: '还在的消息',
        }),
      ],
    });
  });

  it('loads the latest message page in chronological order', async () => {
    const service = new MessageService();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId(CONVERSATION_ID);
    conversation.userId = new MongoObjectId(USER_ID);
    const newestMessage = createTextMessage('第三条', {
      id: '665000000000000000000203',
      createdAt: '2026-05-03T08:02:00.000Z',
    });
    const middleMessage = createTextMessage('第二条', {
      id: '665000000000000000000202',
      createdAt: '2026-05-03T08:01:00.000Z',
    });
    const oldestMessage = createTextMessage('第一条', {
      id: '665000000000000000000201',
      createdAt: '2026-05-03T08:00:00.000Z',
    });

    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.messageModel = {
      find: jest.fn().mockResolvedValue([
        newestMessage,
        middleMessage,
        oldestMessage,
      ]),
    } as never;

    const result = await service.listMessages(AUTH, CONVERSATION_ID, {
      pageSize: '2',
    });

    expect(service.messageModel.find).toHaveBeenCalledWith({
      where: {
        conversationId: conversation.id,
        isArchived: { $ne: true },
      },
      order: {
        createdAt: 'DESC',
      },
      take: 3,
    });
    expect(result.items.map(item => item.content)).toEqual(['第二条', '第三条']);
    expect(result.pageSize).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it('loads older messages before the provided createdAt cursor', async () => {
    const service = new MessageService();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId(CONVERSATION_ID);
    conversation.userId = new MongoObjectId(USER_ID);
    const cursor = '2026-05-03T08:03:00.000Z';
    const messages = [
      createTextMessage('第二条', {
        id: '665000000000000000000302',
        createdAt: '2026-05-03T08:01:00.000Z',
      }),
      createTextMessage('第一条', {
        id: '665000000000000000000301',
        createdAt: '2026-05-03T08:00:00.000Z',
      }),
    ];

    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.messageModel = {
      find: jest.fn().mockResolvedValue(messages),
    } as never;

    const result = await service.listMessages(AUTH, CONVERSATION_ID, {
      pageSize: 20,
      beforeCreatedAt: cursor,
    });

    expect(service.messageModel.find).toHaveBeenCalledWith({
      where: {
        conversationId: conversation.id,
        isArchived: { $ne: true },
        createdAt: {
          $lt: new Date(cursor),
        },
      },
      order: {
        createdAt: 'DESC',
      },
      take: 21,
    });
    expect(result.items.map(item => item.content)).toEqual(['第一条', '第二条']);
    expect(result.hasMore).toBe(false);
  });
});

describe('MessageService deleteMessage', () => {
  it('marks the message as archived without removing it', async () => {
    const service = new MessageService();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId(CONVERSATION_ID);
    conversation.userId = new MongoObjectId(USER_ID);
    const message = createTextMessage('要删除的消息');
    message.conversationId = conversation.id;

    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async item => item),
    } as never;

    await service.deleteMessage(AUTH, CONVERSATION_ID, message.id.toHexString());

    expect(message.isArchived).toBe(true);
    expect(message.archivedAt).toBeInstanceOf(Date);
    expect(message.updatedAt).toBe(message.archivedAt);
    expect(service.messageModel.save).toHaveBeenCalledWith(message);
  });

  it('does not save an already archived message again', async () => {
    const service = new MessageService();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId(CONVERSATION_ID);
    conversation.userId = new MongoObjectId(USER_ID);
    const message = createTextMessage('已经删除的消息');
    message.conversationId = conversation.id;
    message.isArchived = true;
    message.archivedAt = new Date('2026-05-03T09:00:00.000Z');

    service.conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation),
    } as never;
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(),
    } as never;

    await service.deleteMessage(AUTH, CONVERSATION_ID, message.id.toHexString());

    expect(service.messageModel.save).not.toHaveBeenCalled();
  });
});
