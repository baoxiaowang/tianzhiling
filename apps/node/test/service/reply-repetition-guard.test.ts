import { isExactRepeatedReply } from '../../src/service/agents/reply-repetition-guard';
const old = '昂，每小时醒一次，熬得慌不？';
const history = [
  { role: 'user', content: '睡得很差 每小时醒一次' },
  { role: 'assistant', content: old },
  { role: 'user', content: '不知道 睡得不踏实' },
] as any;
describe('whole reply repetition', () => {
  it('detects the repeated insomnia reply across turns', () => {
    expect(isExactRepeatedReply([old], history)).toBe(true);
    expect(
      isExactRepeatedReply(
        [old],
        [
          ...history,
          { role: 'assistant', content: old },
          { role: 'user', content: '？' },
        ]
      )
    ).toBe(true);
  });
  it('preserves quotes, corrections, negation and new content', () => {
    for (const reply of [
      old + '刚才我问岔了。',
      '你不是每小时醒一次，是刚才没睡踏实。',
      '每小时醒一次确实难受，我不继续问你了。',
    ]) {
      expect(isExactRepeatedReply([reply], history)).toBe(false);
    }
    expect(
      isExactRepeatedReply([old, '你刚才已经回答了，我听明白了。'], history)
    ).toBe(false);
  });
  it('handles bubble regrouping without joining different turns', () => {
    expect(
      isExactRepeatedReply(['昂，每小时醒一次', '熬得慌不？'], history)
    ).toBe(true);
    expect(
      isExactRepeatedReply(['第一件事情说清楚了。第二件事情也说清楚了。'], [
        { role: 'assistant', content: '第一件事情说清楚了。' },
        { role: 'user', content: '然后呢' },
        { role: 'assistant', content: '第二件事情也说清楚了。' },
      ] as any)
    ).toBe(false);
  });
  it('does not repair short acknowledgements or empty output', () => {
    expect(
      isExactRepeatedReply(['嗯'], [
        { role: 'assistant', content: '嗯' },
      ] as any)
    ).toBe(false);
    expect(isExactRepeatedReply([], history)).toBe(false);
  });
});
