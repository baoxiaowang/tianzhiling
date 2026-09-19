import {
  AgentEntity,
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
  UserRelativeFactDomain,
  UserRelativeFactStatus,
} from '@tzl/entities';
import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';
import { extractKnownPersonDeclarations } from '../../src/service/agents/user-identity-memory.service';
import {
  buildAgentIdentityContract,
  buildAgentIdentityPrompt,
} from '../../src/service/agents/agent-identity-contract';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createUserMessage(
  content: string,
  id = '665000000000000000000101'
): MessageEntity {
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId(id),
    conversationId: new MongoObjectId('665000000000000000000020'),
    userId: USER_ID,
    agentId: AGENT_ID,
    role: MessageRole.user,
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    createdAt: new Date('2026-09-19T08:00:00.000Z'),
    updatedAt: new Date('2026-09-19T08:00:00.000Z'),
  });
  return message;
}

function buildService(options: { llmEnabled?: boolean } = {}) {
  const service = new AgentProfileFactService();
  const savedFacts: AgentProfileFactEntity[] = [];
  service.logger = { warn: jest.fn(), error: jest.fn() } as never;
  service.openAIService = {
    isEnabled: jest.fn(() => options.llmEnabled === true),
    generateMemoryText: jest.fn().mockResolvedValue({ content: '[]' }),
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
      const existingIndex = savedFacts.findIndex(
        item => item.key === fact.key && item.userId.equals(fact.userId)
      );
      if (existingIndex >= 0) {
        savedFacts[existingIndex] = fact;
      } else {
        savedFacts.push(fact);
      }
      return fact;
    }),
  } as never;
  return { service, savedFacts };
}

function activeFact(
  key: string,
  value: string,
  type = AgentProfileFactType.identity
): AgentProfileFactEntity {
  const fact = new AgentProfileFactEntity();
  Object.assign(fact, {
    id: new MongoObjectId(),
    userId: USER_ID,
    agentId: AGENT_ID,
    type,
    key,
    value,
    polarity: AgentProfileFactPolarity.positive,
    confidence: AgentProfileFactConfidence.confirmed,
    status: AgentProfileFactStatus.active,
    priority: 3,
    supportCount: 1,
    createdAt: new Date('2026-09-19T08:00:00.000Z'),
    updatedAt: new Date('2026-09-19T08:00:00.000Z'),
  });
  return fact;
}

