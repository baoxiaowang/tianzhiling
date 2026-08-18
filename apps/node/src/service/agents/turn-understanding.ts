import type { MessageEntity } from '@tzl/entities';
import { isReplyClosingTurn } from './reply-bubble-plan';
import {
  CONVERSATION_OBJECT_CONFIDENCES,
  CONVERSATION_OBJECT_KINDS,
  REPLY_INTENT_EMOTIONS,
  TURN_EXPECTED_RESPONSES,
  TURN_UNDERSTANDING_VERSION,
  TURN_USER_NEED_KINDS,
  ConversationKnownObject,
  ConversationObjectPlan,
  ReplyIntentEmotion,
  StructuredReplyIntent,
  StructuredReplyIntentItem,
  TurnBoundarySignal,
  TurnExpectedResponse,
  TurnQuestionObligation,
  TurnQuestionType,
  TurnTargetedEmotion,
  TurnUnderstanding,
  TurnUnderstandingActor,
  TurnUnderstandingAmbiguity,
  TurnUserNeed,
  TurnUserNeedKind,
} from './reply-intent';
import { detectReplyRealityDependencies } from './reply-reality-dependency';
import { isReplyActiveContributionRequest } from './reply-strategy-quality';
import { resolveConversationBoundaryLocks } from './conversation-boundary-state';

const USER_CARE_TOWARD_ROLE_PATTERN =
  /(?:吃(?:饭)?(?:了|过)?吗|吃没吃|喝水(?:了)?吗|睡(?:得)?(?:好|着)?吗|休息(?:了|好)?吗|过得(?:怎么样|好不好|好吗|好么|好不)|你好吗|还好吗|好不好|没事吧|冷不冷|热不热|疼不疼|累不累|身体怎么样)|(?:我|我们|大家|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|姐姐|哥哥).{0,8}(?:关心|担心|挂心|挂念|牵挂|惦记|心疼|放心不下|怕)(?:你|您)|(?:想着|怕|担心|惦记|挂念|牵挂).{0,8}(?:你|您).{0,12}(?:吃不上|没吃|挨饿|受冷|冷|热|累|辛苦|不好)|(?:你|您)(?:(?!心疼).){0,12}(?:(?:还)?(?:疼|冷|热|累)(?:吗|不|没|好些|好点)|辛苦了|太辛苦|累坏了)|(?:记得|要|得|可要|别|不要).{0,12}(?:添衣|穿暖|吃饭|喝水|休息|睡觉|熬夜|太累|太辛苦|照顾好(?:你|您)?自己|保重)|(?:你|您)(?:也|要|可要|一定要|得).{0,8}(?:照顾好(?:你|您)?自己|保重|好好的)|^(?:保重|你要好好的|您要好好的)[。！!…\s]*$/;
const ACTIVE_SPEECH_REQUEST_PATTERN =
  /(?:你|您)(?:也|来|再|多)?(?:主动)?(?:说|讲|聊)(?:点|些|说)?(?:自己|你自己的|你的)(?:事|话|情况|想法)?|(?:也|再|多)?说说自己|也说点(?:你|自己的)(?:事|话)?/;
const CORRECTION_PATTERN =
  /(?:不对|不是这样|你说错|你记错|叫错|弄错|答错|别瞎编|别胡编|我不是这个意思|应该叫|你要记住)/;
const RELATIONSHIP_REPAIR_PATTERN =
  /(?:不像你|太假|假的|不认识我|忘了我|不记得我|说了也没用|讲了也没用|别老问我|别总问我)/;
const EMOTIONAL_WHY_PATTERN =
  /(?:为什么|凭什么|怎么会|为何|为啥|凭啥|咋就|咋会)/;
const MEMORY_QUESTION_PATTERN =
  /(?:记得|记不记得|还记得|想得起来|以前|从前|小时候|那时候|当年)/;
const ROLE_MENTION_PATTERN =
  /(?:爸爸|爸|妈妈|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|你|您)/;

const EMOTIONAL_QUESTION_INTENTS = new Set([
  'question_departure',
  'express_hatred',
  'seek_comfort',
  'express_guilt',
  'grieve_unfinished_promise',
]);

