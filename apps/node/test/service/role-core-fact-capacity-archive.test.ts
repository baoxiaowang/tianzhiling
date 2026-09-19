import {
  AgentProfileFactEntity,
  AgentProfileFactStatus,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createUserMessage(
  content: string,
  id = '665000000000000000000101',
  createdAt = new Date('2026-07-26T08:00:00.000Z')
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
    createdAt,
    updatedAt: createdAt,
  });
  return message;
}

function buildService(
  options: { llmEnabled?: boolean; llmFacts?: unknown[] } = {}
) {
  const service = new AgentProfileFactService();
  const stored: AgentProfileFactEntity[] = [];
  let llmFacts = options.llmFacts ?? [];

  service.logger = { warn: jest.fn(), error: jest.fn() } as never;
  service.openAIService = {
    isEnabled: jest.fn(() => options.llmEnabled === true),
    generateMemoryText: jest.fn(async () => ({
      content: JSON.stringify(llmFacts),
    })),
  } as never;
  service.factModel = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        stored.find(
          fact =>
            fact.userId.equals(where.userId) &&
            fact.agentId.equals(where.agentId) &&
            fact.key === where.key
        ) ?? null
      );
    }),
    find: jest.fn(async ({ where }: any) => {
      return stored.filter(fact => {
        if (where.userId && !fact.userId.equals(where.userId)) return false;
        if (where.agentId && !fact.agentId.equals(where.agentId)) return false;
        if (where.type && fact.type !== where.type) return false;
        if (where.status) {
          if (Array.isArray(where.status.$in)) {
            if (!where.status.$in.includes(fact.status)) return false;
          } else if (fact.status !== where.status) {
            return false;
          }
        }
        if (where.key?.$regex) {
          if (!new RegExp(where.key.$regex).test(fact.key)) return false;
        }
        return true;
      });
    }),
    save: jest.fn(async (fact: AgentProfileFactEntity) => {
      if (!fact.id) {
        fact.id = new MongoObjectId();
      }
      const index = stored.findIndex(item => item.id?.equals(fact.id as never));
      if (index >= 0) {
        stored[index] = fact;
      } else {
        stored.push(fact);
      }
      return fact;
    }),
  } as never;

  return {
    service,
    stored,
    setLlmFacts(facts: unknown[]) {
      llmFacts = facts;
    },
  };
}

function personalityFact(
  key: string,
  priority = 2,
  value = '话少，常用具体事情关心人'
) {
  return {
    type: 'style',
    key,
    value,
    polarity: 'positive',
    confidence: 'confirmed',
    priority,
  };
}

const PERSONALITY_KEYS = [
  'style.personality.trait_1',
  'style.personality.trait_2',
  'style.personality.trait_3',
  'style.personality.trait_4',
  'style.personality.trait_5',
  'style.personality.trait_6',
];

describe('role-core personality capacity control', () => {
  it('keeps five personality facts active and leaves the sixth as candidate', async () => {
    const { service, stored } = buildService({
      llmEnabled: true,
      llmFacts: PERSONALITY_KEYS.map(key => personalityFact(key)),
    });

    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('他性格很鲜明，话少'),
      searchableText: '他性格很鲜明，话少',
      explicitlyConfirmed: true,
    });

    const active = stored.filter(
      fact => fact.status === AgentProfileFactStatus.active
    );
    const candidates = stored.filter(
      fact => fact.status === AgentProfileFactStatus.candidate
    );
    expect(active).toHaveLength(5);
    expect(candidates).toHaveLength(1);
    // 超出的一条被保留为 candidate（不丢弃、也不为凑数补写）。
    expect(stored.map(fact => fact.key).sort()).toEqual(
      [...PERSONALITY_KEYS].sort()
    );
    expect(candidates[0].key).toBe('style.personality.trait_6');
  });

  it('keeps adopted high-priority facts when a low-priority candidate arrives', async () => {
    const { service, stored, setLlmFacts } = buildService({ llmEnabled: true });
    setLlmFacts(
      PERSONALITY_KEYS.slice(0, 5).map(key => personalityFact(key, 3))
    );
    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('他性格很鲜明，话少'),
      searchableText: '他性格很鲜明，话少',
      explicitlyConfirmed: true,
    });

    setLlmFacts([
      personalityFact('style.personality.low_priority', 1, '温和，慢性子'),
    ]);
    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('他性格很温和', '665000000000000000000102'),
      searchableText: '他性格很温和',
      explicitlyConfirmed: true,
    });

    for (const key of PERSONALITY_KEYS.slice(0, 5)) {
      expect(stored.find(fact => fact.key === key)?.status).toBe(
        AgentProfileFactStatus.active
      );
    }
    expect(
      stored.find(fact => fact.key === 'style.personality.low_priority')
        ?.status
    ).toBe(AgentProfileFactStatus.candidate);
  });

  it('never squeezes a user-corrected personality fact out by capacity', async () => {
    const { service, stored, setLlmFacts } = buildService({ llmEnabled: true });
    setLlmFacts(PERSONALITY_KEYS.slice(0, 5).map(key => personalityFact(key)));
    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage('他性格很鲜明，话少'),
      searchableText: '他性格很鲜明，话少',
      explicitlyConfirmed: true,
    });

    setLlmFacts([
      {
        ...personalityFact('style.personality.corrected', 1, '其实嘴硬心软'),
        confidence: 'user_corrected',
      },
    ]);
    await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(
        '更正一下，他其实嘴硬心软',
        '665000000000000000000103'
      ),
      searchableText: '更正一下，他其实嘴硬心软',
      explicitlyConfirmed: true,
    });

    expect(
      stored.find(fact => fact.key === 'style.personality.corrected')?.status
    ).toBe(AgentProfileFactStatus.active);
    expect(
      stored.filter(fact => fact.status === AgentProfileFactStatus.active)
    ).toHaveLength(5);
  });
});

