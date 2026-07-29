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
      maxSegments: 3,
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
      maxSegments: 3,
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

  it('marks closing turns so the model does not reopen the conversation', () => {
    const plan = buildReplyBubblePlan({
      currentQuery: '我先睡了，晚安',
      replyMoveCount: 2,
    });

    expect(plan.turnClosure).toBe('close');
    expect(buildReplyBubblePlanPrompt(plan)).toContain('不重新提问');
  });

  it('removes deterministic noise without changing valid bubble semantics', () => {
    const inspected = inspectReplyBubbleStructure([
      '我听着呢',
      '（轻轻叹气）',
      '我听着呢',
      '你慢慢说',
    ]);

    expect(inspected).toEqual({
      segments: ['我听着呢', '你慢慢说'],
      issues: ['stage_direction_segment', 'exact_duplicate_segment'],
      requiresReflow: false,
    });
  });

  it('requests model reflow only when usable content exceeds three bubbles', () => {
    const inspected = inspectReplyBubbleStructure([
      '第一层回应',
      '第二层回应',
      '第三层回应',
      '第四层回应',
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
        '第四层回应',
      ])
    ).toEqual(['第一层回应', '第二层回应', '第三层回应 第四层回应']);
  });
});
