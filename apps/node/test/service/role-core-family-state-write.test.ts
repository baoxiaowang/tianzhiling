import {
  AgentEntity,
  MessageEntity,
  MongoObjectId,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
  UserRelativeFactDomain,
  UserRelativeFactEntity,
  UserRelativeFactStatus,
  UserRelativeProfileEntity,
  UserRelativeProfileStatus,
} from '@tzl/entities';
import { RelativeMemoryExtractorService } from '../../src/service/agents/relative-memory-extractor.service';
import {
  UserIdentityMemoryService,
} from '../../src/service/agents/user-identity-memory.service';
import { UserRelativeProfileService } from '../../src/service/agents/user-relative-profile.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const GRANDPA_AGENT_ID = new MongoObjectId('665000000000000000000010');
const FATHER_PERSON_ID = new MongoObjectId('665000000000000000000201');
const MESSAGE_ID = new MongoObjectId('665000000000000000000301');

function grandpaAgent(): AgentEntity {
  return Object.assign(new AgentEntity(), {
    id: GRANDPA_AGENT_ID,
    createdUserId: USER_ID,
    name: '爷爷',
    realName: '李长海',
    iCallAgent: '爷爷',
    agentCallMe: '孙女',
    status: 1,
  });
}

function fatherPerson(): UserKnownPersonEntity {
  return Object.assign(new UserKnownPersonEntity(), {
    id: FATHER_PERSON_ID,
    userId: USER_ID,
    relationToUser: '爸爸',
    status: UserKnownPersonStatus.active,
  });
}

function createMessage(content: string): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: MESSAGE_ID,
    userId: USER_ID,
    agentId: GRANDPA_AGENT_ID,
    content,
    createdAt: new Date('2026-09-19T08:00:00.000Z'),
  });
}

function buildExtractor(options: {
  content: string;
  people: unknown[];
  boundAgent: AgentEntity;
  personCallsUserMock?: jest.Mock;
  resolveByRelationMock?: jest.Mock;
}) {
  const service = new RelativeMemoryExtractorService();
  service.logger = { warn: jest.fn() } as never;
  service.openAIService = {
    isEnabled: jest.fn(() => true),
    generateMemoryText: jest.fn().mockResolvedValue({
      content: JSON.stringify({ people: options.people }),
    }),
  } as never;
  service.userIdentityMemoryService = {
    resolveKnownPersonReference: jest.fn().mockResolvedValue(null),
    countKnownPeopleByRelation: jest.fn().mockResolvedValue(1),
    resolveKnownPersonByRelation:
      options.resolveByRelationMock || jest.fn().mockResolvedValue(fatherPerson()),
    upsertKnownPersonDeclaration: jest.fn().mockResolvedValue(fatherPerson()),
    setPersonCallsUser:
      options.personCallsUserMock || jest.fn().mockResolvedValue(fatherPerson()),
  } as never;
  service.userRelativeProfileService = {
    setProfileState: jest.fn().mockResolvedValue({}),
    recordFact: jest.fn().mockResolvedValue({}),
  } as never;
  service.personTemporalMemoryService = {
    recordExplicitPersonDate: jest.fn().mockResolvedValue(null),
  } as never;
  return service;
}

