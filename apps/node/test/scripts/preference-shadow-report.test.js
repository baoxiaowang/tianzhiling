const {
  parseAuditLines,
  aggregate,
} = require('../../scripts/preference-shadow-report');

const lines = [
  'noise line',
  '[preference-audit] {"decision":"shadow","kind":"comfort","keys":["taboo.comfort.avoid"],"userId":"u1"}',
  '[preference-audit] {"decision":"write","kind":"address","keys":["relationship.preferred_user_name"],"userId":"u1"}',
  '[preference-audit] {"decision":"skip","kind":"address","keys":[],"userId":"u2"}',
  '[preference-audit] not-json',
];

describe('preference shadow report', () => {
  it('parses audit lines and ignores noise', () => {
    const records = parseAuditLines(lines);
    expect(records).toHaveLength(3);
    expect(records[0].decision).toBe('shadow');
  });

  it('aggregates decision/kind/key/user counts', () => {
    const result = aggregate(parseAuditLines(lines), 5);
    expect(result.total).toBe(3);
    expect(result.byDecision).toEqual({ shadow: 1, write: 1, skip: 1 });
    expect(result.byKind).toEqual({ comfort: 1, address: 2 });
    expect(result.topKeys[0]).toEqual({
      name: 'taboo.comfort.avoid',
      count: 1,
    });
    expect(result.topUsers[0]).toEqual({ name: 'u1', count: 2 });
  });
});
