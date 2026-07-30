import {
  buildReplyLengthPlan,
  buildReplyLengthPlanPrompt,
  countReplyVisibleCharacters,
} from '../../src/service/agents/reply-length-plan';

describe('reply length plan', () => {
  it('keeps daily WeChat turns in the micro budget', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '妈，你吃饭了吗',
      mode: 'daily',
      scene: 'smalltalk',
      replyMoveCount: 1,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'micro',
      targetCharacters: 18,
      reviewCharacters: 24,
    });
  });

  it('keeps a correction brief instead of explaining and comforting repeatedly', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '你刚才说的故事不是和我的，你怎么胡说啊',
      mode: 'boundary',
      scene: 'correction',
      replyMoveCount: 2,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
    });
    expect(buildReplyLengthPlanPrompt(plan)).toContain(
      '删除同义安慰、解释、总结和通用叮嘱'
    );
  });

  it('lets a multi-action semantic plan expand a short daily-routed turn', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '我一气之下把家族群退了。',
      mode: 'daily',
      scene: 'daily_update',
      replyMoveCount: 3,
      semanticPlan: true,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('reserves larger budgets only for genuinely complex messages', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery:
          '妈妈，我今天和家里人吵架了，工作也不顺，晚上又想起以前没来得及对你说的话，心里特别难受',
        mode: 'emotional',
        scene: 'guilt_regret',
        replyMoveCount: 3,
        turnClosure: 'neutral',
      })
    ).toEqual({
      lengthClass: 'extended',
      targetCharacters: 60,
      reviewCharacters: 85,
    });
  });

  it('keeps a protective stop complete even when the semantic plan closes', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '我今天真的撑不住了，真想现在就去找你。',
        mode: 'emotional',
        scene: 'strong_grief',
        replyMoveCount: 3,
        semanticPlan: true,
        hasProtectiveStop: true,
        turnClosure: 'close',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('counts all bubbles together and ignores whitespace', () => {
    expect(countReplyVisibleCharacters(['妈知道了', ' 别难过 '])).toBe(7);
  });
});