export function isUserCaringForRole(currentQuery: string): boolean {
  return USER_CARE_TOWARD_ROLE_PATTERN.test(currentQuery.trim());
}

export function buildTurnUnderstanding(options: {
  currentQuery: string;
  intent?: StructuredReplyIntent;
  objectPlan?: ConversationObjectPlan;
  knownObjects?: ConversationKnownObject[];
  recentMessages?: MessageEntity[];
}): TurnUnderstanding {
  const currentQuery = options.currentQuery.trim();
  const intent = options.intent;
  const objectPlan = options.objectPlan || intent?.objectPlan;
  const actors = resolveActors(currentQuery, objectPlan, options.knownObjects);
  const activeSpeechRequest =
    isReplyActiveContributionRequest(currentQuery, options.recentMessages) ||
    ACTIVE_SPEECH_REQUEST_PATTERN.test(currentQuery);
  const closureSignal = isReplyClosingTurn(currentQuery);
  const corrections = Array.from(
    new Set(
      [
        ...(intent?.reading?.corrections || []),
        ...(CORRECTION_PATTERN.test(currentQuery)
          ? [matchEvidence(currentQuery, CORRECTION_PATTERN)]
          : []),
      ].filter(Boolean) as string[]
    )
  ).map(evidence => ({ evidence, targetRef: 'agent' }));
  const boundarySignals: TurnBoundarySignal[] = [
    ...detectReplyRealityDependencies(currentQuery).map(signal => ({
      evidence: signal.evidence,
      kind: signal.kind,
      targetRef: 'agent',
    })),
    ...(intent?.capabilityQuestions || []).map(question => ({
      evidence: question.evidence,
      kind: `capability:${question.subject}`,
      targetRef: 'agent',
    })),
  ];
  const boundaryLocks = resolveConversationBoundaryLocks({
    currentQuery,
    recentMessages: options.recentMessages,
  });
  const questions = resolveQuestions(currentQuery, intent);
  const needs = resolveNeeds({
    currentQuery,
    intents: intent?.intents || [],
    questions,
    activeSpeechRequest,
    closureSignal,
    corrections,
    boundarySignals,
    objectPlan,
  });
  const ambiguities: TurnUnderstandingAmbiguity[] = (
    objectPlan?.ambiguousMentions || []
  ).map(mention => ({ mention, reason: '当前指代无法可靠绑定到已确认人物' }));
  const emotions = resolveEmotions(currentQuery, intent, needs);
  const relevantActorRefs = new Set(
    needs.map(need => need.targetRef).filter(ref => ref !== 'unknown')
  );
  const complexity = ambiguities.length
    ? 'ambiguous'
    : needs.length > 1 || questions.length > 1 || relevantActorRefs.size > 1
    ? 'compound'
    : 'simple';

  return {
    version: TURN_UNDERSTANDING_VERSION,
    actors,
    needs,
    emotions,
    corrections,
    questions,
    boundarySignals: dedupeBy(
      boundarySignals,
      item => `${item.kind}:${item.evidence}`
    ),
    boundaryLocks,
    activeSpeechRequest,
    closureSignal,
    ambiguities,
    complexity,
  };
}