describe('role-core address preference convergence', () => {
  it('records an explicit new user address even when it ends with a particle (湾呐)', async () => {
    const { service, savedFacts } = buildService();

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('以后叫我湾呐，不叫大名'),
      searchableText: '以后叫我湾呐，不叫大名',
    });

    const preferred = savedFacts.find(
      fact => fact.key === 'relationship.preferred_user_name'
    );
    expect(preferred?.value).toBe('当前用户希望当前角色称呼其为湾呐');
    expect(preferred?.status).toBe(AgentProfileFactStatus.active);
    expect(
      facts.find(fact => fact.key === 'relationship.preferred_user_name')
    ).toMatchObject({
      type: AgentProfileFactType.relationship,
      value: '当前用户希望当前角色称呼其为湾呐',
    });
    // “不叫大名”是对旧称呼的否定，不能落成新别名/新默认称呼。
    expect(savedFacts.map(fact => fact.key)).not.toEqual(
      expect.arrayContaining([expect.stringContaining('大名')])
    );
  });

  it('lets the preferred-name fact beat the stored entity default on the read side', () => {
    const identity = buildAgentIdentityContract({
      agent: {
        id: AGENT_ID,
        name: '爷爷',
        iCallAgent: '爷爷',
        agentCallMe: '孙女',
      } as AgentEntity,
      profileFacts: [
        {
          type: AgentProfileFactType.relationship,
          key: 'relationship.preferred_user_name',
          value: '当前用户希望当前角色称呼其为湾呐',
          polarity: AgentProfileFactPolarity.positive,
          confidence: AgentProfileFactConfidence.confirmed,
          priority: 3,
          status: AgentProfileFactStatus.active,
        },
      ],
    });

    expect(identity.user.preferredName).toBe('湾呐');
    expect(identity.addresses.agentCallsUser).toBe('湾呐');
    expect(buildAgentIdentityPrompt(identity)).toContain('湾呐');
  });

  it('does not turn a third-party address ("爸爸叫我湾呐") into the current role default', async () => {
    const { service, savedFacts } = buildService();

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('爸爸叫我湾呐'),
      searchableText: '爸爸叫我湾呐',
    });

    expect(facts).toEqual([]);
    expect(savedFacts).toEqual([]);
    expect(extractKnownPersonDeclarations('爸爸叫我湾呐')).toEqual([]);

    const identity = buildAgentIdentityContract({
      agent: {
        id: AGENT_ID,
        name: '爷爷',
        iCallAgent: '爷爷',
        agentCallMe: '孙女',
      } as AgentEntity,
      profileFacts: [
        {
          type: AgentProfileFactType.identity,
          key: 'user.identity.alias.confirmed.abc',
          value: '用户别名或昵称是湾呐',
          polarity: AgentProfileFactPolarity.positive,
          confidence: AgentProfileFactConfidence.confirmed,
          priority: 2,
          status: AgentProfileFactStatus.active,
        },
      ],
    });

    // 别名不等于默认称呼：爷爷仍按关系默认称呼用户。
    expect(identity.user.preferredName).toBeUndefined();
    expect(identity.addresses.agentCallsUser).toBe('孙女');
  });

  it('does not read an ordinary "我叫你吃饭" as a durable agent address', async () => {
    const { service, savedFacts } = buildService();

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('我叫你吃饭'),
      searchableText: '我叫你吃饭',
    });

    expect(
      savedFacts.find(fact => fact.key === 'relationship.preferred_agent_name')
    ).toBeUndefined();
  });

  it('records "我以前还叫你老爷子" as an alias without replacing the current address', async () => {
    const { service, savedFacts } = buildService();

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('我以前还叫你老爷子'),
      searchableText: '我以前还叫你老爷子',
    });

    const aliasFact = savedFacts.find(fact =>
      fact.key.startsWith('identity.alias.confirmed.')
    );
    expect(aliasFact?.value).toBe('当前角色别名或昵称是老爷子');
    expect(
      savedFacts.find(fact => fact.key === 'relationship.preferred_agent_name')
    ).toBeUndefined();

    const identity = buildAgentIdentityContract({
      agent: {
        id: AGENT_ID,
        name: '爷爷',
        iCallAgent: '爷爷',
        agentCallMe: '孙女',
      } as AgentEntity,
      profileFacts: savedFacts.map(fact => ({
        type: fact.type,
        key: fact.key,
        value: fact.value,
        polarity: fact.polarity,
        confidence: fact.confidence,
        priority: fact.priority,
        status: fact.status,
      })),
    });

    expect(identity.agent.aliases).toEqual(expect.arrayContaining(['老爷子']));
    expect(identity.addresses.userCallsAgent).toBe('爷爷');
  });

  it('keeps a newer explicit address ahead of a late historical-import fact', async () => {
    const { service, savedFacts } = buildService();
    savedFacts.push(
      activeFact(
        'relationship.preferred_user_name',
        '当前用户希望当前角色称呼其为湾呐',
        AgentProfileFactType.relationship
      )
    );

    await service.upsertFromHistoricalImport({
      userId: USER_ID,
      agentId: AGENT_ID,
      sourceText: '旧聊天里大家都叫我大名',
      type: AgentProfileFactType.relationship,
      key: 'wechat_import.relationship.preferred_user_name',
      value: '当前用户希望当前角色称呼其为大名',
    });

    const canonical = savedFacts.filter(
      fact => fact.key === 'relationship.preferred_user_name'
    );
    expect(canonical).toHaveLength(1);
    expect(canonical[0].value).toBe('当前用户希望当前角色称呼其为湾呐');

    const identity = buildAgentIdentityContract({
      agent: {
        id: AGENT_ID,
        name: '爷爷',
        iCallAgent: '爷爷',
        agentCallMe: '孙女',
      } as AgentEntity,
      profileFacts: savedFacts.map(fact => ({
        type: fact.type,
        key: fact.key,
        value: fact.value,
        polarity: fact.polarity,
        confidence: fact.confidence,
        priority: fact.priority,
        status: fact.status,
      })),
    });
    expect(identity.addresses.agentCallsUser).toBe('湾呐');
  });
});

