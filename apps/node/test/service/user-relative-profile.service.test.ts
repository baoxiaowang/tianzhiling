import {
  MongoObjectId,
  UserKnownPersonEntity,
  UserRelativeFactDomain,
  UserRelativeFactEntity,
  UserRelativeFactStatus,
  UserRelativeProfileEntity,
  UserRelativeProfileStatus,
} from '@tzl/entities';
import {
  isRelativeRelation,
  UserRelativeProfileService,
} from '../../src/service/agents/user-relative-profile.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const OTHER_USER_ID = new MongoObjectId('665000000000000000000002');
const PERSON_ID = new MongoObjectId('665000000000000000000201');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

describe('UserRelativeProfileService', () => {
  it('creates one account-level relative profile for a known family person', async () => {
    const service = new UserRelativeProfileService();
    let stored: UserRelativeProfileEntity | null = null;
    service.relativeProfileModel = {
      findOne: jest.fn(async () => stored),
      save: jest.fn(async value => {
        value.id ||= new MongoObjectId('665000000000000000000301');
        stored = value;
        return value;
      }),
    } as never;

    const profile = await service.ensureForKnownPerson({
      userId: USER_ID,
      personId: PERSON_ID,
      relationToUser: '女儿',
    });
    const sameProfile = await service.ensureForKnownPerson({
      userId: USER_ID,
      personId: PERSON_ID,
      relationToUser: '女儿',
    });

    expect(profile).toMatchObject({
      userId: USER_ID,
      personId: PERSON_ID,
      status: UserRelativeProfileStatus.active,
      lifeStage: 'unknown',
    });
    expect(sameProfile?.id).toEqual(profile?.id);
    expect(service.relativeProfileModel.save).toHaveBeenCalledTimes(1);
    expect(isRelativeRelation('妈妈')).toBe(true);
    expect(isRelativeRelation('朋友')).toBe(false);
  });

  it('keeps changed current facts as history instead of overwriting them', async () => {
    const service = new UserRelativeProfileService();
    const profile = Object.assign(new UserRelativeProfileEntity(), {
      id: new MongoObjectId('665000000000000000000301'),
      userId: USER_ID,
      personId: PERSON_ID,
      status: UserRelativeProfileStatus.active,
    });
    const current = Object.assign(new UserRelativeFactEntity(), {
      id: new MongoObjectId('665000000000000000000401'),
      userId: USER_ID,
      personId: PERSON_ID,
      domain: UserRelativeFactDomain.health,
      key: 'health.fever',
      value: '孩子今天发烧',
      status: UserRelativeFactStatus.current,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const saved: UserRelativeFactEntity[] = [];
    service.relativeProfileModel = {
      findOne: jest.fn(async ({ where }: any) =>
        String(where.userId) === String(USER_ID) ? profile : null
      ),
    } as never;
    service.relativeFactModel = {
      findOne: jest.fn(async () => current),
      save: jest.fn(async value => {
        value.id ||= new MongoObjectId('665000000000000000000402');
        saved.push(value);
        return value;
      }),
    } as never;

    const result = await service.recordFact({
      userId: USER_ID,
      personId: PERSON_ID,
      domain: UserRelativeFactDomain.health,
      key: 'health.fever',
      value: '孩子体温已经下降',
    });
    const rejected = await service.recordFact({
      userId: OTHER_USER_ID,
      personId: PERSON_ID,
      domain: UserRelativeFactDomain.health,
      key: 'health.fever',
      value: '不得跨账户写入',
    });

    expect(current.status).toBe(UserRelativeFactStatus.historical);
    expect(result).toMatchObject({
      userId: USER_ID,
      personId: PERSON_ID,
      value: '孩子体温已经下降',
      status: UserRelativeFactStatus.current,
    });
    expect(rejected).toBeNull();
    expect(saved).toHaveLength(2);
  });

  it('loads only account-scoped relatives relevant to the current topic', async () => {
    const service = new UserRelativeProfileService();
    const profile = Object.assign(new UserRelativeProfileEntity(), {
      id: new MongoObjectId('665000000000000000000301'),
      userId: USER_ID,
      personId: PERSON_ID,
      status: UserRelativeProfileStatus.active,
      lifeStage: 'school_age',
      relationshipsToAgents: [
        {
          agentId: AGENT_ID,
          relationToAgent: '外孙女',
          personCallsAgent: '外婆',
          updatedAt: new Date(),
        },
      ],
      updatedAt: new Date(),
    });
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: PERSON_ID,
      userId: USER_ID,
      preferredName: '安安',
      realName: '赵安宁',
      aliases: ['二宝'],
      relationToUser: '女儿',
      status: 'active',
    });
    const fact = Object.assign(new UserRelativeFactEntity(), {
      personId: PERSON_ID,
      domain: UserRelativeFactDomain.education,
      key: 'education.school_stage',
      value: '安安已经上小学',
      status: UserRelativeFactStatus.current,
      updatedAt: new Date(),
    });
    service.relativeProfileModel = {
      find: jest.fn(async ({ where }: any) =>
        String(where.userId) === String(USER_ID) ? [profile] : []
      ),
    } as never;
    service.knownPersonModel = {
      find: jest.fn(async ({ where }: any) =>
        String(where.userId) === String(USER_ID) ? [person] : []
      ),
    } as never;
    service.relativeFactModel = {
      find: jest.fn(async ({ where }: any) =>
        String(where.userId) === String(USER_ID) ? [fact] : []
      ),
    } as never;

    expect(
      await service.listRelevantForPrompt({
        userId: USER_ID,
        agentId: AGENT_ID,
        query: '安安最近上学怎么样',
      })
    ).toEqual([
      {
        id: `person:${PERSON_ID.toString()}`,
        preferredName: '安安',
        realName: '赵安宁',
        aliases: ['二宝'],
        relationToUser: '女儿',
        relationToAgent: '外孙女',
        personCallsAgent: '外婆',
        lifeStage: 'school_age',
        sex: undefined,
        birthDate: undefined,
        birthYear: undefined,
        facts: [
          {
            domain: UserRelativeFactDomain.education,
            key: 'education.school_stage',
            value: '安安已经上小学',
            status: UserRelativeFactStatus.current,
            occurredAt: undefined,
          },
        ],
      },
    ]);
    expect(
      await service.listRelevantForPrompt({
        userId: USER_ID,
        query: '今天天气怎么样',
      })
    ).toEqual([]);
  });
});
