/**
 * R06：新抽取契约的确定性生命周期与工程压力验收（不调用模型）。
 * 用"人造的模型输出"覆盖：创建、更新、完成、取消、拒谈、不确定、重放幂等、
 * 终态不复活、乱序保护、删除/归档/跨 scope 证据、同文不同 ID 不改源、时间锚点。
 */
import { parseExtractionOutputV2 } from '../../src/service/memory/return-extract-v2/validate-v2';
import { parseExtractionOutputStrict } from '../../src/service/memory/return-extract-v2/validate';
import {
  applyOperations,
  ItemView,
} from '../../src/service/memory/return-extract-v2/lifecycle';
import { buildExtractorInputV2 } from '../../src/service/memory/return-extract-v2/input';

const MESSAGES = [
  {
    messageId: 'm1',
    content: '妈妈明天上午做手术，我在医院陪着',
    occurredAt: '2026-09-10T12:00:00Z',
    role: 'user',
  },
  {
    messageId: 'm2',
    content: '手术做完了，医生说下周三还要复查一次',
    occurredAt: '2026-09-11T12:00:00Z',
    role: 'user',
  },
  {
    messageId: 'm3',
    content: '别提这事了',
    occurredAt: '2026-09-12T12:00:00Z',
    role: 'user',
  },
  {
    messageId: 'm4',
    content: '不去了，我把预约取消了',
    occurredAt: '2026-09-13T12:00:00Z',
    role: 'user',
  },
  {
    messageId: 'm5',
    content: '妈妈明天上午做手术，我在医院陪着',
    occurredAt: '2026-09-09T12:00:00Z',
    role: 'user',
  },
];
// 本项目 target/lib 为 es2018，Object.fromEntries / Array.flatMap 不可用，
// 用等价写法替代，避免为单个测试改动全局编译目标。
const TIMES: Record<string, string> = {};
for (const message of MESSAGES) {
  TIMES[message.messageId] = message.occurredAt;
}
const EXISTING: ItemView[] = [
  {
    itemId: 'i1',
    kind: 'open_event',
    state: 'awaiting_result',
    description: '妈妈要做手术',
    subjectLabel: '妈妈',
    evidenceIds: ['m1'],
    factAt: '2026-09-10T12:00:00Z',
    stateAt: '2026-09-10T12:00:00Z',
    stateHistory: [{ state: 'created', at: '2026-09-10T12:00:00Z' }],
  },
];
const IDS = EXISTING.map(item => item.itemId);

function op(overrides: Record<string, unknown>) {
  return {
    opId: 'o1',
    action: 'create',
    targetItemId: null,
    kind: 'open_event',
    description: '妈妈明天做手术',
    subject: { sourceLabel: '妈妈' },
    phase: null,
    evidence: [{ messageId: 'm1', quote: '妈妈明天上午做手术' }],
    eventTime: { rawText: '明天', anchorMessageId: 'm1', precision: 'day' },
    uncertainty: null,
    reason: '明确安排',
    ...overrides,
  };
}

function parseOne(overrides: Record<string, unknown>) {
  const raw = JSON.stringify({
    schemaVersion: 'return_extract_output_v2',
    operations: [op(overrides)],
    unresolvedReferences: [],
  });
  const parsed = parseExtractionOutputV2(raw, MESSAGES, IDS);
  return { raw, parsed };
}

