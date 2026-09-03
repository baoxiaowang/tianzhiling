import {
  AgentProfileFactAssertionPolicy,
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
  it('replaces profile-page memory sources and archives cleared fields', async () => {
    const service = new AgentProfileFactService();
    const storedFacts = new Map<string, AgentProfileFactEntity>();
    service.factModel = {
      findOne: jest.fn(async ({ where }: any) => {
        return storedFacts.get(where.key) ?? null;
      }),
      save: jest.fn(async fact => {
        if (!fact.id) {
          fact.id = new MongoObjectId();
        }
        storedFacts.set(fact.key, fact);
        return fact;
      }),
    } as never;

    await service.syncAgentProfileMemorySources({
      userId: USER_ID,
      agentId: AGENT_ID,
      sources: {
        lifeExperience: '年轻时做木匠',
        personalityTraits: '嘴硬心软',
        languageHabits: '常说慢慢来',
        hobbies: '下象棋',
        sharedMemories: '夏天一起去河边散步',
      },
    });

    expect([...storedFacts.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'profile_source.life_experience',
          value: '当前角色生平经历：年轻时做木匠',
          status: AgentProfileFactStatus.active,
          confidence: AgentProfileFactConfidence.confirmed,
        }),
        expect.objectContaining({
          key: 'profile_source.personality_traits',
          value: '当前角色性格特点：嘴硬心软',
          assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
        }),
        expect.objectContaining({
          key: 'profile_source.shared_memories',
          value: '用户与当前角色的共同记忆：夏天一起去河边散步',
          assertionPolicy: AgentProfileFactAssertionPolicy.canAssert,
        }),
      ])
    );

    await service.syncAgentProfileMemorySources({
      userId: USER_ID,
      agentId: AGENT_ID,
      sources: {
        personalityTraits: '严厉，但关心家人',
        sharedMemories: '',
      },
    });

    expect(storedFacts.get('profile_source.personality_traits')).toEqual(
      expect.objectContaining({
        value: '当前角色性格特点：严厉，但关心家人',
        status: AgentProfileFactStatus.active,
      })
    );
    expect(storedFacts.get('profile_source.shared_memories')?.status).toBe(
      AgentProfileFactStatus.archived
    );
  });

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

  it('stores a deictically rejected assistant memory as a negative fact', async () => {
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
      message: createUserMessage('我不记得了，没有这事'),
      searchableText: '我不记得了，没有这事',
      previousAssistantContent: '就是城西边那座山。你小时候我背你上去过一回。',
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentProfileFactType.memory,
          key: expect.stringContaining('memory.rejected_assistant.'),
          value: expect.stringContaining(
            '用户否认上一条助手所述共同往事：就是城西边那座山'
          ),
          polarity: AgentProfileFactPolarity.negative,
          confidence: AgentProfileFactConfidence.userCorrected,
          priority: 3,
        }),
      ])
    );
    expect(savedFacts).toHaveLength(facts.length);
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

  it('keeps visual appearance as context-only candidates until repeated images agree', async () => {
    const service = new AgentProfileFactService();
    const storedFacts = new Map<string, AgentProfileFactEntity>();
    service.factModel = {
      findOne: jest.fn(async ({ where }: any) => {
        return storedFacts.get(where.key) ?? null;
      }),
      find: jest.fn(async () => [...storedFacts.values()]),
      save: jest.fn(async fact => {
        if (!fact.id) {
          fact.id = new MongoObjectId();
        }
        storedFacts.set(fact.key, fact);
        return fact;
      }),
    } as never;
    const firstMessage = createUserMessage('[图片]');
    firstMessage.type = MessageType.image;

    await service.upsertVisualAppearanceObservations({
      message: firstMessage,
      observations: [
        {
          personId: 'P1',
          identityTarget: 'agent',
          identityName: '爸爸',
          identityConfidence: 'medium',
          traits: [
            { kind: 'hair_color', value: '黑' },
            { kind: 'eyewear', value: '戴眼镜' },
            { kind: 'build', value: '不清楚' },
          ],
        },
      ],
    });

    expect(storedFacts.get('visual.appearance.agent.hair_color')).toEqual(
      expect.objectContaining({
        value: '当前角色的视觉形象：黑',
        status: AgentProfileFactStatus.candidate,
        supportCount: 1,
        assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
      })
    );
    expect(storedFacts.has('visual.appearance.agent.build')).toBe(false);

    const secondMessage = createUserMessage('[图片]');
    secondMessage.type = MessageType.image;
    secondMessage.id = new MongoObjectId('665000000000000000000102');
    await service.upsertVisualAppearanceObservations({
      message: secondMessage,
      observations: [
        {
          personId: 'P1',
          identityTarget: 'agent',
          identityName: '爸爸',
          identityConfidence: 'high',
          traits: [
            { kind: 'hair_color', value: '黑' },
            { kind: 'eyewear', value: '戴眼镜' },
          ],
        },
      ],
    });

    expect(storedFacts.get('visual.appearance.agent.hair_color')).toEqual(
      expect.objectContaining({
        status: AgentProfileFactStatus.active,
        supportCount: 2,
        assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
      })
    );
    await expect(
      service.listVisualAppearanceMemories({
        userId: USER_ID,
        agentId: AGENT_ID,
      })
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'visual.appearance.agent.eyewear',
          status: AgentProfileFactStatus.active,
          supportCount: 2,
        }),
      ])
    );
  });

  it('does not store low-confidence or unnamed-family visual guesses', async () => {
    const service = new AgentProfileFactService();
    service.factModel = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as never;
    const message = createUserMessage('[图片]');
    message.type = MessageType.image;

    await expect(
      service.upsertVisualAppearanceObservations({
        message,
        observations: [
          {
            personId: 'P1',
            identityTarget: 'agent',
            identityConfidence: 'low',
            traits: [{ kind: 'eyewear', value: '戴眼镜' }],
          },
          {
            personId: 'P2',
            identityTarget: 'family',
            identityConfidence: 'medium',
            traits: [{ kind: 'hair_length', value: '长' }],
          },
        ],
      })
    ).resolves.toEqual([]);
    expect(service.factModel.save).not.toHaveBeenCalled();
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

  it('archives an imported memory only after its last source message is removed', async () => {
    const service = new AgentProfileFactService();
    const firstSource = new MongoObjectId();
    const secondSource = new MongoObjectId();
    const fact = new AgentProfileFactEntity();
    Object.assign(fact, {
      id: new MongoObjectId(),
      userId: USER_ID,
      agentId: AGENT_ID,
      key: 'wechat_import.shared.walk',
      value: '过去常一起散步',
      status: AgentProfileFactStatus.active,
      sourceMessageId: firstSource,
      sourceMessageIds: [firstSource, secondSource],
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    service.factModel = {
      find: jest.fn().mockResolvedValue([fact]),
      save: jest.fn(async value => value),
    } as never;

    await expect(
      service.removeHistoricalSourceMessage({
        userId: USER_ID,
        agentId: AGENT_ID,
        sourceMessageId: firstSource,
      })
    ).resolves.toBe(0);
    expect(fact.status).toBe(AgentProfileFactStatus.active);
    expect(fact.sourceMessageIds).toEqual([secondSource]);

    await expect(
      service.removeHistoricalSourceMessage({
        userId: USER_ID,
        agentId: AGENT_ID,
        sourceMessageId: secondSource,
      })
    ).resolves.toBe(1);
    expect(fact.status).toBe(AgentProfileFactStatus.archived);
  });
});
