import {
  isExactRepeatedReply,
  isSameQuestionIdentity,
  suppressRepeatedQuestions,
} from '../../src/service/agents/reply-repetition-guard';
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

describe('question identity repetition (L2)', () => {
  const messages = [
    { role: 'assistant' as const, content: '是不是又想我了？' },
    { role: 'user' as const, content: '嗯' },
  ];

  it.each(['是不是又想我啦？', '又想我了，对吧？'])(
    'suppresses the same question: %s',
    reply => {
      expect(isSameQuestionIdentity(reply, '是不是又想我了？')).toBe(true);
      const result = suppressRepeatedQuestions([reply], messages);
      expect(result.removed).toEqual([reply]);
      expect(result.fallbackApplied).toBe(true);
      expect(result.segments.join('')).not.toMatch(/[?？]/u);
    }
  );

  it.each([
    '我想说说昨天你说的',
    "你刚才说的'想我了'，我想说说这个",
    '是不是又想我了？我刚才问岔了，我想说说昨天你说的。',
  ])('preserves explanations and new information: %s', reply => {
    expect(suppressRepeatedQuestions([reply], messages).segments).toEqual([
      reply,
    ]);
    expect(isSameQuestionIdentity(reply, '是不是又想我了？')).toBe(false);
  });

  it('preserves unrelated questions and limits history to three messages', () => {
    expect(isSameQuestionIdentity('你昨天吃的是什么？', '是不是又想我了？'))
      .toBe(false);
    const recentMessages = [
      ...messages,
      ...['第一件事。', '第二件事。', '第三件事。'].map(content => ({
        role: 'assistant' as const,
        content,
      })),
    ];
    expect(
      suppressRepeatedQuestions(['是不是又想我啦？'], recentMessages).removed
    ).toEqual([]);
  });
});