export function parseTurnUnderstandingCandidate(options: {
  value: unknown;
  currentQuery: string;
  fallback: TurnUnderstanding;
}): TurnUnderstanding | undefined {
  if (!options.value || typeof options.value !== 'object') {
    return undefined;
  }

  const item = options.value as Record<string, unknown>;
  const allowedActorRefs = new Set([
    'agent',
    'user',
    'unknown',
    ...options.fallback.actors.map(actor => actor.ref),
  ]);
  const allowedBindings = new Set([
    'agent',
    'user',
    'unknown',
    ...options.fallback.actors.map(actor => actor.binding),
  ]);
  const actors = Array.isArray(item.actors)
    ? item.actors
        .slice(0, 8)
        .map(value =>
          parseActor(
            value,
            options.currentQuery,
            allowedActorRefs,
            allowedBindings
          )
        )
        .filter((value): value is TurnUnderstandingActor => Boolean(value))
    : [];
  actors.forEach(actor => allowedActorRefs.add(actor.ref));

  const needs = Array.isArray(item.needs)
    ? item.needs
        .slice(0, 6)
        .map(value => parseNeed(value, options.currentQuery, allowedActorRefs))
        .filter((value): value is TurnUserNeed => Boolean(value))
    : [];
  const emotions = Array.isArray(item.emotions)
    ? item.emotions
        .slice(0, 4)
        .map(value =>
          parseEmotion(value, options.currentQuery, allowedActorRefs)
        )
        .filter((value): value is TurnTargetedEmotion => Boolean(value))
    : [];
  const questions = Array.isArray(item.questions)
    ? item.questions
        .slice(0, 4)
        .map(value =>
          parseQuestion(value, options.currentQuery, allowedActorRefs)
        )
        .filter((value): value is TurnQuestionObligation => Boolean(value))
    : [];

  if (
    !actors.length &&
    !needs.length &&
    !emotions.length &&
    !questions.length
  ) {
    return undefined;
  }

  return mergeTurnUnderstandings(options.fallback, {
    ...options.fallback,
    actors,
    needs,
    emotions,
    questions,
    activeSpeechRequest:
      typeof item.activeSpeechRequest === 'boolean'
        ? item.activeSpeechRequest
        : options.fallback.activeSpeechRequest,
    closureSignal:
      typeof item.closureSignal === 'boolean'
        ? item.closureSignal
        : options.fallback.closureSignal,
  });
}

export function mergeTurnUnderstandings(
  deterministic: TurnUnderstanding,
  semantic?: TurnUnderstanding
): TurnUnderstanding {
  if (!semantic) {
    return deterministic;
  }

  const actors = dedupeBy(
    [...deterministic.actors, ...semantic.actors],
    actor => actor.ref
  );
  const needs = dedupeBy(
    [...deterministic.needs, ...semantic.needs],
    need => `${need.kind}:${need.targetRef}:${normalizeText(need.evidence)}`
  )
    .sort((left, right) =>
      left.priority === right.priority ? 0 : left.priority === 'must' ? -1 : 1
    )
    .slice(0, 6);
  const questions = dedupeBy(
    [...deterministic.questions, ...semantic.questions],
    question => normalizeText(question.text)
  ).slice(0, 4);
  const emotions = dedupeBy(
    [...semantic.emotions, ...deterministic.emotions],
    emotion => `${emotion.label}:${emotion.targetRef}`
  ).slice(0, 4);
  const ambiguities = dedupeBy(
    [...deterministic.ambiguities, ...semantic.ambiguities],
    ambiguity => ambiguity.mention
  );
  const relevantActorRefs = new Set(
    needs.map(need => need.targetRef).filter(ref => ref !== 'unknown')
  );

  return {
    version: TURN_UNDERSTANDING_VERSION,
    actors,
    needs,
    emotions,
    corrections: dedupeBy(
      [...deterministic.corrections, ...semantic.corrections],
      correction => normalizeText(correction.evidence)
    ),
    questions,
    boundarySignals: dedupeBy(
      [...deterministic.boundarySignals, ...semantic.boundarySignals],
      signal => `${signal.kind}:${normalizeText(signal.evidence)}`
    ),
    boundaryLocks: dedupeBy(
      [...deterministic.boundaryLocks, ...semantic.boundaryLocks],
      lock => lock.kind
    ),
    activeSpeechRequest:
      deterministic.activeSpeechRequest || semantic.activeSpeechRequest,
    closureSignal: deterministic.closureSignal || semantic.closureSignal,
    ambiguities,
    complexity: ambiguities.length
      ? 'ambiguous'
      : needs.length > 1 || questions.length > 1 || relevantActorRefs.size > 1
      ? 'compound'
      : 'simple',
  };
}

export function shouldUseSemanticUnderstanding(options: {
  currentQuery: string;
  knownObjects?: ConversationKnownObject[];
}): boolean {
  const query = options.currentQuery.trim();
  const mentionedKnownObjects = (options.knownObjects || []).filter(object =>
    object.aliases.some(alias => alias.length > 1 && query.includes(alias))
  );
  const explicitRoleMentions = Array.from(
    new Set(
      query.match(/爸爸|爸|妈妈|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆/g) ||
        []
    )
  );
  const mixedObligations =
    (isUserCaringForRole(query) && isReplyActiveContributionRequest(query)) ||
    (CORRECTION_PATTERN.test(query) && /[?？]/.test(query)) ||
    (RELATIONSHIP_REPAIR_PATTERN.test(query) && /[?？]/.test(query));
  return (
    mixedObligations ||
    mentionedKnownObjects.length > 2 ||
    explicitRoleMentions.length > 1
  );
}

