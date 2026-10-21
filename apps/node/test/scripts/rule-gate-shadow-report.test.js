const { parseLines, aggregate } = require('../../scripts/rule-gate-shadow-report');

describe('rule gate shadow report', () => {
  it('aggregates gate and reason counts', () => {
    const records = parseLines([
      'noise',
      '[rule-gate] {"gate":"structured_memory_enqueue","action":"would_skip","reason":"pure_social","textLength":2,"messageId":"m1"}',
      '[rule-gate] {"gate":"structured_memory_enqueue","action":"would_skip","reason":"pure_social","textLength":2}',
      '[rule-gate] broken',
    ]);
    expect(records).toHaveLength(2);
    const result = aggregate(records, 5);
    expect(result.total).toBe(2);
    expect(result.byGate.structured_memory_enqueue).toBe(2);
    expect(result.byReason.pure_social).toBe(2);
  });
});
