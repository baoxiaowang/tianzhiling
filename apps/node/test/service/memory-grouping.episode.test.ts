import {
  buildGroupKey,
  EVENT_GROUP_MAX_GAP_MS,
  heatForGroup,
  resolveEpisodeGapMs,
  resolveGroupAssignment,
  shouldMarkDisengagement,
} from '../../src/service/memory/memory-grouping';

const CONV_A = '6af2abcd56eca3f487028e11';
const CONV_B = '6af2abcd56eca3f487029999';

function candidate(overrides: Partial<{
  groupId: string;
  topicKey: string;
  subjectRef: string | undefined;
  conversationId: string | undefined;
  spanTo: Date;
}> = {}) {
  return {
    groupId: overrides.groupId ?? 'g1',
    topicKey: overrides.topicKey ?? '住院就医',
    subjectRef: overrides.subjectRef,
    conversationId: overrides.conversationId ?? CONV_A,
    spanTo: overrides.spanTo ?? new Date('2026-11-16T10:00:00+08:00'),
  };
}

const AT = (h: number, m = 0) => new Date(`2026-11-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);

describe('episode grouping（场次制分组）', () => {
  it('同会话、相邻 ≤2h、同话题同主体 → 并场', () => {
    const decision = resolveGroupAssignment({
      topicKey: '住院就医',
      subjectRef: undefined,
      conversationId: CONV_A,
      occurredAt: AT(11, 30),
      candidates: [candidate({ spanTo: AT(10) })],
    });
    expect(decision).toEqual({ action: 'join', groupId: 'g1' });
  });

  it('同会话但间隔超场次窗口（3h）→ 开新场（跨场靠链，不靠合并）', () => {
    const decision = resolveGroupAssignment({
      topicKey: '住院就医',
      conversationId: CONV_A,
      occurredAt: AT(13, 0),
      candidates: [candidate({ spanTo: AT(10) })],
    });
    expect(decision).toEqual({ action: 'create' });
  });

  it('不同会话即使时间相邻 → 不并场（跨亲人/跨线程隔离）', () => {
    const decision = resolveGroupAssignment({
      topicKey: '住院就医',
      conversationId: CONV_B,
      occurredAt: AT(10, 10),
      candidates: [candidate({ conversationId: CONV_A, spanTo: AT(10) })],
    });
    expect(decision).toEqual({ action: 'create' });
  });

  it('45 天窗口不再是 join 依据（历史同话题同会话 → create）', () => {
    const spanTo = new Date(AT(10).getTime() - EVENT_GROUP_MAX_GAP_MS + 3600 * 1000);
    const decision = resolveGroupAssignment({
      topicKey: '住院就医',
      conversationId: CONV_A,
      occurredAt: AT(10),
      candidates: [candidate({ spanTo })],
    });
    expect(decision).toEqual({ action: 'create' });
  });

  it('主体不同不并场（原有语义保持）', () => {
    const decision = resolveGroupAssignment({
      topicKey: '学业',
      subjectRef: '二哥',
      conversationId: CONV_A,
      occurredAt: AT(10, 5),
      candidates: [candidate({ topicKey: '学业', subjectRef: '小妹', spanTo: AT(10) })],
    });
    expect(decision).toEqual({ action: 'create' });
  });

  it('maxGapMs 显式覆盖（测试/调参用）', () => {
    const decision = resolveGroupAssignment({
      topicKey: '住院就医',
      conversationId: CONV_A,
      occurredAt: AT(10, 30),
      candidates: [candidate({ spanTo: AT(10) })],
      maxGapMs: 10 * 60 * 1000,
    });
    expect(decision).toEqual({ action: 'create' });
  });

  it('resolveEpisodeGapMs 默认 2h，env 可调', () => {
    expect(resolveEpisodeGapMs()).toBe(2 * 60 * 60 * 1000);
  });

  it('buildGroupKey 分钟粒度：同日早晚两场不撞键', () => {
    const base = { engine: 'event_v1', userId: 'u1', topicKey: '住院就医' };
    const morning = buildGroupKey({ ...base, spanFrom: AT(8) });
    const evening = buildGroupKey({ ...base, spanFrom: AT(20) });
    const morningAgain = buildGroupKey({ ...base, spanFrom: AT(8) });
    expect(morning).not.toBe(evening);
    expect(morning).toBe(morningAgain); // 幂等
  });

  it('重建幂等：同一消息流两遍分组得到相同场次切分', () => {
    const messages = [
      { at: AT(9), text: 1 },
      { at: AT(9, 40), text: 2 },
      { at: AT(15), text: 3 }, // 新场
      { at: AT(15, 30), text: 4 },
    ];
    const segment = (msgs: typeof messages) => {
      const groups: Array<{ start: number; spanTo: Date }> = [];
      for (const m of msgs) {
        const joinable = groups.filter(g => m.at.getTime() - g.spanTo.getTime() <= resolveEpisodeGapMs());
        if (joinable.length) {
          joinable[joinable.length - 1].spanTo = m.at;
        } else {
          groups.push({ start: m.text, spanTo: m.at });
        }
      }
      return groups.map(g => g.start);
    };
    expect(segment(messages)).toEqual([1, 3]);
    expect(segment(messages)).toEqual(segment([...messages])); // 两遍一致
  });

  it('回避判定：全短应答才算回避，任一实质内容即不算', () => {
    expect(shouldMarkDisengagement(['嗯'])).toBe(true);
    expect(shouldMarkDisengagement(['好', '嗯嗯'])).toBe(true);
    expect(shouldMarkDisengagement(['嗯', '妈的复查结果还没出来'])).toBe(false);
    expect(shouldMarkDisengagement(['嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯很长的应答'])).toBe(false);
    expect(shouldMarkDisengagement([])).toBe(false);
  });

  it('热度回避惩罚：14 天内回避 ×0.6，15 天外不罚', () => {
    const now = new Date('2026-11-16T12:00:00+08:00');
    const base = { memberCount: 4, spanTo: now, now };
    const engaged = heatForGroup(base);
    const recentDisengaged = heatForGroup({
      ...base,
      lastUserDisengagedAt: new Date('2026-11-14T12:00:00+08:00'),
    });
    const oldDisengaged = heatForGroup({
      ...base,
      lastUserDisengagedAt: new Date('2026-10-01T12:00:00+08:00'),
    });
    expect(recentDisengaged).toBeCloseTo(engaged * 0.6, 3);
    expect(oldDisengaged).toBe(engaged);
  });
});
