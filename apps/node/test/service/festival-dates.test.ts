import {
  buildFestivalTriggerPrompt,
  resolveFestivalDate,
  resolveFestivalTrigger,
  resolveQingmingDate,
} from '../../src/service/agents/festival-dates';

describe('festival dates', () => {
  it('computes Qingming for the 21st century', () => {
    expect(resolveQingmingDate(2024)).toBe('2024-04-04');
    expect(resolveQingmingDate(2025)).toBe('2025-04-04');
    expect(resolveQingmingDate(2026)).toBe('2026-04-05');
  });

  it('computes lunar festivals from the Chinese calendar', () => {
    expect(resolveFestivalDate('chunjie', 2024)).toBe('2024-02-10');
    expect(resolveFestivalDate('zhongyuan', 2024)).toBe('2024-08-18');
    expect(resolveFestivalDate('hanyi', 2024)).toBe('2024-11-01');
  });

  it('returns a date fact when the user mentions the festival', () => {
    const trigger = resolveFestivalTrigger({
      query: '快到清明了',
      now: new Date('2026-04-03T00:00:00.000Z'),
    });
    expect(trigger).toMatchObject({
      key: 'qingming',
      date: '2026-04-05',
      daysUntil: 2,
    });
    expect(buildFestivalTriggerPrompt(trigger)).toContain('2026-04-05');
    expect(buildFestivalTriggerPrompt(trigger)).not.toContain('先问');
  });

  it('does not trigger on unrelated chat', () => {
    expect(
      resolveFestivalTrigger({
        query: '今天天气不错',
        now: new Date('2026-04-03T00:00:00.000Z'),
      })
    ).toBeUndefined();
  });
});
