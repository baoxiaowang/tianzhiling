import {
  isSameLocalDay,
  resolveLowInfoStateShadowDecision,
} from '../../src/service/agents/low-info-state-shadow';

const NOW = new Date('2026-11-16T10:00:00+08:00');
const FRESH = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
const STALE = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

const CANDIDATE = {
  kind: 'open_loop' as const,
  ref: 'task-1',
  subject: '她提到生意难做',
  state: 'reported',
  updatedAt: FRESH,
};

function decide(overrides: Record<string, unknown> = {}) {
  return resolveLowInfoStateShadowDecision({
    momentType: 'low_info_status',
    currentQuery: '早',
    isFirstUserTurnOfDay: true,
    candidates: [CANDIDATE],
    now: NOW,
    ...overrides,
  });
}

describe('low-info state shadow (step 0)', () => {
  it('全部门通过时才会注入，并携带候选标识', () => {
    const decision = decide();
    expect(decision.wouldInject).toBe(true);
    expect(decision.candidateKind).toBe('open_loop');
    expect(decision.candidateRef).toBe('task-1');
    expect(decision.reason).toContain('shadow:inject|open_loop:task-1');
  });

  it('非低信息轮不注入', () => {
    const decision = decide({ momentType: 'ordinary' });
    expect(decision.wouldInject).toBe(false);
    expect(decision.reason).toContain('not_low_info');
  });

  it('收尾型确认轮（非首条且非问候）不注入', () => {
    const decision = decide({
      currentQuery: '好',
      isFirstUserTurnOfDay: false,
    });
    expect(decision.wouldInject).toBe(false);
    expect(decision.gates.openingTurn).toBe(false);
    expect(decision.reason).toContain('not_opening');
  });

  it('开启型问候即使不是当日首条也可注入', () => {
    const decision = decide({
      currentQuery: '早啊',
      isFirstUserTurnOfDay: false,
    });
    expect(decision.wouldInject).toBe(true);
  });

  it('过期候选（超过 3 天）不注入', () => {
    const decision = decide({
      candidates: [{ ...CANDIDATE, updatedAt: STALE }],
    });
    expect(decision.wouldInject).toBe(false);
    expect(decision.reason).toContain('no_fresh_candidate');
  });

  it('已闭合状态（resolved/dismissed/superseded/dormant）不算候选', () => {
    for (const state of ['resolved', 'dismissed', 'superseded', 'dormant']) {
      const decision = decide({
        candidates: [{ ...CANDIDATE, state }],
      });
      expect(decision.wouldInject).toBe(false);
      expect(decision.reason).toContain('no_fresh_candidate');
    }
  });

  it('当天已注入过则预算门拦截', () => {
    const decision = decide({ alreadyInjectedToday: true });
    expect(decision.wouldInject).toBe(false);
    expect(decision.reason).toContain('budget_used');
  });

  it('低落轮不注入压力类状态（情绪门）', () => {
    const decision = decide({ currentQuery: '早 好难受' });
    expect(decision.wouldInject).toBe(false);
    expect(decision.gates.calmEmotion).toBe(false);
    expect(decision.reason).toContain('distress_turn');
  });

  it('多个新鲜候选时取最新', () => {
    const newer = {
      kind: 'open_loop' as const,
      ref: 'task-2',
      subject: '复查',
      updatedAt: new Date(NOW.getTime() - 3600 * 1000).toISOString(),
    };
    const decision = decide({ candidates: [CANDIDATE, newer] });
    expect(decision.candidateRef).toBe('task-2');
  });

  it('isSameLocalDay 跨天返回 false', () => {
    expect(isSameLocalDay(new Date('2026-11-16T23:59+08:00'), new Date('2026-11-17T00:01+08:00'))).toBe(false);
    expect(isSameLocalDay(new Date('2026-11-16T08:00+08:00'), new Date('2026-11-16T22:00+08:00'))).toBe(true);
  });
});
