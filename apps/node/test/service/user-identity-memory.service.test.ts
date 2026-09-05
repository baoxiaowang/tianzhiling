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
});

function createMessage(content: string): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: new MongoObjectId('665000000000000000000101'),
    userId: USER_ID,
    agentId: AGENT_ID,
    content,
  });
}
