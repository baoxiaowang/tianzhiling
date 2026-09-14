import {
  MemoryEventGroupEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import { MemoryEventEngine } from '../../src/service/memory/memory-event.engine';
import {
  isPastOnlyStatement,
  parseOpenItemExtractionOutput,
  selectOpenItemExtractionWindow,
} from '../../src/service/memory/memory-open-item-extraction';
import {
  buildOpenItemSummary,
  nextOpenItemState,
  resolveItemTopicKey,
  resolveOpenItemObservation,
} from '../../src/service/memory/memory-open-item.rules';
import { MemoryModuleService } from '../../src/service/memory/memory-module.service';
import {
  EVENT_GROUP_MAX_GAP_MS,
  buildGroupKey,
  buildOpenItemFingerprint,
  resolveGroupAssignment,
} from '../../src/service/memory/memory-grouping';
import type {
  MemoryModule,
  MemoryRecallResult,
} from '../../src/service/memory/memory-module.types';

// ---- 极简内存仓储：只实现引擎用到的查询子集 ----

type Doc = Record<string, unknown>;

function matches(doc: Doc, filter: Doc): boolean {
  for (const key of Object.keys(filter)) {
    const expected = filter[key] as Doc;
    // 项目里的查询用 _id，内存仓储里存的是 id。
    const actual = key === '_id' ? doc.id : doc[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const op = expected as Record<string, unknown>;
      if ('$in' in op) {
        const list = op.$in as unknown[];
        if (!list.some(item => String(item) === String(actual))) return false;
        continue;
      }
      if ('$gte' in op) {
        if (!(asTime(actual) >= asTime(op.$gte))) return false;
        continue;
      }
      if ('$lte' in op) {
        if (!(asTime(actual) <= asTime(op.$lte))) return false;
        continue;
      }
      if ('$ne' in op) {
        if (String(actual) === String(op.$ne)) return false;
        continue;
      }
    }
    if (String(actual) !== String(expected)) return false;
  }
  return true;
}

function asTime(value: unknown): number {
  return value instanceof Date ? value.getTime() : 0;
}

class FakeRepo<T extends Doc> {
  rows: T[] = [];
  private seq = 0;

  async find(options?: {
    where?: Doc;
    order?: Doc;
    take?: number;
  }): Promise<T[]> {
    let rows = this.rows.filter(row => matches(row, options?.where || {}));
    const orderKey = options?.order ? Object.keys(options.order)[0] : undefined;
    if (orderKey) {
      const direction = options!.order![orderKey] as string;
      rows = rows
        .slice()
        .sort((left, right) =>
          direction === 'DESC'
            ? asTime(right[orderKey]) - asTime(left[orderKey])
            : asTime(left[orderKey]) - asTime(right[orderKey])
        );
    }
    if (typeof options?.take === 'number') rows = rows.slice(0, options.take);
    return rows;
  }

  async findOne(options: { where: Doc }): Promise<T | undefined> {
    return this.rows.find(row => matches(row, options.where));
  }

  async save(entity: T): Promise<T> {
    const row = { ...entity } as T;
    if (!row.id || String(row.id) === 'undefined') {
      this.seq += 1;
      (row as Doc).id = new MongoObjectId(
        `${String(this.seq).padStart(24, '0')}`
      );
    }
    const index = this.rows.findIndex(
      item => String(item.id) === String(row.id)
    );
    if (index === -1) this.rows.push(row);
    else this.rows[index] = row;
    return row;
  }

  async delete(criteria: Doc): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter(row => !matches(row, criteria));
    return { affected: before - this.rows.length };
  }

  async count(): Promise<number> {
    return this.rows.length;
  }
}

function buildEngine() {
  const engine = new MemoryEventEngine();
  const groups = new FakeRepo<Doc>();
  const items = new FakeRepo<Doc>();
  const messages = new FakeRepo<Doc>();
  (engine as never as { groupModel: unknown }).groupModel = groups;
  (engine as never as { itemModel: unknown }).itemModel = items;
  (engine as never as { messageModel: unknown }).messageModel = messages;
  return { engine, groups, items, messages };
}

const USER_ID = '6a9aa69fa41df734c10745eb';
const CONVERSATION_ID = '6a9aa6eea41df734c10745f1';
const AGENT_ID = '6a9aa6eea41df734c10745f4';

function addUserMessage(
  repo: FakeRepo<Doc>,
  id: string,
  content: string,
  occurredAt: Date
) {
  void repo.save({
    id: new MongoObjectId(id),
    userId: new MongoObjectId(USER_ID),
    role: MessageRole.user,
    content,
    occurredAt,
  } as Doc);
}