describe('role-core family state write side', () => {
  it('writes another family member address to that person, not to the current role', async () => {
    const setPersonCallsUser = jest.fn().mockResolvedValue(fatherPerson());
    const service = buildExtractor({
      content: '爸爸叫我湾呐',
      boundAgent: grandpaAgent(),
      people: [
        {
          referenceName: '爸爸',
          relationToUser: '爸爸',
          personCallsUser: '湾呐',
        },
      ],
      personCallsUserMock: setPersonCallsUser,
    });

    await expect(
      service.captureFromUserMessage(
        createMessage('爸爸叫我湾呐'),
        '爸爸叫我湾呐',
        { boundAgent: grandpaAgent() }
      )
    ).resolves.toBe(1);

    // 目标校验：写到"爸爸"这个 personId 名下，并显式排除当前角色（爷爷）。
    expect(setPersonCallsUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        personId: FATHER_PERSON_ID,
        personCallsUser: '湾呐',
        sourceMessageId: MESSAGE_ID,
        excludeLinkedAgentId: GRANDPA_AGENT_ID,
      })
    );
    expect(
      service.userRelativeProfileService.setProfileState
    ).toHaveBeenCalledWith(
      expect.objectContaining({ personId: FATHER_PERSON_ID })
    );
  });

  it('never records the current role itself when the model names it', async () => {
    const setPersonCallsUser = jest.fn();
    const upsert = jest.fn().mockResolvedValue(fatherPerson());
    const service = buildExtractor({
      content: '爷爷叫我湾呐',
      boundAgent: grandpaAgent(),
      people: [
        {
          referenceName: '爷爷',
          relationToUser: '爷爷',
          personCallsUser: '湾呐',
        },
      ],
      personCallsUserMock: setPersonCallsUser,
    });
    (
      service.userIdentityMemoryService as unknown as {
        upsertKnownPersonDeclaration: jest.Mock;
      }
    ).upsertKnownPersonDeclaration = upsert;

    await expect(
      service.captureFromUserMessage(
        createMessage('爷爷叫我湾呐'),
        '爷爷叫我湾呐',
        { boundAgent: grandpaAgent() }
      )
    ).resolves.toBe(0);

    // 当前角色被主体边界排除：既不改它的默认称呼，也不建"另一个爷爷"。
    expect(setPersonCallsUser).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(
      service.userRelativeProfileService.setProfileState
    ).not.toHaveBeenCalled();
  });

  it('does not fabricate a death from a reunion question', async () => {
    const service = buildExtractor({
      content: '爸爸在下面团圆了吗？',
      boundAgent: grandpaAgent(),
      // 模型判读：问句不成立，不产出任何人物事实（程序不自行造事实）。
      people: [],
    });

    await expect(
      service.captureFromUserMessage(
        createMessage('爸爸在下面团圆了吗？'),
        '爸爸在下面团圆了吗？',
        { boundAgent: grandpaAgent() }
      )
    ).resolves.toBe(0);
    expect(
      service.personTemporalMemoryService.recordExplicitPersonDate
    ).not.toHaveBeenCalled();
    expect(service.userRelativeProfileService.recordFact).not.toHaveBeenCalled();
  });

  it('binds a death assertion to the stated subject only', async () => {
    const motherPerson = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000203'),
      userId: USER_ID,
      relationToUser: '妈妈',
      status: UserKnownPersonStatus.active,
    });
    const service = buildExtractor({
      content: '我爸爸去世了，妈妈挺好的',
      boundAgent: grandpaAgent(),
      people: [
        {
          referenceName: '爸爸',
          relationToUser: '爸爸',
          dates: [{ eventType: 'death', date: '2020-03-01' }],
        },
        {
          referenceName: '妈妈',
          relationToUser: '妈妈',
          facts: [
            { domain: 'other', key: 'other.status', value: '妈妈挺好的' },
          ],
        },
      ],
    });
    (
      service.userIdentityMemoryService as unknown as {
        resolveKnownPersonReference: jest.Mock;
        countKnownPeopleByRelation: jest.Mock;
        upsertKnownPersonDeclaration: jest.Mock;
      }
    ).resolveKnownPersonReference = jest.fn().mockResolvedValue(null);
    (
      service.userIdentityMemoryService as unknown as {
        countKnownPeopleByRelation: jest.Mock;
      }
    ).countKnownPeopleByRelation = jest.fn().mockResolvedValue(0);
    (
      service.userIdentityMemoryService as unknown as {
        upsertKnownPersonDeclaration: jest.Mock;
      }
    ).upsertKnownPersonDeclaration = jest.fn(
      async ({ declaration }: { declaration: { relationToUser: string } }) =>
        declaration.relationToUser === '爸爸' ? fatherPerson() : motherPerson
    );

    await service.captureFromUserMessage(
      createMessage('我爸爸去世了，妈妈挺好的'),
      '我爸爸去世了，妈妈挺好的',
      { boundAgent: grandpaAgent() }
    );

    const recordDate = service.personTemporalMemoryService
      .recordExplicitPersonDate as jest.Mock;
    expect(recordDate).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: 'relative',
        subjectId: FATHER_PERSON_ID,
        eventType: 'death',
      })
    );
    expect(
      recordDate.mock.calls.some(
        call => String(call[0].subjectId) === String(motherPerson.id)
      )
    ).toBe(false);
    expect(service.userRelativeProfileService.recordFact).toHaveBeenCalledWith(
      expect.objectContaining({ personId: motherPerson.id })
    );
  });

  it('instructs the extractor model on core states and no unverified merging', async () => {
    const service = buildExtractor({
      content: '爸爸在下面团圆了吗？',
      boundAgent: grandpaAgent(),
      people: [],
    });

    await service.captureFromUserMessage(
      createMessage('爸爸在下面团圆了吗？'),
      '爸爸在下面团圆了吗？',
      { boundAgent: grandpaAgent() }
    );

    const request = (service.openAIService.generateMemoryText as jest.Mock).mock
      .calls[0][0];
    expect(request.systemPrompt).toContain('personCallsUser');
    expect(request.systemPrompt).toContain('life_event.deceased');
    expect(request.systemPrompt).toContain('下面团圆了吗');
    expect(request.systemPrompt).toContain('routine.live_alone');
    expect(request.systemPrompt).toContain('work.long_distance');
    expect(request.systemPrompt).toContain('不得合并');
  });

  it('demotes an old core state to history instead of keeping it affirmative', async () => {
    const service = new UserRelativeProfileService();
    const profile = Object.assign(new UserRelativeProfileEntity(), {
      id: new MongoObjectId('665000000000000000000401'),
      userId: USER_ID,
      personId: FATHER_PERSON_ID,
      status: UserRelativeProfileStatus.active,
    });
    const current = Object.assign(new UserRelativeFactEntity(), {
      id: new MongoObjectId('665000000000000000000402'),
      userId: USER_ID,
      personId: FATHER_PERSON_ID,
      domain: UserRelativeFactDomain.routine,
      key: 'routine.live_alone',
      value: '爸爸目前独居',
      status: UserRelativeFactStatus.current,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const saved: UserRelativeFactEntity[] = [];
    service.relativeProfileModel = {
      findOne: jest.fn().mockResolvedValue(profile),
    } as never;
    service.relativeFactModel = {
      findOne: jest.fn().mockResolvedValue(current),
      save: jest.fn(async value => {
        value.id ||= new MongoObjectId('665000000000000000000403');
        saved.push(value);
        return value;
      }),
    } as never;

    const result = await service.recordFact({
      userId: USER_ID,
      personId: FATHER_PERSON_ID,
      domain: UserRelativeFactDomain.routine,
      key: 'routine.live_alone',
      value: '爸爸搬来和用户一起住了',
      status: UserRelativeFactStatus.current,
    });

    expect(current.status).toBe(UserRelativeFactStatus.historical);
    expect(result).toMatchObject({
      value: '爸爸搬来和用户一起住了',
      status: UserRelativeFactStatus.current,
    });
  });
});

