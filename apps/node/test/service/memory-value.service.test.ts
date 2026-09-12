import { MongoObjectId } from '@tzl/entities';
import { MemoryValueService } from '../../src/service/agents/memory-value.service';

const userId = new MongoObjectId('665000000000000000000001');
const agentId = new MongoObjectId('665000000000000000000002');
const messageId = new MongoObjectId('665000000000000000000003');
const message = {
  id: messageId,
  userId,
  agentId,
  createdAt: new Date('2026-09-08T00:00:00Z'),
};
describe('buildFamilyStructureDecision', () => {
  const build = (mentioned: any[], existing: any[] = []) => {
    const service = new MemoryValueService();
    const input = {
      currentMessageId: String(messageId),
      referenceAt: '2026-09-11T00:00:00Z',
      subjects: [{ ref: `user:${userId}`, label: '当前讲述者/用户本人' }],
      messages: [{ id: String(messageId), role: 'user', content: '妈妈' }],
      existing,
    } as any;
    return (service as any).buildFamilyStructureDecision(input, mentioned);
  };

  it('keeps each family fragment as the user verbatim words', () => {
    const decision = build([
      {
        label: '妈妈',
        relation: '母亲',
        evidence: [{ messageId: String(messageId), quote: '妈妈身体一时好一时坏' }],
      },
    ]);
    expect(decision.value).toContain('家人关系说明');
    expect(decision.value).toContain('妈妈（母亲）');
    expect(decision.value).toContain('妈妈身体一时好一时坏');
  });

  it('accumulates new relatives without rewriting the existing lines', () => {
    const decision = build(
      [
        {
          label: '妹妹',
          relation: '妹妹',
          evidence: [{ messageId: String(messageId), quote: '妹妹今年考上大学' }],
        },
      ],
      [
        {
          id: new MongoObjectId('665000000000000000000701'),
          subjectRef: `user:${userId}`,
          key: 'family.structure',
          value: '家人关系说明：\n- 妈妈（母亲）：用户原话“妈妈身体一时好一时坏”',
        },
      ]
    );
    expect(decision.value).toContain('妈妈（母亲）');
    // 称呼和关系是同一个词时不重复写「妹妹（妹妹）」。
    expect(decision.value).toContain('妹妹：用户原话“妹妹今年考上大学”');
    expect(decision.operation).toBe('merge');
  });

  it('does not merge two grandchildren whose names differ', () => {
    const decision = build([
      {
        label: '大孙子',
        relation: '孙子',
        evidence: [{ messageId: String(messageId), quote: '大孙子读小学了' }],
      },
      {
        label: '小孙子',
        relation: '孙子',
        evidence: [{ messageId: String(messageId), quote: '小孙子刚会走路' }],
      },
    ]);
    expect(decision.value).toContain('大孙子');
    expect(decision.value).toContain('小孙子');
  });
});

describe('buildDepartureDateDecision', () => {
  const mkMessage = (content: string, at: string) => ({
    id: new MongoObjectId('665000000000000000000101'),
    userId,
    agentId,
    role: 'user',
    content,
    createdAt: new Date(at),
  });
  const run = (contents: Array<[string, string]>) => {
    const service = new MemoryValueService();
    const messages = contents.map(([content, at]) => mkMessage(content, at));
    const input = {
      currentMessageId: String(messages[0].id),
      currentMessageIds: messages.map(m => String(m.id)),
      referenceAt: '2026-09-11T00:00:00Z',
      subjects: [{ ref: `agent:${agentId}`, label: '爸爸', relation: '父亲' }],
      conversationAgentRef: `agent:${agentId}`,
      messages: messages.map(m => ({
        id: String(m.id),
        role: 'user',
        content: m.content,
      })),
      existing: [],
    } as any;
    return (service as any).buildDepartureDateDecision(input, messages);
  };

  it('keeps only the finest precision when the same person is mentioned twice', () => {
    const decisions = run([
      ['你离开我13年了', '2026-09-01T00:00:00Z'],
      ['你已经走了13年零2个月了', '2026-09-02T00:00:00Z'],
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].date.month).toBeDefined();
    expect(decisions[0].date.day).toBeUndefined();
  });

  it('writes no parameter when two equally precise statements conflict', () => {
    // 参数层不猜：两句都留在第二层的原话里，由模型判断。
    expect(
      run([
        ['你离开我13年了', '2026-09-01T00:00:00Z'],
        ['你离开我8年了', '2026-09-02T00:00:00Z'],
      ])
    ).toHaveLength(0);
  });
});

