import {
  AgentProfileFactConfidence,
  AgentProfileFactEntity,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createUserMessage(content: string): MessageEntity {
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId('665000000000000000000101'),
    conversationId: new MongoObjectId('665000000000000000000020'),
    userId: USER_ID,
    agentId: AGENT_ID,
    role: MessageRole.user,
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    createdAt: new Date('2026-07-26T08:00:00.000Z'),
    updatedAt: new Date('2026-07-26T08:00:00.000Z'),
  });

  return message;
}

describe('AgentProfileFactService', () => {
  it('extracts corrected role facts into active profile facts', async () => {
    const service = new AgentProfileFactService();
    const savedFacts: AgentProfileFactEntity[] = [];
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    service.factModel = {
      findOne: jest.fn(async ({ where }: any) => {
        return (
          savedFacts.find(
            fact =>
              fact.userId.equals(where.userId) &&
              fact.agentId.equals(where.agentId) &&
              fact.key === where.key
          ) ?? null
        );
      }),
      save: jest.fn(async fact => {
        if (!fact.id) {
          fact.id = new MongoObjectId();
        }
        savedFacts.push(fact);
        return fact;
      }),
    } as never;

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(
        '你走的时候是58岁，你以前是木匠，不爱说肉麻话'
      ),
      searchableText: '你走的时候是58岁，你以前是木匠，不爱说肉麻话',
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentProfileFactType.age,
          key: 'age.age_at_death',
          value: '当前角色离开时58岁',
          confidence: AgentProfileFactConfidence.extracted,
        }),
        expect.objectContaining({
          type: AgentProfileFactType.occupation,
          key: 'occupation.primary',
          value: '当前角色以前的职业或工作是木匠',
        }),
        expect.objectContaining({
          type: AgentProfileFactType.style,
          key: 'style.no_sweet_talk',
          polarity: AgentProfileFactPolarity.negative,
        }),
      ])
    );
    expect(savedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'age.age_at_death',
          status: AgentProfileFactStatus.active,
        }),
      ])
    );
  });

  it('adds feedback-derived guardrail facts', async () => {
    const service = new AgentProfileFactService();
    const savedFacts: AgentProfileFactEntity[] = [];
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => {
        savedFacts.push(fact);
        return fact;
      }),
    } as never;

    await service.extractAndUpsertFromFeedback({
      feedbackId: new MongoObjectId('665000000000000000000201'),
      userId: USER_ID,
      agentId: AGENT_ID,
      messageId: new MongoObjectId('665000000000000000000301'),
      feedbackType: 'fabricated',
      feedbackContent: '这段瞎编了',
      assistantContent: '我记得以前你总爱吃辣',
    });

    expect(savedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentProfileFactType.taboo,
          key: 'taboo.feedback.no_fabrication',
          confidence: AgentProfileFactConfidence.feedback,
          priority: 3,
        }),
      ])
    );
  });

  it('keeps model-only facts as candidates until repeated evidence confirms them', async () => {
    const service = new AgentProfileFactService();
    let storedFact: AgentProfileFactEntity | null = null;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            type: 'occupation',
            key: 'occupation.primary',
            value: '当前角色以前做木工',
            polarity: 'positive',
            confidence: 'confirmed',
            priority: 2,
          },
        ]),
      }),
    } as never;
    service.factModel = {
      findOne: jest.fn(async () => storedFact),
      save: jest.fn(async fact => {
        if (!fact.id) {
          fact.id = new MongoObjectId();
        }
        storedFact = fact;
        return fact;
      }),
    } as never;

    const firstMessage =
      createUserMessage('补充一下，过去主要靠木工手艺过日子');
    await service.extractAndUpsertFromUserMessage({
      message: firstMessage,
      searchableText: firstMessage.content,
    });

    expect(storedFact).toEqual(
      expect.objectContaining({
        value: '当前角色以前做木工',
        status: AgentProfileFactStatus.candidate,
        supportCount: 1,
      })
    );

    const secondMessage =
      createUserMessage('我再说一次，过去主要靠木工手艺过日子');
    secondMessage.id = new MongoObjectId('665000000000000000000102');
    await service.extractAndUpsertFromUserMessage({
      message: secondMessage,
      searchableText: secondMessage.content,
    });

    expect(storedFact).toEqual(
      expect.objectContaining({
        status: AgentProfileFactStatus.active,
        supportCount: 2,
      })
    );
    expect(storedFact?.sourceMessageIds).toHaveLength(2);
  });

  it('activates a model-extracted fact when the user explicitly asks to remember it', async () => {
    const service = new AgentProfileFactService();
    let storedFact: AgentProfileFactEntity | null = null;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            type: 'preference',
            key: 'user.preference.communication',
            value: '用户不喜欢被说教',
            polarity: 'negative',
            confidence: 'confirmed',
            priority: 3,
          },
        ]),
      }),
    } as never;
    service.factModel = {
      findOne: jest.fn(async () => storedFact),
      save: jest.fn(async fact => {
        storedFact = fact;
        return fact;
      }),
    } as never;

    const message = createUserMessage('记住，我不喜欢被说教');
    await service.extractAndUpsertFromUserMessage({
      message,
      searchableText: message.content,
    });

    expect(storedFact).toEqual(
      expect.objectContaining({
        value: '用户不喜欢被说教',
        status: AgentProfileFactStatus.active,
      })
    );
  });

  it('archives a matching active profile fact for an explicit forget request', async () => {
    const service = new AgentProfileFactService();
    const fact = new AgentProfileFactEntity();
    Object.assign(fact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      key: 'user.preference.communication',
      value: '用户不喜欢被说教',
      status: AgentProfileFactStatus.active,
      updatedAt: new Date(),
    });
    service.factModel = {
      find: jest.fn().mockResolvedValue([fact]),
      save: jest.fn(async value => value),
    } as never;

    await expect(
      service.archiveMatchingFacts({
        userId: USER_ID,
        agentId: AGENT_ID,
        requestText: '删除我不喜欢被说教这条记忆',
      })
    ).resolves.toBe(1);
    expect(fact.status).toBe(AgentProfileFactStatus.archived);
    expect(service.factModel.save).toHaveBeenCalledWith(fact);
  });

  it('archives the most recent profile fact group when the user says that thing', async () => {
    const service = new AgentProfileFactService();
    const latestSourceId = new MongoObjectId('665000000000000000000181');
    const olderSourceId = new MongoObjectId('665000000000000000000182');
    const latestFacts = ['profile.sleep', 'profile.stress'].map(key => {
      const fact = new AgentProfileFactEntity();
      Object.assign(fact, {
        userId: USER_ID,
        agentId: AGENT_ID,
        sourceMessageId: latestSourceId,
        key,
        value: key,
        status: AgentProfileFactStatus.active,
        updatedAt: new Date('2026-07-28T10:00:00.000Z'),
      });
      return fact;
    });
    const olderFact = new AgentProfileFactEntity();
    Object.assign(olderFact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      sourceMessageId: olderSourceId,
      key: 'profile.preference',
      value: '用户不喜欢说教',
      status: AgentProfileFactStatus.active,
      updatedAt: new Date('2026-07-27T10:00:00.000Z'),
    });
    service.factModel = {
      find: jest.fn().mockResolvedValue([...latestFacts, olderFact]),
      save: jest.fn(async fact => fact),
    } as never;

    await expect(
      service.archiveMatchingFacts({
        userId: USER_ID,
        agentId: AGENT_ID,
        requestText: '刚才那件事你别记了，忘掉吧。',
      })
    ).resolves.toBe(2);
    expect(
      latestFacts.every(fact => fact.status === AgentProfileFactStatus.archived)
    ).toBe(true);
    expect(olderFact.status).toBe(AgentProfileFactStatus.active);
  });

  it('stores a named shared family member without guessing the relationship', async () => {
    const service = new AgentProfileFactService();
    const savedFacts: AgentProfileFactEntity[] = [];
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => {
        savedFacts.push(fact);
        return fact;
      }),
    } as never;

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('大宝是我们共同的重要家人'),
      searchableText: '大宝是我们共同的重要家人',
    });

    expect(facts).toEqual([
      expect.objectContaining({
        type: AgentProfileFactType.family,
        key: 'family.shared_member.大宝',
        value:
          '大宝是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
        confidence: AgentProfileFactConfidence.confirmed,
        priority: 3,
      }),
    ]);
    expect(savedFacts).toHaveLength(1);
  });

  it('does not infer a family relationship from third-person emotion alone', async () => {
    const service = new AgentProfileFactService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    service.factModel = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as never;

    await expect(
      service.extractAndUpsertFromUserMessage({
        message: createUserMessage('大宝想你想得哭了'),
        searchableText: '大宝想你想得哭了',
      })
    ).resolves.toEqual([]);
    expect(service.factModel.save).not.toHaveBeenCalled();
  });

  it('lists active shared family member names for subject attribution', async () => {
    const service = new AgentProfileFactService();
    const fact = new AgentProfileFactEntity();
    Object.assign(fact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      type: AgentProfileFactType.family,
      key: 'family.shared_member.大宝',
      value: '大宝是用户与当前角色共同的重要家人',
      status: AgentProfileFactStatus.active,
      priority: 3,
      updatedAt: new Date('2026-07-26T08:00:00.000Z'),
    });
    service.factModel = {
      find: jest.fn().mockResolvedValue([fact]),
    } as never;

    await expect(
      service.listSharedFamilyMemberNames({
        userId: USER_ID,
        agentId: AGENT_ID,
      })
    ).resolves.toEqual(['大宝']);
  });

  it('rejects broad family facts extracted from an ordinary question', async () => {
    const service = new AgentProfileFactService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            type: 'family',
            key: '父亲',
            value: '智能体的爸爸',
            polarity: 'positive',
            confidence: 'confirmed',
            priority: 2,
          },
        ]),
      }),
    } as never;
    service.factModel = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as never;

    await expect(
      service.extractAndUpsertFromUserMessage({
        message: createUserMessage('你为什么这么放心我会照顾你爸爸'),
        searchableText: '你为什么这么放心我会照顾你爸爸',
      })
    ).resolves.toEqual([]);
    expect(service.openAIService.generateText).not.toHaveBeenCalled();
    expect(service.factModel.save).not.toHaveBeenCalled();
  });

  it('skips profile extraction model calls for a current pain question', async () => {
    const service = new AgentProfileFactService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn(),
    } as never;
    service.factModel = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as never;

    await expect(
      service.extractAndUpsertFromUserMessage({
        message: createUserMessage('那你呢？现在身上还疼吗？'),
        searchableText: '那你呢？现在身上还疼吗？',
      })
    ).resolves.toEqual([]);
    expect(service.openAIService.generateText).not.toHaveBeenCalled();
    expect(service.factModel.save).not.toHaveBeenCalled();
  });

  it('does not turn a guessed occupation question into a profile fact', async () => {
    const service = new AgentProfileFactService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn(),
    } as never;
    service.factModel = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as never;

    await expect(
      service.extractAndUpsertFromUserMessage({
        message: createUserMessage('你以前是木匠吗？'),
        searchableText: '你以前是木匠吗？',
      })
    ).resolves.toEqual([]);
    expect(service.openAIService.generateText).not.toHaveBeenCalled();
    expect(service.factModel.save).not.toHaveBeenCalled();
  });
});