describe('事件分组纯逻辑', () => {
  const spanTo = new Date('2026-09-07T10:00:00.000Z');

  it('同话题、同主体、时间连续 → 并入', () => {
    expect(
      resolveGroupAssignment({
        topicKey: '抽烟',
        occurredAt: new Date('2026-09-13T10:00:00.000Z'),
        candidates: [{ groupId: 'g1', topicKey: '抽烟', spanTo }],
      })
    ).toEqual({ action: 'join', groupId: 'g1' });
  });

  it('超过生命周期上限 → 开新的一件', () => {
    expect(
      resolveGroupAssignment({
        topicKey: '抽烟',
        occurredAt: new Date(spanTo.getTime() + EVENT_GROUP_MAX_GAP_MS + 1),
        candidates: [{ groupId: 'g1', topicKey: '抽烟', spanTo }],
      })
    ).toEqual({ action: 'create' });
  });

  it('话题或主体不同 → 不并', () => {
    expect(
      resolveGroupAssignment({
        topicKey: '复查',
        occurredAt: new Date('2026-09-08T10:00:00.000Z'),
        candidates: [{ groupId: 'g1', topicKey: '抽烟', spanTo }],
      })
    ).toEqual({ action: 'create' });
    expect(
      resolveGroupAssignment({
        topicKey: '复查',
        subjectRef: '奶奶',
        occurredAt: new Date('2026-09-08T10:00:00.000Z'),
        candidates: [
          { groupId: 'g1', topicKey: '复查', subjectRef: '爷爷', spanTo },
        ],
      })
    ).toEqual({ action: 'create' });
  });

  it('多个候选时并入最近的一件', () => {
    expect(
      resolveGroupAssignment({
        topicKey: '抽烟',
        occurredAt: new Date('2026-09-20T10:00:00.000Z'),
        candidates: [
          {
            groupId: 'old',
            topicKey: '抽烟',
            spanTo: new Date('2026-08-01T00:00:00Z'),
          },
          {
            groupId: 'new',
            topicKey: '抽烟',
            spanTo: new Date('2026-09-15T00:00:00Z'),
          },
        ],
      })
    ).toEqual({ action: 'join', groupId: 'new' });
  });

  it('分组键稳定：重建两次结果一致', () => {
    const input = {
      engine: 'event_v1',
      userId: USER_ID,
      topicKey: '抽烟',
      spanFrom: spanTo,
    };
    expect(buildGroupKey(input)).toBe(buildGroupKey(input));
  });

  it('未了结条目的指纹不含日期，但认得出是不是同一个日子', () => {
    const base = {
      engine: 'event_v1',
      userId: USER_ID,
      topicKey: '就医',
      subjectRef: '爸爸',
      content: '我下周要去医院复查',
    };
    const fingerprintAt = (day: string, overrides: Record<string, unknown>) =>
      buildOpenItemFingerprint({
        ...base,
        ...overrides,
        occurredAt: new Date(`${day}T10:00:00.000Z`),
      });
    // 同一句话隔几天再说，还是同一条
    expect(fingerprintAt('2026-09-07', {})).toBe(
      fingerprintAt('2026-09-10', {})
    );
    // 主体不同、内容不同，都是两件事
    expect(fingerprintAt('2026-09-07', {})).not.toBe(
      fingerprintAt('2026-09-07', { subjectRef: '妈妈' })
    );
    expect(fingerprintAt('2026-09-07', {})).not.toBe(
      fingerprintAt('2026-09-07', { content: '我要去拿体检报告' })
    );
    // 日子类：句子里只有日子不同，也必须是两条（否则等于把日子丢了）
    expect(
      fingerprintAt('2026-09-07', {
        topicKey: '纪念日',
        content: '明天是您的三七',
      })
    ).not.toBe(
      fingerprintAt('2026-09-07', {
        topicKey: '纪念日',
        content: '明天是您的五七',
      })
    );
  });
});

