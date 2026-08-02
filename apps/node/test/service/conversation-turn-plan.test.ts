import {
  buildConversationTurnPlanPrompt,
  resolveConversationTurnPlan,
  turnPlanToEngagement,
} from '../../src/service/agents/conversation-turn-plan';

describe('conversation turn plan', () => {
  const turnPlan = {
    state: 'repairing' as const,
    open: [
      {
        object: 'user',
        need: 'reciprocal_affection' as const,
        detail: '直接听到角色也想自己',
        priority: 'must' as const,
      },
    ],
    goal: 'repair' as const,
    action: 'affection' as const,
    target: '先直接表达也想用户',
    avoid: 'explain' as const,
    close: 'blocked' as const,
  };

  it('maps the compact plan to the released persistence fields', () => {
    expect(turnPlanToEngagement(turnPlan)).toEqual({
      userConversationState: 'repairing',
      openLoop: '直接听到角色也想自己',
      continuationGoal: 'repair',
      assistantContribution: 'affection',
      mustContribute: '先直接表达也想用户',
      avoidRepeatingMove: '解释和辩解',
      closureReadiness: 'blocked',
    });
    expect(buildConversationTurnPlanPrompt(turnPlan)).toBe(
      '在修复；未完：用户必须“直接听到角色也想自己”；修复/回应感情“先直接表达也想用户”；避免解释和辩解；不收尾'
    );
  });

  it('uses the final engagement after later policy code changes the plan', () => {
    const resolved = resolveConversationTurnPlan({
      turnPlan,
      engagement: {
        userConversationState: 'repairing',
        openLoop: '旧事实需要被撤回',
        continuationGoal: 'repair',
        assistantContribution: 'answer',
        mustContribute: '承认说错并停止猜测',
        avoidRepeatingMove: '不继续猜测',
        closureReadiness: 'possible',
      },
    });

    expect(resolved).toMatchObject({
      state: 'repairing',
      open: [
        {
          object: 'user',
          need: 'other',
          detail: '旧事实需要被撤回',
        },
      ],
      goal: 'repair',
      action: 'answer',
      target: '承认说错并停止猜测',
      avoid: 'other',
      close: 'possible',
    });
  });
});
