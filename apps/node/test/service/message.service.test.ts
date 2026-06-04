import {
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { MessageService } from '../../src/service/message.service';

function createTextMessage(content: string): MessageEntity {
  const message = new MessageEntity();
  message.id = new MongoObjectId('665000000000000000000101');
  message.conversationId = new MongoObjectId('665000000000000000000102');
  message.role = MessageRole.assistant;
  message.type = MessageType.text;
  message.content = content;
  message.status = MessageStatus.sent;
  message.createdAt = new Date('2026-05-03T08:00:00.000Z');
  message.updatedAt = new Date('2026-05-03T08:00:00.000Z');

  return message;
}

describe('MessageService buildConversationMessageItem', () => {
  it('normalizes malformed legacy fenge separators for old messages', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('第一段</fenge]第二段 [fenge] 第三段')
    );

    expect(item.content).toBe('第一段</fenge>第二段</fenge>第三段');
    expect(item.segments).toEqual(['第一段', '第二段', '第三段']);
  });

  it('keeps paragraph splitting as a fallback when no separator exists', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('第一段\n\n第二段')
    );

    expect(item.content).toBe('第一段</fenge>第二段');
    expect(item.segments).toEqual(['第一段', '第二段']);
  });

  it('strips a trailing malformed separator from a single segment', () => {
    const service = new MessageService();
    const item = service.buildConversationMessageItem(
      createTextMessage('第一段</fenge]')
    );

    expect(item.content).toBe('第一段');
    expect(item.segments).toEqual(['第一段']);
  });
});