describe('事件组合引擎', () => {
  it('把同一件事的原话聚成一个组合，且重复写入幂等', async () => {
    const { engine, groups } = buildEngine();
    const first = await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          content: '就是现在偶尔抽烟了',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(first.status).toBe('accepted');

    const second = await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          content: '爸爸，大儿今天没忍住又抽烟了',
          occurredAt: new Date('2026-09-13T10:00:00.000Z'),
        },
        // 重复提交第一条：不能变成两个成员
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          content: '就是现在偶尔抽烟了',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(second.status).toBe('accepted');

    const all = await groups.find({});
    expect(all).toHaveLength(1);
    const group = all[0] as unknown as MemoryEventGroupEntity;
    expect(group.topicKey).toBe('抽烟');
    expect(group.members).toHaveLength(2);
    expect(group.title).toContain('抽烟');
  });

  it('情绪句、问句、没有话题的原话不进组合', async () => {
    const { engine, groups } = buildEngine();
    const result = await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'bbbbbbbbbbbbbbbbbbbbbbb1',
          content: '大姐我想你了',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        {
          messageId: 'bbbbbbbbbbbbbbbbbbbbbbb2',
          content: '你在干嘛呢',
          occurredAt: new Date('2026-09-07T10:01:00.000Z'),
        },
        {
          messageId: 'bbbbbbbbbbbbbbbbbbbbbbb3',
          content: '今天天气不错我出去走了走',
          occurredAt: new Date('2026-09-07T10:02:00.000Z'),
        },
      ],
    });
    expect(result.status).toBe('skipped');
    expect(await groups.count()).toBe(0);
  });

  it('检索命中组合并展开成员，排除当前这轮，且只给用户原话', async () => {
    const { engine, messages } = buildEngine();
    const t1 = new Date('2026-09-07T10:00:00.000Z');
    const t2 = new Date('2026-09-13T10:00:00.000Z');
    await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          content: '就是现在偶尔抽烟了',
          occurredAt: t1,
        },
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          content: '爸爸，大儿今天没忍住又抽烟了',
          occurredAt: t2,
        },
      ],
    });
    addUserMessage(
      messages,
      'aaaaaaaaaaaaaaaaaaaaaaa1',
      '就是现在偶尔抽烟了',
      t1
    );
    addUserMessage(
      messages,
      'aaaaaaaaaaaaaaaaaaaaaaa2',
      '爸爸，大儿今天没忍住又抽烟了',
      t2
    );
    // AI 说过的话不能被当成用户记忆
    void messages.save({
      id: new MongoObjectId('aaaaaaaaaaaaaaaaaaaaaaa3'),
      userId: new MongoObjectId(USER_ID),
      role: MessageRole.assistant,
      content: '少抽点，身体要紧',
      occurredAt: t2,
    } as Doc);

    const recalled = await engine.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '那段时间有你陪着，真的没抽，可是自从你走了，又捡起来了',
      currentTurnMessageIds: ['aaaaaaaaaaaaaaaaaaaaaaa2'],
      limit: 5,
    });

    expect(recalled.status).toBe('ok');
    const quotes = recalled.evidence.filter(
      item => item.assertPolicy === 'quote'
    );
    expect(quotes.map(item => item.text)).toEqual(['就是现在偶尔抽烟了']);
    const summary = recalled.evidence.find(
      item => item.kind === 'group_summary'
    );
    expect(summary?.assertPolicy).toBe('context');
    // 成员必须能回到原话
    expect(quotes[0].sourceMessageIds).toEqual(['aaaaaaaaaaaaaaaaaaaaaaa1']);
  });

  it('检索也走"抽不出话题键就不检索"', async () => {
    const { engine } = buildEngine();
    const recalled = await engine.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '在吗',
      currentTurnMessageIds: [],
      limit: 5,
    });
    expect(recalled.status).toBe('skipped');
    expect(recalled.diagnostics.skipReason).toBe('no_topic_key');
  });

  it('删原话级联：成员删空后整组删除', async () => {
    const { engine, groups, items } = buildEngine();
    await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          content: '就是现在偶尔抽烟了',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    void items.save({
      id: new MongoObjectId('ccccccccccccccccccccccc1'),
      userId: new MongoObjectId(USER_ID),
      engine: 'event_v1',
      topicKey: '抽烟',
      state: 'awaiting_result',
      sourceMessageIds: [new MongoObjectId('aaaaaaaaaaaaaaaaaaaaaaa1')],
      stateHistory: [],
    } as Doc);

    const result = await engine.maintain({
      action: 'forget',
      userId: USER_ID,
      messageIds: ['aaaaaaaaaaaaaaaaaaaaaaa1'],
    });
    expect(result.status).toBe('ok');
    expect(await groups.count()).toBe(0);
    expect(await items.count()).toBe(0);
  });

  it('提问记账在线：raised 只加次数与时间，不改状态；状态变化才写历史', async () => {
    const { engine, items } = buildEngine();
    void items.save({
      id: new MongoObjectId('ccccccccccccccccccccccc1'),
      userId: new MongoObjectId(USER_ID),
      engine: 'event_v1',
      topicKey: '复查',
      state: 'awaiting_result',
      stateHistory: [],
      raisedCount: 0,
    } as Doc);

    const raised = await engine.updateOpenItem({
      userId: USER_ID,
      itemId: 'ccccccccccccccccccccccc1',
      raised: true,
    });
    expect(raised.status).toBe('updated');
    expect(raised.item?.raisedCount).toBe(1);
    expect(raised.item?.state).toBe('awaiting_result');
    expect(raised.item?.stateHistory).toHaveLength(0);

    // 同一轮重试不能把"问过"多加一次
    const raisedAgain = await engine.updateOpenItem({
      userId: USER_ID,
      itemId: 'ccccccccccccccccccccccc1',
      raised: true,
      now: new Date(),
    });
    expect(raisedAgain.item?.raisedCount).toBe(1);

    const closed = await engine.updateOpenItem({
      userId: USER_ID,
      itemId: 'ccccccccccccccccccccccc1',
      state: 'resolved',
      evidenceMessageId: 'aaaaaaaaaaaaaaaaaaaaaaa9',
      source: 'offline_extraction',
    });
    expect(closed.item?.state).toBe('resolved');
    expect(closed.item?.stateHistory).toHaveLength(1);
    expect(closed.item?.stateHistory[0].source).toBe('offline_extraction');
  });
});

