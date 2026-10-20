import {
  buildRitualTriggerPrompt,
  resetRitualTriggerState,
  resolveDepartureDay,
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
