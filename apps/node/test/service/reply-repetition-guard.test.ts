import {
  deriveRecentReplyMoves,
  extractLiteralClauses,
  extractRecentAssistantTexts,
  removeRepeatedReplySegments,
} from '../../src/service/agents/reply-repetition-guard';

describe('reply repetition guard', () => {
  const messages = [
    { role: 'user', content: '睡得很差 每小时醒一次' },
    {
      role: 'assistant',
      content: '昂，每小时醒一次，熬得慌不？',
    },
    { role: 'user', content: '不知道 睡得不踏实' },
  ] as any;

  it('extracts the last assistant clauses and question move', () => {
    expect(extractRecentAssistantTexts(messages)).toEqual([
      '昂，每小时醒一次，熬得慌不？',
    ]);
    expect(extractLiteralClauses(extractRecentAssistantTexts(messages))).toContain(
      '昂，每小时醒一次，熬得慌不'
    );
    expect(deriveRecentReplyMoves(extractRecentAssistantTexts(messages))).toEqual([
      'generic_question',
    ]);
  });

  it('removes a segment that repeats the previous assistant line', () => {
    const result = removeRepeatedReplySegments(
      ['昂，每小时醒一次，熬得慌不？', '你先躺会儿，别硬撑。'],
      extractRecentAssistantTexts(messages)
    );
    expect(result.segments).toEqual(['你先躺会儿，别硬撑。']);
    expect(result.removed).toEqual(['昂，每小时醒一次，熬得慌不？']);
    expect(result.fallbackApplied).toBe(false);
  });

  it('falls back when every segment is repeated', () => {
    const result = removeRepeatedReplySegments(
      ['昂，每小时醒一次，熬得慌不？'],
      extractRecentAssistantTexts(messages)
    );
    expect(result.segments).toEqual(['我在，慢慢说。']);
    expect(result.fallbackApplied).toBe(true);
  });
});
