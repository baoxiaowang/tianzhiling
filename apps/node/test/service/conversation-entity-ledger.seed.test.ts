import {
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import { ConversationEntityLedgerService } from '../../src/service/agents/conversation-entity-ledger.service';

describe('ConversationEntityLedgerService seed', () => {
  it('backfills an explicit name relation from recent user messages', async () => {
    const service = new ConversationEntityLedgerService();
    service.logger = { warn: jest.fn(), info: jest.fn() } as never;
    const saved: Array<{ key: string; field: string; value: string }> = [];
    service.redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      hset: jest.fn((key: string, field: string, value: string) => {
        saved.push({ key, field, value });
        return Promise.resolve(1);
      }),
      expire: jest.fn().mockResolvedValue(1),
    } as never;
    const conversationId = new MongoObjectId('665000000000000000000601');
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000602'),
      conversationId,
      userId: new MongoObjectId('665000000000000000000603'),
      agentId: new MongoObjectId('665000000000000000000604'),
      role: MessageRole.user,
      content: '豆丁，你的儿子',
      createdAt: new Date('2026-10-27T15:29:12.000Z'),
    });
    service.messageModel = {
      find: jest.fn().mockResolvedValue([message]),
    } as never;

    await (service as any).seedFromRecentMessages(conversationId);

    expect(saved).toHaveLength(1);
    expect(saved[0].field).toBe('豆丁');
    expect(saved[0].value).toContain('"relationToAgent":"儿子"');
    expect(service.redisService.set).toHaveBeenCalledWith(
      `conversation:entity-ledger:seeded:${String(conversationId)}`,
      '1',
      'EX',
      30 * 24 * 60 * 60
    );
  });
});