describe('记忆模块门面', () => {
  const envKeys = [
    'NODE_MEMORY_MODULE_SCOPE',
    'NODE_MEMORY_MODULE_MODE',
    'NODE_MEMORY_MODULE_PRIMARY',
    'NODE_MEMORY_MODULE_RECALL_ENGINE',
    'NODE_MEMORY_MODULE_SHADOW',
    'NODE_MEMORY_MODULE_USER_IDS',
  ];
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  function buildService(options: {
    legacy: Partial<MemoryModule>;
    event: Partial<MemoryModule>;
  }) {
    const service = new MemoryModuleService();
    (service as never as { legacyEngine: unknown }).legacyEngine = {
      capabilities: () => ({
        engine: 'legacy_v1',
        supports: {},
        limits: {},
      }),
      ...options.legacy,
    };
    (service as never as { eventEngine: unknown }).eventEngine = {
      capabilities: () => ({
        engine: 'event_v1',
        supports: {},
        limits: {},
      }),
      ...options.event,
    };
    return service;
  }

  it('未配置时 = 关闭，不调用任何引擎', async () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'off';
    const legacyRecall = jest.fn();
    const eventRecall = jest.fn();
    const service = buildService({
      legacy: { recall: legacyRecall },
      event: { recall: eventRecall },
    });

    const result = await service.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '爸爸，大儿今天没忍住又抽烟了',
      currentTurnMessageIds: [],
      limit: 5,
    });
    expect(result.status).toBe('skipped');
    expect(result.diagnostics.skipReason).toBe('module_off');
    expect(legacyRecall).not.toHaveBeenCalled();
    expect(eventRecall).not.toHaveBeenCalled();
  });

  it('检索与未了结清单分开选引擎：开启新模块不会顺带换掉召回', async () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'active';
    // 未了结清单走新引擎，检索仍然走旧引擎（默认）
    process.env.NODE_MEMORY_MODULE_PRIMARY = 'event_v1';
    process.env.NODE_MEMORY_MODULE_USER_IDS = USER_ID;

    const legacyRecall = jest.fn().mockResolvedValue({
      evidence: [],
      status: 'ok',
      diagnostics: {
        engine: 'legacy_v1',
        mode: 'active',
        candidateCount: 1,
        selectedCount: 0,
      },
    });
    const eventRecall = jest.fn();
    const eventList = jest.fn().mockResolvedValue({
      items: [],
      status: 'empty',
      diagnostics: { engine: 'event_v1', total: 0 },
    });
    const service = buildService({
      legacy: { recall: legacyRecall },
      event: { recall: eventRecall, listOpenItems: eventList },
    });

    const recalled = await service.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '爸爸，大儿今天没忍住又抽烟了',
      currentTurnMessageIds: [],
      limit: 5,
    });
    expect(recalled.diagnostics.engine).toBe('legacy_v1');
    expect(legacyRecall).toHaveBeenCalled();
    expect(eventRecall).not.toHaveBeenCalled();

    await service.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(eventList).toHaveBeenCalled();
  });

  it('SCOPE=all 时对全部用户生效（真实流量验证）', async () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'active';
    process.env.NODE_MEMORY_MODULE_SCOPE = 'all';
    process.env.NODE_MEMORY_MODULE_PRIMARY = 'event_v1';
    const eventList = jest.fn().mockResolvedValue({
      items: [],
      status: 'empty',
      diagnostics: { engine: 'event_v1', total: 0 },
    });
    const service = buildService({
      legacy: {},
      event: { listOpenItems: eventList },
    });

    const selection = service.describeSelection(USER_ID);
    expect(selection.mode).toBe('active');
    await service.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(eventList).toHaveBeenCalled();
  });

  it('SCOPE=all 但 MODE=off 时仍然不动', () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'off';
    process.env.NODE_MEMORY_MODULE_SCOPE = 'all';
    const service = buildService({ legacy: {}, event: {} });
    expect(service.describeSelection(USER_ID).mode).toBe('off');
  });

  it('名单外用户即使配置了也不生效', async () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'active';
    process.env.NODE_MEMORY_MODULE_PRIMARY = 'event_v1';
    process.env.NODE_MEMORY_MODULE_USER_IDS = 'ffffffffffffffffffffffff';
    const eventRecall = jest.fn();
    const service = buildService({
      legacy: {},
      event: { recall: eventRecall },
    });

    const result = await service.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '抽烟',
      currentTurnMessageIds: [],
      limit: 5,
    });
    expect(result.status).toBe('skipped');
    expect(eventRecall).not.toHaveBeenCalled();
  });

  it('影子模式：只注入生效引擎的结果，影子结果只记录', async () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'shadow';
    process.env.NODE_MEMORY_MODULE_PRIMARY = 'legacy_v1';
    process.env.NODE_MEMORY_MODULE_SHADOW = 'event_v1';
    process.env.NODE_MEMORY_MODULE_USER_IDS = USER_ID;

    const legacyResult: MemoryRecallResult = {
      evidence: [
        {
          id: 'legacy-1',
          kind: 'utterance',
          text: '就是现在偶尔抽烟了',
          role: 'user',
          sourceMessageIds: ['m1'],
          assertPolicy: 'quote',
          engine: 'legacy_v1',
        },
      ],
      status: 'ok',
      diagnostics: {
        engine: 'legacy_v1',
        mode: 'active',
        candidateCount: 10,
        selectedCount: 1,
      },
    };
    const eventResult: MemoryRecallResult = {
      evidence: [
        {
          id: 'member:m1',
          kind: 'group_member',
          text: '就是现在偶尔抽烟了',
          role: 'user',
          sourceMessageIds: ['m1'],
          assertPolicy: 'quote',
          engine: 'event_v1',
        },
        {
          id: 'member:m2',
          kind: 'group_member',
          text: '爸爸，大儿今天没忍住又抽烟了',
          role: 'user',
          sourceMessageIds: ['m2'],
          assertPolicy: 'quote',
          engine: 'event_v1',
        },
      ],
      status: 'ok',
      diagnostics: {
        engine: 'event_v1',
        mode: 'active',
        candidateCount: 2,
        selectedCount: 2,
        groupCount: 1,
      },
    };
    const service = buildService({
      legacy: { recall: jest.fn().mockResolvedValue(legacyResult) },
      event: { recall: jest.fn().mockResolvedValue(eventResult) },
    });

    const result = await service.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '抽烟',
      currentTurnMessageIds: [],
      limit: 5,
    });

    expect(result.diagnostics.mode).toBe('shadow');
    expect(result.evidence.map(item => item.id)).toEqual(['legacy-1']);
    expect(result.shadow?.engine).toBe('event_v1');
    expect(result.shadow?.selectedCount).toBe(2);
  });

  it('引擎报错时降级为空证据，不把异常抛给回复链路', async () => {
    process.env.NODE_MEMORY_MODULE_MODE = 'active';
    process.env.NODE_MEMORY_MODULE_PRIMARY = 'event_v1';
    process.env.NODE_MEMORY_MODULE_RECALL_ENGINE = 'event_v1';
    process.env.NODE_MEMORY_MODULE_USER_IDS = USER_ID;
    const service = buildService({
      legacy: {},
      event: { recall: jest.fn().mockRejectedValue(new Error('milvus down')) },
    });

    const result = await service.recall({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      currentUserText: '抽烟',
      currentTurnMessageIds: [],
      limit: 5,
    });

    expect(result.status).toBe('failed');
    expect(result.evidence).toEqual([]);
    expect(result.diagnostics.errorCode).toBe('milvus down');
  });
});

