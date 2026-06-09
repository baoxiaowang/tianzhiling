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
});