function resolveActors(
  currentQuery: string,
  objectPlan?: ConversationObjectPlan,
  knownObjects?: ConversationKnownObject[]
): TurnUnderstandingActor[] {
  const actors: TurnUnderstandingActor[] = [...(objectPlan?.objects || [])];
  for (const object of knownObjects || []) {
    const mention = [...object.aliases]
      .filter(alias => alias && currentQuery.includes(alias))
      .sort((left, right) => right.length - left.length)[0];
    if (!mention || actors.some(actor => actor.binding === object.id)) {
      continue;
    }
    actors.push({
      ref:
        object.id === 'agent' || object.id === 'user'
          ? object.id
          : `known_${actors.length + 1}`,
      mention,
      kind: object.kind,
      binding: object.id,
      confidence: 'high',
    });
  }

  if (
    ROLE_MENTION_PATTERN.test(currentQuery) &&
    !actors.some(actor => actor.binding === 'agent')
  ) {
    actors.push({
      ref: 'agent',
      mention: currentQuery.match(ROLE_MENTION_PATTERN)?.[0] || '你',
      kind: 'agent',
      binding: 'agent',
      confidence: 'high',
    });
  }

  return dedupeBy(actors, actor => actor.ref).slice(0, 8);
}

function resolveQuestions(
  currentQuery: string,
  intent?: StructuredReplyIntent
): TurnQuestionObligation[] {
  const excerpts = Array.from(
    new Set([
      ...(intent?.reading?.questionsToAnswer || []),
      ...(currentQuery.match(/[^。！!？?\n]{1,100}[？?]/gu) || []).map(value =>
        value.trim()
      ),
    ])
  );
  if (!excerpts.length && intent?.intents.some(isQuestionIntent)) {
    excerpts.push(currentQuery.slice(0, 120));
  }

  return excerpts.slice(0, 4).map((text, index) => {
    const type = classifyQuestionType(text, intent?.intents || []);
    return {
      id: `question_${index + 1}`,
      text,
      targetRef: resolveIntentTargetRef(
        intent?.intents.find(isQuestionIntent),
        intent?.objectPlan
      ),
      type,
      mustAnswer: type !== 'emotional_rhetorical',
      evidenceRequirement:
        type === 'memory'
          ? 'grounded'
          : type === 'boundary' || type === 'emotional_rhetorical'
          ? 'uncertain_answer'
          : 'none',
    };
  });
}