function setup(current: any = null) {
  const service = new MemoryValueService();
  service.factModel = {
    findOne: jest.fn(async () => current),
    find: jest.fn(async () => []),
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    insertOne: jest.fn(async d => {
      current = { ...d, id: d._id };
    }),
  } as any;
  service.personTemporalMemoryService = {
    recordExplicitPersonDate: jest.fn(),
    recordAgentDepartureFromMessage: jest.fn(),
  } as any;
  const d = {
    subjectRef: `agent:${agentId}`,
    participants: [],
    kind: 'event',
    type: 'memory',
    key: 'memory.tree',
    value: '小时候坐树下听故事',
    retention: 'durable',
    certainty: 'explicit',
    timeKind: 'historical',
    operation: 'add',
    reason: '具体共同经历',
    evidence: [{ messageId: String(messageId), quote: '树下听故事' }],
    protected: false,
    salience: 2,
  };
  const audit = {
    before: current ? [structuredClone(current)] : [],
    rejected: [],
    input: { messages: [] },
  };
  return { service, d, audit, stored: () => current };
}
describe('memory value writes', () => {
  it('retries an accepted identity projection after the fact was already committed', async () => {
    const { service, d, audit } = setup();
    const recordApprovedUserIdentity = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary identity failure'))
      .mockResolvedValueOnce(undefined);
    service.userIdentityMemoryService = { recordApprovedUserIdentity } as any;
    const identity = {
      ...d,
      subjectRef: `user:${userId}`,
      type: 'identity',
      key: 'user.identity.real_name',
      value: '用户正式姓名是赵浩帅',
      identity: { realName: '赵浩帅' },
    };
    const withSource = {
      ...audit,
      input: {
        messages: [{ id: String(messageId), role: 'user', content: '赵浩帅' }],
      },
    };
    await expect(
      (service as any).apply(message, identity, 0, withSource)
    ).rejects.toThrow('temporary identity failure');
    expect(await (service as any).apply(message, identity, 0, withSource)).toBe(
      false
    );
    expect(service.factModel.insertOne).toHaveBeenCalledTimes(1);
    expect(recordApprovedUserIdentity).toHaveBeenCalledTimes(2);
  });
  it('reports previously committed writes and refreshes the agent after retry', async () => {
    const { service, d } = setup({
      id: new MongoObjectId(),
      status: 'active',
      governance: { decisionId: `memory_value_v1:${messageId}:0` },
    });
    const audit = {
      version: 'memory_value_v1',
      status: 'proposed',
      decisions: [d],
      approved: [0],
      rejected: [],
      before: [],
      input: { messages: [] },
      modelCalls: 1,
    };
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue({ memoryValueAudit: audit }),
      updateOne: jest.fn(),
    } as any;
    jest.spyOn(service, 'active').mockReturnValue(true);
    const result = await service.process(
      message as any,
      '树下听故事',
      {} as any
    );
    expect(result).toMatchObject({
      count: 1,
      changedAgents: [String(agentId)],
    });
    expect(service.messageModel.updateOne).toHaveBeenLastCalledWith(
      expect.anything(),
      {
        $set: expect.objectContaining({
          memoryWriteStatus: 'written',
          memoryWriteProfileFactCount: 1,
        }),
      }
    );
  });
  it('persists intrinsic protection even when the proposal omits its flag', async () => {
    const { service, d, audit, stored } = setup();
    await (service as any).apply(message, { ...d, type: 'age' }, 0, audit);
    expect(stored().governance.protected).toBe(true);
  });
  it('retries one message without adding support or another record', async () => {
    const { service, d, audit, stored } = setup();
    expect(await (service as any).apply(message, d, 0, audit)).toBe(true);
    expect(await (service as any).apply(message, d, 0, audit)).toBe(false);
    expect(service.factModel.insertOne).toHaveBeenCalledTimes(1);
    expect(stored().supportCount).toBe(1);
  });
  it('keeps an active fact when a proposed replacement was rejected', async () => {
    const current = {
      id: new MongoObjectId(),
      value: '原有事实',
      updatedAt: new Date(),
      governance: { revision: 1 },
    };
    const { service, d, audit } = setup(current);
    const changed = await (service as any).apply(
      message,
      { ...d, operation: 'replace', targetId: String(current.id) },
      0,
      { ...audit, rejected: [0] }
    );
    expect(changed).toBe(false);
    expect(service.factModel.updateOne).not.toHaveBeenCalled();
  });
  it('fails stale revisions rather than overwriting concurrent user corrections', async () => {
    const current = {
      id: new MongoObjectId(),
      value: '已纠正事实',
      updatedAt: new Date(),
      governance: { revision: 2 },
    };
    const { service, d } = setup(current);
    await expect(
      (service as any).apply(
        message,
        { ...d, operation: 'replace', targetId: String(current.id) },
        0,
        { before: [{ ...current, governance: { revision: 1 } }], rejected: [] }
      )
    ).rejects.toThrow('STALE_VERSION');
    expect(service.factModel.updateOne).not.toHaveBeenCalled();
  });
  it('requires the compare-and-set to succeed', async () => {
    const current = {
      id: new MongoObjectId(),
      value: '原有事实',
      updatedAt: new Date(),
      governance: { revision: 1 },
    };
    const { service, d } = setup(current);
    (service.factModel.updateOne as jest.Mock).mockResolvedValue({
      modifiedCount: 0,
    });
    await expect(
      (service as any).apply(
        message,
        { ...d, operation: 'replace', targetId: String(current.id) },
        0,
        { before: [current], rejected: [] }
      )
    ).rejects.toThrow('STALE_VERSION');
  });
  it('archives without changing the original key, classification or assertion', async () => {
    const current = {
      id: new MongoObjectId(),
      key: 'occupation.primary',
      type: 'occupation',
      value: '是妈妈的骄傲',
      updatedAt: new Date(),
      governance: { revision: 1 },
    };
    const { service, d } = setup(current);
    const changed = await (service as any).apply(
      message,
      {
        ...d,
        operation: 'archive',
        targetId: String(current.id),
        retention: 'discard',
      },
      0,
      { before: [current], rejected: [] }
    );
    expect(changed).toBe(true);
    expect(service.factModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      {
        $set: expect.objectContaining({
          key: current.key,
          type: current.type,
          value: current.value,
          status: 'archived',
        }),
      }
    );
  });
  it('does not apply historical replay over a newer assertion', async () => {
    const current = {
      id: new MongoObjectId(),
      value: '原有事实',
      updatedAt: new Date(),
      governance: { revision: 1, sourceOccurredAt: '2026-09-09T00:00:00Z' },
    };
    const { service, d } = setup(current);
    expect(
      await (service as any).apply(
        message,
        { ...d, operation: 'replace', targetId: String(current.id) },
        0,
        { before: [current], rejected: [] }
      )
    ).toBe(false);
    expect(service.factModel.updateOne).not.toHaveBeenCalled();
  });
  it('merges a new near-duplicate fact into the existing record instead of inserting', async () => {
    const existing = {
      id: new MongoObjectId('665000000000000000000077'),
      userId,
      agentId: userId,
      type: 'memory',
      key: 'health.pain.old',
      value: '用户当前感到身体疼痛',
      status: 'active',
      updatedAt: new Date('2026-09-07T00:00:00.000Z'),
      governance: {
        subjectRef: `user:${userId}`,
        retention: 'session',
        protected: false,
      },
      sourceMessageIds: [],
    };
    const { service } = setup(null);
    (service.factModel.find as jest.Mock).mockResolvedValue([existing]);
    const decision = {
      subjectRef: `user:${userId}`,
      participants: [],
      kind: 'person',
      type: 'memory',
      key: 'health.pain.new',
      value: '用户当前感到身体疼痛，疼得睡不着',
      retention: 'session',
      certainty: 'uncertain',
      timeKind: 'current',
      validUntil: '2026-09-20T00:00:00.000Z',
      operation: 'add',
      reason: '身体不适',
      evidence: [{ messageId: String(messageId), quote: '树下听故事' }],
      protected: false,
      salience: 2,
    };

    const changed = await (service as any).apply(message, decision, 0, {
      before: [],
      rejected: [],
    });

    expect(changed).toBe(true);
    expect(service.factModel.insertOne).not.toHaveBeenCalled();
    expect(service.factModel.updateOne).toHaveBeenCalled();
  });
});

