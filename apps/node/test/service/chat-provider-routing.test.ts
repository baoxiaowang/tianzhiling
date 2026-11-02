import { isDeepSeekPeakAt } from '../../src/service/agents/chat-provider-routing';

describe('DeepSeek peak routing', () => {
  it('detects weekday peak windows in UTC', () => {
    expect(isDeepSeekPeakAt(new Date('2026-11-02T01:00:00Z'))).toBe(true);
    expect(isDeepSeekPeakAt(new Date('2026-11-02T03:59:00Z'))).toBe(true);
    expect(isDeepSeekPeakAt(new Date('2026-11-02T04:00:00Z'))).toBe(false);
    expect(isDeepSeekPeakAt(new Date('2026-11-02T07:00:00Z'))).toBe(true);
    expect(isDeepSeekPeakAt(new Date('2026-11-02T10:00:00Z'))).toBe(false);
  });

  it('treats weekends and configured holidays as off-peak', () => {
    expect(isDeepSeekPeakAt(new Date('2026-11-07T07:00:00Z'))).toBe(false);
    expect(
      isDeepSeekPeakAt(new Date('2026-11-02T07:00:00Z'), ['2026-11-02'])
    ).toBe(false);
  });
});