describe('未了结清单的离线抽取', () => {
  // v1 的规则路径默认关闭（只由离线模型判定写入清单）；这里显式打开，验证规则本身。
  beforeEach(() => {
    process.env.NODE_MEMORY_OPEN_ITEM_RULES = '1';
  });
  afterEach(() => {
    delete process.env.NODE_MEMORY_OPEN_ITEM_RULES;
  });

  it('规则路径默认关闭：ingest 不再凭规则往清单里写条目', async () => {
    delete process.env.NODE_MEMORY_OPEN_ITEM_RULES;
    const { engine } = buildEngine();
    await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'fffffffffffffffffffffff1',
          content: '爸爸，我下周要去医院复查',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    const items = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(items.items).toHaveLength(0);
  });

  it('说"还没出结果"会建条目，说"没事了"会了结并留证据', async () => {
    const { engine } = buildEngine();
    const first = await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'ddddddddddddddddddddddd1',
          content: '爸爸，我下周要去医院复查',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(first.status).toBe('accepted');

    const opened = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(opened.items).toHaveLength(1);
    expect(opened.items[0].state).toBe('awaiting_result');
    expect(opened.items[0].summary).toContain('复查');

    await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'ddddddddddddddddddddddd2',
          content: '爸爸，复查结果出来了，没事了',
          occurredAt: new Date('2026-09-14T10:00:00.000Z'),
        },
      ],
    });

    const closed = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(closed.items).toHaveLength(0);
  });

  it('纯情绪或与事项无关的原话不进清单', async () => {
    const { engine } = buildEngine();
    await engine.ingest({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      messages: [
        {
          messageId: 'eeeeeeeeeeeeeeeeeeeeeee1',
          content: '爸爸，我今天收拾了屋子，晒太阳了',
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    const items = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(items.items).toHaveLength(0);
  });
});

describe('未了结规则纯逻辑', () => {
  it('分辨未了结、已了结、不想提', () => {
    expect(resolveOpenItemObservation('我下周要去医院复查')?.unresolved).toBe(
      true
    );
    expect(resolveOpenItemObservation('复查结果出来了，没事了')?.resolved).toBe(
      true
    );
    expect(resolveOpenItemObservation('别问了，我不想提')?.dismissed).toBe(
      true
    );
    expect(resolveOpenItemObservation('今天天气不错')).toBeUndefined();
  });

  it('收紧后必须"具体事项 + 未完成信号"同时成立', () => {
    // 有事项但没有任何未完成/承诺信号：不成条目
    expect(
      resolveOpenItemObservation('以前你也让大儿能不抽就不抽')
    ).toBeUndefined();
    expect(resolveOpenItemObservation('我最近睡得很好')).toBeUndefined();
    // 有信号但没有具体事项：不成条目
    expect(resolveOpenItemObservation('我明天要去买菜')).toBeUndefined();
    expect(resolveOpenItemObservation('我打算收拾一下屋子')).toBeUndefined();
    // 两者都有：成条目
    expect(resolveOpenItemObservation('我下周要去医院复查')?.topicKey).toBe(
      '就医'
    );
    expect(resolveOpenItemObservation('下个月要考试了')?.topicKey).toBe('学业');
  });

  it('习惯类只在承诺/决心语气下才算一件事', () => {
    expect(resolveOpenItemObservation('我决定戒烟了')?.unresolved).toBe(true);
    expect(resolveItemTopicKey('我决定戒烟了')).toBe('习惯');
    expect(resolveOpenItemObservation('就是现在偶尔抽烟了')).toBeUndefined();
  });

  it('纪念日不是未了结事项', () => {
    expect(resolveItemTopicKey('下周是爸爸的忌日')).toBeUndefined();
  });

  it('只有明确结果才把条目推向终态', () => {
    expect(
      nextOpenItemState({
        current: 'awaiting_result',
        observation: resolveOpenItemObservation('结果没事了')!,
      })
    ).toBe('resolved');
    // 含糊的说法不动状态
    expect(
      nextOpenItemState({
        current: 'awaiting_result',
        observation: {
          unresolved: false,
          resolved: false,
          dismissed: false,
          importance: 2,
        },
      })
    ).toBeUndefined();
  });

  it('摘要只截原话，不改写', () => {
    const text = '爸爸，我下周要去医院复查，医生说要看结果';
    expect(buildOpenItemSummary(text)).toBe(text);
  });
});

describe('未了结条目的模型判定（解析与校验）', () => {
  const messages = [
    {
      messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
      content: '爸爸，我下周要去医院复查，医生说要看结果',
      occurredAt: '2026-09-07T10:00:00.000Z',
    },
    {
      messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
      content: '以前这个时候你该去买菜了，你以前还做过脚的手术',
      occurredAt: '2026-09-08T10:00:00.000Z',
    },
  ];

  it('只接受"引用逐字来自原话"的条目', () => {
    const parsed = parseOpenItemExtractionOutput(
      JSON.stringify({
        items: [
          {
            messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
            quote: '我下周要去医院复查',
            topicKey: '就医',
            state: 'awaiting_result',
            importance: 3,
            dueHint: '下周',
          },
          {
            messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
            quote: '我下个月要去做手术', // 原文里没有这句：编的
            topicKey: '就医',
            state: 'awaiting_result',
            importance: 3,
          },
        ],
      }),
      messages
    );

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toEqual(
      expect.objectContaining({
        messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
        topicKey: '就医',
        state: 'awaiting_result',
        importance: 3,
        dueHint: '下周',
      })
    );
    expect(parsed.rejected.map(item => item.reason)).toEqual([
      'quote_not_found_in_source',
    ]);
  });

  it('类别和状态必须在允许集合内', () => {
    const parsed = parseOpenItemExtractionOutput(
      JSON.stringify({
        items: [
          {
            messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
            quote: '我下周要去医院复查',
            topicKey: '思念',
            state: 'awaiting_result',
            importance: 3,
          },
          {
            messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
            quote: '我下周要去医院复查',
            topicKey: '就医',
            state: 'resolved',
            importance: 3,
          },
        ],
      }),
      messages
    );
    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.rejected.map(item => item.reason)).toEqual([
      'topic_not_allowed',
      'invalid_state',
    ]);
  });

  it('引用太短或 JSON 不合法时安全返回空', () => {
    expect(
      parseOpenItemExtractionOutput(
        JSON.stringify({
          items: [
            {
              messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
              quote: '我下周要去医院复查',
              topicKey: '就医',
              state: 'awaiting_result',
              importance: 3,
            },
          ],
        }),
        messages
      ).candidates
    ).toHaveLength(1);
    expect(
      parseOpenItemExtractionOutput(
        JSON.stringify({
          items: [
            {
              messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
              quote: '复查',
              topicKey: '就医',
              state: 'awaiting_result',
              importance: 3,
            },
          ],
        }),
        messages
      ).rejected[0].reason
    ).toBe('quote_too_short');
    expect(
      parseOpenItemExtractionOutput('not json', messages).rejected[0].reason
    ).toBe('invalid_json');
  });

  it('看不出主事的半句、只有症状没有就医的都不收', () => {
    const rows = [
      {
        messageId: 'bbbbbbbbbbbbbbbbbbbbbbb1',
        content: '还有4个月的时间',
        occurredAt: '2026-09-09T10:00:00.000Z',
      },
      {
        messageId: 'bbbbbbbbbbbbbbbbbbbbbbb2',
        content: '我头很重，眼睛也疼。',
        occurredAt: '2026-09-09T10:00:00.000Z',
      },
      {
        messageId: 'bbbbbbbbbbbbbbbbbbbbbbb3',
        content: '今天我去医院复查了，医生说下个月还要去',
        occurredAt: '2026-09-09T10:00:00.000Z',
      },
    ];
    const parsed = parseOpenItemExtractionOutput(
      JSON.stringify({
        items: [
          {
            messageId: 'bbbbbbbbbbbbbbbbbbbbbbb1',
            quote: '还有4个月的时间',
            topicKey: '纪念日',
            state: 'awaiting_result',
            importance: 1,
          },
          {
            messageId: 'bbbbbbbbbbbbbbbbbbbbbbb2',
            quote: '我头很重，眼睛也疼',
            topicKey: '身体',
            state: 'awaiting_result',
            importance: 2,
          },
          {
            messageId: 'bbbbbbbbbbbbbbbbbbbbbbb3',
            quote: '今天我去医院复查了，医生说下个月还要去',
            topicKey: '就医',
            state: 'awaiting_result',
            importance: 3,
          },
        ],
      }),
      rows
    );
    // 纪念日就算引用的是含糊片段，也只进"日子"那一类，不进待跟进清单。
    expect(parsed.candidates.map(item => item.messageId)).toEqual([
      'bbbbbbbbbbbbbbbbbbbbbbb1',
      'bbbbbbbbbbbbbbbbbbbbbbb3',
    ]);
    expect(
      parsed.candidates.find(item => item.topicKey === '纪念日')?.importance
    ).toBe(1);
    expect(parsed.rejected.map(item => item.reason)).toEqual([
      'symptom_without_care',
    ]);
    // 看不出主事（人、时间都没有）的片段在更早一步就被拒
    expect(
      parseOpenItemExtractionOutput(
        JSON.stringify({
          items: [
            {
              messageId: 'bbbbbbbbbbbbbbbbbbbbbbb2',
              quote: '看出去的东西是重影的',
              topicKey: '就医',
              state: 'awaiting_result',
              importance: 2,
            },
          ],
        }),
        [
          ...rows,
          {
            messageId: 'bbbbbbbbbbbbbbbbbbbbbbb2',
            content: '我头很重，眼睛也疼，看出去的东西是重影的。',
            occurredAt: '2026-09-09T10:00:00.000Z',
          },
        ]
      ).rejected[0].reason
    ).toBe('quote_without_subject_or_time');
  });
});

describe('模型判定结果的写入', () => {
  it('同事项同主体只保留一条，证据只追加；做成动作时更新状态并留痕', async () => {
    const { engine, items } = buildEngine();
    const occurredAt = new Date('2026-09-07T10:00:00.000Z');

    const first = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '我下周要去医院复查',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt,
        },
      ],
    });
    expect(first.created).toBe(1);

    const second = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我开始吃药了，医生说要坚持',
          topicKey: '就医',
          state: 'action_committed',
          importance: 3,
          occurredAt: new Date('2026-09-09T10:00:00.000Z'),
        },
      ],
    });
    expect(second.updated).toBe(1);
    expect(await items.count()).toBe(1);

    const listed = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].state).toBe('action_committed');
    expect(listed.items[0].sourceMessageIds).toHaveLength(2);
    expect(listed.items[0].stateHistory).toHaveLength(2);
  });

  it('隔几天再说同一件事，还是同一条（指纹不带日期）', async () => {
    const { engine, items } = buildEngine();
    const first = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '我刚做完手术，在家躺着',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(first.created).toBe(1);

    const later = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我刚做完手术，在家躺着',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-10T10:00:00.000Z'),
        },
      ],
    });
    expect(later.updated).toBe(1);
    expect(later.created).toBe(0);
    expect(await items.count()).toBe(1);
    const stored = (await items.find())[0] as unknown as {
      sourceMessageIds: unknown[];
    };
    expect(stored.sourceMessageIds).toHaveLength(2);
  });

  it('同一天里换了说法、或者没带主体，也并成同一条', async () => {
    const { engine, items } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '爸爸，我刚做完手术，在家躺着',
          topicKey: '就医',
          subjectRef: '爸爸',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    const second = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我刚做完手术，在家躺着',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T12:00:00.000Z'),
        },
      ],
    });
    expect(second.updated).toBe(1);
    expect(second.created).toBe(0);
    expect(await items.count()).toBe(1);
  });

  it('同一句话被归到两个话题：各自留在自己的清单里，不并', async () => {
    const { engine, items } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '下周六小宝办周岁酒',
          topicKey: '纪念日',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '下周六小宝办周岁酒',
          topicKey: '家人',
          state: 'action_committed',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(await items.count()).toBe(2);
  });

  it('同一句话被抽成"家人"和"关系矛盾"：是同一件事，并成一条', async () => {
    const { engine, items } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '我好久没有见到她了，妈妈，我真的好害怕不敢见我姐姐',
          topicKey: '家人',
          subjectRef: '姐姐',
          state: 'awaiting_result',
          importance: 2,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我好久没有见到她了，妈妈，我真的好害怕不敢见我姐姐',
          topicKey: '关系矛盾',
          subjectRef: '姐姐',
          state: 'action_committed',
          importance: 2,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(await items.count()).toBe(1);
  });

  it('两边都说了不同的人：说的是同一句话也不并（不是同一件事）', async () => {
    const { engine, items } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '我下周要去医院复查',
          topicKey: '就医',
          subjectRef: '妈妈',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我下周要去医院复查',
          topicKey: '就医',
          subjectRef: '爸爸',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    expect(await items.count()).toBe(2);
  });

  it('已经了结的同一件事原话再提一次：重新开工，不新增条目', async () => {
    const { engine, items } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '我下周要去医院复查',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    const stored = (await items.find())[0] as unknown as { id: string };
    await engine.updateOpenItem({
      userId: USER_ID,
      itemId: String(stored.id),
      raised: true,
      state: 'resolved',
      source: 'user_request',
      now: new Date('2026-09-08T10:00:00.000Z'),
    });
    expect(
      ((await items.find())[0] as unknown as { state: string }).state
    ).toBe('resolved');

    const again = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我下周要去医院复查',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-12T10:00:00.000Z'),
        },
      ],
    });
    expect(again.created).toBe(0);
    expect(again.updated).toBe(1);
    expect(await items.count()).toBe(1);
    const reopened = (await items.find())[0] as unknown as {
      state: string;
      raisedCount: number;
      stateHistory: unknown[];
    };
    expect(reopened.state).toBe('awaiting_result');
    expect(reopened.raisedCount).toBe(0);
    expect(reopened.stateHistory).toHaveLength(3);
  });

  it('了结后换了说法再提：按新的一件事记，旧的那条保持已了结', async () => {
    const { engine, items } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa1',
          quote: '我下周要去医院复查',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });
    const stored = (await items.find())[0] as unknown as { id: string };
    await engine.updateOpenItem({
      userId: USER_ID,
      itemId: String(stored.id),
      state: 'resolved',
      source: 'user_request',
      now: new Date('2026-09-08T10:00:00.000Z'),
    });
    const again = await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'aaaaaaaaaaaaaaaaaaaaaaa2',
          quote: '我又要去医院复查了',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-12T10:00:00.000Z'),
        },
      ],
    });
    expect(again.created).toBe(1);
    expect(await items.count()).toBe(2);
    const states = (await items.find()).map(
      row => (row as unknown as { state: string }).state
    );
    expect(states.sort()).toEqual(['awaiting_result', 'resolved']);
  });

  it('日子类：不同的日子各是一条，同一个日子说两次还是一条', async () => {
    const { engine, items } = buildEngine();
    const addCalendar = (messageId: string, quote: string, day: string) =>
      engine.applyExtractedOpenItems({
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        agentId: AGENT_ID,
        candidates: [
          {
            messageId,
            quote,
            topicKey: '纪念日',
            state: 'awaiting_result',
            importance: 3,
            occurredAt: new Date(`${day}T10:00:00.000Z`),
          },
        ],
      });
    await addCalendar(
      'ccccccccccccccccccccccc1',
      '明天是您的三七',
      '2026-09-07'
    );
    await addCalendar(
      'ccccccccccccccccccccccc2',
      '明天是您的五七',
      '2026-09-12'
    );
    expect(await items.count()).toBe(2);
    const same = await addCalendar(
      'ccccccccccccccccccccccc3',
      '明天是您的三七',
      '2026-09-14'
    );
    expect(same.created).toBe(0);
    expect(same.updated).toBe(1);
    expect(await items.count()).toBe(2);
  });

  it('纪念日单独存放：不占待跟进清单的名额，也不出现在默认清单里', async () => {
    const { engine } = buildEngine();
    await engine.applyExtractedOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      candidates: [
        {
          messageId: 'ccccccccccccccccccccccc1',
          quote: '再过两天该给您烧六七了',
          topicKey: '纪念日',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
        {
          messageId: 'ccccccccccccccccccccccc2',
          quote: '我挂了明早的号',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          occurredAt: new Date('2026-09-07T10:00:00.000Z'),
        },
      ],
    });

    const followUps = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
    });
    expect(followUps.items.map(item => item.summary)).toEqual([
      '我挂了明早的号',
    ]);

    const withCalendar = await engine.listOpenItems({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      agentId: AGENT_ID,
      includeCalendar: true,
    });
    expect(withCalendar.items).toHaveLength(2);
  });

  it('每人最多 5 条活跃条目，超出丢弃', async () => {
    const { engine, items } = buildEngine();
    const matters = [
      { topicKey: '就医', quote: '我下周要去医院复查' },
      { topicKey: '身体', quote: '奶奶最近总说腰疼' },
      { topicKey: '学业', quote: '下个月要交毕业论文' },
      { topicKey: '工作', quote: '公司说过完年要给我调岗' },
      { topicKey: '居住', quote: '房租到期了得找地方搬' },
      { topicKey: '钱财', quote: '还差朋友一笔钱没还上' },
    ] as const;
    for (let index = 0; index < matters.length; index += 1) {
      await engine.applyExtractedOpenItems({
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        agentId: AGENT_ID,
        candidates: [
          {
            messageId: `aaaaaaaaaaaaaaaaaaaaaa${index}b`,
            quote: matters[index].quote,
            topicKey: matters[index].topicKey,
            state: 'awaiting_result',
            importance: 2,
            occurredAt: new Date(`2026-09-0${index + 1}T10:00:00.000Z`),
          },
        ],
      });
    }
    expect(await items.count()).toBe(5);
  });
});

