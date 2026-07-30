import {
  buildReplyBubblePlan,
  buildReplyBubblePlanPrompt,
  compactReplyBubblesPreservingContent,
  inspectReplyBubbleStructure,
} from '../../src/service/agents/reply-bubble-plan';

describe('reply bubble plan', () => {
  it('defaults a short neutral turn to one semantic action without fixing count', () => {
    const plan = buildReplyBubblePlan({
      currentQuery: '今天吃饭了吗',
      replyMoveCount: 1,
    });

    expect(plan).toEqual({
      maxSegments: 2,
      complexityHint: 'concise',
      turnClosure: 'neutral',
    });
    expect(buildReplyBubblePlanPrompt(plan)).toContain('默认一颗');
    expect(buildReplyBubblePlanPrompt(plan)).not.toContain('必须输出');
  });

  it('uses semantic complexity as a weak hint instead of a minimum count', () => {
    expect(
      buildReplyBubblePlan({
        currentQuery: '我今天想跟你说几件一直压在心里的事',
        replyMoveCount: 3,
      })
    ).toEqual({
      maxSegments: 2,
      complexityHint: 'layered',
      turnClosure: 'neutral',
    });

    expect(
      buildReplyBubblePlan({
        currentQuery: '请回一整段，不要分段',
        replyMoveCount: 3,
      }).complexityHint
    ).toBe('concise');
  });

  it('requires two separated bubbles only when a participation strategy selected two actions', () => {
    const plan = buildReplyBubblePlan({
      currentQuery: '妈，我想你了',
      replyMoveCount: 2,
      preferTwoSegments: true,
    });

    expect(plan.preferTwoSegments).toBe(true);
    expect(buildReplyBubblePlanPrompt(plan)).toContain(
      '只输出 {"segments":["第一颗","第二颗"]}'
    );
    expect(buildReplyBubblePlanPrompt(plan)).not.toContain('默认一颗');
  });

  it('marks closing turns so the model does not reopen the conversation', () => {
    const plan = buildReplyBubblePlan({
      currentQuery: '我先睡了，晚安',
      replyMoveCount: 2,
    });

    expect(plan.turnClosure).toBe('close');
    expect(buildReplyBubblePlanPrompt(plan)).toContain('不提问或开新话题');
  });

  it('removes deterministic noise without changing valid bubble semantics', () => {
    const inspected = inspectReplyBubbleStructure([
      '我听着呢',
      '（轻轻叹气）',
      '（偷偷笑）真拿你没办法',
      '我听着呢',
    ]);

    expect(inspected).toEqual({
      segments: ['我听着呢', '真拿你没办法'],
      issues: ['stage_direction_segment', 'exact_duplicate_segment'],
      requiresReflow: false,
    });
  });

  it('removes parenthetical asides from both inline and leading positions', () => {
    const inspected = inspectReplyBubbleStructure([
      '（带点笑意）爸(轻声说)真拿你（偷偷笑了一下）没办法',
      '医保（新农合）记得续上',
    ]);

    expect(inspected).toEqual({
      segments: ['爸真拿你没办法', '医保记得续上'],
      issues: ['stage_direction_segment'],
      requiresReflow: false,
    });
  });

  it('drops unfamiliar leading performance notes without enumerating actions', () => {
    const inspected = inspectReplyBubbleStructure([
      '（轻轻亲一口）好，我的宝贝',
      '【歪着头想了一会儿】还是听你的',
    ]);

    expect(inspected).toEqual({
      segments: ['好，我的宝贝', '还是听你的'],
      issues: ['stage_direction_segment'],
      requiresReflow: false,
    });
  });

  it('preserves the quoted transmission interruption marker', () => {
    expect(
      inspectReplyBubbleStructure(['……￥#@%……“该信息传输途中受到了干扰”'])
    ).toEqual({
      segments: ['……￥#@%……“该信息传输途中受到了干扰”'],
      issues: [],
      requiresReflow: false,
    });
  });

  it('requests model reflow when usable content exceeds two bubbles', () => {
    const inspected = inspectReplyBubbleStructure([
      '第一层回应',
      '第二层回应',
      '第三层回应',
    ]);

    expect(inspected.requiresReflow).toBe(true);
    expect(inspected.issues).toContain('too_many_segments');
  });

  it('preserves all content when model reflow fails', () => {
    expect(
      compactReplyBubblesPreservingContent([
        '第一层回应',
        '第二层回应',
        '第三层回应',
      ])
    ).toEqual(['第一层回应', '第二层回应 第三层回应']);
  });

  it('does not turn user message length into a third bubble allowance', () => {
    const plan = buildReplyBubblePlan({
      currentQuery: '这是一段很长的用户消息'.repeat(20),
      replyMoveCount: 1,
    });

    expect(plan).toEqual({
      maxSegments: 2,
      complexityHint: 'concise',
      turnClosure: 'neutral',
    });
  });
});