describe('bounded model repair', () => {
  const input = {
    currentMessageId: String(messageId),
    referenceAt: message.createdAt.toISOString(),
    subjects: [
      { ref: `user:${userId}`, label: '用户' },
      { ref: `agent:${agentId}`, label: '亲人' },
    ],
    messages: [{ id: String(messageId), role: 'user', content: '树下听故事' }],
    existing: [],
  };
  it('asks the model once to repair invalid structure without coercing the decision', async () => {
    const { service, d } = setup();
    const generateText = jest
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({ decisions: [{ ...d, kind: 'invented' }] }),
      })
      .mockResolvedValueOnce({ content: JSON.stringify({ decisions: [d] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ approved: [0] }) });
    service.openAIService = { isEnabled: () => true, generateText } as any;
    const result = await service.propose(structuredClone(input));
    expect(result.modelCalls).toBe(3);
    expect(result.decisions[0].kind).toBe('event');
    expect(
      JSON.parse(generateText.mock.calls[1][0].prompt).validationError
    ).toBe(
      'MEMORY_VALUE_ENUM: kind="invented"; allowed=person|relationship|event|temporal'
    );
    expect(service.factModel.insertOne).not.toHaveBeenCalled();
  });
  it('degrades a second invalid proposal to no memory without an unbounded retry loop', async () => {
    const { service, d } = setup();
    const generateText = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        decisions: [
          {
            ...d,
            evidence: [{ messageId: String(messageId), quote: '编造原话' }],
          },
        ],
      }),
    });
    service.openAIService = { isEnabled: () => true, generateText } as any;
    // 一次修复后仍不合规时不再抛错，而是视为本条消息没有可保存的记忆；
    // 模型调用仍然有界（首轮 + 一次修复）。
    const result = await service.propose(structuredClone(input));
    expect(result.decisions).toEqual([]);
    expect(result.modelCalls).toBe(2);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(service.factModel.insertOne).not.toHaveBeenCalled();
  });
  it('lets the model address a reviewer objection once and accounts for all calls', async () => {
    const { service, d } = setup();
    const id = '665000000000000000000099';
    const target = {
      id,
      subjectRef: d.subjectRef,
      key: d.key,
      type: d.type,
      value: '旧错误',
      status: 'active',
      revision: 0,
      protected: false,
    };
    const revised = { ...d, operation: 'replace', targetId: id };
    const generateText = jest
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({ decisions: [revised] }),
        response: { usage: { total_tokens: 100 } },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          approved: [],
          reasons: [{ index: 0, reason: '添加了原话未提供的心理解释' }],
        }),
        response: { usage: { total_tokens: 20 } },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ decisions: [revised] }),
        response: { usage: { total_tokens: 110 } },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ approved: [0] }),
        response: { usage: { total_tokens: 30 } },
      });
    service.openAIService = { isEnabled: () => true, generateText } as any;
    const result = await service.propose({
      ...structuredClone(input),
      sourceFactIds: [id],
      existing: [target],
    });
    expect(result).toMatchObject({
      modelCalls: 4,
      modelTokens: 260,
      rejected: [],
    });
    expect(
      JSON.parse(generateText.mock.calls[2][0].prompt).validationError
    ).toContain('添加了原话未提供的心理解释');
    expect(service.factModel.updateOne).not.toHaveBeenCalled();
  });
  it('stops after a second semantic rejection and preserves the reviewer reason', async () => {
    const { service, d } = setup();
    const id = '665000000000000000000099';
    const target = {
      id,
      subjectRef: d.subjectRef,
      key: d.key,
      type: d.type,
      value: '旧错误',
      status: 'active',
      revision: 0,
      protected: false,
    };
    const generateText = jest.fn().mockImplementation(async options =>
      options.memoryReview
        ? {
            content: JSON.stringify({
              approved: [],
              reasons: [{ index: 0, reason: '证据仍不支持' }],
            }),
          }
        : {
            content: JSON.stringify({
              decisions: [{ ...d, operation: 'replace', targetId: id }],
            }),
          }
    );
    service.openAIService = { isEnabled: () => true, generateText } as any;
    const result = await service.propose({
      ...structuredClone(input),
      sourceFactIds: [id],
      existing: [target],
    });
    expect(result).toMatchObject({
      modelCalls: 4,
      rejected: [0],
      reviewReasons: [{ index: 0, reason: '证据仍不支持' }],
    });
    expect(generateText).toHaveBeenCalledTimes(4);
    expect(service.factModel.updateOne).not.toHaveBeenCalled();
  });
});
