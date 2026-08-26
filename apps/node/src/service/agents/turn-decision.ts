import type { ReplyBrief } from './reply-brief.service';
import type { ReplyPlanningMode } from './reply-intent-classifier.service';
import { GRIEF_CRISIS_INTENT_PATTERN } from './reply-intent';
import type { TurnExpectedResponse, TurnUnderstanding } from './reply-intent';
import { isUserCaringForRole } from './turn-understanding';

export { isUserCaringForRole } from './turn-understanding';

export const TURN_DECISION_VERSION = 'turn_decision_v3' as const;

const EXPLICIT_USER_QUESTION_PATTERN =
  /[？?]|(?:吗|么|没有|没|多少|哪里|哪儿|什么|怎么|为什么|为何|谁|几时|几点|多久|多大|几岁)[。！!…~～\s]*$/;

export type TurnConversationOwner = 'assistant' | 'shared';

export type TurnBubbleRole =
  | 'direct_answer'
  | 'receive_care'
  | 'role_contribution'
  | 'relationship_response'
  | 'boundary_answer'
  | 'family_response'
  | 'comfort'
  | 'topic_reaction'
  | 'repair'
  | 'natural_close';

export interface TurnParticipationContract {
  directAnswerRequired: boolean;
  turnOwner: TurnConversationOwner;
  careReceptionRequired: boolean;
  bubbleRoles: TurnBubbleRole[];
  avoidRecentMoves: string[];
  avoidLiteralClauses: string[];
}

export interface TurnResponseAct {
  kind: TurnBubbleRole;
  targetRef: string;
  needIds: string[];
  priority: 'must' | 'supporting';
}

export type TurnDecisionPlanningStatus =
  | 'not_called'
  | 'succeeded'
  | 'timeout'
  | 'parse_failed'
  | 'failed';

export interface TurnDecision {
  version: typeof TURN_DECISION_VERSION;
  planningMode: ReplyPlanningMode;
  planningDepth: 'direct' | 'semantic';
  planningStatus: TurnDecisionPlanningStatus;
  understandingVersion: TurnUnderstanding['version'];
  understanding: TurnUnderstanding;
  primaryGoal: string;
  responseActs: TurnResponseAct[];
  questionPolicy: 'none' | 'helpful' | 'necessary';
  closure: 'continue' | 'neutral' | 'close';
  userNeed: string;
  primaryAct: string;
  supportingActs: string[];
  answerRequired: boolean;
  participation: TurnParticipationContract;
  shouldContinue: boolean;
  evidenceRequired: boolean;
  memoryAllowed: boolean;
  strictGrounding: boolean;
  boundaryFocuses: string[];
  output: {
    tone: string;
    length: ReplyBrief['lengthPlan']['lengthClass'];
    bubbles: 'natural' | 'single_preferred' | 'two_preferred';
  };
}

