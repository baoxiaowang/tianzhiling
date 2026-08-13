import type {
  ConversationAssistantContribution,
  ConversationAvoidAction,
  ConversationClosureReadiness,
  ConversationContinuationGoal,
  ConversationEngagementPlan,
  ConversationMovePlan,
  ConversationTurnPlan,
  ConversationUserState,
} from './reply-intent';

const STATE_TEXT: Record<ConversationUserState, string> = {
  opening: '刚开始',
  exploring: '在展开',
  deepening: '在深入',
  repairing: '在修复',
  withdrawing: '在退开',
  closing: '在收尾',
};

const GOAL_TEXT: Record<ConversationContinuationGoal, string> = {
  deepen: '深入',
  hold: '接住',
  repair: '修复',
  close: '收尾',
};

const ACTION_TEXT: Record<ConversationAssistantContribution, string> = {
  answer: '直接回答',
  stance: '表明态度',
  specific_detail: '给证据细节',
  self_expression: '主动表达',
  affection: '回应感情',
  question: '问一个问题',
  strategic_silence: '留白',
};

const CLOSE_TEXT: Record<ConversationClosureReadiness, string> = {
  blocked: '不收尾',
  possible: '可延续',
  ready: '可收尾',
};

const AVOID_TEXT: Record<ConversationAvoidAction, string> = {
  none: '无',
  generic_comfort: '泛泛安慰',
  repeat_acknowledgement: '重复确认或复述',
  explain: '解释和辩解',
  ask: '把表达责任推回用户',
  promise_later: '只承诺以后改变',
  premature_close: '过早收尾',
  unsupported_detail: '补写无证据细节',
  displacement_loss: '忽视潜词-仅回应表面信息',
  other: '重复上一轮无效动作',
};

export function turnPlanToEngagement(
  plan: ConversationTurnPlan
): ConversationEngagementPlan {
  const primaryOpen =
    plan.open.find(item => item.priority === 'must') || plan.open[0];
  const openLoop = plan.open.length
    ? plan.open.map(item => item.detail).join('；')
    : plan.close === 'ready'
    ? '用户已准备结束本轮'
    : plan.target;

  return {
    userConversationState: plan.state,
    openLoop,
    continuationGoal: plan.goal,
    assistantContribution: plan.action,
    mustContribute: plan.target || primaryOpen?.detail || openLoop,
    avoidRepeatingMove: AVOID_TEXT[plan.avoid],
    closureReadiness: plan.close,
  };
}

export function resolveConversationTurnPlan(options: {
  engagement?: ConversationEngagementPlan;
  turnPlan?: ConversationTurnPlan;
}): ConversationTurnPlan | undefined {
  const { engagement, turnPlan } = options;

  if (!engagement) {
    return turnPlan;
  }

  if (turnPlan && engagementMatchesTurnPlan(engagement, turnPlan)) {
    return turnPlan;
  }

  // 后续事实/证据约束可能只修改了 engagement 的贡献动作。
  // 原先明确保留的 topic_followup 仍应继续存在，否则会在同步时被抹成
  // 泛化的 other，导致“顺着具体事追问”的开放点丢失。
  const retainedTopicFollowUps = (turnPlan?.open || []).filter(
    point => point.need === 'topic_followup'
  );

  return {
    state: engagement.userConversationState,
    open:
      engagement.closureReadiness === 'ready'
        ? []
        : retainedTopicFollowUps.length
        ? retainedTopicFollowUps
        : [
            {
              object: 'user',
              need: 'other',
              detail: engagement.openLoop,
              priority: 'must',
            },
          ],
    goal: engagement.continuationGoal,
    action: engagement.assistantContribution,
    target: engagement.mustContribute,
    avoid: resolveAvoidAction(engagement.avoidRepeatingMove),
    close: engagement.closureReadiness,
  };
}

export function buildConversationTurnPlanPrompt(
  plan: ConversationTurnPlan
): string {
  const open = plan.open.length
    ? plan.open
        .map(item => {
          const object =
            item.object === 'agent'
              ? '角色'
              : item.object === 'user'
              ? '用户'
              : item.object === 'unknown'
              ? '对象不明'
              : item.object;
          const priority = item.priority === 'must' ? '必须' : '顺带';
          return `${object}${priority}“${item.detail}”`;
        })
        .join('；')
    : '无';

  const avoid = plan.avoid === 'none' ? '' : `；避免${AVOID_TEXT[plan.avoid]}`;

  return `${STATE_TEXT[plan.state]}；未完：${open}；${GOAL_TEXT[plan.goal]}/${
    ACTION_TEXT[plan.action]
  }“${plan.target}”${avoid}；${CLOSE_TEXT[plan.close]}`;
}

export function synchronizeConversationTurnPlan(
  plan?: ConversationMovePlan
): ConversationMovePlan | undefined {
  if (!plan?.turnPlan) {
    return plan;
  }

  const turnPlan = resolveConversationTurnPlan({
    engagement: plan.engagement,
    turnPlan: plan.turnPlan,
  });

  return turnPlan ? { ...plan, turnPlan } : plan;
}

function engagementMatchesTurnPlan(
  engagement: ConversationEngagementPlan,
  turnPlan: ConversationTurnPlan
): boolean {
  const mapped = turnPlanToEngagement(turnPlan);

  return (
    mapped.userConversationState === engagement.userConversationState &&
    mapped.openLoop === engagement.openLoop &&
    mapped.continuationGoal === engagement.continuationGoal &&
    mapped.assistantContribution === engagement.assistantContribution &&
    mapped.mustContribute === engagement.mustContribute &&
    mapped.avoidRepeatingMove === engagement.avoidRepeatingMove &&
    mapped.closureReadiness === engagement.closureReadiness
  );
}

function resolveAvoidAction(value: string): ConversationAvoidAction {
  const entry = Object.entries(AVOID_TEXT).find(([, text]) => text === value);
  return (entry?.[0] as ConversationAvoidAction | undefined) || 'other';
}
