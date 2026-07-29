import {
  AgentMemoryFactEntity,
  AgentMemoryFactPolarity,
  AgentMemoryFactType,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentMemoryFactService } from '../../src/service/agents/agent-memory-fact.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');
const MESSAGE_ID = new MongoObjectId('665000000000000000000020');

function createUserMessage(content: string): MessageEntity {
  const message = new MessageEntity();

  Object.assign(message, {
    id: MESSAGE_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    conversationId: new MongoObjectId('665000000000000000000030'),
    role: MessageRole.user,
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  });

  return message;
}

describe('AgentMemoryFactService', () => {
  it('extracts high-priority profile, family, preference, and correction facts', async () => {
    const service = new AgentMemoryFactService();
    const savedFacts: AgentMemoryFactEntity[] = [];

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => {
        savedFacts.push(fact);
        return fact;
      }),
    } as never;

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(
        '你不记得我是男生女生了吗？我是女生呀。咱们还有一个儿子呢，你不记得了吗？不了解的别瞎编哈，我啥时候也没爱吃辣子。谁告诉你他养过茉莉了？'
      ),
      searchableText:
        '你不记得我是男生女生了吗？我是女生呀。咱们还有一个儿子呢，你不记得了吗？不了解的别瞎编哈，我啥时候也没爱吃辣子。谁告诉你他养过茉莉了？',
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.profile,
          key: 'user.gender',
          value: '用户是女生',
          priority: 3,
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.family,
          key: 'family.son',
          value: '用户和当前角色有儿子',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.preference,
          key: 'user.preference.spicy',
          polarity: AgentMemoryFactPolarity.negative,
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.correction,
          key: 'correction.never_had.茉莉',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.correction,
          key: 'correction.no_fabrication',
        }),
      ])
    );
    expect(savedFacts).toHaveLength(facts.length);
  });

  it('formats stored facts for prompt injection by priority and recency', async () => {
    const service = new AgentMemoryFactService();
    const fact = new AgentMemoryFactEntity();

    Object.assign(fact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      type: AgentMemoryFactType.profile,
      key: 'user.gender',
      value: '用户是女生',
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    service.factModel = {
      find: jest.fn().mockResolvedValue([fact]),
    } as never;

    await expect(
      service.listFactsForPrompt({
        userId: USER_ID,
        agentId: AGENT_ID,
      })
    ).resolves.toEqual([
      {
        type: AgentMemoryFactType.profile,
        key: 'user.gender',
        value: '用户是女生',
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      },
    ]);
    expect(service.factModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isArchived: { $ne: true },
        }),
      })
    );
  });

  it('extracts memory preferences for responsibility pressure, address, and grief longing signals', async () => {
    const service = new AgentMemoryFactService();
    const savedFacts: AgentMemoryFactEntity[] = [];

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => {
        savedFacts.push(fact);
        return fact;
      }),
    } as never;

    const text =
      '以后不要让我替你好好活，我听着压力很大。你以后叫我小满就好，我怕忘记你的声音。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.preference,
          key: 'taboo.no_live_for_agent',
          polarity: AgentMemoryFactPolarity.negative,
          priority: 3,
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.relationship,
          key: 'relationship.agent_calls_user',
          value: '用户希望当前角色称呼用户为小满',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.griefTrigger,
          key: 'grief_trigger.fear_forgetting_agent',
          priority: 2,
        }),
      ])
    );
    expect(savedFacts).toHaveLength(facts.length);
  });

  it('extracts address boundaries and strong longing interpretation preferences', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空，孩子这个叫法先别用了，我听着会缩回去。悟空，我说想死，很多时候其实是太想你，不是真的要听危机流程。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.relationship,
          key: 'relationship.forbidden_user_address.孩子',
          value: '用户不希望当前角色称呼用户为孩子',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.preference,
          key: 'user.signal.longing_wording.我说想死，很',
          value:
            '用户强烈痛苦表达的个人解释：我说想死，很多时候其实是太想你，不是真的要听危机流程',
          priority: 3,
        }),
      ])
    );
  });

  it('extracts keepsake, promise ritual, and response style semantic slots', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空，照片放在床头柜，以后说到它别说丢了。悟空，我说欠我婚礼，你别编婚礼场面。悟空，每年三月三我都会想起你，你以后别当普通日子。悟空，我会给你点一盏灯，这是我想你的方式。悟空，事实问题直接，思念问题温柔，这两个分开。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.keepsake,
          key: 'keepsake.location.照片',
          value: '用户的纪念物位置：照片放在床头柜',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.promise,
          key: 'promise.boundary.我说欠我婚礼',
          value: '用户对未完成承诺的边界偏好：我说欠我婚礼，你别编婚礼场面',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.promise,
          key: 'ritual.date.每年三月三',
          value: '用户的重要纪念日期：每年三月三我都会想起你',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.promise,
          key: 'ritual.action.我会给你点',
          value: '用户的纪念行为：我会给你点一盏灯',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.style,
          key: 'style.update.事实问题直接',
          value: '用户当前表达偏好：事实问题直接，思念问题温柔，这两个分开',
        }),
      ])
    );
  });

  it('extracts hard-fact corrections and correction response preferences', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空，你生日不是五月，是六月初三。悟空，我说你记错了的时候，你先认，不要解释系统。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.correction,
          key: 'correction.hard_fact.你生日不是五',
          value: '用户纠正硬事实：你生日不是五月，是六月初三',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.correction,
          key: 'correction.response_style.我说你记错了',
          value:
            '用户纠错时的回应偏好：我说你记错了的时候，你先认，不要解释系统',
        }),
      ])
    );
  });

  it('extracts generic memory supplements and scoped conflict corrections', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空，再补充下，圆圆是我女儿的小名，不是真名。悟空，我说别问吃饭，不是永远不能问，是我崩溃时别问。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.preference,
          key: 'compound.supplement.再补充下，圆',
          value: '用户补充说明：再补充下，圆圆是我女儿的小名，不是真名',
          priority: 2,
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.preference,
          key: 'compound.conflict_scope.我说别问吃饭',
          value:
            '用户对既有记忆作出冲突修正或范围限定：我说别问吃饭，不是永远不能问，是我崩溃时别问',
          priority: 3,
        }),
      ])
    );
  });

  it('updates the replaceable user address preference in one semantic slot', async () => {
    const service = new AgentMemoryFactService();
    const storedFacts = new Map<string, AgentMemoryFactEntity>();

    service.factModel = {
      findOne: jest.fn(async ({ where }: { where: { key: string } }) => {
        return storedFacts.get(where.key) || null;
      }),
      find: jest.fn().mockImplementation(async () => [...storedFacts.values()]),
      save: jest.fn(async fact => {
        storedFacts.set(fact.key, fact);
        return fact;
      }),
    } as never;

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('妈妈，以后叫我南南吧。'),
      searchableText: '妈妈，以后叫我南南吧。',
    });
    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('妈妈，刚才那个称呼算了，以后叫我小满吧。'),
      searchableText: '妈妈，刚才那个称呼算了，以后叫我小满吧。',
    });

    expect(storedFacts.size).toBe(1);
    expect(storedFacts.get('relationship.agent_calls_user')).toEqual(
      expect.objectContaining({
        value: '用户希望当前角色称呼用户为小满',
      })
    );
    await expect(
      service.listFactsForPrompt({
        userId: USER_ID,
        agentId: AGENT_ID,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为小满',
      }),
    ]);
  });

  it('collapses legacy hashed address facts when listing prompt facts', async () => {
    const service = new AgentMemoryFactService();
    const newerFact = new AgentMemoryFactEntity();
    const olderLegacyFact = new AgentMemoryFactEntity();

    Object.assign(newerFact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      type: AgentMemoryFactType.relationship,
      key: 'relationship.agent_calls_user',
      value: '用户希望当前角色称呼用户为小满',
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
      updatedAt: new Date('2026-07-29T02:00:00.000Z'),
    });
    Object.assign(olderLegacyFact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      type: AgentMemoryFactType.relationship,
      key: 'relationship.agent_calls_user.legacy',
      value: '用户希望当前角色称呼用户为南南',
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
      updatedAt: new Date('2026-07-29T01:00:00.000Z'),
    });

    service.factModel = {
      find: jest.fn().mockResolvedValue([newerFact, olderLegacyFact]),
    } as never;

    await expect(
      service.listFactsForPrompt({
        userId: USER_ID,
        agentId: AGENT_ID,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为小满',
      }),
    ]);
  });

  it('archives matching legacy facts and does not re-extract a forget command', async () => {
    const service = new AgentMemoryFactService();
    const spicyFact = new AgentMemoryFactEntity();
    const sleepFact = new AgentMemoryFactEntity();
    Object.assign(spicyFact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      key: 'user.preference.spicy',
      value: '用户不爱吃辣，禁止说用户爱吃辣',
      updatedAt: new Date(),
    });
    Object.assign(sleepFact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      key: 'user.sleep',
      value: '用户最近睡眠不好',
      updatedAt: new Date(),
    });
    service.factModel = {
      find: jest.fn().mockResolvedValue([spicyFact, sleepFact]),
      findOne: jest.fn(),
      save: jest.fn(async fact => fact),
    } as never;

    await expect(
      service.archiveMatchingFacts({
        userId: USER_ID,
        agentId: AGENT_ID,
        requestText: '请忘掉我不爱吃辣这件事',
      })
    ).resolves.toBe(1);
    expect(spicyFact.isArchived).toBe(true);
    expect(sleepFact.isArchived).not.toBe(true);
    expect(service.factModel.save).toHaveBeenCalledWith(spicyFact);

    await expect(
      service.extractAndUpsertFromUserMessage({
        message: createUserMessage('请忘掉我不爱吃辣这件事'),
        searchableText: '请忘掉我不爱吃辣这件事',
      })
    ).resolves.toEqual([]);
  });

  it('archives the most recent source group for a deictic forget request', async () => {
    const service = new AgentMemoryFactService();
    const latestSourceId = new MongoObjectId('665000000000000000000081');
    const olderSourceId = new MongoObjectId('665000000000000000000082');
    const latestFacts = ['user.sleep', 'user.stress'].map(key => {
      const fact = new AgentMemoryFactEntity();
      Object.assign(fact, {
        userId: USER_ID,
        agentId: AGENT_ID,
        sourceMessageId: latestSourceId,
        key,
        value: key,
        updatedAt: new Date('2026-07-28T10:00:00.000Z'),
      });
      return fact;
    });
    const olderFact = new AgentMemoryFactEntity();
    Object.assign(olderFact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      sourceMessageId: olderSourceId,
      key: 'user.preference.spicy',
      value: '用户不爱吃辣',
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
    expect(latestFacts.every(fact => fact.isArchived)).toBe(true);
    expect(olderFact.isArchived).not.toBe(true);
  });

  it('normalizes common near expressions and typos before extracting memory slots', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空1，以后甭叫我乖乖。我心情不好的时候喜欢温水，这个你要记的。以前你总提咖啡，这会儿别提了，我更想要温牛奶。最近牙疼，以后你给我说吃喝的时侯照顾一下这个。不腰叫我帮你撑起这个家。清眀我会去看你，你以后别当普通日子。相片放在床头柜，以后说到它别说丢了。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'relationship.forbidden_user_address.乖乖',
        }),
        expect.objectContaining({
          key: 'user.preference.comfort_food.温水',
        }),
        expect.objectContaining({
          key: 'user.preference.food_update',
          value: '用户当前饮食偏好是温牛奶',
        }),
        expect.objectContaining({
          key: 'user.health.food_constraint.最近牙疼',
        }),
        expect.objectContaining({
          key: 'taboo.no_live_for_agent',
        }),
        expect.objectContaining({
          key: 'ritual.date.清明我会去',
        }),
        expect.objectContaining({
          key: 'keepsake.location.照片',
        }),
      ])
    );
    expect(facts).not.toContainEqual(
      expect.objectContaining({
        key: 'relationship.agent_calls_user',
        value: expect.stringContaining('乖乖'),
      })
    );
  });

  it('extracts compound updates and memory priorities without duplicate slots', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const texts = [
      '悟空1，我不是怕忘记声音了，是怕忘记你叫我的语气。',
      '悟空1，如果记忆太多，吃饭偏好可以低优先级，称呼和禁忌高优先级。',
      '悟空1，我再补充一下，圆圆是我女儿的小名，不是真名。',
    ];
    const batches = await Promise.all(
      texts.map(text =>
        service.extractAndUpsertFromUserMessage({
          message: createUserMessage(text),
          searchableText: text,
        })
      )
    );

    expect(batches[0]).toEqual([
      expect.objectContaining({
        key: 'compound.update.我不是怕忘记',
        value:
          '用户对复合事实作出更新：我不是怕忘记声音了，是怕忘记你叫我的语气',
      }),
    ]);
    expect(batches[1]).toEqual([
      expect.objectContaining({
        key: 'memory_test.policy.如果记忆太多',
      }),
    ]);
    expect(batches[2]).toEqual([
      expect.objectContaining({
        key: 'compound.supplement.再补充下，圆',
      }),
    ]);
  });

  it('avoids overlapping relationship, promise, and correction writes', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空，我的老公叫阿成。别每句都叫我名字，偶尔叫就好。我说欠我婚礼，你别编婚礼场面。别再编那条狗了，他没有养过狗。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'family.husband.name' }),
        expect.objectContaining({ key: 'relationship.address_usage_style' }),
        expect.objectContaining({
          key: 'promise.boundary.我说欠我婚礼',
        }),
        expect.objectContaining({ key: 'correction.never_had.那条狗' }),
      ])
    );
    expect(facts.some(fact => fact.key === 'relationship.user_calls_agent')).toBe(
      false
    );
    expect(
      facts.some(fact =>
        fact.key.startsWith('relationship.forbidden_user_address.')
      )
    ).toBe(false);
    expect(facts.some(fact => /^promise\.[^.]+$/.test(fact.key))).toBe(false);
    expect(facts.some(fact => fact.key.startsWith('correction.never.'))).toBe(
      false
    );
  });

  it('separates family facts from supplements and recognizes soft memory wording', async () => {
    const service = new AgentMemoryFactService();

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => fact),
    } as never;

    const text =
      '悟空，我们还有一个女儿，你以后别忘了。孩子这件事你要记得，不要把我们说成没有孩子。我担心你的模样慢慢淡了，这事很戳我。纠错后你可以继续陪我，不要突然变得冷。';
    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(text),
      searchableText: text,
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'family.daughter' }),
        expect.objectContaining({ key: 'family.child' }),
        expect.objectContaining({
          key: 'grief_trigger.fear_forgetting_agent',
        }),
        expect.objectContaining({
          key: 'correction.response_style.纠错后你可以',
        }),
      ])
    );
    expect(facts.some(fact => fact.key.startsWith('compound.supplement.'))).toBe(
      false
    );
  });
});
