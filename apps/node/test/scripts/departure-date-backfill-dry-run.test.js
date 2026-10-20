const {
  extractDepartureCandidates,
  parseChineseNumber,
  shiftMonths,
  dateKey,
} = require('../../scripts/backfill-departure-dates-dry-run');

const REF = new Date('2026-10-08T00:00:00.000Z');
const names = ['爸爸'];

function first(text, options = {}) {
  return extractDepartureCandidates(text, REF, { names, ...options })[0];
}

describe('departure date backfill dry-run rules', () => {
  it('parses Chinese numerals', () => {
    expect(parseChineseNumber('三')).toBe(3);
    expect(parseChineseNumber('二十三')).toBe(23);
    expect(parseChineseNumber('一百')).toBe(100);
  });

  it('parses an explicit calendar date, with confidence tied to the subject', () => {
    const secondPerson = first('你是2023年10月8日走的');
    expect(secondPerson).toMatchObject({
      kind: 'exact',
      confidence: 'high',
      exactDate: '2023-10-08',
      subjectHint: 'second_person',
    });
    const unspecified = first('他2023年10月8日走的');
    expect(unspecified).toMatchObject({
      kind: 'exact',
      confidence: 'medium',
      subjectHint: 'unspecified',
    });
  });

  it('rejects dates that belong to plans or non-death events', () => {
    expect(
      first('妈妈 您本来说6月18号给爸爸去千家惠买衣服 结果您匆匆走了')
    ).toBeUndefined();
    expect(first('他2023年10月8日结婚，走了三年')).toMatchObject({
      kind: 'year',
      matched: '走了三年',
    });
  });

  it('applies day offsets before computing ritual dates', () => {
    const tomorrow = first('后天就是你百天忌了');
    expect(tomorrow.kind).toBe('milestone');
    expect(tomorrow.estimatedStart).toBe('2026-07-02');
    expect(tomorrow.estimatedEnd).toBe('2026-07-04');
    expect(first('五七我回去看你')).toBeUndefined();
    expect(first('我给你做了五七花')).toBeUndefined();
  });

  it('handles relative anniversary offsets and skips “过完周年那年”', () => {
    const later = first('爷爷你后天就过一周年了我去看你');
    expect(later.kind).toBe('year');
    expect(later.estimatedStart).toBe('2025-09-10');
    expect(later.estimatedEnd).toBe('2025-11-09');
    const past = first('前几天是您离开十周年呢');
    expect(past.estimatedStart).toBe('2016-09-05');
    expect(
      first('爸爸带着对你的思念在给你过完三周年的那年九月')
    ).toBeUndefined();
  });

  it('skips baby 100-day celebrations without a death word', () => {
    expect(first('宝宝百天了')).toBeUndefined();
    expect(first('今天是宝宝百天，你走了百天了')).toMatchObject({
      kind: 'milestone',
    });
  });

  it('parses year, month and day durations relative to the message', () => {
    const year = first('他走了三年了');
    expect(year.kind).toBe('year');
    expect(year.estimatedStart).toBe('2023-04-09');
    expect(year.estimatedEnd).toBe('2024-04-07');

    const month = first('他走了三个月');
    expect(month.kind).toBe('month');
    expect(month.estimatedStart).toBe('2026-06-23');

    const day = first('他走了7天');
    expect(day.kind).toBe('day');
    expect(day.estimatedStart).toBe('2026-09-30');
    expect(day.estimatedEnd).toBe('2026-10-02');
  });

  it('infers the year for a month-day date and supports 去年', () => {
    const current = first('他10月8日走的');
    expect(current).toMatchObject({
      kind: 'partial_date',
      confidence: 'medium',
      exactDate: '2026-10-08',
    });
    const lastYear = first('他去年10月8日走的');
    expect(lastYear.exactDate).toBe('2025-10-08');
    const twoDigit = first('他23年10月8日走的');
    expect(twoDigit.exactDate).toBe('2023-10-08');
  });

  it('parses half a year and “两个多月”', () => {
    expect(first('他走了半年').kind).toBe('month');
    const more = first('他走了两个多月');
    expect(more.kind).toBe('month');
    expect(more.estimatedStart).toBe('2026-07-09');
    expect(more.estimatedEnd).toBe('2026-08-08');
  });

  it('parses ritual milestones inclusively', () => {
    const candidate = first('今天是他的头七');
    expect(candidate.kind).toBe('milestone');
    expect(candidate.estimatedStart).toBe('2026-10-01');
    expect(candidate.estimatedEnd).toBe('2026-10-03');
  });

  it('parses an anniversary and marks it estimated', () => {
    const candidate = first('今年是三周年');
    expect(candidate.kind).toBe('year');
    expect(candidate.confidence).toBe('medium');
    expect(candidate.estimatedStart).toBe('2023-09-08');
    expect(candidate.estimatedEnd).toBe('2023-11-07');
  });

  it('supports 离开我们 and 走后 phrasings', () => {
    expect(first('他离开我们已经三年了').kind).toBe('year');
    expect(first('他走后三年了').kind).toBe('year');
  });

  it('does not parse unrelated years or places', () => {
    expect(first('我住院三年了')).toBeUndefined();
    expect(first('我离开家三年了')).toBeUndefined();
    expect(first('他离开了公司三年')).toBeUndefined();
    expect(first('如果他没有走')).toBeUndefined();
  });

  it('does not treat non-death anniversaries as departure', () => {
    expect(first('我们结婚三周年了')).toBeUndefined();
    expect(first('公司成立三周年')).toBeUndefined();
  });

  it('distinguishes second person, agent name and other people', () => {
    expect(first('你走了三年了').subjectHint).toBe('second_person');
    expect(first('爸爸走了三年了').subjectHint).toBe('agent_name');
    expect(first('我爷爷走了三年了').subjectHint).toBe('other_person');
    const otherPerson = first(
      '老爸也走了17天了 你下葬的那天过后一个礼拜 老爸就来找你了'
    );
    expect(otherPerson.subjectHint).toBe('other_person');
    expect(otherPerson.confidence).not.toBe('high');
  });

  it('only includes vague multi-year expressions when asked', () => {
    expect(first('他走了十几年了')).toBeUndefined();
    expect(first('他走了十几年了', { includeVague: true })).toMatchObject({
      kind: 'vague',
      confidence: 'low',
    });
  });

  it('shifts months without overflowing the target month', () => {
    expect(dateKey(shiftMonths(new Date('2026-03-31T00:00:00Z'), -1))).toBe(
      '2026-02-28'
    );
    expect(dateKey(shiftMonths(new Date('2024-03-31T00:00:00Z'), -1))).toBe(
      '2024-02-29'
    );
  });
});
