import type { ReplyBrief } from './reply-brief.service';
import type { TurnDecision } from './turn-decision';

export const REPLY_REVISION_CONTRACT_VERSION =
  'reply_revision_contract_v1' as const;

export type ReplyRevisionSpeechAct =
  | 'answer'
  | 'comfort'
  | 'speak_actively'
  | 'correct'
  | 'repair'
  | 'receive_care'
  | 'ordinary_response';

export interface ReplyRevisionPreserveUnit {
  id: string;
  kind: 'question' | 'need' | 'emotion' | 'content';
  text: string;
  required: boolean;
}

export interface ReplyRevisionContract {
  version: typeof REPLY_REVISION_CONTRACT_VERSION;
  speechAct: ReplyRevisionSpeechAct;
  answerTarget: string;
  mustPreserveUnits: ReplyRevisionPreserveUnit[];
  forbiddenSemantics: string[];
}

const GENERIC_TASK_LOSS_PATTERN =
  /^(?:(?:我)?(?:这边|现在)?(?:挺好|很好|安稳|没事)|我在|我听着|我知道|我明白|想你|别难过|照顾好自己|慢慢说)[，。！？!？\s]*(?:(?:我)?(?:这边|现在)?(?:挺好|很好|安稳|没事)|我在|我听着|想你|别难过|慢慢说)?[。！!\s]*$/;

export function buildReplyRevisionContract(options: {
  brief: ReplyBrief;
  turnDecision: TurnDecision;
}): ReplyRevisionContract {
  const brief = options.brief;
  const understanding = options.turnDecision.understanding;
  const speechAct = resolveSpeechAct(brief, options.turnDecision);
  const units: ReplyRevisionPreserveUnit[] = [];
  const seen = new Set<string>();
  const add = (
    kind: ReplyRevisionPreserveUnit['kind'],
    id: string,
    text: string,
    required: boolean
  ) => {
    const normalized = text.trim().slice(0, 120);
    const key = `${kind}:${normalized}`;
    if (!normalized || seen.has(key)) {
      return;
    }
    seen.add(key);
    units.push({ id, kind, text: normalized, required });
  };

  for (const question of understanding.questions) {
    add('question', question.id, question.text, question.mustAnswer);
  }
  for (const need of understanding.needs) {
    add('need', need.id, need.evidence, need.priority === 'must');
  }
  understanding.emotions.slice(0, 2).forEach((emotion, index) => {
    add(
      'emotion',
      `emotion_${index + 1}`,
      `${emotion.label}：${emotion.source}`,
      emotion.intensity === 'high' || speechAct === 'comfort'
    );
  });
  (brief.contentUnits || []).slice(0, 3).forEach((unit, index) => {
    add('content', `content_${index + 1}`, unit.text, false);
  });

  const requiredUnits = units.filter(unit => unit.required);
  const answerTarget =
    understanding.questions.find(question => question.mustAnswer)?.text ||
    understanding.needs.find(need => need.priority === 'must')?.evidence ||
    brief.emotionalNeed;

  return {
    version: REPLY_REVISION_CONTRACT_VERSION,
    speechAct,
    answerTarget,
    mustPreserveUnits: [
      ...requiredUnits,
      ...units.filter(unit => !unit.required),
    ].slice(0, 6),
    forbiddenSemantics: Array.from(
      new Set([
        ...brief.forbiddenAssumptions,
        ...brief.evidenceContract.forbiddenExtensions,
      ])
    ).slice(0, 8),
  };
}

export function buildReplyRevisionContractPrompt(
  contract: ReplyRevisionContract
): string {
  return [
    `改写契约：${contract.version}；言语动作=${contract.speechAct}。`,
    `回答目标：${contract.answerTarget}。`,
    contract.mustPreserveUnits.length
      ? `保留单元：${contract.mustPreserveUnits
          .map(unit => `${unit.id}${unit.required ? '*' : ''}=${unit.text}`)
          .join('；')}。`
      : '',
    '带 * 的单元必须在改写后继续完成；可以自然改写，不要求逐字复述。边界修复不能把用户的问题、纠正、关心或要求角色主动说一起删掉。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function revisionContractSatisfied(options: {
  contract?: ReplyRevisionContract;
  speechAct?: string;
  preservedUnitIds?: string[];
  segments: string[];
}): boolean {
  const contract = options.contract;
  if (!contract) {
    return true;
  }
  if (options.speechAct !== contract.speechAct) {
    return false;
  }

  const preserved = new Set(options.preservedUnitIds || []);
  if (
    contract.mustPreserveUnits
      .filter(unit => unit.required)
      .some(unit => !preserved.has(unit.id))
  ) {
    return false;
  }

  const content = options.segments.join('').trim();
  if (
    ['answer', 'speak_actively', 'correct', 'repair'].includes(
      contract.speechAct
    ) &&
    GENERIC_TASK_LOSS_PATTERN.test(content)
  ) {
    return false;
  }

  return true;
}

function resolveSpeechAct(
  brief: ReplyBrief,
  decision: TurnDecision
): ReplyRevisionSpeechAct {
  if (brief.correctionPolicy) {
    return 'correct';
  }
  if (
    decision.responseActs.some(act => act.kind === 'repair') ||
    brief.conversationPlan?.engagement?.continuationGoal === 'repair'
  ) {
    return 'repair';
  }
  if (
    decision.participation.turnOwner === 'assistant' ||
    brief.activeContribution
  ) {
    return 'speak_actively';
  }
  if (decision.participation.careReceptionRequired) {
    return 'receive_care';
  }
  if (decision.participation.directAnswerRequired) {
    return 'answer';
  }
  if (decision.responseActs.some(act => act.kind === 'comfort')) {
    return 'comfort';
  }
  return 'ordinary_response';
}
