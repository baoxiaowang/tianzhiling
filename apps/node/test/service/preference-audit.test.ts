import {
  buildPreferenceAuditRecord,
  formatPreferenceAuditLine,
} from '../../src/service/agents/preference-audit';

describe('preference audit', () => {
  it('dedupes keys and keeps ids without raw text', () => {
    const record = buildPreferenceAuditRecord({
      decision: 'shadow',
      kind: 'comfort',
      keys: ['taboo.comfort.avoid', 'taboo.comfort.avoid'],
      messageId: 'm1',
      userId: 'u1',
      agentId: 'a1',
      now: new Date('2026-10-20T00:00:00.000Z'),
    });
    expect(record.keys).toEqual(['taboo.comfort.avoid']);
    expect(record).not.toHaveProperty('text');
    expect(formatPreferenceAuditLine(record)).toContain('[preference-audit]');
    expect(formatPreferenceAuditLine(record)).toContain('"decision":"shadow"');
  });
});
