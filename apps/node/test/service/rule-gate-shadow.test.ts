import {
  buildRuleGateShadowRecord,
  formatRuleGateShadowLine,
  isPureSocialTurn,
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
      gate: 'memory_retrieval',
      reason: 'pure_social',
      textLength: 2,
      now: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(record.action).toBe('would_skip');
    expect(formatRuleGateShadowLine(record)).toContain('[rule-gate-shadow]');
    expect(record).not.toHaveProperty('text');
  });

  it('samples by env rate', () => {
    expect(shouldSampleRuleGateShadow({ RULE_GATE_SHADOW_SAMPLE_RATE: '0' }, () => 0)).toBe(false);
    expect(shouldSampleRuleGateShadow({ RULE_GATE_SHADOW_SAMPLE_RATE: '1' }, () => 0.9)).toBe(true);
    expect(shouldSampleRuleGateShadow({}, () => 0.5)).toBe(false);
  });
});