export function buildTurnDecision(options: {
  brief: ReplyBrief;
  planningMode: ReplyPlanningMode;
  planningStatus?: TurnDecisionPlanningStatus;
  currentQuery?: string;
}): TurnDecision {
  const brief = options.brief;
  const commActs: string[] = brief.commAct?.steps.map(step => step.act) || [];
  const conversationActs: string[] =
    brief.conversationPlan?.moves.map(move => move.type) || [];
  const acts = uniqueStrings(
    commActs.length ? commActs : [...conversationActs, ...brief.replyMoves]
  );
  const understanding = brief.understanding;
  const primaryIntent = brief.intents[0]?.intent || '';
  const currentQuery = options.currentQuery || '';
  const activeContributionRequired = Boolean(
    understanding.activeSpeechRequest ||
      brief.activeContribution ||
      brief.conversationPlan?.engagement?.assistantContribution ===
        'self_expression'
  );
  const directAnswerRequired =
    EXPLICIT_USER_QUESTION_PATTERN.test(currentQuery) &&
    understanding.questions.some(question => question.mustAnswer);
  const responseActs = buildTurnResponseActs(understanding);
  const answerRequired =
    activeContributionRequired ||
    directAnswerRequired ||
    responseActs.some(act =>
      ['repair', 'boundary_answer', 'family_response'].includes(act.kind)
    ) ||
    /^(?:ask_|request_|correct_assistant)/.test(primaryIntent) ||
    ['answer', 'acknowledge'].includes(conversationActs[0]);
  const closure =
    understanding.closureSignal ||
    brief.strategyQuality?.preferredAlternative === 'natural_close'
      ? 'close'
      : brief.conversationPlan?.turnClosure === 'continue' ||
        brief.bubblePlan.turnClosure === 'continue'
      ? 'continue'
      : 'neutral';
  const questionPolicy = resolveTurnQuestionPolicy(
    understanding,
    brief.conversationPlan?.questionNeed,
    options.planningMode,
    currentQuery
  );
  const memoryAllowed =
    !brief.correctionPolicy &&
    (brief.mode === 'memory' ||
      brief.factClaimMode === 'grounded' ||
      brief.evidence.length > 0);
  const careReceptionRequired =
    Boolean(brief.careReception) ||
    understanding.needs.some(
      need => need.expectedResponse === 'direct_answer_and_receive_care'
    ) ||
    isUserCaringForRole(currentQuery);
  const outputBubbles = brief.bubblePlan.preferTwoSegments
    ? 'two_preferred'
    : closure === 'close'
    ? 'single_preferred'
    : 'natural';
  const inferredBubbleRoles = resolveTurnBubbleRoles({
    directAnswerRequired,
    activeContributionRequired,
    careReceptionRequired,
    primaryIntent,
    correction: Boolean(brief.correctionPolicy),
    closing: closure === 'close',
    preferTwoSegments: outputBubbles === 'two_preferred',
  });
  const participation: TurnParticipationContract = {
    directAnswerRequired,
    turnOwner: activeContributionRequired ? 'assistant' : 'shared',
    careReceptionRequired,
    bubbleRoles: uniqueBubbleRoles([
      ...responseActs.map(act => act.kind),
      ...inferredBubbleRoles,
    ]).slice(0, 2),
    avoidRecentMoves: uniqueStrings(
      (brief.strategyQuality?.repeatedMoves || []).filter(
        move => move !== 'literal_repeat'
      )
    ),
    avoidLiteralClauses: uniqueStrings(
      brief.strategyQuality?.literalClauses || []
    ),
  };

  return {
    version: TURN_DECISION_VERSION,
    planningMode: options.planningMode,
    planningDepth: options.planningMode === 'semantic' ? 'semantic' : 'direct',
    planningStatus:
      options.planningStatus ||
      (options.planningMode === 'semantic' ? 'succeeded' : 'not_called'),
    understandingVersion: understanding.version,
    understanding,
    primaryGoal: buildPrimaryGoal(responseActs, understanding),
    responseActs,
    questionPolicy,
    closure,
    userNeed:
      brief.reading?.primaryNeed ||
      understanding.needs[0]?.evidence ||
      brief.emotionalNeed ||
      brief.replyMoves[0] ||
      '回应用户当前原话',
    primaryAct: acts[0] || (answerRequired ? 'answer' : 'acknowledge'),
    supportingActs: acts.slice(1, 3),
    answerRequired,
    participation,
    shouldContinue:
      closure === 'continue' ||
      brief.conversationPlan?.engagement?.closureReadiness === 'blocked',
    evidenceRequired:
      brief.strictGrounding ||
      brief.factClaimMode === 'grounded' ||
      brief.realityDependencies.length > 0 ||
      understanding.questions.some(
        question => question.evidenceRequirement !== 'none'
      ),
    memoryAllowed,
    strictGrounding: brief.strictGrounding,
    boundaryFocuses: uniqueStrings([
      ...brief.guardrailFocuses,
      ...brief.forbiddenAssumptions,
      ...understanding.boundaryLocks.map(lock => lock.evidence),
    ]),
    output: {
      tone: brief.reading?.suggestedTone || '自然、亲近、克制',
      length: brief.lengthPlan.lengthClass,
      bubbles: outputBubbles,
    },
  };
}

