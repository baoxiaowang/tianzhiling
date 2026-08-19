import type { ReplyBrief } from './reply-brief.service';
import type { ReplyPlanningMode } from './reply-intent-classifier.service';
import { GRIEF_CRISIS_INTENT_PATTERN } from './reply-intent';
import type { TurnExpectedResponse, TurnUnderstanding } from './reply-intent';
import { isUserCaringForRole } from './turn-understanding';

export { isUserCaringForRole } from './turn-understanding';

export const TURN_DECISION_VERSION = 'turn_decision_v3' as const;

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
    understanding.questions.some(question => question.mustAnswer) ||
    understanding.needs.some(need =>
      ['direct_answer', 'direct_answer_and_receive_care'].includes(
        need.expectedResponse
      )
    ) ||
    /^(?:ask_|question_|correct_assistant)/.test(primaryIntent);
  const responseActs = buildTurnResponseActs(understanding);
  const answerRequired =
    activeContributionRequired ||
    directAnswerRequired ||
    responseActs.some(act =>
      ['repair', 'boundary_answer', 'family_response'].includes(act.kind)
    ) ||
    /^(?:ask_|request_|correct_assistant)/.test(primaryIntent) ||
    ['answer', 'acknowledge'].includes(conversationActs[0]);
  const closure = understanding.closureSignal
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
  return [
    '# 本轮唯一决策',
    '理解版本：' + decision.understandingVersion,
    decision.understanding.needs.length
      ? '用户诉求：' +
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
      ? '情绪理解：' +
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
    '需要：' + decision.userNeed,
    '本轮目标：' + decision.primaryGoal,
    decision.responseActs.length
      ? '必须完成的动作：' +
        decision.responseActs
          .map(
            act =>
              `${TURN_BUBBLE_ROLE_LABELS[act.kind]}(${act.targetRef},${
                act.priority === 'must' ? '必须' : '辅助'
              })`
          )
          .join(' → ')
      : '',
    '主动作：' + decision.primaryAct,
    decision.supportingActs.length
      ? '辅助动作：' + decision.supportingActs.join('、')
      : '',
    '必须直接回答：' +
      (decision.participation.directAnswerRequired ? '是' : '否'),
    '对话责任：' +
      (decision.participation.turnOwner === 'assistant'
        ? '本轮由角色提供内容，不反问、不把话推回用户'
        : '双方自然承接'),
    decision.participation.careReceptionRequired
      ? '接纳关心：先回答，再收下用户的关心；不用“别挂心”，也不立刻反向叮嘱'
      : '',
    decision.participation.bubbleRoles.length
      ? '内容动作：' +
        decision.participation.bubbleRoles
          .map(role => TURN_BUBBLE_ROLE_LABELS[role])
          .join(' → ')
      : '',
    decision.participation.avoidRecentMoves.length
      ? '本轮避开最近重复动作：' +
        decision.participation.avoidRecentMoves.join('、')
      : '',
    decision.participation.avoidLiteralClauses.length
      ? '不得复用最近原句：' +
        decision.participation.avoidLiteralClauses.join('、')
      : '',
    '提问策略：' +
      (decision.questionPolicy === 'none'
        ? '不提问，不把表达责任推回用户'
        : decision.questionPolicy === 'necessary'
        ? '只有缺少关键事实时问一个必要问题'
        : '完成本轮必须动作后，确有自然价值时最多问一个'),
    '收放：' +
      (decision.closure === 'close'
        ? '自然收尾，不另开话题'
        : decision.closure === 'continue'
        ? '可自然留下开放点'
        : '完成本轮动作后自然停住'),
    '事实：' +
      (decision.evidenceRequired
        ? '具体事实必须来自证据包'
        : '没有证据也不得新增具体共同经历或现实事实'),
    '表达：' +
      decision.output.tone +
      '；' +
      decision.output.length +
      '；先形成内容完整的单条正文，展示拆分由发送层处理',
    decision.boundaryFocuses.length
      ? '边界：' + decision.boundaryFocuses.join('；')
      : '',
    '其他历史计划字段只作解释材料；与本决策冲突时，以本决策、用户原话和证据包为准。',
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

  if (
    understanding.activeSpeechRequest ||
    understanding.closureSignal ||
    understanding.corrections.length > 0 ||
    understanding.questions.some(question => question.mustAnswer) ||
    understanding.needs.some(need =>
      [
        'care_for_role',
        'relationship_repair',
        'active_speech',
        'close',
      ].includes(need.kind)
    )
  ) {
    return 'none';
  }

  if (
    plannedQuestionNeed &&
    (plannedQuestionNeed !== 'none' || planningMode === 'semantic')
  ) {
    return plannedQuestionNeed;
  }

  // 普通轮次不由程序预先禁止提问。helpful 只是给模型保留策略空间，
  // 并不要求它一定提问；明确答题、纠正、收尾和用户要求角色主动说时
  // 仍由上面的分支收紧。
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