function resolveNeeds(options: {
  currentQuery: string;
  intents: StructuredReplyIntentItem[];
  questions: TurnQuestionObligation[];
  activeSpeechRequest: boolean;
  closureSignal: boolean;
  corrections: Array<{ evidence: string; targetRef: string }>;
  boundarySignals: TurnBoundarySignal[];
  objectPlan?: ConversationObjectPlan;
}): TurnUserNeed[] {
  const needs: TurnUserNeed[] = [];
  const add = (
    kind: TurnUserNeedKind,
    targetRef: string,
    evidence: string,
    priority: 'must' | 'supporting',
    expectedResponse: TurnExpectedResponse
  ) => {
    needs.push({
      id: `need_${needs.length + 1}`,
      kind,
      targetRef,
      evidence: evidence.slice(0, 120),
      priority,
      expectedResponse,
    });
  };

  if (options.closureSignal) {
    add('close', 'agent', options.currentQuery, 'must', 'natural_close');
  }
  if (options.corrections.length) {
    add(
      'correction',
      'agent',
      options.corrections[0].evidence,
      'must',
      'repair'
    );
  }
  if (options.boundarySignals.length) {
    add(
      'boundary',
      'agent',
      options.boundarySignals[0].evidence,
      'must',
      'boundary_answer'
    );
  }

  const careForRole = isUserCaringForRole(options.currentQuery);
  for (const question of options.questions) {
    if (!question.mustAnswer) {
      add('comfort', question.targetRef, question.text, 'must', 'comfort');
      continue;
    }
    add(
      careForRole ? 'care_for_role' : 'fact_question',
      question.targetRef,
      question.text,
      'must',
      careForRole ? 'direct_answer_and_receive_care' : 'direct_answer'
    );
  }

  if (careForRole && !needs.some(need => need.kind === 'care_for_role')) {
    add(
      'care_for_role',
      'agent',
      options.currentQuery,
      'must',
      'direct_answer_and_receive_care'
    );
  }

  for (const intent of options.intents) {
    const mapped = mapIntentToNeed(intent, careForRole);
    if (!mapped) {
      continue;
    }
    add(
      mapped.kind,
      resolveIntentTargetRef(intent, options.objectPlan),
      options.currentQuery,
      mapped.priority,
      mapped.expectedResponse
    );
  }

  if (options.activeSpeechRequest) {
    add(
      'active_speech',
      'agent',
      options.currentQuery,
      'must',
      'role_contribution'
    );
  }
  if (RELATIONSHIP_REPAIR_PATTERN.test(options.currentQuery)) {
    add(
      'relationship_repair',
      'agent',
      matchEvidence(options.currentQuery, RELATIONSHIP_REPAIR_PATTERN),
      'must',
      'repair'
    );
  }
  if (!needs.length) {
    add(
      'smalltalk',
      'agent',
      options.currentQuery,
      'supporting',
      'ordinary_response'
    );
  }

  return dedupeBy(
    needs,
    need => `${need.kind}:${need.targetRef}:${need.expectedResponse}`
  )
    .sort((left, right) =>
      left.priority === right.priority ? 0 : left.priority === 'must' ? -1 : 1
    )
    .slice(0, 6)
    .map((need, index) => ({ ...need, id: `need_${index + 1}` }));
}

function resolveEmotions(
  currentQuery: string,
  intent: StructuredReplyIntent | undefined,
  needs: TurnUserNeed[]
): TurnTargetedEmotion[] {
  const labels = new Set<ReplyIntentEmotion>();
  if (intent?.emotion && !['neutral', 'unknown'].includes(intent.emotion)) {
    labels.add(intent.emotion);
  }
  if (/想你|想您|好想|舍不得|挂念/.test(currentQuery)) {
    labels.add('longing');
  }
  if (isUserCaringForRole(currentQuery)) {
    labels.add('concern');
  }
  if (/对不起|后悔|怪我|是我不好|愧疚/.test(currentQuery)) {
    labels.add('guilt');
  }
  if (/生气|恨|凭什么|讨厌|怨/.test(currentQuery)) {
    labels.add('anger');
  }
  if (/难过|哭|心疼|痛苦|撑不住|受不了/.test(currentQuery)) {
    labels.add('sadness');
  }

  return Array.from(labels)
    .slice(0, 4)
    .map(label => ({
      label,
      targetRef: resolveEmotionTarget(needs),
      source: currentQuery.slice(0, 120),
      intensity: resolveEmotionIntensity(currentQuery),
      function: resolveEmotionFunction(label, needs),
    }));
}

