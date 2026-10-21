import {
  buildRuleGateShadowRecord,
  formatRuleGateShadowLine,
  getRuleGateMode,
  isPureSocialTurn,
  shouldSkipStructuredMemoryEnqueue,
  shouldSampleRuleGateShadow,
} from '../../src/service/agents/rule-gate-shadow';

describe('rule gate shadow', () => {
  it('recognizes only short pure social turns', () => {
    for (const text of ['嗯', '嗯嗯', '好的', '晚安', '在吗', '哈哈', '知道了']) {
      expect(isPureSocialTurn(text)).toBe(true);
    }
    for (const text of ['我想你', '我今晚睡不着', '你还记得我爸吗', '好，那我先睡了，明天再说']) {
      expect(isPureSocialTurn(text)).toBe(false);
    }
  });

  it('records would-skip without text', () => {
    const record = buildRuleGateShadowRecord({
      gate: 'structured_memory_enqueue',
      reason: 'pure_social',
      textLength: 2,
      messageId: 'm1',
      now: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(record).toMatchObject({ mode: 'shadow', action: 'would_skip' });
    expect(formatRuleGateShadowLine(record)).toContain('[rule-gate]');
    expect(record).not.toHaveProperty('text');
  });

  it('defaults to active and supports shadow', () => {
    expect(getRuleGateMode({} as NodeJS.ProcessEnv)).toBe('active');
    expect(
      getRuleGateMode({ RULE_GATE_MODE: 'shadow' } as NodeJS.ProcessEnv)
    ).toBe('shadow');
    expect(
      buildRuleGateShadowRecord({
        gate: 'structured_memory_enqueue',
        mode: 'active',
        reason: 'pure_social',
        textLength: 1,
      })
    ).toMatchObject({ mode: 'active', action: 'skip' });
  });

  it('skips structured memory only in active mode for pure social turns', () => {
    expect(shouldSkipStructuredMemoryEnqueue('嗯', 'active')).toBe(true);
    expect(shouldSkipStructuredMemoryEnqueue('嗯', 'shadow')).toBe(false);
    expect(shouldSkipStructuredMemoryEnqueue('我想你', 'active')).toBe(false);
  });

  it('samples by env rate', () => {
    expect(shouldSampleRuleGateShadow({ RULE_GATE_SHADOW_SAMPLE_RATE: '0' }, () => 0)).toBe(false);
    expect(shouldSampleRuleGateShadow({ RULE_GATE_SHADOW_SAMPLE_RATE: '1' }, () => 0.9)).toBe(true);
    expect(shouldSampleRuleGateShadow({}, () => 0.5)).toBe(false);
  });
});