describe('候选窗口的选择（实测结论固化）', () => {
  const row = (content: string) => ({ content });
  const isFact = (text: string) => /复查|手术|考试|住院/u.test(text);

  it('消息少的用户给全部原话，不只给事实型', () => {
    const rows = [
      row('爸爸我想你了'),
      row('明天我去医院复查'),
      row('你走了以后我很想你'),
    ];
    const picked = selectOpenItemExtractionWindow(rows, {
      textOf: item => item.content,
      isFactBearing: isFact,
    });
    expect(picked.map(item => item.content)).toEqual([
      '爸爸我想你了',
      '明天我去医院复查',
      '你走了以后我很想你',
    ]);
  });

  it('消息多的用户先按事实型收窄，再截最近若干条', () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      row(index % 2 === 0 ? `闲聊第${index}句` : `第${index}天要去医院复查`)
    );
    const picked = selectOpenItemExtractionWindow(rows, {
      textOf: item => item.content,
      isFactBearing: isFact,
      smallWindowMax: 10,
      largeWindowMax: 4,
    });
    expect(picked).toHaveLength(4);
    for (const item of picked) expect(isFact(item.content)).toBe(true);
  });

  it('丢掉空消息', () => {
    const picked = selectOpenItemExtractionWindow([row('  '), row('去复查')], {
      textOf: item => item.content,
      isFactBearing: isFact,
    });
    expect(picked).toHaveLength(1);
  });
});

