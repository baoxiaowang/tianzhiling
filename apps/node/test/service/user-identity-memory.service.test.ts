import {
  MessageEntity,
  MongoObjectId,
  UserIdentityProfileEntity,
  UserKnownPersonEntity,
} from '@tzl/entities';
import {
  extractKnownPersonDeclarations,
  UserIdentityMemoryService,
} from '../../src/service/agents/user-identity-memory.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

describe('UserIdentityMemoryService', () => {
  it('extracts explicit people but refuses questions and keeps relation in identity key', () => {
    expect(extractKnownPersonDeclarations('大宝叫李雨桐，是我女儿。')).toEqual([
      {
        identityKey: '女儿|李雨桐',
        realName: '李雨桐',
        aliases: ['大宝'],
        relationToUser: '女儿',
      },
    ]);
    expect(extractKnownPersonDeclarations('李雨桐是我女儿。')).toEqual([
      {
        identityKey: '女儿|李雨桐',
        realName: '李雨桐',
        aliases: [],
        relationToUser: '女儿',
      },
    ]);
    expect(extractKnownPersonDeclarations('李雨桐是我女儿吗？')).toEqual([]);
    expect(
      extractKnownPersonDeclarations('李明是我朋友，李明是我同事。').map(
        item => item.identityKey
      )
    ).toEqual(['朋友|李明', '同事|李明']);
    expect(extractKnownPersonDeclarations('大宝最近很想你。')).toEqual([]);
  });

  it('moves a changed global user name into history and exposes it to every agent', async () => {
    const service = new UserIdentityMemoryService();
    let stored: UserIdentityProfileEntity | null = null;
    service.identityModel = {
      findOne: jest.fn(async () => stored),
      save: jest.fn(async value => {
        value.id = new MongoObjectId('665000000000000000000100');
        stored = value;
        return value;
      }),
      updateOne: jest.fn(async (_filter, update: any) => {
        Object.assign(stored!, update.$set);
        return { modifiedCount: 1 };
      }),
    } as never;
    service.knownPersonModel = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async value => value),
    } as never;

    const first = createMessage('我叫赵浩洁');
    await service.recordFromUserMessage(first, first.content);
    const changed = createMessage('我改成赵皓洁了弟弟');
    changed.id = new MongoObjectId('665000000000000000000102');
    await service.recordFromUserMessage(changed, changed.content);

    expect(await service.getUserIdentity(USER_ID)).toEqual({
      realName: '赵皓洁',
      formerNames: ['赵浩洁'],
      aliases: expect.arrayContaining(['浩洁', '浩浩', '洁洁', '皓洁', '皓皓']),
    });
  });

  it('loads a known person only when a name or alias is mentioned', async () => {
    const service = new UserIdentityMemoryService();
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000201'),
      realName: '李雨桐',
      aliases: ['大宝'],
      relationToUser: '女儿',
    });
    service.knownPersonModel = {
      find: jest.fn(async () => [person]),
    } as never;

    expect(
      await service.listRelevantKnownPeople({
        userId: USER_ID,
        query: '大宝最近又不舒服了',
      })
    ).toEqual([
      {
        id: 'person:665000000000000000000201',
        realName: '李雨桐',
        aliases: ['大宝'],
        relationToUser: '女儿',
      },
    ]);
    expect(
      await service.listRelevantKnownPeople({
        userId: USER_ID,
        query: '今天天气怎么样',
      })
    ).toEqual([]);
  });

  it('creates an account-level relative profile for an explicitly named relative', async () => {
    const service = new UserIdentityMemoryService();
    const ensureForKnownPerson = jest.fn(async () => null);
    service.identityModel = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async value => value),
    } as never;
    service.knownPersonModel = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async value => {
        value.id = new MongoObjectId('665000000000000000000201');
        return value;
      }),
    } as never;
    service.userRelativeProfileService = {
      ensureForKnownPerson,
    } as never;
    const message = createMessage('李雨桐是我女儿');

    await service.recordFromUserMessage(message, message.content);

    expect(ensureForKnownPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        personId: new MongoObjectId('665000000000000000000201'),
        relationToUser: '女儿',
      })
    );
  });

  it('keeps one stable person when a nickname is later linked to a formal name', async () => {
    const service = new UserIdentityMemoryService();
    const people: UserKnownPersonEntity[] = [];
    service.identityModel = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async value => value),
    } as never;
    service.knownPersonModel = {
      find: jest.fn(async () => people),
      save: jest.fn(async value => {
        value.id ||= new MongoObjectId('665000000000000000000221');
        if (!people.includes(value)) people.push(value);
        return value;
      }),
    } as never;
    service.userRelativeProfileService = {
      ensureForKnownPerson: jest.fn(async () => null),
    } as never;

    const nickname = createMessage('浩浩是我儿子');
    await service.recordFromUserMessage(nickname, nickname.content);
    const formal = createMessage('浩浩名字叫赵浩帅，是我儿子');
    formal.id = new MongoObjectId('665000000000000000000222');
    await service.recordFromUserMessage(formal, formal.content);

    expect(people).toHaveLength(1);
    expect(people[0].identityKey).toMatch(/^person:/);
    expect(people[0]).toMatchObject({
      realName: '赵浩帅',
      preferredName: '浩浩',
      aliases: ['浩浩'],
    });
  });

  it('keeps an agent-specific preferred address out of global aliases', async () => {
    const service = new UserIdentityMemoryService();
    const save = jest.fn(async value => value);
    service.identityModel = {
      findOne: jest.fn(async () => null),
      save,
    } as never;
    service.knownPersonModel = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async value => value),
    } as never;
    const message = createMessage('以后你就叫我洁洁');

    await service.recordFromUserMessage(message, message.content);

    expect(save).not.toHaveBeenCalled();
  });

  it('resolves a contained formal name or nickname but rejects ambiguous relations', async () => {
    const service = new UserIdentityMemoryService();
    const first = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000201'),
      userId: USER_ID,
      realName: '赵浩帅',
      preferredName: '浩浩',
      aliases: ['帅帅'],
      relationToUser: '儿子',
      status: 'active',
    });
    const second = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000202'),
      userId: USER_ID,
      realName: '赵安宁',
      preferredName: '安安',
      relationToUser: '儿子',
      status: 'active',
    });
    service.knownPersonModel = {
      find: jest.fn(async () => [first, second]),
    } as never;

    await expect(
      service.resolveKnownPersonMention({
        userId: USER_ID,
        mention: '我的儿子浩浩',
      })
    ).resolves.toBe(first);
    await expect(
      service.resolveKnownPersonMention({ userId: USER_ID, mention: '儿子' })
    ).resolves.toBeNull();
  });
});

function createMessage(content: string): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: new MongoObjectId('665000000000000000000101'),
    userId: USER_ID,
    agentId: AGENT_ID,
    content,
  });
}
