const { parseLines, aggregate } = require('../../scripts/rule-gate-shadow-report');

describe('rule gate shadow report', () => {
  it('aggregates gate and reason counts', () => {
    const records = parseLines([
      'noise',
      '[rule-gate-shadow] {"gate":"memory_retrieval","action":"would_skip","reason":"pure_social","textLength":2}',
      '[rule-gate-shadow] {"gate":"structured_memory_enqueue","action":"would_skip","reason":"pure_social","textLength":2}',
      '[rule-gate-shadow] broken',
    ]);
    expect(records).toHaveLength(2);
    const result = aggregate(records, 5);
    expect(result.total).toBe(2);
    expect(result.byGate.memory_retrieval).toBe(1);
    expect(result.byReason.pure_social).toBe(2);
  });
});