export function buildTurnDecisionPrompt(decision: TurnDecision): string {
  const hardObligations = uniqueStrings([
    ...(decision.understanding.corrections.length
      ? ['用户明确纠正已生效，旧事实不得继续使用']
      : []),
    ...(decision.participation.directAnswerRequired
      ? ['用户有明确问题，应正面回答；不知道时如实说明不确定']
      : []),
    ...(decision.understanding.boundarySignals.length
      ? ['当前请求涉及现实能力或事实边界，必须如实说明']
      : []),
    ...(decision.closure === 'close'
      ? ['用户明确结束，本轮自然回应并收尾']
      : []),
  ]);

  return [
    '# 本轮硬约束与业务建议',
    '理解版本：' + decision.understandingVersion,
    hardObligations.length
      ? '硬约束：' + hardObligations.join('；')
      : '硬约束：无新增；仍须遵守事实证据、安全和现实边界。',
    decision.understanding.needs.length
      ? '程序观察到的可能诉求（仅供参考）：' +
        decision.understanding.needs
          .map(
            need =>
              `${need.id}[${need.targetRef}]${need.evidence}→${
                TURN_BUBBLE_ROLE_LABELS[
                  mapExpectedResponseToActs(need.expectedResponse)[0]
                ]
              }`
          )
          .join('；')
      : '',
    decision.understanding.emotions.length
      ? '可能的情绪线索（由你结合上下文复核）：' +
        decision.understanding.emotions
          .map(
            emotion =>
              `${emotion.label}[${emotion.targetRef}]，来源“${emotion.source}”`
          )
          .join('；')
      : '',
    decision.understanding.ambiguities.length
      ? '未决指代：' +
        decision.understanding.ambiguities
          .map(item => `${item.mention}（${item.reason}）`)
          .join('；') +
        '；不得猜测绑定'
      : '',
    '平台希望这一轮做到：先理解这句话在连续对话中的作用，再选择能增进真实亲人感、长期信任和对话参与感的回应策略。',
    '可参考的用户需要：' + decision.userNeed,
    '可参考的回应方向：' + decision.primaryGoal,
    decision.responseActs.length
      ? '候选回应动作（可合并、换序、忽略或替换）：' +
        decision.responseActs
          .map(act => `${TURN_BUBBLE_ROLE_LABELS[act.kind]}(${act.targetRef})`)
          .join(' → ')
      : '',
    decision.participation.turnOwner === 'assistant'
      ? '参与建议：用户希望角色主动提供内容；优先自己说，不把聊天责任推回用户。'
      : '参与建议：结合最近上下文自主决定回应、贡献、提问或留白。',
    decision.participation.careReceptionRequired
      ? '关心线索：用户可能在关心角色；建议先回答并自然收下，不用“别挂心”把关心挡回去。'
      : '',
    decision.participation.avoidRecentMoves.length
      ? '重复风险提示：最近可能用过' +
        decision.participation.avoidRecentMoves.join('、')
      : '',
    decision.participation.avoidLiteralClauses.length
      ? '不得复用最近原句：' +
        decision.participation.avoidLiteralClauses.join('、')
      : '',
    decision.closure === 'close'
      ? '提问与收放：用户明确结束，不另开话题。'
      : '提问与收放：由你根据上下文和本轮内容价值自主决定；消息短不代表必须短答或收尾，也不为续聊硬问。',
    '事实：' +
      (decision.evidenceRequired
        ? '具体事实必须来自证据包'
        : '没有证据也不得新增具体共同经历或现实事实'),
    '表达：' +
      decision.output.tone +
      '；先把内容完整说好，展示拆分由发送层处理，不为字数或泡数牺牲内容',
    decision.boundaryFocuses.length
      ? '边界校验：' +
        decision.boundaryFocuses.join('；') +
        '。历史边界只防止同类越界，不要求延续旧话题。'
      : '',
    '除硬约束外，以上均是平台业务建议，不是执行表格。若程序推测与用户原话、最近上下文或你的整体理解冲突，忽略推测并采用更自然可靠的策略。',
  ]
    .filter(Boolean)
    .join('\n');
}

const TURN_BUBBLE_ROLE_LABELS: Record<TurnBubbleRole, string> = {
  direct_answer: '先正面回答',
  receive_care: '接纳这份关心',
  role_contribution: '给角色侧内容',
  relationship_response: '回应关系与情感',
  boundary_answer: '说明现实边界并补回情感价值',
  family_response: '回应对应家人或人物',
  comfort: '承接情绪，不编事实答案',
  topic_reaction: '给贴题的不同反应',
  repair: '完成纠正或修复',
  natural_close: '自然收尾',
};