function mapIntentToNeed(
  intent: StructuredReplyIntentItem,
  careForRole: boolean
):
  | {
      kind: TurnUserNeedKind;
      priority: 'must' | 'supporting';
      expectedResponse: TurnExpectedResponse;
    }
  | undefined {
  switch (intent.intent) {
    case 'express_longing':
    case 'seek_dream_connection':
    case 'express_keepsake_attachment':
      return {
        kind: 'longing',
        priority: 'must',
        expectedResponse: 'relationship_response',
      };
    case 'ask_agent_status':
      return {
        kind: careForRole ? 'care_for_role' : 'fact_question',
        priority: 'must',
        expectedResponse: careForRole
          ? 'direct_answer_and_receive_care'
          : 'direct_answer',
      };
    case 'correct_assistant':
      return {
        kind: 'correction',
        priority: 'must',
        expectedResponse: 'repair',
      };
    case 'challenge_authenticity':
    case 'challenge_source':
      return {
        kind: 'relationship_repair',
        priority: 'must',
        expectedResponse: 'repair',
      };
    case 'recall_memory':
    case 'ask_identity':
    case 'question_departure':
    case 'question_reincarnation':
      return {
        kind: 'fact_question',
        priority: 'must',
        expectedResponse:
          intent.intent === 'question_departure' ? 'comfort' : 'direct_answer',
      };
    case 'verify_presence':
    case 'ask_platform_support':
      return {
        kind: 'boundary',
        priority: 'must',
        expectedResponse: 'boundary_answer',
      };
    case 'share_family_update':
    case 'express_family_care_regret':
    case 'challenge_family_care':
      return {
        kind: 'family_update',
        priority: 'supporting',
        expectedResponse: 'family_response',
      };
    case 'share_user_update':
    case 'share_significant_matter':
      return {
        kind: 'user_update',
        priority: 'supporting',
        expectedResponse: 'ordinary_response',
      };
    case 'seek_comfort':
    case 'express_guilt':
    case 'express_hatred':
    case 'regret_unfinished_devotion':
    case 'grieve_unfinished_promise':
      return {
        kind: 'comfort',
        priority: 'must',
        expectedResponse: 'comfort',
      };
    case 'smalltalk':
      return {
        kind: 'smalltalk',
        priority: 'supporting',
        expectedResponse: 'ordinary_response',
      };
    default:
      return undefined;
  }
}

function resolveIntentTargetRef(
  intent?: StructuredReplyIntentItem,
  objectPlan?: ConversationObjectPlan
): string {
  if (!intent) {
    return 'agent';
  }
  if (intent.target === 'agent' || intent.target === 'relationship') {
    return 'agent';
  }
  if (intent.target === 'user') {
    return 'user';
  }
  if (intent.target === 'family') {
    return (
      objectPlan?.focusRefs.find(ref =>
        objectPlan.objects.some(
          object => object.ref === ref && object.kind === 'family'
        )
      ) ||
      objectPlan?.objects.find(object => object.kind === 'family')?.ref ||
      'unknown'
    );
  }
  return 'unknown';
}

function isQuestionIntent(intent: StructuredReplyIntentItem): boolean {
  return [
    'ask_agent_status',
    'ask_identity',
    'recall_memory',
    'question_departure',
    'question_reincarnation',
    'verify_presence',
    'challenge_source',
    'ask_platform_support',
  ].includes(intent.intent);
}

function classifyQuestionType(
  text: string,
  intents: StructuredReplyIntentItem[]
): TurnQuestionType {
  if (
    EMOTIONAL_WHY_PATTERN.test(text) &&
    (intents.some(intent => EMOTIONAL_QUESTION_INTENTS.has(intent.intent)) ||
      /(?:离开|走了|抛下|不要我|好人没好报|老天|命|这么狠|带走)/.test(text))
  ) {
    return 'emotional_rhetorical';
  }
  if (MEMORY_QUESTION_PATTERN.test(text)) {
    return 'memory';
  }
  if (
    detectReplyRealityDependencies(text).length ||
    intents.some(intent =>
      ['verify_presence', 'ask_platform_support'].includes(intent.intent)
    )
  ) {
    return 'boundary';
  }
  return 'fact';
}

function resolveEmotionTarget(needs: TurnUserNeed[]): string {
  return (
    needs.find(need => need.kind === 'care_for_role')?.targetRef ||
    needs.find(need => need.kind === 'family_update')?.targetRef ||
    needs[0]?.targetRef ||
    'agent'
  );
}

function resolveEmotionIntensity(
  currentQuery: string
): 'low' | 'medium' | 'high' {
  if (/特别|太|非常|真的|一直|受不了|撑不住|恨死|哭/.test(currentQuery)) {
    return 'high';
  }
  return /想|担心|心疼|难过|后悔|生气|害怕/.test(currentQuery)
    ? 'medium'
    : 'low';
}

function resolveEmotionFunction(
  label: ReplyIntentEmotion,
  needs: TurnUserNeed[]
): TurnTargetedEmotion['function'] {
  if (needs.some(need => need.kind === 'relationship_repair')) {
    return 'repairing_relationship';
  }
  if (needs.some(need => need.kind === 'fact_question')) {
    return 'seeking_answer';
  }
  if (needs.some(need => need.kind === 'care_for_role')) {
    return 'seeking_reassurance';
  }
  if (label === 'longing' || label === 'attachment') {
    return 'seeking_closeness';
  }
  return 'sharing';
}

