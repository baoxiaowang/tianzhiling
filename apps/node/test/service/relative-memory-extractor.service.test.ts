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
});