describe('R06 新协议校验边界', () => {
  it('证据引文必须逐字出现在声明的消息里，改到同文别条要报错', () => {
    const { parsed } = parseOne({
      evidence: [{ messageId: 'm2', quote: '妈妈明天上午做手术' }],
    });
    expect(parsed.operations).toHaveLength(0);
    expect(parsed.rejected[0].reason).toBe('evidence_source_mismatch');
  });

  it('声明同文但不同 ID 的消息不算错（引文确实在那条里）', () => {
    const { parsed } = parseOne({
      evidence: [{ messageId: 'm5', quote: '妈妈明天上午做手术' }],
    });
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].evidence[0].messageId).toBe('m5');
  });

  it('update/resolve/cancel/dismiss 必须给已有事项 ID', () => {
    expect(
      parseOne({ action: 'resolve', targetItemId: null }).parsed.rejected[0]
        .reason
    ).toBe('unknown_target_item');
    expect(
      parseOne({ action: 'resolve', targetItemId: 'i9' }).parsed.rejected[0]
        .reason
    ).toBe('unknown_target_item');
    expect(
      parseOne({ action: 'create', targetItemId: 'i1' }).parsed.rejected[0]
        .reason
    ).toBe('create_must_have_null_target');
  });

  it('非法动作/类别/精度被拒并有明确原因', () => {
    expect(parseOne({ action: 'invent' }).parsed.rejected[0].reason).toBe(
      'invalid_action'
    );
    expect(parseOne({ kind: 'unknown_kind' }).parsed.rejected[0].reason).toBe(
      'invalid_kind'
    );
    const ok = parseOne({
      eventTime: {
        rawText: '过年',
        anchorMessageId: 'm1',
        precision: 'someday',
      },
    }).parsed;
    expect(ok.operations[0].eventTime.precision).toBe('unknown');
  });

  it('动作同义词（add/complete/refuse）归一后可用，并计数', () => {
    const parsed = parseOne({ action: 'add' }).parsed;
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].action).toBe('create');
    expect(parsed.normalizedActions).toBe(1);
  });
});

describe('R06 生命周期', () => {
  it('create 新开一条；uncertain 只留候选不产生条目', () => {
    const operations: any[] = [
      op({
        opId: 'c1',
        description: '复查安排在周三',
        evidence: [{ messageId: 'm2', quote: '手术做完了' }],
      }),
      op({
        opId: 'u1',
        action: 'uncertain',
        targetItemId: null,
        uncertainty: '不知道是谁',
      }),
    ];
    const { items, outcomes } = applyOperations(operations, EXISTING, {
      messageTimes: TIMES,
    });
    expect(items).toHaveLength(2);
    expect(items[1].state).toBe('awaiting_result');
    expect(outcomes.find(o => o.opId === 'u1')?.applied).toBe(false);
  });

  it('update 追加证据、完成不丢后续；resolve 落终态', () => {
    const update = parseOne({
      opId: 'u2',
      action: 'update',
      targetItemId: 'i1',
      description: '手术完成，下周三复查',
      evidence: [
        { messageId: 'm2', quote: '手术做完了，医生说下周三还要复查一次' },
      ],
    }).parsed.operations;
    const step1 = applyOperations(update, EXISTING, { messageTimes: TIMES });
    expect(step1.items[0].state).toBe('awaiting_result');
    expect(step1.items[0].evidenceIds).toEqual(['m1', 'm2']);

    const resolve = parseOne({
      opId: 'r1',
      action: 'resolve',
      targetItemId: 'i1',
      description: '检查结果没事',
      evidence: [{ messageId: 'm2', quote: '手术做完了' }],
    }).parsed.operations;
    const step2 = applyOperations(resolve, step1.items, {
      messageTimes: TIMES,
    });
    expect(step2.items[0].state).toBe('resolved');
  });

  it('拒谈落 dismissed，且旧证据不能复活', () => {
    const dismiss = parseOne({
      opId: 'd1',
      action: 'dismiss',
      targetItemId: 'i1',
      description: '用户要求别再提',
      evidence: [{ messageId: 'm3', quote: '别提这事了' }],
    }).parsed.operations;
    const step1 = applyOperations(dismiss, EXISTING, { messageTimes: TIMES });
    expect(step1.items[0].state).toBe('dismissed');

    const staleUpdate = parseOne({
      opId: 'u3',
      action: 'update',
      targetItemId: 'i1',
      description: '旧证据重放',
      evidence: [{ messageId: 'm1', quote: '妈妈明天上午做手术' }],
    }).parsed.operations;
    const step2 = applyOperations(staleUpdate, step1.items, {
      messageTimes: TIMES,
    });
    expect(step2.items[0].state).toBe('dismissed');
    // 旧证据重放既可能撞"终态不复活"，也可能先撞"乱序"，两者都必须拒绝
    expect(['terminal_not_resurrected', 'stale_evidence_ignored']).toContain(
      step2.outcomes[0].reason
    );
  });

  it('同一批/跨批重放是 noop，且不刷新事实时间', () => {
    const operations = parseOne({ opId: 'c2' }).parsed.operations;
    const first = applyOperations(operations, [], { messageTimes: TIMES });
    const second = applyOperations(operations, first.items, {
      messageTimes: TIMES,
    });
    expect(second.items).toHaveLength(1);
    expect(second.outcomes[0].reason).toBe('duplicate_noop');
    expect(second.items[0].factAt).toBe(TIMES.m1);
  });

  it('乱序：更早证据的 update 不覆盖更新的状态', () => {
    const newer = parseOne({
      opId: 'n1',
      action: 'update',
      targetItemId: 'i1',
      description: '已完成',
      evidence: [{ messageId: 'm2', quote: '手术做完了' }],
    }).parsed.operations;
    const step1 = applyOperations(newer, EXISTING, { messageTimes: TIMES });
    const older = parseOne({
      opId: 'n2',
      action: 'update',
      targetItemId: 'i1',
      description: '准备手术',
      evidence: [{ messageId: 'm5', quote: '妈妈明天上午做手术' }],
    }).parsed.operations;
    const step2 = applyOperations(older, step1.items, { messageTimes: TIMES });
    expect(step2.outcomes[0].reason).toBe('stale_evidence_ignored');
  });

  it('删除/归档/跨 scope 的证据不允许提交', () => {
    const operations = parseOne({ opId: 'c3' }).parsed.operations;
    const result = applyOperations(operations, [], {
      messageTimes: TIMES,
      allowedMessageIds: ['m2'],
    });
    expect(result.items).toHaveLength(0);
    expect(result.outcomes[0].reason).toBe('evidence_not_allowed');
  });
});

