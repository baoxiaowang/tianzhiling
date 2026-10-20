const {
  parsePromptSizeLines,
  aggregate,
} = require('../../scripts/prompt-size-report');

describe('prompt size report', () => {
  it('parses and aggregates prompt-size lines', () => {
    const records = parsePromptSizeLines([
      'noise',
      '[prompt-size] {"stableChars":3000,"taskChars":1000,"totalChars":4000,"estimatedTokens":3509,"stableShare":0.75,"evidenceCount":2}',
      '[prompt-size] {"stableChars":2000,"taskChars":2000,"totalChars":4000,"estimatedTokens":3509,"stableShare":0.5,"evidenceCount":4}',
      '[prompt-size] broken',
    ]);
    expect(records).toHaveLength(2);
    const result = aggregate(records, 5);
    expect(result.total).toBe(2);
    expect(result.avg.totalChars).toBe(4000);
    expect(result.avg.stableShare).toBe(0.625);
    expect(result.avg.evidenceCount).toBe(3);
  });
});
