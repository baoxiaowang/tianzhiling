import {
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';
import { getUserRequestWriteMode } from '../../src/service/memory-write-guard';

function message(): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: new MongoObjectId('665000000000000000000b01'),
    userId: new MongoObjectId('665000000000000000000b02'),
    agentId: new MongoObjectId('665000000000000000000b03'),
    conversationId: new MongoObjectId('665000000000000000000b04'),
    content: '以后叫我瑶瑶',
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
  });
}

function fact(key: string, value: string) {
  return {
    type: key.startsWith('style')
      ? AgentProfileFactType.style
      : key.startsWith('taboo')
      ? AgentProfileFactType.taboo
      : AgentProfileFactType.relationship,
    key,
    value,
    polarity: AgentProfileFactPolarity.positive,
    confidence: AgentProfileFactConfidence.extracted,
    priority: 3,
    status: AgentProfileFactStatus.active,
  };
}

describe('explicit user request write', () => {
  it('defaults to active with off/shadow overrides', () => {
    expect(getUserRequestWriteMode({} as NodeJS.ProcessEnv)).toBe('active');
    expect(
      getUserRequestWriteMode({
        USER_REQUEST_WRITE_MODE: 'shadow',
      } as NodeJS.ProcessEnv)
    ).toBe('shadow');
    expect(
      getUserRequestWriteMode({
        NODE_USER_REQUEST_WRITE_MODE: 'off',
      } as NodeJS.ProcessEnv)
    ).toBe('off');
  });


  const previous = process.env.USER_REQUEST_WRITE_MODE;
  afterEach(() => {
    process.env.USER_REQUEST_WRITE_MODE = previous;
  });

  it('writes only whitelisted preference keys in active mode', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    (service as any).extractFactsWithRules = jest.fn().mockReturnValue([
      fact('relationship.preferred_user_name', '当前用户希望当前角色称呼其为瑶瑶'),
      fact('style.preference.closing_question', '不要总在结尾提问'),
      fact('identity.relationship', '当前角色是用户的爸爸'),
    ]);
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const written = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后叫我瑶瑶，别总在最后问我问题',
    });

    expect(written.map(item => item.key)).toEqual([
      'relationship.preferred_user_name',
      'style.preference.closing_question',
    ]);
    expect(upsertFact).toHaveBeenCalledTimes(2);
    expect(upsertFact.mock.calls[0][0]).toMatchObject({
      key: 'relationship.preferred_user_name',
      confidence: AgentProfileFactConfidence.confirmed,
      trustedSource: true,
    });
  });

  it('does not write in shadow mode', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'shadow';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    (service as any).extractFactsWithRules = jest
      .fn()
      .mockReturnValue([fact('style.preference.verbosity', '回复短一点')]);
    const upsertFact = jest.fn();
    (service as any).upsertFact = upsertFact;

    const written = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后说话短一点',
    });

    expect(written).toHaveLength(1);
    expect(upsertFact).not.toHaveBeenCalled();
    expect(service.logger.info).toHaveBeenCalled();
  });

  it('reuses the existing rule extractors for real request text', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const address = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后叫我瑶瑶',
    });
    const addressWithRemember = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '记住，以后叫我瑶瑶',
    });
    const style = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后别总在最后问我问题',
    });
    const taboo = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后别提炼他前妻',
    });

    expect(address.map(item => item.key)).toContain(
      'relationship.preferred_user_name'
    );
    expect(addressWithRemember.map(item => item.key)).toContain(
      'relationship.preferred_user_name'
    );
    expect(style.map(item => item.key)).toContain(
      'style.preference.closing_question'
    );
    expect(taboo.some(item => item.key.startsWith('taboo.'))).toBe(true);
  });

  it('writes a regional expression preference from shared origin', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const written = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '你是四川人，我们是四川人',
    });

    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'style.preference.region_dialect',
          value: '用户希望沿用四川地区的表达习惯交流',
        }),
      ])
    );
    expect(upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'style.preference.region_dialect',
        confidence: AgentProfileFactConfidence.confirmed,
      })
    );
  });

  it('can write a region preference and an address preference together', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const written = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '你是四川人，我们是四川人，以后叫我瑶瑶',
    });

    expect(written.map(item => item.key)).toEqual(
      expect.arrayContaining([
        'style.preference.region_dialect',
        'relationship.preferred_user_name',
      ])
    );
    expect(upsertFact).toHaveBeenCalledTimes(2);
  });

  it('writes global comfort taboos and death wording', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    service.factModel = { findOne: jest.fn().mockResolvedValue(null) } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const written = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后别跟我说节哀，我们不说死，说走了',
    });

    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'taboo.comfort.avoid',
          value: '不要对用户说“节哀”',
          preferenceScope: 'global',
        }),
        expect.objectContaining({
          key: 'style.preference.death_wording',
          value: '用“走了”，不用“死”',
          preferenceScope: 'global',
        }),
      ])
    );
    expect(upsertFact).toHaveBeenCalledTimes(2);
  });

  it('merges new comfort phrases into the existing list', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    service.factModel = {
      findOne: jest.fn().mockResolvedValue({
        value: '不要对用户说“节哀”',
      }),
    } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '以后别跟我说想开点',
    });

    expect(upsertFact).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'taboo.comfort.avoid',
        value: '不要对用户说“节哀、想开点”',
      })
    );
  });

  it('writes a per-person kinship display preference', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const personId = new MongoObjectId('665000000000000000000b09');
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
    } as never;
    service.userIdentityMemoryService = {
      resolveKnownPersonReference: jest.fn().mockResolvedValue({
        id: personId,
        relationToUser: '外祖父',
        realName: null,
        preferredName: null,
      }),
    } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const written = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '别叫姥爷，叫外公',
    });

    expect(written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `style.preference.kinship_display.${personId.toString()}`,
          value: '用户希望称外祖父为“外公”，不要叫“姥爷”',
          preferenceScope: 'person',
        }),
      ])
    );
  });

  it('writes a contextual taboo instead of a global one', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const upsertFact = jest.fn().mockResolvedValue({});
    (service as any).upsertFact = upsertFact;

    const emotion = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '我哭的时候别讲道理',
    });
    const time = await service.recordExplicitUserRequest({
      message: message(),
      searchableText: '晚上别提他',
    });

    expect(emotion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'taboo.context.topic.哭',
          value: '当用户哭时，不要讲道理',
          preferenceScope: 'topic',
        }),
      ])
    );
    expect(time).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'taboo.context.time.晚上',
          preferenceScope: 'time',
        }),
      ])
    );
  });

  it('does not write memory/task/one-off requests', async () => {
    process.env.USER_REQUEST_WRITE_MODE = 'active';
    const service = new AgentProfileFactService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const extractFactsWithRules = jest.fn();
    (service as any).extractFactsWithRules = extractFactsWithRules;
    const upsertFact = jest.fn();
    (service as any).upsertFact = upsertFact;

    for (const text of ['记住我婆婆是山东人', '帮我查一下天气', '今天先别讲道理']) {
      await service.recordExplicitUserRequest({
        message: message(),
        searchableText: text,
      });
    }

    expect(extractFactsWithRules).not.toHaveBeenCalled();
    expect(upsertFact).not.toHaveBeenCalled();
  });
});