describe('UserIdentityMemoryService personCallsUser', () => {
  function buildService(person: UserKnownPersonEntity | null) {
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      findOne: jest.fn().mockResolvedValue(person),
      save: jest.fn(async value => value),
    } as never;
    service.userRelativeProfileService = {
      ensureForKnownPerson: jest.fn().mockResolvedValue(null),
    } as never;
    service.openAIService = { isEnabled: jest.fn(() => false) } as never;
    return service;
  }

  it('rejects a target that is not an active person of this account', async () => {
    const service = buildService(null);
    await expect(
      service.setPersonCallsUser({
        userId: USER_ID,
        personId: FATHER_PERSON_ID,
        personCallsUser: '湾呐',
        sourceMessageId: MESSAGE_ID,
      })
    ).resolves.toBeNull();
    expect(service.knownPersonModel.save).not.toHaveBeenCalled();
  });

  it('refuses to record an address for the person linked to the current role', async () => {
    const person = Object.assign(fatherPerson(), { linkedAgentId: GRANDPA_AGENT_ID });
    const service = buildService(person);

    await expect(
      service.setPersonCallsUser({
        userId: USER_ID,
        personId: FATHER_PERSON_ID,
        personCallsUser: '湾呐',
        sourceMessageId: MESSAGE_ID,
        excludeLinkedAgentId: GRANDPA_AGENT_ID,
      })
    ).resolves.toBeNull();
    expect(person.personCallsUser).toBeUndefined();
    expect(service.knownPersonModel.save).not.toHaveBeenCalled();
  });

  it('is idempotent per source message and overwrites on a newer statement', async () => {
    const person = Object.assign(fatherPerson(), {
      personCallsUser: '湾呐',
      personCallsUserSourceMessageId: MESSAGE_ID,
    });
    const service = buildService(person);

    await service.setPersonCallsUser({
      userId: USER_ID,
      personId: FATHER_PERSON_ID,
      personCallsUser: '湾呐',
      sourceMessageId: MESSAGE_ID,
    });
    expect(service.knownPersonModel.save).not.toHaveBeenCalled();

    const nextMessageId = new MongoObjectId('665000000000000000000302');
    await service.setPersonCallsUser({
      userId: USER_ID,
      personId: FATHER_PERSON_ID,
      personCallsUser: '阿湾',
      sourceMessageId: nextMessageId,
    });
    expect(person.personCallsUser).toBe('阿湾');
    expect(person.personCallsUserSourceMessageId).toEqual(nextMessageId);
    expect(service.knownPersonModel.save).toHaveBeenCalledTimes(1);
  });

  it('does not merge an unverified appellation into another relative', async () => {
    const grandma = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000202'),
      userId: USER_ID,
      realName: '王秀兰',
      preferredName: '奶奶',
      relationToUser: '奶奶',
      identityKey: '奶奶|王秀兰',
      status: UserKnownPersonStatus.active,
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([grandma]),
      save: jest.fn(async value => value),
    } as never;
    service.userRelativeProfileService = {
      ensureForKnownPerson: jest.fn().mockResolvedValue(null),
    } as never;
    service.openAIService = { isEnabled: jest.fn(() => false) } as never;

    expect(
      await service.resolveKnownPersonReference({
        userId: USER_ID,
        referenceName: '婆婆',
        relationToUser: '婆婆',
      })
    ).toBeNull();

    const created = await service.upsertKnownPersonDeclaration({
      userId: USER_ID,
      agentId: GRANDPA_AGENT_ID,
      messageId: MESSAGE_ID,
      sourceText: '婆婆叫李桂芳',
      declaration: {
        identityKey: '婆婆|李桂芳',
        realName: '李桂芳',
        aliases: [],
        relationToUser: '婆婆',
      },
    });

    expect(created.relationToUser).toBe('婆婆');
    expect(created.realName).toBe('李桂芳');
    // 原有"奶奶"记录未被改写、未被合并。
    expect(grandma.realName).toBe('王秀兰');
    expect(grandma.relationToUser).toBe('奶奶');
    expect(service.knownPersonModel.save).toHaveBeenCalledTimes(1);
  });
});