function parseActor(
  value: unknown,
  currentQuery: string,
  allowedActorRefs: Set<string>,
  allowedBindings: Set<string>
): TurnUnderstandingActor | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const ref = readText(item.ref, 40);
  const mention = readText(item.mention, 30);
  const kind = readEnum(item.kind, CONVERSATION_OBJECT_KINDS);
  const binding = readText(item.binding, 120);
  const confidence = readEnum(item.confidence, CONVERSATION_OBJECT_CONFIDENCES);
  if (
    !ref ||
    !allowedActorRefs.has(ref) ||
    !mention ||
    !currentQuery.includes(mention) ||
    !kind ||
    !binding ||
    !allowedBindings.has(binding) ||
    !confidence
  ) {
    return undefined;
  }
  return { ref, mention, kind, binding, confidence };
}

function parseNeed(
  value: unknown,
  currentQuery: string,
  allowedActorRefs: Set<string>
): TurnUserNeed | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const id = readText(item.id, 30);
  const kind = readEnum(item.kind, TURN_USER_NEED_KINDS);
  const targetRef = readText(item.targetRef, 40);
  const evidence = readText(item.evidence, 120);
  const priority = readEnum(item.priority, ['must', 'supporting'] as const);
  const expectedResponse = readEnum(
    item.expectedResponse,
    TURN_EXPECTED_RESPONSES
  );
  if (
    !id ||
    !kind ||
    !targetRef ||
    !allowedActorRefs.has(targetRef) ||
    !evidence ||
    !currentQuery.includes(evidence) ||
    !priority ||
    !expectedResponse
  ) {
    return undefined;
  }
  return { id, kind, targetRef, evidence, priority, expectedResponse };
}

function parseEmotion(
  value: unknown,
  currentQuery: string,
  allowedActorRefs: Set<string>
): TurnTargetedEmotion | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const label = readEnum(item.label, REPLY_INTENT_EMOTIONS);
  const targetRef = readText(item.targetRef, 40);
  const source = readText(item.source, 120);
  const intensity = readEnum(item.intensity, [
    'low',
    'medium',
    'high',
  ] as const);
  const emotionFunction = readEnum(item.function, [
    'sharing',
    'seeking_reassurance',
    'seeking_answer',
    'seeking_closeness',
    'repairing_relationship',
    'other',
  ] as const);
  if (
    !label ||
    !targetRef ||
    !allowedActorRefs.has(targetRef) ||
    !source ||
    !currentQuery.includes(source) ||
    !intensity ||
    !emotionFunction
  ) {
    return undefined;
  }
  return {
    label,
    targetRef,
    source,
    intensity,
    function: emotionFunction,
  };
}

function parseQuestion(
  value: unknown,
  currentQuery: string,
  allowedActorRefs: Set<string>
): TurnQuestionObligation | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const id = readText(item.id, 30);
  const text = readText(item.text, 120);
  const targetRef = readText(item.targetRef, 40);
  const type = readEnum(item.type, [
    'fact',
    'memory',
    'emotional_rhetorical',
    'boundary',
  ] as const);
  const evidenceRequirement = readEnum(item.evidenceRequirement, [
    'none',
    'grounded',
    'uncertain_answer',
  ] as const);
  if (
    !id ||
    !text ||
    !currentQuery.includes(text) ||
    !targetRef ||
    !allowedActorRefs.has(targetRef) ||
    !type ||
    typeof item.mustAnswer !== 'boolean' ||
    !evidenceRequirement
  ) {
    return undefined;
  }
  return {
    id,
    text,
    targetRef,
    type,
    mustAnswer: item.mustAnswer,
    evidenceRequirement,
  };
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function matchEvidence(value: string, pattern: RegExp): string {
  pattern.lastIndex = 0;
  return value.match(pattern)?.[0]?.trim().slice(0, 120) || value.slice(0, 120);
}

function normalizeText(value: string): string {
  return value.replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()[\]【】~～]/gu, '');
}

function dedupeBy<T>(values: T[], keyOf: (value: T) => string): T[] {
  return Array.from(
    new Map(values.map(value => [keyOf(value), value] as const)).values()
  );
}
