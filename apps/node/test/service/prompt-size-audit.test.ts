import {
  buildPromptSizeRecord,
  formatPromptSizeLine,
  shouldSamplePromptSize,
} from '../../src/service/agents/prompt-size-audit';

describe('prompt size audit', () => {
  it('records stable/task share and estimated tokens without content', () => {
    const record = buildPromptSizeRecord({
      stableChars: 3415,
      taskChars: 1357,
      totalChars: 4772,
      evidenceCount: 3,
      mode: 'standard',
      now: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(record.estimatedTokens).toBe(Math.round(4772 / 1.14));
    expect(record.stableShare).toBe(0.716);
    expect(record.evidenceCount).toBe(3);
    expect(record).not.toHaveProperty('content');
    expect(formatPromptSizeLine(record)).toContain('[prompt-size]');
  });

  it('samples by env rate and supports disabling', () => {
    expect(
      shouldSamplePromptSize({ PROMPT_SIZE_SAMPLE_RATE: '0' }, () => 0)
    ).toBe(false);
    expect(
      shouldSamplePromptSize({ PROMPT_SIZE_SAMPLE_RATE: '1' }, () => 0.99)
    ).toBe(true);
    expect(shouldSamplePromptSize({}, () => 0.01)).toBe(true);
    expect(shouldSamplePromptSize({}, () => 0.5)).toBe(false);
  });
});