describe('role-core address source-time ordering', () => {
  it('does not let a late-arriving older message overwrite a newer address', async () => {
    const { service, stored } = buildService();
    const preferred = () =>
      stored.find(fact => fact.key === 'relationship.preferred_user_name');

    const newer = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000201',
      new Date('2026-07-26T10:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: newer,
      searchableText: newer.content,
    });
    expect(preferred()?.value).toBe('当前用户希望当前角色称呼其为湾呐');

    // 后到达、但发生时间更早的消息不得覆盖新称呼。
    const older = createUserMessage(
      '以后叫我小芳',
      '665000000000000000000202',
      new Date('2026-07-26T08:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: older,
      searchableText: older.content,
    });

    expect(preferred()?.value).toBe('当前用户希望当前角色称呼其为湾呐');
    expect(
      stored.filter(fact => fact.key === 'relationship.preferred_user_name')
    ).toHaveLength(1);
  });

  it('is idempotent when the same source message is replayed', async () => {
    const { service, stored } = buildService();
    const message = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000301',
      new Date('2026-07-26T10:00:00.000Z')
    );
    // 生产里重放来自重新读取的消息对象，这里用同 id 的另一个实例模拟。
    const replay = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000301',
      new Date('2026-07-26T10:00:00.000Z')
    );

    await service.extractAndUpsertFromUserMessage({
      message,
      searchableText: message.content,
    });
    await service.extractAndUpsertFromUserMessage({
      message: replay,
      searchableText: replay.content,
    });

    const facts = stored.filter(
      fact => fact.key === 'relationship.preferred_user_name'
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('当前用户希望当前角色称呼其为湾呐');
    expect(facts[0].supportCount).toBe(1);
  });

  it('always lets an explicit correction win, even with an older timestamp', async () => {
    const { service, stored } = buildService();
    const preferred = () =>
      stored.find(fact => fact.key === 'relationship.preferred_user_name');

    const newer = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000401',
      new Date('2026-07-26T10:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: newer,
      searchableText: newer.content,
    });

    const correction = createUserMessage(
      '更正一下，以后叫我小明',
      '665000000000000000000402',
      new Date('2026-07-26T07:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: correction,
      searchableText: correction.content,
    });

    expect(preferred()?.value).toBe('当前用户希望当前角色称呼其为小明');
  });
});

describe('role-core archive reason persistence', () => {
  it('persists a real reason when an explicit correction supersedes an address fact', async () => {
    const { service, stored } = buildService();

    const initial = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000501',
      new Date('2026-07-26T10:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: initial,
      searchableText: initial.content,
    });

    const correction = createUserMessage(
      '更正一下，以后叫我小明',
      '665000000000000000000502',
      new Date('2026-07-26T11:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: correction,
      searchableText: correction.content,
    });

    const canonical = stored.find(
      fact => fact.key === 'relationship.preferred_user_name'
    );
    expect(canonical?.status).toBe(AgentProfileFactStatus.active);
    expect(canonical?.value).toBe('当前用户希望当前角色称呼其为小明');

    const superseded = stored.find(fact =>
      fact.key.startsWith('relationship.preferred_user_name.superseded.')
    );
    expect(superseded?.status).toBe(AgentProfileFactStatus.archived);
    expect(superseded?.value).toBe('当前用户希望当前角色称呼其为湾呐');
    // 库中原句，而不是按 confidence/status 合成的文案。
    expect(superseded?.governance?.reason).toContain('用户明确更正');
    expect(superseded?.governance?.reason).toContain('湾呐');
    expect(superseded?.governance?.reason).toContain('小明');
  });

  it('does not change archived-record reads and keeps the active value in prompt listing', async () => {
    const { service, stored } = buildService();

    const initial = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000601',
      new Date('2026-07-26T10:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: initial,
      searchableText: initial.content,
    });
    const correction = createUserMessage(
      '更正一下，以后叫我小明',
      '665000000000000000000602',
      new Date('2026-07-26T11:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message: correction,
      searchableText: correction.content,
    });

    const listed = await service.listFactsForPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
    });
    const listedKeys = listed.map(fact => fact.key);
    expect(listedKeys).toContain('relationship.preferred_user_name');
    expect(
      listedKeys.some(key => key.includes('.superseded.'))
    ).toBe(false);
    expect(
      listed.find(fact => fact.key === 'relationship.preferred_user_name')
        ?.value
    ).toBe('当前用户希望当前角色称呼其为小明');

    // archived 记录本身字段仍可读。
    const archived = stored.find(fact =>
      fact.key.startsWith('relationship.preferred_user_name.superseded.')
    );
    expect(archived?.value).toBe('当前用户希望当前角色称呼其为湾呐');
    expect(archived?.sourceMessageId?.toHexString()).toBe(
      '665000000000000000000601'
    );
  });

  it('persists a real reason when a forget request archives a fact', async () => {
    const { service, stored } = buildService();

    const message = createUserMessage(
      '以后叫我湾呐',
      '665000000000000000000701',
      new Date('2026-07-26T10:00:00.000Z')
    );
    await service.extractAndUpsertFromUserMessage({
      message,
      searchableText: message.content,
    });

    const archivedCount = await service.archiveMatchingFacts({
      userId: USER_ID,
      agentId: AGENT_ID,
      requestText: '这件事忘掉吧',
    });
    expect(archivedCount).toBeGreaterThan(0);

    const archived = stored.find(
      fact => fact.key === 'relationship.preferred_user_name'
    );
    expect(archived?.status).toBe(AgentProfileFactStatus.archived);
    expect(archived?.governance?.reason).toContain('用户明确要求不再保留');
  });
});
