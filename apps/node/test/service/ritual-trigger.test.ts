import {
  buildRitualTriggerPrompt,
  resetRitualTriggerState,
  resolveDepartureDay,
  resolveDepartureDayRange,
  resolveRitualTrigger,
} from '../../src/service/agents/ritual-trigger';

const NOW = new Date('2026-10-08T00:00:00.000Z'); // 北京时间 2026-10-08 08:00

describe('ritual trigger', () => {
  beforeEach(() => resetRitualTriggerState());

  it('normalizes explicit ritual words', () => {
    const trigger = resolveRitualTrigger({
      query: '今天是他头七',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.touqi',
      day: 7,
      reason: 'explicit',
    });
    expect(buildRitualTriggerPrompt(trigger)).toContain('第 7 天（头七）');
  });

  it('does not turn a future ritual mention into “today”', () => {
    const trigger = resolveRitualTrigger({
      query: '等你五七时候给你送面条',
      now: NOW,
      disableDedupe: true,
    });
    const prompt = buildRitualTriggerPrompt(trigger);
    expect(prompt).toContain('五七是离开后的第 35 天');
    expect(prompt).not.toContain('今天是');

    const todayTrigger = resolveRitualTrigger({
      query: '今天是他头七',
      now: NOW,
      disableDedupe: true,
    });
    expect(buildRitualTriggerPrompt(todayTrigger)).toContain('今天是');
  });

  it('computes the inclusive departure day from the profile date', () => {
    expect(resolveDepartureDay('2026-10-02', NOW)).toBe(7);
    expect(resolveDepartureDay('2026-09-18', NOW)).toBe(21);
    expect(resolveDepartureDay('2026-07-01', NOW)).toBe(100);

    const trigger = resolveRitualTrigger({
      query: '你离开 7 天了',
      agentDeathDate: '2026-10-02',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.touqi',
      day: 7,
      reason: 'profile_day',
      confidence: 'confirmed',
    });
  });

  it('falls back to the duration in the utterance when no profile exists', () => {
    const trigger = resolveRitualTrigger({
      query: '你走了 21 天',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.sanqi',
      day: 21,
      reason: 'duration',
      confidence: 'estimated',
    });
    expect(buildRitualTriggerPrompt(trigger)).toContain('以家里算法为准');
  });

  it('uses an estimated profile range when the exact date is unknown', () => {
    const range = resolveDepartureDayRange(
      { estimatedStart: '2026-10-01', estimatedEnd: '2026-10-02' },
      NOW
    );
    expect(range).toEqual({ min: 7, max: 8, exact: false });

    const trigger = resolveRitualTrigger({
      query: '今天天气不错',
      agentDeathStart: '2026-10-01',
      agentDeathEnd: '2026-10-02',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.touqi',
      confidence: 'estimated',
    });
    expect(buildRitualTriggerPrompt(trigger)).toContain('可能是');
  });

  it('does not stretch a wide year range into a ritual day', () => {
    expect(
      resolveRitualTrigger({
        query: '今天天气不错',
        agentDeathStart: '2023-01-01',
        agentDeathEnd: '2024-01-01',
        now: NOW,
        disableDedupe: true,
      })
    ).toBeUndefined();
  });

  it('does not trigger on unrelated chat or non-milestone days', () => {
    expect(
      resolveRitualTrigger({
        query: '今天天气不错',
        agentDeathDate: '2026-10-01', // 第 8 天，不是仪式日
        now: NOW,
        disableDedupe: true,
      })
    ).toBeUndefined();
    expect(
      resolveRitualTrigger({ query: '今天天气不错', now: NOW })
    ).toBeUndefined();
  });

  it('injects a proactive profile-day trigger once per conversation per day', () => {
    const first = resolveRitualTrigger({
      conversationId: 'conv-1',
      query: '今天天气不错',
      agentDeathDate: '2026-10-02',
      now: NOW,
    });
    expect(first?.key).toBe('ritual.touqi');

    const second = resolveRitualTrigger({
      conversationId: 'conv-1',
      query: '今天天气不错',
      agentDeathDate: '2026-10-02',
      now: NOW,
    });
    expect(second).toBeUndefined();

    // 用户明确提到仪式时，即使今天已注入过，仍然给事实。
    const explicit = resolveRitualTrigger({
      conversationId: 'conv-1',
      query: '头七要准备什么',
      agentDeathDate: '2026-10-02',
      now: NOW,
    });
    expect(explicit?.key).toBe('ritual.touqi');
  });

  it('computes an exact anniversary from the profile date', () => {
    const trigger = resolveRitualTrigger({
      query: '今天是他忌日',
      agentDeathDate: '2023-10-08',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.anniversary_3',
      label: '3周年',
      reason: 'anniversary',
      confidence: 'confirmed',
    });
    const prompt = buildRitualTriggerPrompt(trigger);
    expect(prompt).toContain('今天是离开后的第 3 个周年');
    expect(prompt).toContain('2026-10-08');
  });

  it('understands “离开我们已经三年了”', () => {
    const trigger = resolveRitualTrigger({
      query: '他离开我们已经三年了',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.anniversary_3',
      reason: 'anniversary',
    });
    expect(buildRitualTriggerPrompt(trigger)).toContain('第 3 个周年');
  });

  it('turns an explicit year duration into an anniversary', () => {
    const trigger = resolveRitualTrigger({
      query: '他走了三年了',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.anniversary_3',
      reason: 'anniversary',
      confidence: 'estimated',
    });
    const prompt = buildRitualTriggerPrompt(trigger);
    expect(prompt).toContain('按你说的“走了三年”估算');
    expect(prompt).toContain('大概是离开后的第 3 个周年');
    expect(prompt).toContain('以家里算法为准');
  });

  it('shows the date of an upcoming explicit anniversary', () => {
    const trigger = resolveRitualTrigger({
      query: '快到他的三周年了',
      agentDeathDate: '2023-10-20',
      now: NOW,
      disableDedupe: true,
    });
    const prompt = buildRitualTriggerPrompt(trigger);
    expect(trigger).toMatchObject({
      key: 'ritual.anniversary_3',
      confidence: 'confirmed',
    });
    expect(prompt).toContain('2026-10-20');
    expect(prompt).toContain('还有 12 天');
    expect(prompt).toContain('第 3 个周年');
  });

  it('uses an estimated profile range for an explicit anniversary', () => {
    const trigger = resolveRitualTrigger({
      query: '今年是三周年了',
      agentDeathStart: '2023-10-01',
      agentDeathEnd: '2023-10-03',
      now: NOW,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.anniversary_3',
      confidence: 'estimated',
    });
    expect(buildRitualTriggerPrompt(trigger)).toContain(
      '按你之前说的时长估算'
    );
  });

  it('keeps “今年” on this year even after the anniversary passed', () => {
    const now = new Date('2026-10-08T00:00:00.000Z');
    const trigger = resolveRitualTrigger({
      query: '今年忌日是哪天',
      agentDeathDate: '2023-01-05',
      now,
      disableDedupe: true,
    });
    expect(trigger).toMatchObject({
      key: 'ritual.anniversary_3',
      confidence: 'confirmed',
    });
    const prompt = buildRitualTriggerPrompt(trigger);
    expect(prompt).toContain('2026-01-05');
    expect(prompt).toContain('已经过去');
  });

  it('does not turn non-departure or unrelated years into an anniversary', () => {
    expect(
      resolveRitualTrigger({
        query: '我们结婚三周年了',
        agentDeathDate: '2023-10-08',
        now: NOW,
        disableDedupe: true,
      })
    ).toBeUndefined();
    expect(
      resolveRitualTrigger({
        query: '我住院三年了',
        now: NOW,
        disableDedupe: true,
      })
    ).toBeUndefined();
  });

  it('does not contain response instructions', () => {
    const prompt = buildRitualTriggerPrompt(
      resolveRitualTrigger({
        query: '你离开 7 天了',
        agentDeathDate: '2026-10-02',
        now: NOW,
        disableDedupe: true,
      })
    );
    expect(prompt).toContain('今天是离开后的第 7 天');
    expect(prompt).not.toContain('先问');
    expect(prompt).not.toContain('不要');
  });
});