describe('过去时与已完成的排除', () => {
  it('判定函数本身：有将来动作就不算过去时', () => {
    expect(isPastOnlyStatement('我后悔那天没再多劝劝你')).toBe(true);
    expect(isPastOnlyStatement('今天送闺女上大学回来了')).toBe(true);
    expect(isPastOnlyStatement('咱妈前两天摔了一跤，脚肿了')).toBe(false);
    expect(isPastOnlyStatement('我明天带妈妈去体检')).toBe(false);
  });

  const rows = [
    {
      messageId: 'gggggggggggggggggggggg1',
      content:
        '我好想你，我后悔那天没再多劝劝你，让你继续检查，你说预约的第二天早上的彩超',
      occurredAt: '2026-09-01T10:00:00.000Z',
    },
    {
      messageId: 'gggggggggggggggggggggg2',
      content: '应该是我七八岁的时候吧 那会哥还没结婚',
      occurredAt: '2026-09-01T10:00:00.000Z',
    },
    {
      messageId: 'gggggggggggggggggggggg3',
      content: '今天送闺女上大学回来了',
      occurredAt: '2026-09-01T10:00:00.000Z',
    },
    {
      messageId: 'gggggggggggggggggggggg4',
      content: '咱妈前两天摔了一跤，脚肿了',
      occurredAt: '2026-09-01T10:00:00.000Z',
    },
    {
      messageId: 'gggggggggggggggggggggg5',
      content: '我明天带妈妈去体检',
      occurredAt: '2026-09-01T10:00:00.000Z',
    },
  ];
  it('回忆、已完成、没有将来动作的都不收；有当前状态或将来动作的收', () => {
    const parsed = parseOpenItemExtractionOutput(
      JSON.stringify({
        items: [
          {
            messageId: 'gggggggggggggggggggggg1',
            quote: '我后悔那天没再多劝劝你，让你继续检查',
            topicKey: '就医',
            state: 'awaiting_result',
            importance: 3,
          },
          {
            messageId: 'gggggggggggggggggggggg2',
            quote: '我七八岁的时候吧 那会哥还没结婚',
            topicKey: '婚育',
            state: 'awaiting_result',
            importance: 2,
          },
          {
            messageId: 'gggggggggggggggggggggg3',
            quote: '今天送闺女上大学回来了',
            topicKey: '学业',
            state: 'awaiting_result',
            importance: 2,
          },
          {
            messageId: 'gggggggggggggggggggggg4',
            quote: '咱妈前两天摔了一跤，脚肿了',
            topicKey: '家人',
            state: 'awaiting_result',
            importance: 2,
          },
          {
            messageId: 'gggggggggggggggggggggg5',
            quote: '我明天带妈妈去体检',
            topicKey: '就医',
            state: 'action_committed',
            importance: 3,
          },
        ],
      }),
      rows
    );
    expect(parsed.candidates.map(item => item.messageId)).toEqual([
      'gggggggggggggggggggggg4',
      'gggggggggggggggggggggg5',
    ]);
    expect(parsed.rejected.map(item => item.reason)).toEqual([
      'past_only_statement',
      'past_only_statement',
      'past_only_statement',
    ]);
  });
});