describe('R06 旧协议（v1 items）校验器的忠实性回归', () => {
  const messages = [
    { messageId: 'm1', content: '妈妈明天上午做手术，我在医院陪着' },
  ];

  it('短引文不再被删，只标记', () => {
    const raw = JSON.stringify({
      items: [
        {
          messageId: 'm1',
          quote: '我在医院陪着',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    });
    const parsed = parseExtractionOutputStrict(raw, messages);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].flags).toContain('shortQuote');
  });

  it('来源不符改为拒绝，不再静默改源或替换整句', () => {
    const raw = JSON.stringify({
      items: [
        {
          messageId: 'm9',
          quote: '妈妈明天做手术',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    });
    const parsed = parseExtractionOutputStrict(raw, messages);
    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.rejected[0].reason).toBe('unknown_declared_message');
  });

  it('超过 4 条显式报告截断，不静默丢弃', () => {
    const long =
      '我下周一要去医院复查，顺便把药开了，还要问医生能不能停药，另外把报告拿了，最后交完费再约下次时间，我要问清楚';
    const items = [
      '我下周一要去医院复查',
      '顺便把药开了',
      '还要问医生能不能停药',
      '另外把报告拿了',
      '最后交完费再约下次时间',
      '我要问清楚',
    ].map(quote => ({
      messageId: 'm2',
      quote,
      topicKey: '就医',
      state: 'awaiting_result',
      importance: 3,
    }));
    const parsed = parseExtractionOutputStrict(JSON.stringify({ items }), [
      { messageId: 'm2', content: long },
    ]);
    expect(parsed.truncated).toBe(true);
    expect(parsed.droppedItems).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- N01 反例

describe('N01 生命周期反例（先复现再修）', () => {
  const TIMES2: Record<string, string> = {
    m1: '2026-09-09T12:00:00Z',
    m2: '2026-09-11T12:00:00Z',
  };
  const SEQ: Record<string, number> = { m1: 1, m2: 2 };
  const baseItem: ItemView = {
    itemId: 'i1',
    kind: 'open_event',
    state: 'awaiting_result',
    description: '爸爸要做手术',
    subjectLabel: '爸爸',
    evidenceIds: ['m1'],
    factAt: TIMES2.m1,
    changeAt: TIMES2.m1,
    stateAt: TIMES2.m1,
    stateSeq: 1,
    stateHistory: [{ state: 'created', at: TIMES2.m1 }],
  };
  const messages2 = [
    { messageId: 'm1', content: '爸爸明天做手术', occurredAt: TIMES2.m1 },
    {
      messageId: 'm2',
      content: '爸爸手术做完了，周三还得去复查一次',
      occurredAt: TIMES2.m2,
    },
  ];
  const mk = (overrides: Record<string, unknown>) => {
    const raw = JSON.stringify({
      schemaVersion: 'return_extract_output_v2',
      operations: [
        {
          opId: 'o1',
          action: 'create',
          targetItemId: null,
          kind: 'open_event',
          description: '爸爸明天做手术',
          subject: { sourceLabel: '爸爸' },
          phase: null,
          evidence: [{ messageId: 'm1', quote: '爸爸明天做手术' }],
          eventTime: {
            rawText: '明天',
            anchorMessageId: 'm1',
            precision: 'day',
          },
          uncertainty: null,
          reason: '明确安排',
          ...overrides,
        },
      ],
      unresolvedReferences: [],
    });
    return parseExtractionOutputV2(raw, messages2, ['i1']).operations;
  };

  it('1. meaningful_update 新建不是待办', () => {
    const operations = mk({
      kind: 'meaningful_update',
      action: 'create',
      description: '女儿考上学校，家里高兴',
      evidence: [{ messageId: 'm2', quote: '爸爸手术做完了' }],
    });
    const { items } = applyOperations(operations, [], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(items[0].state).toBe('meaningful_update');
    expect(items[0].state).not.toBe('awaiting_result');
  });

  it('2. 已 resolve 的旧证据再用 create 提交：不复活、不新建', () => {
    const resolved: ItemView = {
      ...baseItem,
      state: 'resolved',
      stateAt: TIMES2.m2,
      stateSeq: 2,
    };
    const operations = mk({});
    const { items, outcomes } = applyOperations(operations, [resolved], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('resolved');
    expect(outcomes[0].reason).toBe('terminal_not_resurrected');
  });

  it('3. 同一条消息里的两件事：各自成条（同消息不同引文）', () => {
    const raw = JSON.stringify({
      schemaVersion: 'return_extract_output_v2',
      operations: [
        {
          opId: 'o1',
          action: 'create',
          targetItemId: null,
          kind: 'open_event',
          description: '爸爸手术完成',
          subject: { sourceLabel: '爸爸' },
          evidence: [{ messageId: 'm2', quote: '爸爸手术做完了' }],
          eventTime: {
            rawText: null,
            anchorMessageId: 'm2',
            precision: 'unknown',
          },
          uncertainty: null,
          reason: 'x',
        },
        {
          opId: 'o2',
          action: 'create',
          targetItemId: null,
          kind: 'open_event',
          description: '周三要复查',
          subject: { sourceLabel: '爸爸' },
          evidence: [{ messageId: 'm2', quote: '周三还得去复查一次' }],
          eventTime: {
            rawText: '周三',
            anchorMessageId: 'm2',
            precision: 'day',
          },
          uncertainty: null,
          reason: 'y',
        },
      ],
      unresolvedReferences: [],
    });
    const operations = parseExtractionOutputV2(raw, messages2, [
      'i1',
    ]).operations;
    const { items } = applyOperations(operations, [], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(items).toHaveLength(2);
  });

  it('4. 同一引文重复提交只算一次（跨"进程"也是 noop）', () => {
    const operations = mk({});
    const first = applyOperations(operations, [], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    const second = applyOperations(operations, first.items, {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(second.items).toHaveLength(1);
    expect(second.outcomes[0].reason).toBe('duplicate_noop');
    expect(second.items[0].factAt).toBe(TIMES2.m1);
  });

  it('5. 旧背景 + 新结果混合证据：变化时间按 anchor 取新，不按最早证据', () => {
    const operations = mk({
      action: 'update',
      targetItemId: 'i1',
      description: '手术完成，周三复查',
      evidence: [
        { messageId: 'm1', quote: '爸爸明天做手术' },
        { messageId: 'm2', quote: '爸爸手术做完了' },
      ],
      eventTime: { rawText: null, anchorMessageId: 'm2', precision: 'unknown' },
    });
    const { items } = applyOperations(operations, [baseItem], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(items[0].factAt).toBe(TIMES2.m1);
    expect(items[0].changeAt).toBe(TIMES2.m2);
    expect(items[0].stateAt).toBe(TIMES2.m2);
  });

  it('6. 新 update 之后，迟到的旧 resolve 不得覆盖', () => {
    const operations = mk({
      action: 'update',
      targetItemId: 'i1',
      description: '手术完成，周三复查',
      evidence: [{ messageId: 'm2', quote: '爸爸手术做完了' }],
      eventTime: { rawText: null, anchorMessageId: 'm2', precision: 'unknown' },
    });
    const step1 = applyOperations(operations, [baseItem], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    const lateClose = mk({
      action: 'resolve',
      targetItemId: 'i1',
      description: '旧消息的关闭',
      evidence: [{ messageId: 'm1', quote: '爸爸明天做手术' }],
      eventTime: { rawText: null, anchorMessageId: 'm1', precision: 'unknown' },
    });
    const step2 = applyOperations(lateClose, step1.items, {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(step2.items[0].state).toBe('awaiting_result');
    expect(step2.outcomes[0].reason).toBe('stale_evidence_ignored');
  });

  it('7. 同一时间戳靠接收序号定先后', () => {
    const sameTime = { m1: '2026-09-10T00:00:00Z', m2: '2026-09-10T00:00:00Z' };
    const seq = { m1: 1, m2: 2 };
    const newer: ItemView = { ...baseItem, stateAt: sameTime.m1, stateSeq: 2 };
    const staleClose = mk({
      action: 'resolve',
      targetItemId: 'i1',
      description: '旧序号的关闭',
      evidence: [{ messageId: 'm1', quote: '爸爸明天做手术' }],
      eventTime: { rawText: null, anchorMessageId: 'm1', precision: 'unknown' },
    });
    const { outcomes, items } = applyOperations(staleClose, [newer], {
      messageTimes: sameTime,
      messageSeq: seq,
    });
    expect(outcomes[0].reason).toBe('stale_evidence_ignored');
    expect(items[0].state).toBe('awaiting_result');
  });

  it('8. 明确拒谈后，新证据的 update 不自动重开（保持候选）', () => {
    const dismissed: ItemView = {
      ...baseItem,
      state: 'dismissed',
      stateAt: TIMES2.m1,
      stateSeq: 1,
    };
    const operations = mk({
      action: 'update',
      targetItemId: 'i1',
      description: '爸爸又说起复查',
      evidence: [{ messageId: 'm2', quote: '爸爸手术做完了' }],
      eventTime: { rawText: null, anchorMessageId: 'm2', precision: 'unknown' },
    });
    const { items, outcomes } = applyOperations(operations, [dismissed], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(items[0].state).toBe('dismissed');
    expect(outcomes[0].reason).toBe('dismissed_requires_explicit_reopen');
  });

  it('9. 已 resolve 的事项被新证据 update 时可以重开（新周期）', () => {
    const resolved: ItemView = {
      ...baseItem,
      state: 'resolved',
      stateAt: TIMES2.m1,
      stateSeq: 1,
    };
    const operations = mk({
      action: 'update',
      targetItemId: 'i1',
      description: '又约了复查',
      evidence: [{ messageId: 'm2', quote: '爸爸手术做完了' }],
      eventTime: { rawText: null, anchorMessageId: 'm2', precision: 'unknown' },
    });
    const { items } = applyOperations(operations, [resolved], {
      messageTimes: TIMES2,
      messageSeq: SEQ,
    });
    expect(items[0].state).toBe('awaiting_result');
    expect(
      items[0].stateHistory.some(event => event.state === 'reopened')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------- N02 输入契约

describe('N02 输入契约（会话切分 / 输入上界 / 水位 / 预算）', () => {
  const row = (
    id: string,
    role: 'user' | 'assistant',
    at: string,
    content = `内容-${id}`
  ) => ({
    id,
    role,
    occurredAt: at,
    content,
    sourceType: 'text' as const,
  });

  it('会话按用户消息间隔切；中间的 AI 消息不切段', () => {
    // 用户间隔 4 小时：同一段，中间有 AI 消息也算同一段
    const same = buildExtractorInputV2(
      [
        row('u1', 'user', '2026-09-10T10:00:00Z'),
        row('a1', 'assistant', '2026-09-10T11:00:00Z'),
        row('u2', 'user', '2026-09-10T14:00:00Z'),
      ],
      { now: new Date('2026-09-10T14:05:00Z') }
    );
    expect(same.segments).toHaveLength(1);
    expect(same.segments[0].messages.map(message => message.id)).toEqual([
      'u1',
      'a1',
      'u2',
    ]);

    // 用户间隔 11 小时：即使中间有 AI 消息，也仍然是两段（回归由用户间隔决定）
    const split = buildExtractorInputV2(
      [
        row('u1', 'user', '2026-09-10T10:00:00Z'),
        row('a1', 'assistant', '2026-09-10T20:00:00Z', 'AI 十小时后才回复'),
        row('u2', 'user', '2026-09-10T21:00:00Z'),
      ],
      { now: new Date('2026-09-10T21:05:00Z') }
    );
    expect(split.segments.map(segment => segment.period)).toEqual([
      'previous_session',
      'current_session',
    ]);
  });

  it('用户间隔 ≥6 小时才算两段', () => {
    const rows = [
      row('u1', 'user', '2026-09-10T10:00:00Z'),
      row('u2', 'user', '2026-09-10T21:00:00Z'),
    ];
    const built = buildExtractorInputV2(rows, {
      now: new Date('2026-09-10T21:05:00Z'),
    });
    expect(built.segments.map(segment => segment.period)).toEqual([
      'previous_session',
      'current_session',
    ]);
  });

  it('输入上界：触发之后的消息不能进输入', () => {
    const rows = [
      row('u1', 'user', '2026-09-10T10:00:00Z'),
      row('u2', 'user', '2026-09-10T12:00:00Z', '触发时还没发生的下一句'),
    ];
    const built = buildExtractorInputV2(rows, {
      now: new Date('2026-09-10T12:00:00Z'),
      inputUpperBound: '2026-09-10T11:00:00Z',
      currentSessionStartId: 'u1',
    });
    const ids = built.segments.reduce<string[]>(
      (acc, segment) => acc.concat(segment.messages.map(message => message.id)),
      []
    );
    expect(ids).toEqual(['u1']);
    expect(built.inputUpperBound).toBe('2026-09-10T11:00:00Z');
  });

  it('currentSessionStartId：只取触发消息及其之后，且上一段作为背景', () => {
    const rows = [
      row('p1', 'user', '2026-09-09T10:00:00Z'),
      row('p2', 'user', '2026-09-09T11:00:00Z'),
      row('c1', 'user', '2026-09-10T10:00:00Z', '本次触发'),
      row('c2', 'user', '2026-09-10T10:05:00Z'),
    ];
    const built = buildExtractorInputV2(rows, {
      now: new Date('2026-09-10T10:06:00Z'),
      currentSessionStartId: 'c1',
    });
    const current = built.segments.find(
      segment => segment.period === 'current_session'
    );
    expect(current?.messages.map(message => message.id)).toEqual(['c1', 'c2']);
    const previous = built.segments.find(
      segment => segment.period === 'previous_session'
    );
    expect(previous?.messages.map(message => message.id)).toEqual(['p1', 'p2']);
  });

  it('水位只在连续读完时推进，遇到未读就停', () => {
    const {
      resolveNextWatermark,
    } = require('../../src/service/memory/return-extract-v2/input');
    const order = ['m1', 'm2', 'm3', 'm4'];
    expect(
      resolveNextWatermark({
        previousWatermark: 'm1',
        receivedOrder: order,
        readMessageIds: ['m2'],
      })
    ).toEqual({
      watermark: 'm2',
      blockedBy: 'm3',
    });
    expect(
      resolveNextWatermark({
        previousWatermark: 'm1',
        receivedOrder: order,
        readMessageIds: ['m2', 'm3', 'm4'],
      })
    ).toEqual({
      watermark: 'm4',
    });
  });

  it('预算：条数与字符都受限，并如实记录覆盖账本', () => {
    const rows = [
      row('u1', 'user', '2026-09-10T10:00:00Z', '甲'.repeat(80)),
      row('u2', 'user', '2026-09-10T10:01:00Z', '乙'.repeat(80)),
      row('u3', 'user', '2026-09-10T10:02:00Z', '丙'.repeat(80)),
    ];
    const built = buildExtractorInputV2(rows, {
      now: new Date('2026-09-10T10:03:00Z'),
      budgetMessages: 2,
      budgetChars: 200,
    });
    const ids = built.segments.reduce<string[]>(
      (acc, segment) => acc.concat(segment.messages.map(message => message.id)),
      []
    );
    expect(ids).toEqual(['u2', 'u3']);
    expect(built.coverage.truncated).toBe(true);
    expect(built.coverage.deferredRanges[0]).toContain('u1');
    expect(built.coverage.readMessages).toBe(2);
    expect(built.coverage.inputChars).toBe(160);
  });
});

// ---------------------------------------------------------------- 请求留档

describe('请求留档：保存真正发送的内容', () => {
  it('capture 出来的 system/user 与传给模型字符串完全一致，且可落成 JSONL', () => {
    const {
      createRequestLog,
    } = require('../../scripts/return-extract-v2/request-log');
    const log = createRequestLog();
    const system = '系统提示（含换行）\n第二行';
    const user = '{"messages":[{"content":"原话"}]}';
    const entry = log.record({
      fragmentId: 'f1',
      mode: 'm',
      protocol: 'narrow',
      inputMode: 'v2',
      model: 'qwen-plus',
      step: 0,
      system,
      user,
      messageIds: ['m1'],
      inputChars: user.length,
    });
    expect(entry.system).toBe(system);
    expect(entry.user).toBe(user);
    const lines = log.toJsonl().trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.system).toBe(system);
    expect(parsed.user).toBe(user);
    expect(parsed.inputChars).toBe(user.length);
  });

  it('复用旧 raw 时不伪造请求：step=-1 且 system/user 为空', () => {
    const {
      createRequestLog,
      markNotSent,
    } = require('../../scripts/return-extract-v2/request-log');
    const log = createRequestLog();
    log.record(
      markNotSent({
        fragmentId: 'f1',
        mode: 'm',
        protocol: 'narrow',
        inputMode: 'v2',
        model: 'qwen-plus',
        reason: 'reused_raw',
      })
    );
    const [entry] = log.all();
    expect(entry.step).toBe(-1);
    expect(entry.system).toBe('');
    expect(entry.user).toBe('');
  });

  it('两步模式两次调用各留一条，步骤号不混', () => {
    const {
      createRequestLog,
    } = require('../../scripts/return-extract-v2/request-log');
    const log = createRequestLog();
    const base = {
      fragmentId: 'f1',
      mode: 'm',
      protocol: 'two-step',
      inputMode: 'v2',
      model: 'qwen-plus',
      messageIds: ['m1'],
      inputChars: 3,
    };
    log.record({ ...base, step: 0, system: 'S0', user: 'U0' });
    log.record({ ...base, step: 1, system: 'S1', user: 'U1' });
    const entries = log.all();
    expect(entries.map((item: any) => item.step)).toEqual([0, 1]);
    expect(entries.map((item: any) => item.user)).toEqual(['U0', 'U1']);
  });
});

// ---------------------------------------------------------------- 请求边界

describe('请求边界：attempted/succeeded/failed 都留档，且不含密钥', () => {
  const base = {
    fragmentId: 'f1',
    mode: 'm',
    protocol: 'v2',
    inputMode: 'v2',
    step: 0,
    model: 'qwen-plus',
    params: { temperature: 0, topP: 0.1, maxTokens: 100 },
    system: 'S',
    user: 'U',
    messageIds: ['m1'],
    promptSource: 'prompt-v2',
    promptVersion: 'return-extract-v2',
  };

  it('成功：记录 attempted→succeeded、请求 hash、服务端模型名', async () => {
    const {
      createModelInvoker,
      createFakeClient,
    } = require('../../scripts/return-extract-v2/request-boundary');
    const invoker = createModelInvoker({
      client: createFakeClient(),
      promptVersion: 'v1',
    });
    const result = await invoker.invoke(base);
    const [entry] = invoker.all();
    expect(entry.status).toBe('succeeded');
    expect(entry.resolvedModel).toBe('fake-model-1');
    expect(entry.requestHash).toHaveLength(64);
    expect(entry.attemptedAt).toBeTruthy();
    expect(entry.settledAt).toBeTruthy();
    expect(result.raw.length).toBeGreaterThan(0);
    expect(JSON.stringify(entry)).not.toContain('sk-');
  });

  it('失败：仍然留一条 failed 记录并带错误信息', async () => {
    const {
      createModelInvoker,
      createFakeClient,
    } = require('../../scripts/return-extract-v2/request-boundary');
    const invoker = createModelInvoker({
      client: createFakeClient({ failAtStep: 1 }),
      promptVersion: 'v1',
    });
    await expect(invoker.invoke(base)).rejects.toThrow('fake_client_failure');
    const [entry] = invoker.all();
    expect(entry.status).toBe('failed');
    expect(entry.error).toContain('fake_client_failure');
    expect(entry.requestHash).toHaveLength(64);
  });

  it('两步：两次调用各有记录，第二步失败也不丢第一步', async () => {
    const {
      createModelInvoker,
      createFakeClient,
    } = require('../../scripts/return-extract-v2/request-boundary');
    const invoker = createModelInvoker({
      client: createFakeClient({ failAtStep: 2 }),
      promptVersion: 'v1',
    });
    await invoker.invoke({ ...base, step: 0, promptSource: 'discovery' });
    await expect(
      invoker.invoke({ ...base, step: 1, promptSource: 'review' })
    ).rejects.toThrow();
    const entries = invoker.all();
    expect(entries.map((item: any) => [item.step, item.status])).toEqual([
      [0, 'succeeded'],
      [1, 'failed'],
    ]);
  });

  it('脱敏：错误信息里的假密钥不会被留档', async () => {
    const {
      createModelInvoker,
      redactSecrets,
    } = require('../../scripts/return-extract-v2/request-boundary');
    const client = {
      chat: {
        completions: {
          async create() {
            throw new Error(
              'auth failed: sk-TESTFAKE1234567890 and api_key="abcdef123456"'
            );
          },
        },
      },
    };
    const invoker = createModelInvoker({ client });
    await expect(invoker.invoke(base)).rejects.toThrow();
    const [entry] = invoker.all();
    expect(entry.error).not.toContain('sk-TESTFAKE');
    expect(entry.error).not.toContain('abcdef123456');
    expect(entry.error).toContain('sk-***');
    expect(redactSecrets('Bearer abcdefghijkl')).toContain('Bearer ***');
  });

  it('服务端没返回模型名时保持 null，不用请求名回填', async () => {
    const {
      createModelInvoker,
    } = require('../../scripts/return-extract-v2/request-boundary');
    const client = {
      chat: {
        completions: {
          async create() {
            return {
              choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
            };
          },
        },
      },
    };
    const invoker = createModelInvoker({ client });
    await invoker.invoke(base);
    expect(invoker.all()[0].resolvedModel).toBeNull();
  });

  it('not_sent 不伪造 system/user，也不给 requestHash', () => {
    const {
      createModelInvoker,
      createFakeClient,
    } = require('../../scripts/return-extract-v2/request-boundary');
    const invoker = createModelInvoker({
      client: createFakeClient(),
      promptVersion: 'v1',
    });
    invoker.markNotSent({
      fragmentId: 'f1',
      mode: 'm',
      protocol: 'v2',
      inputMode: 'v2',
      model: 'qwen-plus',
      params: base.params,
      promptSource: 'reused_raw',
    });
    const [entry] = invoker.all();
    expect(entry.status).toBe('not_sent');
    expect(entry.system).toBe('');
    expect(entry.user).toBe('');
    expect(entry.requestHash).toBe('');
    expect(entry.resolvedModel).toBeNull();
  });
});