function resolveTurnBubbleRoles(options: {
  directAnswerRequired: boolean;
  activeContributionRequired: boolean;
  careReceptionRequired: boolean;
  primaryIntent: string;
  correction: boolean;
  closing: boolean;
  preferTwoSegments: boolean;
}): TurnBubbleRole[] {
  if (options.correction) {
    return ['repair'];
  }
  if (options.closing) {
    return ['natural_close'];
  }

  const roles: TurnBubbleRole[] = [];
  if (options.directAnswerRequired) {
    roles.push('direct_answer');
  } else if (options.activeContributionRequired) {
    roles.push('role_contribution');
  } else if (options.primaryIntent === 'express_longing') {
    roles.push('relationship_response');
  } else {
    roles.push('topic_reaction');
  }

  if (options.careReceptionRequired) {
    roles.push('receive_care');
  } else if (options.activeContributionRequired) {
    if (!roles.includes('role_contribution')) {
      roles.push('role_contribution');
    } else {
      roles.push('topic_reaction');
    }
  } else if (options.preferTwoSegments) {
    roles.push(
      roles[0] === 'relationship_response'
        ? 'topic_reaction'
        : 'relationship_response'
    );
  }

  return Array.from(new Set(roles)).slice(0, options.preferTwoSegments ? 2 : 1);
}

function buildTurnResponseActs(
  understanding: TurnUnderstanding
): TurnResponseAct[] {
  const acts: TurnResponseAct[] = [];
  const orderedNeeds = [...understanding.needs].sort((left, right) =>
    left.priority === right.priority ? 0 : left.priority === 'must' ? -1 : 1
  );

  for (const need of orderedNeeds) {
    for (const kind of mapExpectedResponseToActs(need.expectedResponse)) {
      const existing = acts.find(
        act => act.kind === kind && act.targetRef === need.targetRef
      );
      if (existing) {
        existing.needIds = uniqueStrings([...existing.needIds, need.id]);
        if (need.priority === 'must') {
          existing.priority = 'must';
        }
        continue;
      }
      acts.push({
        kind,
        targetRef: need.targetRef,
        needIds: [need.id],
        priority: need.priority,
      });
    }
  }

  return acts.slice(0, 4);
}

function mapExpectedResponseToActs(
  expectedResponse: TurnExpectedResponse
): TurnBubbleRole[] {
  switch (expectedResponse) {
    case 'direct_answer_and_receive_care':
      return ['direct_answer', 'receive_care'];
    case 'direct_answer':
      return ['direct_answer'];
    case 'relationship_response':
      return ['relationship_response'];
    case 'ordinary_response':
      return ['topic_reaction'];
    case 'repair':
      return ['repair'];
    case 'role_contribution':
      return ['role_contribution'];
    case 'boundary_answer':
      return ['boundary_answer'];
    case 'family_response':
      return ['family_response'];
    case 'comfort':
      return ['comfort'];
    case 'natural_close':
      return ['natural_close'];
  }
}

function resolveTurnQuestionPolicy(
  understanding: TurnUnderstanding,
  plannedQuestionNeed: 'none' | 'helpful' | 'necessary' | undefined,
  planningMode: ReplyPlanningMode,
  currentQuery: string
): 'none' | 'helpful' | 'necessary' {
  if (GRIEF_CRISIS_INTENT_PATTERN.test(currentQuery)) {
    return 'necessary';
  }

  if (understanding.closureSignal) {
    return 'none';
  }

  if (plannedQuestionNeed && planningMode === 'semantic') {
    return plannedQuestionNeed;
  }

  // 普通轮次（包括短消息、纠正、关心和要求角色主动说）不由程序
  // 预先禁止或要求提问。helpful 只保留模型的策略空间。
  return 'helpful';
}

function buildPrimaryGoal(
  responseActs: TurnResponseAct[],
  understanding: TurnUnderstanding
): string {
  const mustActs = responseActs.filter(act => act.priority === 'must');
  const selected = (mustActs.length ? mustActs : responseActs).slice(0, 2);
  if (selected.length) {
    return selected.map(act => TURN_BUBBLE_ROLE_LABELS[act.kind]).join('，再');
  }
  return understanding.needs[0]?.evidence || '回应用户当前原话';
}

function uniqueBubbleRoles(values: TurnBubbleRole[]): TurnBubbleRole[] {
  return Array.from(new Set(values));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map(value => value?.trim()).filter(Boolean) as string[])
  );
}