describe('role-core expression preferences', () => {
  it('stores a durable, scoped expression preference as its own style dimension', async () => {
    const { service, savedFacts } = buildService();

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('以后别说一大段'),
      searchableText: '以后别说一大段',
    });

    const preference = savedFacts.find(
      fact => fact.key === 'style.preference.verbosity'
    );
    expect(preference).toMatchObject({
      type: AgentProfileFactType.style,
      value: '用户对表达方式的长期要求：以后别说一大段',
      assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
    });
    // 不能退化成“不要提一大段”的忌讳事实。
    expect(
      savedFacts.find(fact => fact.key.startsWith('taboo.'))
    ).toBeUndefined();
  });

  it('keeps independent dimensions separate and collapses same-dimension conflicts', async () => {
    const { service, savedFacts } = buildService();

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('以后别说一大段，别总在最后问我问题'),
      searchableText: '以后别说一大段，别总在最后问我问题',
    });
    expect(
      savedFacts.filter(fact => fact.key.startsWith('style.preference.'))
    ).toHaveLength(2);

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(
        '以后别啰嗦，短一点',
        '665000000000000000000102'
      ),
      searchableText: '以后别啰嗦，短一点',
    });
    const verbosity = savedFacts.filter(
      fact => fact.key === 'style.preference.verbosity'
    );
    expect(verbosity).toHaveLength(1);
    expect(verbosity[0].value).toBe('用户对表达方式的长期要求：以后别啰嗦');
  });

  it('does not persist a one-off "今天先别讲道理" preference', async () => {
    const { service, savedFacts } = buildService({ llmEnabled: true });

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('今天先别讲道理'),
      searchableText: '今天先别讲道理',
    });

    expect(
      savedFacts.filter(fact => fact.key.startsWith('style.preference.'))
    ).toEqual([]);
    expect(facts).toEqual([]);
    expect(service.openAIService.generateMemoryText).not.toHaveBeenCalled();
  });
});

describe('role-core personality and family-state reading', () => {
  it('passes personality evidence rules to the extractor without inferring from hometown', async () => {
    const { service } = buildService({ llmEnabled: true });

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('他话少，常用具体事情关心人'),
      searchableText: '他话少，常用具体事情关心人',
    });

    expect(service.openAIService.generateMemoryText).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('不从籍贯推性格'),
      })
    );
  });

  it('marks current family states as "last mentioned" and keeps historical facts stable', () => {
    const identity = buildAgentIdentityContract({
      agent: { id: AGENT_ID, name: '爷爷', iCallAgent: '爷爷' } as AgentEntity,
      relatives: [
        {
          id: 'person:665000000000000000000201',
          preferredName: '安安',
          realName: '赵安宁',
          aliases: ['二宝'],
          relationToUser: '女儿',
          lifeStage: 'school_age',
          nameKnown: true,
          nameInquiryCount: 0,
          facts: [
            {
              domain: UserRelativeFactDomain.health,
              key: 'health.live_alone',
              value: '安安目前独居',
              status: UserRelativeFactStatus.current,
              occurredAt: new Date('2026-09-01T00:00:00.000Z'),
            },
            {
              domain: UserRelativeFactDomain.work,
              key: 'work.retired',
              value: '安安已经退休',
              status: UserRelativeFactStatus.historical,
            },
          ],
        },
      ],
    });

    const prompt = buildAgentIdentityPrompt(identity);
    expect(prompt).toContain('"recency":"上次提到"');
    expect(prompt).toContain('安安目前独居');
    expect(prompt).toContain('安安已经退休');
    expect(prompt).toContain('不得合并成同一个人');
  });
});
