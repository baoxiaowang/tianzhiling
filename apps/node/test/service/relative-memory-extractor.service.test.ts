import {
  AgentEntity,
  AgentSex,
  MessageEntity,
  MongoObjectId,
  UserKnownPersonEntity,
  UserRelativeFactDomain,
} from '@tzl/entities';
import { RelativeMemoryExtractorService } from '../../src/service/agents/relative-memory-extractor.service';

describe('RelativeMemoryExtractorService', () => {
  it('records an explicit account-level user birthday without a model call', async () => {
    const service = new RelativeMemoryExtractorService();
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn(),
    } as never;
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn().mockResolvedValue({}),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000511'),
      userId: new MongoObjectId('665000000000000000000512'),
      agentId: new MongoObjectId('665000000000000000000513'),
      content: '我的生日是1992年8月1日',
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    });

    await expect(
      service.captureFromUserMessage(message, message.content)
    ).resolves.toBe(1);
    expect(
      service.personTemporalMemoryService.recordExplicitPersonDate
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: 'user',
        subjectId: message.userId,
        eventType: 'birth',
        year: 1992,
        month: 8,
        day: 1,
      })
    );
    expect(service.openAIService.generateText).not.toHaveBeenCalled();
  });

  it('does not record a birthday question or negation', async () => {
    const service = new RelativeMemoryExtractorService();
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = { isEnabled: jest.fn(() => true) } as never;
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn(),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000514'),
      userId: new MongoObjectId('665000000000000000000515'),
      agentId: new MongoObjectId('665000000000000000000516'),
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    });

    await expect(
      service.captureFromUserMessage(message, '我的生日是8月1日吗？')
    ).resolves.toBe(0);
    expect(
      service.personTemporalMemoryService.recordExplicitPersonDate
    ).not.toHaveBeenCalled();
  });

  it('writes a named child birth date and health fact to account memory', async () => {
    const service = new RelativeMemoryExtractorService();
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000501'),
    });
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          people: [
            {
              referenceName: '浩浩',
              realName: '赵浩帅',
              aliases: ['浩浩'],
              relationToUser: '儿子',
              lifeStage: 'infant',
              sex: 'male',
              dates: [{ eventType: 'birth', date: '2026-08-01' }],
              facts: [
                {
                  domain: 'health',
                  key: 'health.fever',
                  value: '今天有点发烧',
                  status: 'current',
                },
              ],
            },
          ],
        }),
      }),
    } as never;
    service.userIdentityMemoryService = {
      resolveKnownPersonReference: jest.fn().mockResolvedValue(null),
      upsertKnownPersonDeclaration: jest.fn().mockResolvedValue(person),
    } as never;
    service.userRelativeProfileService = {
      setProfileState: jest.fn().mockResolvedValue({}),
      recordFact: jest.fn().mockResolvedValue({}),
    } as never;
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn().mockResolvedValue({
        exactDate: new Date('2026-08-01T00:00:00.000Z'),
        normalizedYear: 2026,
      }),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000502'),
      userId: new MongoObjectId('665000000000000000000503'),
      agentId: new MongoObjectId('665000000000000000000504'),
      content: '我儿子赵浩帅，小名浩浩，8月1日出生，今天有点发烧',
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    });

    await expect(
      service.captureFromUserMessage(message, message.content)
    ).resolves.toBe(2);
    expect(
      service.personTemporalMemoryService.recordExplicitPersonDate
    ).toHaveBeenCalled();
    expect(service.userRelativeProfileService.recordFact).toHaveBeenCalledWith(
      expect.objectContaining({ domain: UserRelativeFactDomain.health })
    );
  });

  it('links another unambiguous AI relative locally without exposing the agent list', async () => {
    const service = new RelativeMemoryExtractorService();
    const parent = Object.assign(new AgentEntity(), {
      id: new MongoObjectId('665000000000000000000601'),
      createdUserId: new MongoObjectId('665000000000000000000603'),
      name: '妈妈',
      iCallAgent: '妈妈',
      sex: AgentSex.woman,
      status: 1,
    });
    const father = Object.assign(new AgentEntity(), {
      id: new MongoObjectId('665000000000000000000602'),
      createdUserId: parent.createdUserId,
      name: '爸爸',
      iCallAgent: '爸爸',
      sex: AgentSex.man,
      status: 1,
    });
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000604'),
    });
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          people: [
            {
              referenceName: '爸爸',
              relationToUser: '爸爸',
              facts: [
                {
                  domain: 'health',
                  key: 'health.illness_before_death',
                  value: '爸爸生前患病',
                },
              ],
            },
          ],
        }),
      }),
    } as never;
    service.agentModel = {
      find: jest.fn().mockResolvedValue([parent, father]),
    } as never;
    service.userIdentityMemoryService = {
      resolveKnownPersonReference: jest.fn().mockResolvedValue(null),
      countKnownPeopleByRelation: jest.fn().mockResolvedValue(0),
      upsertKnownPersonDeclaration: jest.fn().mockResolvedValue(person),
    } as never;
    service.userRelativeProfileService = {
      setProfileState: jest.fn().mockResolvedValue({}),
      recordFact: jest.fn().mockResolvedValue({}),
    } as never;
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn(),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000605'),
      userId: parent.createdUserId,
      agentId: parent.id,
      content: '爸爸生前患病，后来去世了。',
      createdAt: new Date('2026-09-05T00:00:00.000Z'),
    });

    await service.captureFromUserMessage(message, message.content, {
      messengerParent: parent,
    });

    expect(
      service.userIdentityMemoryService.upsertKnownPersonDeclaration
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        declaration: expect.objectContaining({
          relationToUser: '爸爸',
          linkedAgentId: father.id,
        }),
      })
    );
    const modelPrompt = (service.openAIService.generateText as jest.Mock).mock
      .calls[0][0].prompt;
    expect(modelPrompt).not.toContain(father.id.toString());
  });

  it('does not link an ambiguous relative to either AI agent', async () => {
    const service = new RelativeMemoryExtractorService();
    const userId = new MongoObjectId('665000000000000000000611');
    const parent = Object.assign(new AgentEntity(), {
      id: new MongoObjectId('665000000000000000000612'),
    });
    const candidates = [
      '665000000000000000000613',
      '665000000000000000000614',
    ].map(id =>
      Object.assign(new AgentEntity(), {
        id: new MongoObjectId(id),
        name: '爷爷',
        iCallAgent: '爷爷',
      })
    );
    service.agentModel = {
      find: jest.fn().mockResolvedValue(candidates),
    } as never;

    await expect(
      (service as any).resolveUniqueLinkedAgent(
        Object.assign(new MessageEntity(), { userId }),
        parent,
        ['爷爷']
      )
    ).resolves.toBeUndefined();
  });

  it('reaches the model for a bare relative mention and keeps propositions separate', async () => {
    const service = new RelativeMemoryExtractorService();
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000701'),
    });
    const boundAgent = Object.assign(new AgentEntity(), {
      id: new MongoObjectId('665000000000000000000702'),
      name: '爸爸',
      iCallAgent: '爸爸',
    });
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          people: [
            {
              referenceName: '妈妈',
              relationToUser: '母亲',
              facts: [
                {
                  domain: 'work',
                  key: 'work.pension',
                  value: '妈妈已经领了养老保险',
                  status: 'current',
                },
                {
                  domain: 'work',
                  key: 'work.busy',
                  value: '妈妈很忙，还是到处打工',
                  status: 'current',
                },
              ],
            },
          ],
        }),
      }),
    } as never;
    service.agentModel = {
      findOne: jest.fn().mockResolvedValue(boundAgent),
    } as never;
    service.userIdentityMemoryService = {
      resolveKnownPersonReference: jest.fn().mockResolvedValue(null),
      countKnownPeopleByRelation: jest.fn().mockResolvedValue(0),
      upsertKnownPersonDeclaration: jest.fn().mockResolvedValue(person),
    } as never;
    service.userRelativeProfileService = {
      setProfileState: jest.fn().mockResolvedValue({}),
      recordFact: jest.fn().mockResolvedValue({}),
    } as never;
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn(),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000703'),
      userId: new MongoObjectId('665000000000000000000704'),
      agentId: boundAgent.id,
      createdAt: new Date('2026-09-16T09:33:36.136Z'),
    });
    const text = '妈妈已经领了养老保险了，就是挺忙，还是到处打工';

    await expect(
      service.captureFromUserMessage(message, text, {
        contextMessages: [
          { role: 'assistant', content: '家里其他人现在怎么样？' },
        ],
      })
    ).resolves.toBe(2);
    expect(service.openAIService.generateText).toHaveBeenCalledTimes(1);
    // 记录最终实际请求：系统提示含主体边界与命题键要求；用户提示含参考时间与近期上下文。
    expect(service.openAIService.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('用户本人的处境'),
        prompt: expect.stringMatching(
          /参考时间（消息发生时间）：2026-09-16T09:33:36\.136Z[\s\S]*最近连续对话[^：]*：[\s\S]*家里其他人现在怎么样/
        ),
      })
    );
    const recordFact = service.userRelativeProfileService
      .recordFact as jest.Mock;
    expect(recordFact).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'work.pension',
        effectiveAt: message.createdAt,
        occurredAt: undefined,
      })
    );
    expect(recordFact).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'work.busy' })
    );
  });

  it('excludes the bound AI relative itself from account-level relatives', async () => {
    const service = new RelativeMemoryExtractorService();
    const boundAgent = Object.assign(new AgentEntity(), {
      id: new MongoObjectId('665000000000000000000711'),
      name: '爸爸',
      iCallAgent: '爸爸',
    });
    service.logger = { warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          people: [
            {
              referenceName: '爸爸',
              relationToUser: '爸爸',
              facts: [{ domain: 'other', key: 'x', value: '爸爸很好' }],
            },
          ],
        }),
      }),
    } as never;
    service.agentModel = {
      findOne: jest.fn().mockResolvedValue(boundAgent),
    } as never;
    const upsertKnownPerson = jest.fn();
    service.userIdentityMemoryService = {
      resolveKnownPersonReference: jest.fn(),
      upsertKnownPersonDeclaration: upsertKnownPerson,
    } as never;
    service.userRelativeProfileService = {
      setProfileState: jest.fn(),
      recordFact: jest.fn(),
    } as never;
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn(),
    } as never;
    const message = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000712'),
      userId: new MongoObjectId('665000000000000000000713'),
      agentId: boundAgent.id,
      createdAt: new Date('2026-09-16T09:21:33.726Z'),
    });

    await expect(
      service.captureFromUserMessage(message, '爸爸，我很想你')
    ).resolves.toBe(0);
    expect(upsertKnownPerson).not.toHaveBeenCalled();
  });

  it('excludes the bound AI relative through kinship synonyms, not exact names', () => {
    const service = new RelativeMemoryExtractorService();
    const isParent = (item: {
      referenceName?: string;
      realName?: string;
      relation?: string;
    }) => (service as any).isMessengerParent(item, ['爸爸']);

    // “爹/爸/父亲”与“爸爸”同组，都指当前对话对象本人。
    expect(isParent({ referenceName: '爹', relation: '父亲' })).toBe(true);
    expect(isParent({ referenceName: '爸' })).toBe(true);
    expect(isParent({ relation: '父亲' })).toBe(true);
    // 不同组的人不是当前角色。
    expect(isParent({ referenceName: '妈妈', relation: '母亲' })).toBe(false);
    expect(isParent({ referenceName: '二奶奶', relation: '奶奶' })).toBe(false);
  });
});
