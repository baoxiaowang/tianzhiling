import {
  CONVERSATION_SESSION_GAP_MS,
  selectCurrentSessionHistory,
} from '../../src/service/agents/conversation-session';

describe('conversation session boundary', () => {
  const at = (value: string) => ({ createdAt: new Date(value) });

  it('keeps continuous messages inside one session', () => {
    const messages = [
      at('2026-11-04T00:00:00.000Z'),
      at('2026-11-04T00:05:00.000Z'),
      at('2026-11-04T00:10:00.000Z'),
    ];
    const result = selectCurrentSessionHistory(
      messages,
      new Date('2026-11-04T00:20:00.000Z')
    );
    expect(result.boundary).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it('drops the previous session when the current turn is after a long gap', () => {
    const old = at('2026-11-03T09:32:00.000Z');
    const result = selectCurrentSessionHistory(
      [old],
      new Date('2026-11-04T00:51:00.000Z')
    );
    expect(result.boundary).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.boundaryAt?.toISOString()).toBe(old.createdAt.toISOString());
  });

  it('keeps only messages after the last in-history long gap', () => {
    const old = at('2026-11-02T09:00:00.000Z');
    const current = at('2026-11-02T18:00:00.000Z');
    const result = selectCurrentSessionHistory(
      [old, current],
      new Date('2026-11-02T18:30:00.000Z')
    );
    expect(result.boundary).toBe(true);
    expect(result.messages).toEqual([current]);
  });

  it('uses a six hour default gap', () => {
    expect(CONVERSATION_SESSION_GAP_MS).toBe(6 * 60 * 60 * 1000);
  });
});
