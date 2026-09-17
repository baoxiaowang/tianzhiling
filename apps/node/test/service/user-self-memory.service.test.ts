import {
  MessageEntity,
  MongoObjectId,
  UserSelfFactDomain,
  UserSelfFactEntity,
  UserSelfFactStatus,
} from '@tzl/entities';
import {
  shouldExtractUserSelf,
  UserSelfMemoryService,
} from '../../src/service/agents/user-self-memory.service';

describe('UserSelfMemoryService', () => {
  describe('shouldExtractUserSelf', () => {
    it('accepts first-person statements about the user own situation', () => {
      for (const text of [
        '我想离婚，再不离，我真的没有活路了',
        '现在我工作压力很大，心里难受的紧',
        '我快坚持不住了',
      ]) {
        expect(shouldExtractUserSelf(text)).toBe(true);
      }
      // 承接式口语：本条没有"我"，但上一条用户消息是第一人称。
      expect(
        shouldExtractUserSelf('养娃压力很大的嘛，还要加油挣钱', [
          { role: 'user', content: '现在我工作压力很大，心里难受的紧' },
        ])
      ).toBe(true);
      expect(
        shouldExtractUserSelf('养娃压力很大的嘛，还要加油挣钱')
      ).toBe(false);
    });

    it('rejects pure address, longing, reassurance, kinship and bare acks', () => {
      for (const text of [
        '爸爸',
        '爸爸，我很想你',
        '你放心，我很好',
        '我没事',
        '好的',
        '妈妈已经领了养老保险了，就是挺忙，还是到处打工',
        '你放心，哥哥嫂子和你孙子孙女都很好',
      ]) {
        expect(shouldExtractUserSelf(text)).toBe(false);
      }
    });
  });

  it('extracts and stores the user own current situation', async () => {
    const service = new UserSelfMemoryService();
    const saved: UserSelfFactEntity[] = [];
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          facts: [
            {
              domain: 'work',
              key: 'work.pressure',
              value: '用户现在工作压力很大',
              status: 'current',
            },
            {
              domain: 'family',
              key: 'marriage.intent_divorce',
              value: '用户想离婚',
              status: 'uncertain',
            },
          ],
        }),
      }),
    } as never;
    service.selfFactModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => {
        saved.push(fact);
        return fact;
      }),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000801'),
      userId: new MongoObjectId('665000000000000000000802'),
      agentId: new MongoObjectId('665000000000000000000803'),
      createdAt: new Date('2026-09-16T13:10:00.455Z'),
    });

    await expect(
      service.extractFromUserMessage(message, '我想离婚，再不离，我真的没有活路了')
    ).resolves.toBe(2);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      domain: UserSelfFactDomain.work,
      key: 'work.pressure',
      status: UserSelfFactStatus.current,
      effectiveAt: message.createdAt,
      sourceMessageId: message.id,
    });
    expect(saved[1]).toMatchObject({
      key: 'marriage.intent_divorce',
      status: UserSelfFactStatus.uncertain,
    });
  });

  it('does not call the model for a kinship-only situation message', async () => {
    const service = new UserSelfMemoryService();
    const generateMemoryText = jest.fn();
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000804'),
      userId: new MongoObjectId('665000000000000000000805'),
      agentId: new MongoObjectId('665000000000000000000806'),
      createdAt: new Date('2026-09-16T13:11:00.000Z'),
    });

    await expect(
      service.extractFromUserMessage(message, '妈妈已经领了养老保险了')
    ).resolves.toBe(0);
    expect(generateMemoryText).not.toHaveBeenCalled();
  });

  it('keeps the previous current fact as history when the value changes', async () => {
    const service = new UserSelfMemoryService();
    const existing = Object.assign(new UserSelfFactEntity(), {
      id: new MongoObjectId('665000000000000000000807'),
      userId: new MongoObjectId('665000000000000000000808'),
      domain: UserSelfFactDomain.situation,
      key: 'situation.mood',
      value: '用户压力很大',
      status: UserSelfFactStatus.current,
      supportCount: 1,
    });
    const saved: UserSelfFactEntity[] = [];
    service.selfFactModel = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn(async fact => {
        saved.push(fact);
        return fact;
      }),
    } as never;

    await service.recordFact({
      userId: new MongoObjectId('665000000000000000000808'),
      domain: UserSelfFactDomain.situation,
      key: 'situation.mood',
      value: '用户最近轻松了一些',
      effectiveAt: new Date('2026-09-17T00:00:00.000Z'),
    });

    expect(existing.status).toBe(UserSelfFactStatus.historical);
    const inserted = saved.find(fact => fact.value === '用户最近轻松了一些');
    expect(inserted).toBeDefined();
    expect(inserted?.status).toBe(UserSelfFactStatus.current);
  });
});
