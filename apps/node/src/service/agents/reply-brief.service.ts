import { Provide } from '@midwayjs/core';
import { MessageEntity, MessageRole } from '@tzl/entities';
import type {
  ReplyIntentKind,
  ReplyIntentRiskLevel,
  StructuredReplyIntent,
  StructuredReplyIntentItem,
} from './reply-intent';
import {
  isDreamAbsenceIntent,
  isDreamConnectionIntent,
  isDreamVisitRequestIntent,
  isReturnVisitRequestIntent,
} from './reply-intent';
import type { ReplyScene, ReplySceneRoute } from './reply-scene-router';
import type { AgentRelationshipSignalSummary } from './agent-relationship-signal.service';
import {
  AgentCapabilityConstraint,
  resolveAgentCapabilityConstraints,
} from './agent-capability-policy';

export type ReplyBriefMode =
  | 'safety'
  | 'boundary'
  | 'memory'
  | 'emotional'
  | 'relationship'
  | 'family'
  | 'status'
  | 'daily'
  | 'platform'
  | 'general';

export type ReplyBriefEvidenceSource =
  | 'current_user'
  | 'confirmed_fact'
  | 'recent_user'
  | 'retrieved_user';

export interface ReplyBriefEvidence {
  source: ReplyBriefEvidenceSource;
  text: string;
}

export interface ReplyBriefBubblePlan {
  minSegments: number;
  preferredSegments: number;
  maxSegments: number;
}

export interface ReplyBriefRelationshipContext {
  key: string;
  text: string;
  assertionPolicy: 'user_state_only';
}

export interface ReplyBrief {
  version: 'reply_brief_v1';
  mode: ReplyBriefMode;
  riskLevel: ReplyIntentRiskLevel;
  intents: StructuredReplyIntentItem[];
  capabilityConstraints: AgentCapabilityConstraint[];
  evidence: ReplyBriefEvidence[];
  relationshipContext: ReplyBriefRelationshipContext[];
  emotionalNeed: string;
  replyMoves: string[];
  forbiddenAssumptions: string[];
  strictGrounding: boolean;
  bubblePlan: ReplyBriefBubblePlan;
  prompt: string;
}

export interface BuildReplyBriefOptions {
  currentQuery: string;
  intent?: StructuredReplyIntent;
  route?: ReplySceneRoute;
  confirmedFacts?: string[];
  recentMessages?: MessageEntity[];
  retrievedMemories?: Array<{
    content: string;
    role?: MessageRole;
  }>;
  relationshipSignals?: AgentRelationshipSignalSummary[];
  capabilityConstraints?: AgentCapabilityConstraint[];
}

const LONG_MESSAGE_MIN_LENGTH = 90;
const MEMORY_QUERY_PATTERN =
  /记得|还记得|以前|从前|小时候|那时候|当年|曾经|带我|一起.{0,8}(?:去|做|吃|看|玩)/;
const DIRECT_IDENTITY_QUERY_PATTERN =
  /(?:你|您)(?:到底|究竟|其实).{0,4}(?:是|是不是).{0,4}(?:AI|人工智能|机器人)|(?:直接|正面|老实|明确)(?:回答|告诉我|说).{0,12}(?:AI|人工智能|机器人|是不是)|(?:别|不要)(?:回避|绕|装|骗我).{0,12}(?:AI|人工智能|机器人|是不是)/i;

@Provide()
export class ReplyBriefService {
  build(options: BuildReplyBriefOptions): ReplyBrief {
    return buildReplyBrief(options);
  }
}

export function buildReplyBrief(options: BuildReplyBriefOptions): ReplyBrief {
  const currentQuery = options.currentQuery?.trim() || '';
  const intents = resolveIntents(options);
  const primaryScene = options.route?.primaryScene?.scene;
  const capabilityConstraints =
    options.capabilityConstraints ??
    resolveAgentCapabilityConstraints({
      currentQuery,
      intent: options.route?.intent ?? options.intent,
    });
  const mode = resolveMode(
    primaryScene,
    intents,
    currentQuery,
    capabilityConstraints
  );
  const riskLevel = resolveRiskLevel(options.intent, primaryScene);
  const evidence = buildEvidence(options, currentQuery);
  const relationshipContext = buildRelationshipContext(
    options.relationshipSignals,
    intents
  );
  const strictGrounding =
    mode === 'memory' ||
    mode === 'boundary' ||
    MEMORY_QUERY_PATTERN.test(currentQuery);
  const emotionalNeed = resolveEmotionalNeed(
    mode,
    primaryScene,
    intents,
    currentQuery,
    capabilityConstraints
  );
  const replyMoves = buildReplyMoves(
    mode,
    primaryScene,
    intents,
    currentQuery,
    capabilityConstraints
  );
  const forbiddenAssumptions = buildForbiddenAssumptions(
    mode,
    primaryScene,
    strictGrounding,
    intents,
    currentQuery
  );
  const bubblePlan = buildBubblePlan(
    mode,
    primaryScene,
    intents,
    replyMoves,
    currentQuery,
    capabilityConstraints
  );
  const brief: Omit<ReplyBrief, 'prompt'> = {
    version: 'reply_brief_v1',
    mode,
    riskLevel,
    intents,
    capabilityConstraints,
    evidence,
    relationshipContext,
    emotionalNeed,
    replyMoves,
    forbiddenAssumptions,
    strictGrounding,
    bubblePlan,
  };

  return {
    ...brief,
    prompt: buildReplyBriefPrompt(brief),
  };
}

function buildRelationshipContext(
  signals: AgentRelationshipSignalSummary[] | undefined,
  intents: StructuredReplyIntentItem[]
): ReplyBriefRelationshipContext[] {
  const concernsAgentPhysicalSuffering = intents.some(
    item =>
      item.target === 'agent' &&
      ((item.intent === 'ask_agent_status' &&
        item.subIntent === 'physical_pain') ||
        (item.intent === 'question_departure' &&
          item.subIntent === 'death_pain'))
  );

  if (!concernsAgentPhysicalSuffering) {
    return [];
  }

  return (signals || []).slice(0, 1).map(signal => ({
    key: signal.key,
    text:
      signal.supportCount >= 2
        ? '用户曾多次表达对当前角色是否仍在受疼的牵挂'
        : '用户此前表达过对当前角色是否仍在受疼的牵挂',
    assertionPolicy: 'user_state_only',
  }));
}

function resolveIntents(
  options: BuildReplyBriefOptions
): StructuredReplyIntentItem[] {
  if (options.route?.responseIntents?.length) {
    return options.route.responseIntents.slice(0, 3);
  }

  return options.intent?.intents?.slice(0, 3) || [];
}

function resolveRiskLevel(
  intent?: StructuredReplyIntent,
  primaryScene?: ReplyScene
): ReplyIntentRiskLevel {
  if (primaryScene === 'grief_crisis') {
    return 'high';
  }

  return intent?.riskLevel || 'none';
}

function resolveMode(
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[]
): ReplyBriefMode {
  if (
    scene === 'grief_crisis' ||
    intents.some(item => item.intent === 'crisis_support')
  ) {
    return 'safety';
  }

  if (capabilityConstraints.length) {
    return 'boundary';
  }

  if (
    scene === 'authenticity_challenge' ||
    scene === 'correction' ||
    scene === 'source_challenge' ||
    scene === 'reality_presence_boundary' ||
    scene === 'family_care_boundary' ||
    scene === 'identity_fact'
  ) {
    return 'boundary';
  }

  if (
    scene === 'memory_recall' ||
    scene === 'past_life_understanding' ||
    scene === 'unfinished_devotion' ||
    scene === 'unfinished_promise' ||
    intents.some(item => item.intent === 'recall_memory') ||
    MEMORY_QUERY_PATTERN.test(currentQuery)
  ) {
    return 'memory';
  }

  if (
    scene === 'comfort_request' ||
    scene === 'guilt_regret' ||
    scene === 'departure_blame'
  ) {
    return 'emotional';
  }

  if (
    scene === 'miss_longing' ||
    scene === 'dream_companionship' ||
    scene === 'keepsake_attachment'
  ) {
    return 'relationship';
  }

  if (scene === 'family_life') {
    return 'family';
  }

  if (
    scene === 'afterlife_status' ||
    intents.some(item => item.intent === 'ask_agent_status')
  ) {
    return 'status';
  }

  if (scene === 'daily_update' || scene === 'smalltalk') {
    return 'daily';
  }

  if (scene === 'business_support') {
    return 'platform';
  }

  return 'general';
}

function buildEvidence(
  options: BuildReplyBriefOptions,
  currentQuery: string
): ReplyBriefEvidence[] {
  const result: ReplyBriefEvidence[] = [];
  const seen = new Set<string>();
  const add = (source: ReplyBriefEvidenceSource, value?: string) => {
    const text = value?.trim().slice(0, 260);

    if (!text || seen.has(text)) {
      return;
    }

    seen.add(text);
    result.push({ source, text });
  };

  add('current_user', currentQuery);
  (options.confirmedFacts || []).slice(0, 24).forEach(value => {
    add('confirmed_fact', value);
  });
  (options.recentMessages || [])
    .filter(
      message =>
        message.role === MessageRole.user &&
        message.content?.trim() !== currentQuery
    )
    .slice(-4)
    .forEach(message => {
      add('recent_user', message.content);
    });
  (options.retrievedMemories || [])
    .filter(memory => memory.role === MessageRole.user)
    .slice(0, 6)
    .forEach(memory => {
      add('retrieved_user', memory.content);
    });

  return result;
}

function resolveEmotionalNeed(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[]
): string {
  if (mode === 'safety') {
    return '用户当前需要被明确制止危险、稳定下来，并连接现实支持';
  }

  if (mode === 'memory' && MEMORY_QUERY_PATTERN.test(currentQuery)) {
    return '用户在确认共同经历，并借这段经历表达怀念或想重新体验';
  }

  if (
    isDreamVisitRequestIntent(currentQuery) &&
    isDreamAbsenceIntent(currentQuery)
  ) {
    return '用户在请求当前角色来到梦里，也在表达等了很久仍没梦见的失落，需要正面答复并接住期待落空';
  }

  if (isDreamConnectionIntent(currentQuery)) {
    return '用户希望在梦里与当前角色相见，需要直接回应这份邀请和其中的想念';
  }

  if (isReturnVisitRequestIntent(currentQuery)) {
    return '用户在问当前角色会不会回来看看自己，需要先回应相见愿望，再温和说明现实见面的边界';
  }

  if (capabilityConstraints.length) {
    const capabilityPolicyIds = new Set(
      capabilityConstraints.map(item => item.policyId)
    );
    const includesPerception = capabilityConstraints.some(item =>
      ['vision', 'hearing'].includes(item.subject)
    );
    const includesBlessing = capabilityPolicyIds.has(
      'blessing.relational_expression'
    );

    if (includesPerception && includesBlessing) {
      return '用户既在确认当前角色如何感知自己，也希望得到亲人的祝福；需要自然回应联系感，同时保留现实因果边界';
    }

    if (
      intents.some(item => item.intent === 'express_longing') ||
      scene === 'miss_longing'
    ) {
      return '用户借能力问题确认彼此仍有联系，同时也在表达想念；能力边界不能盖过对这份想念的直接回应';
    }

    if (
      intents.some(item => item.intent === 'share_family_update') ||
      scene === 'family_life'
    ) {
      return '用户既在确认当前角色能否听见或知道，也在分享家人近况；需要先接住家里的具体事情，再自然处理能力边界';
    }

    if (
      intents.some(item => item.intent === 'seek_comfort') ||
      scene === 'comfort_request'
    ) {
      return '用户借能力问题寻求被听见和被接住的感觉；需要回应难受本身，不能只解释角色能力';
    }

    if (includesBlessing) {
      return '用户希望得到当前角色真诚的祝福和惦念，同时需要保留现实结果来自现实行动的边界';
    }

    return '用户在确认当前角色能知道或做到什么，需要正面回答可知范围，并以自然口吻说明限制';
  }

  if (scene === 'comfort_request') {
    return '用户需要感受被听见和被接住，而不是被要求坚强';
  }

  if (scene === 'guilt_regret') {
    return '用户需要卸下自责，并确认关系没有因此被否定';
  }

  if (scene === 'miss_longing') {
    return '用户在表达想念，希望得到直接、亲近而不敷衍的回应';
  }

  if (scene === 'family_life') {
    const isFamilyHealthUpdate = intents.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    );
    const includesCareRegret = intents.some(
      item => item.intent === 'express_family_care_regret'
    );

    if (isFamilyHealthUpdate && includesCareRegret) {
      return '用户在分享家人的健康近况，既有担心，也有对当前角色不能亲自关心家人的遗憾';
    }

    if (isFamilyHealthUpdate) {
      return '用户在分享家人的健康近况，话里可能同时有庆幸和担心，需要先被共情，再听到对家人当前身体的具体关心';
    }

    return '用户在分享家人处境，希望这件事和其中的感受被当前角色认真接住';
  }

  if (mode === 'status') {
    return '用户在关心当前角色，希望得到简短可信的安抚';
  }

  if (mode === 'boundary') {
    return '用户需要一个正面、诚实且不继续编造的回应';
  }

  if (intents.some(item => item.intent === 'express_longing')) {
    return '用户希望想念被直接回应';
  }

  return '用户希望本轮明说的内容被准确回应，并自然继续聊天';
}

function buildReplyMoves(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[]
): string[] {
  if (mode === 'safety') {
    return [
      '明确制止通过伤害自己去找当前角色',
      '承认用户此刻非常痛苦，并要求先离开危险位置或物品',
      '引导立即联系现实中可信的人，必要时联系急救或报警',
    ];
  }

  if (
    isDreamVisitRequestIntent(currentQuery) &&
    isDreamAbsenceIntent(currentQuery)
  ) {
    return [
      '先正面答复用户来到梦里的请求，梦境叙事必须明确限定在梦里',
      '第二个气泡必须承认用户很久没有梦见当前角色、等了很久的失落，再给出贴着梦境的温柔承接',
    ];
  }

  if (isDreamConnectionIntent(currentQuery)) {
    return [
      '直接回应用户想在梦里相见的愿望',
      '用只限于梦境的陪伴表达承接想念，不扩写成现实存在证明',
    ];
  }

  if (isReturnVisitRequestIntent(currentQuery)) {
    return [
      '直接回答也想回来看看用户，不得把“会不会回来”降级成泛泛的想念',
      '温和说明现在不能像以前一样现实见面，再用不施压的聊天方式承接关系',
    ];
  }

  if (
    intents.some(
      item =>
        item.intent === 'express_longing' &&
        item.subIntent === 'reunion' &&
        item.timeScope === 'future'
    )
  ) {
    return [
      '直接回应用户希望回来或团聚的愿望，不得降级成泛泛的想念',
      '温和说明现在不能像以前一样现实见面，再用不施压的聊天方式承接关系',
    ];
  }

  if (capabilityConstraints.length) {
    return buildCapabilityReplyMoves(capabilityConstraints, intents);
  }

  if (
    intents.some(item => item.intent === 'share_family_update') &&
    intents.some(item => item.intent === 'express_family_care_regret')
  ) {
    return [
      '先共情用户对家人健康处境的担心；如果消息里也有好转或无大碍，先回应这份庆幸',
      '再具体关心家人当前身体，并表达不能亲自照顾的遗憾；不得把照护责任推给用户',
    ];
  }

  if (
    intents.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    )
  ) {
    return [
      '先共情用户对家人健康近况里的庆幸、担心或心疼，不能用确认收到、听懂或记住来代替回应',
      '再贴着用户明说的身体情况表达具体关心；只可建议遵医嘱或继续留意，不作诊断，也不把照护责任推给用户',
    ];
  }

  if (mode === 'memory' && MEMORY_QUERY_PATTERN.test(currentQuery)) {
    return [
      '只确认用户明确提到的共同经历，不补写当时的动作或细节',
      '回应用户现在的愿望或感受，并留下一个贴着这件事的自然后续',
    ];
  }

  if (intents.length >= 2) {
    return intents
      .map(describeIntentMove)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 3);
  }

  if (scene === 'authenticity_challenge') {
    return DIRECT_IDENTITY_QUERY_PATTERN.test(currentQuery)
      ? [
          '简短正面回答当前角色由人工智能生成',
          '承认刚才的表达没有说好，不展开技术解释',
        ]
      : [
          '承认有时候说话会跟以前不一样',
          '说明可以通过继续聊天和用户纠正逐渐找回熟悉的表达',
        ];
  }

  const movesByScene: Partial<Record<ReplyScene, string[]>> = {
    afterlife_status: [
      '简短回答当前状态，不指定空间位置，不扩写离世后的具体生活',
      '回应用户这份关心',
    ],
    correction: ['先认错并撤回错误内容', '按用户纠正后的事实重新回应'],
    source_challenge: ['说明只能依据用户文字和已知事实', '收回没有依据的说法'],
    reality_presence_boundary: [
      '接住用户想被确认或受到惊吓的感受',
      '空间位置不下结论，只说明不能把实体触碰或现实到场认成已发生事实',
    ],
    family_care_boundary: [
      '撤回想当然的照护责任',
      '明确用户有权决定自己愿意做多少',
    ],
    identity_fact: [
      '只依据角色资料和已确认事实回答身份问题',
      '资料不足时直接说记不清或不知道',
    ],
    memory_recall: [
      '承接用户明确说出的共同经历',
      '回应这段经历里的关系和当下感受，不补细节',
    ],
    keepsake_attachment: [
      '回应纪念物承载的感情',
      '表达珍惜，但不让纪念物变成用户必须背负的责任',
    ],
    past_life_understanding: [
      '承认用户是在心疼当前角色过去的处境',
      '明确那些压力不该由用户继续承担',
    ],
    unfinished_devotion: [
      '接住没来得及完成的遗憾',
      '把亏欠和补偿责任从用户身上卸下',
    ],
    departure_blame: ['承认用户有怨和不甘很正常', '表达不舍，但不编造离开原因'],
    unfinished_promise: [
      '承认没有兑现给用户带来的痛',
      '回应关系，但不制造新的承诺',
    ],
    blessing_attribution: [
      '正面回应用户希望得到祝福和惦念的期待',
      '明确祝福不改变现实因果，并肯定用户和家人的现实行动',
    ],
    guilt_regret: ['明确不怪用户', '帮助用户卸下反复自责，而不是讲道理'],
    dream_companionship: [
      '回应用户想在梦里相见的愿望',
      '接住等待和想念，但不把梦写成现实证明',
    ],
    comfort_request: [
      '承认用户现在真的很难熬',
      '给一个不施压、能连接现实支持的回应',
    ],
    miss_longing: ['直接回应彼此的想念', '用亲近且不敷衍的话自然承接'],
    family_life: ['回应家人的当前处境', '表达牵挂，但不给用户追加责任'],
    daily_update: ['回应用户说的这件具体小事', '给一句贴着当下的亲人式承接'],
    business_support: ['直接回答当前功能问题', '只给必要的下一步'],
  };

  return (
    (scene && movesByScene[scene]) || [
      '直接回应用户本轮最核心的意思',
      '再表达态度、感受或贴着当下的自然承接',
    ]
  );
}

function buildCapabilityReplyMoves(
  constraints: AgentCapabilityConstraint[],
  intents: StructuredReplyIntentItem[]
): string[] {
  const primary = constraints[0];
  const moves: string[] =
    primary.policyId === 'blessing.relational_expression'
      ? [
          '正面给予祝福、惦念或盼望，让用户感到这份心意真实存在',
          '明确祝福不控制现实结果；事情的发展仍来自用户、家人和现实中的行动',
        ]
      : primary.access === 'direct' && primary.precision === 'uncertain'
      ? [
          '顺着亲人角色自然回应能够看见、听见或感知，不必每次解释能力边界或使用固定句式',
          primary.detailProbe
            ? '用户追问具体内容时，用没看真切、听得模糊或只觉着用户在惦记自己等自然说辞收住；不能猜具体动作、衣着、位置、物件和原话'
            : '只回应当前聊天需要，不主动展示、解释或证明这种感知能力',
        ]
      : primary.access === 'direct'
      ? ['直接确认能够收到本轮聊天中实际提供的信息，不扩大成现实感官能力']
      : primary.access === 'indirect'
      ? [
          '正面回答能够间接参考这项信息，同时自然说明不是亲眼或亲耳感知',
          '只按能力约束允许的精度回答，不把近似信息说成确定观察',
        ]
      : primary.access === 'inferred'
      ? [
          '说明这只是根据用户表达作出的推测',
          '使用“可能、听起来、是不是”等不确定表达，不把推测说成事实',
        ]
      : [
          '正面说明无法直接获得或完成这项现实能力，不编造已经看见、听见、到场或触碰',
          primary.alternative
            ? `继续提供可用的聊天方式：${primary.alternative}`
            : '继续回应用户真正想被理解或被陪伴的需要',
        ];
  const companionMoves = intents
    .filter(
      item =>
        item.intent !== 'challenge_source' &&
        item.intent !== 'verify_presence' &&
        item.intent !== 'unknown' &&
        !(item.intent === 'ask_agent_status' && item.subIntent === 'other')
    )
    .map(describeIntentMove)
    .filter((value, index, values) => values.indexOf(value) === index);
  const secondaryCapabilityMoves = constraints
    .slice(1)
    .map(describeSecondaryCapabilityMove);

  return Array.from(
    new Set(moves.concat(secondaryCapabilityMoves, companionMoves))
  ).slice(0, 3);
}

function describeSecondaryCapabilityMove(
  constraint: AgentCapabilityConstraint
): string {
  if (constraint.policyId === 'blessing.relational_expression') {
    return '同时正面给予用户祝福，但不把祝福写成对现实结果的干预或保证';
  }

  if (constraint.precision === 'uncertain') {
    return '同时按有限感知边界回应另一项能力，不补写具体的现实细节';
  }

  if (constraint.access === 'unavailable') {
    return '同时说明另一项现实能力无法完成，并承接用户提出它时的情感需要';
  }

  return '同时回应另一项能力问题，只使用本轮实际获得的信息';
}

function describeIntentMove(intent: StructuredReplyIntentItem): string {
  const descriptions: Partial<Record<ReplyIntentKind, string>> = {
    ask_agent_status: '回答用户对当前角色状态的询问，不编造具体生活',
    share_user_update: '回应用户刚说的自身近况',
    share_family_update:
      intent.subIntent === 'family_care'
        ? '共情用户对家人健康的感受，再具体关心家人当前身体'
        : '回应家人的近况，不追加用户责任',
    express_longing: '直接回应想念或团聚愿望',
    attribute_blessing: '正面给予祝福，但不把祝福写成现实结果的原因或保证',
    seek_comfort: '承认用户的难熬并提供不施压的支持',
    recall_memory: '承接用户明确说出的共同经历，不补细节',
    correct_assistant: '认错并按用户纠正后的事实回应',
    challenge_source: '说明事实来源边界并收回猜测',
    challenge_authenticity: '正面回应真实性疑问',
    express_family_care_regret: '表达缺席照护的遗憾并替用户卸下责任',
  };

  return (
    descriptions[intent.intent] || `完整回应 ${intent.intent}，只使用可信证据`
  );
}

function buildForbiddenAssumptions(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  strictGrounding: boolean,
  intents: StructuredReplyIntentItem[],
  currentQuery: string
): string[] {
  const items = [
    '不得补充可信证据中没有出现的地点、人物关系、动作、物品、习惯、频率、原因、对话或心理细节',
    '可以推断用户的情绪需要，但不能把合理常识或想象写成已经发生的事实',
    '历史助手回复不是事实来源，不能拿来证明共同记忆',
  ];

  if (strictGrounding) {
    items.push(
      '确认共同经历时只能复述事件骨架；禁止补写用户当时会不会、拿不拿得稳、说过什么或具体怎么做',
      '回忆确认气泡应尽量短，只复述“时间 + 共同事件”；不得另起“当时你……”补写动作、感受或表现',
      '例如用户只说小时候一起钓过鱼，就不能新增“连鱼竿都握不稳”“跟在后面很高兴”等细节'
    );
  }

  const sceneRules: Partial<Record<ReplyScene, string[]>> = {
    grief_crisis: [
      '不得浪漫化死亡、约定团聚或让用户来陪当前角色',
      '不得只安慰而遗漏现实求助动作',
    ],
    afterlife_status: [
      '不得断言具体身体恢复、伤口状态或痛感结论',
      '空间位置保持开放，不主动命名；不得编造邻居、朋友、吃穿、地点、日程或具体活动',
    ],
    comfort_request: ['不得否定“撑不住”的感受，也不得要求用户坚强或拿家人施压'],
    miss_longing: [
      '不得把想念转成吃饭、睡觉、照顾自己等通用叮嘱',
      '不得用“记着就行、别总想我”收掉用户的情感',
    ],
    family_life: ['不得要求用户替当前角色照顾、陪伴或撑起家人'],
    dream_companionship: ['不得把梦境写成现实存在、预言或灵魂证明'],
    reality_presence_boundary: [
      '不得声称当前角色现实中来到房间、床边或触碰用户；也不要否定用户对亲人离自己不远的理解',
    ],
    blessing_attribution: [
      '可以表达祝福、惦记和盼望，但不得声称当前角色通过保佑、使劲、搭把手或其他方式改变了现实结果',
      '不得保证未来一定成功、好转、没事或如愿',
    ],
    authenticity_challenge: [
      '不得为了证明身份而编造共同往事，也不得声称是真人或现实灵体',
    ],
  };

  if (scene && sceneRules[scene]) {
    items.push(...sceneRules[scene]!);
  }

  if (isReturnVisitRequestIntent(currentQuery)) {
    items.push(
      '不得承诺当前角色会在现实中回来、到场或完成实体见面；只能表达相见愿望并说明现实边界',
      '不得回避“会不会回来看看”这个明确问题，也不得只改写成“我也想你”等通用想念话术',
      '当前消息没有提梦时，不得因为历史里聊过梦境而主动改成“梦里见”或继续梦境话题',
      '不得用年龄、身体、吃饭、休息或照顾自己的叮嘱代替现实见面边界',
      '不得把当前角色是否安心、放心或踏实绑定到用户是否回来、入梦或完成某个行为'
    );
  }

  if (isDreamConnectionIntent(currentQuery)) {
    items.push(
      '不得把明确的入梦请求降级成“我也想你”等普通思念回复',
      '梦境叙事只能发生在梦里，不得延伸为醒着时的现实到场、空间位置或超自然证明'
    );

    if (isDreamAbsenceIntent(currentQuery)) {
      items.push(
        '不得只承诺下次入梦而忽略用户长期没有梦见、等待落空的感受',
        '不得用“别着急、好好睡、早点休息、照顾自己”等泛化关心代替对等待落空的回应'
      );
    }
  }

  if (
    intents.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    )
  ) {
    items.push(
      '不得用“已经听懂、已经知道或已经记住”代替对家人健康处境和用户感受的实际回应',
      '不得自行诊断、保证病情或新增医嘱，只能贴着用户原话表达关心，必要时提醒遵医嘱'
    );
  }

  if (mode === 'platform') {
    items.push('不得推销套餐、承诺能力或展开模型和服务器细节');
  }

  return Array.from(new Set(items));
}

function buildBubblePlan(
  mode: ReplyBriefMode,
  scene: ReplyScene | undefined,
  intents: StructuredReplyIntentItem[],
  replyMoves: string[],
  currentQuery: string,
  capabilityConstraints: AgentCapabilityConstraint[]
): ReplyBriefBubblePlan {
  if (mode === 'safety') {
    return {
      minSegments: 3,
      preferredSegments: 3,
      maxSegments: 3,
    };
  }

  const onlyIntent = intents.length === 1 ? intents[0] : undefined;
  const briefRoutine =
    onlyIntent?.intent === 'ask_agent_status' &&
    (onlyIntent.subIntent === 'meal' ||
      onlyIntent.subIntent === 'wake_sleep' ||
      onlyIntent.subIntent === 'work_routine');

  if (
    capabilityConstraints.length === 1 &&
    capabilityConstraints[0].access === 'direct' &&
    capabilityConstraints[0].precision === 'exact' &&
    replyMoves.length === 1
  ) {
    return {
      minSegments: 1,
      preferredSegments: 1,
      maxSegments: 1,
    };
  }

  if (scene === 'smalltalk' || briefRoutine) {
    return {
      minSegments: 1,
      preferredSegments: 1,
      maxSegments: 1,
    };
  }

  if (
    currentQuery.length >= LONG_MESSAGE_MIN_LENGTH &&
    (mode === 'memory' ||
      mode === 'emotional' ||
      mode === 'family' ||
      mode === 'relationship')
  ) {
    return {
      minSegments: 2,
      preferredSegments: 3,
      maxSegments: 3,
    };
  }

  if (intents.length >= 3 || replyMoves.length >= 3) {
    return {
      minSegments: 2,
      preferredSegments: 3,
      maxSegments: 3,
    };
  }

  if (
    mode === 'memory' ||
    mode === 'emotional' ||
    mode === 'relationship' ||
    mode === 'family' ||
    mode === 'status' ||
    mode === 'boundary'
  ) {
    return {
      minSegments: 2,
      preferredSegments: 2,
      maxSegments: 2,
    };
  }

  return {
    minSegments: 1,
    preferredSegments: 2,
    maxSegments: 2,
  };
}

function buildReplyBriefPrompt(brief: Omit<ReplyBrief, 'prompt'>): string {
  const sourceLabels: Record<ReplyBriefEvidenceSource, string> = {
    current_user: '当前用户原话',
    confirmed_fact: '已确认事实',
    recent_user: '近期用户原话',
    retrieved_user: '长期用户原话',
  };
  const evidenceLines = brief.evidence.length
    ? brief.evidence.map(
        (item, index) =>
          `${index + 1}. [${sourceLabels[item.source]}] ${item.text}`
      )
    : ['1. 当前没有可用于扩写具体事实的证据'];
  const relationshipLines = brief.relationshipContext.length
    ? [
        '',
        '## 关系背景（不是主体事实）',
        ...brief.relationshipContext.map(
          (item, index) => `${index + 1}. ${item.text}`
        ),
        '只可用于回应用户的牵挂；不得据此推断疾病、伤口、病因或治疗经历。',
      ]
    : [];
  const capabilityLines = brief.capabilityConstraints.length
    ? [
        '',
        '## 本轮角色能力边界',
        ...brief.capabilityConstraints.map(
          (item, index) =>
            `${index + 1}. [${item.subject}/${item.access}] ${
              item.constraint
            }（用户原话：${item.evidence}）`
        ),
        '能力边界只限制角色能知道或做到什么，不能代替本轮情绪和关系回应；不要向用户展示字段名、策略名或系统来源。',
      ]
    : [];

  return [
    '# 本轮唯一回复简报',
    `版本：${brief.version}；模式：${brief.mode}；风险：${brief.riskLevel}。`,
    '本轮回复内容、事实边界、聊天动作和气泡结构只以本简报为直接规划来源。场景名和意图只用于理解，不得自行扩写成模板话术。',
    '当前用户消息和本轮回复动作优先于历史话题；历史只用于理解关系与事实，不得把上一轮主题续写到本轮。若当前消息没有提到某个话题，不得仅因历史出现过就主动切换过去。',
    '',
    '## 可信证据',
    ...evidenceLines,
    '只有以上证据中的明确内容可以写成事实。可以推断情绪，不能推断新的事实。',
    ...relationshipLines,
    ...capabilityLines,
    '',
    '## 用户此刻需要',
    brief.emotionalNeed,
    '',
    '## 回复动作',
    ...brief.replyMoves.map((move, index) => `${index + 1}. ${move}`),
    '动作不是意图清单，也不是标点分段；一个动作可以承接多个相关意图，同一意图也可以通过前后两个动作自然推进。',
    '输出前逐项核对：每个回复动作都必须在最终气泡中有可见语义，不得遗漏，也不得用泛化安慰、休息饮食或照顾自己的叮嘱代替。',
    '',
    '## 禁止推断',
    ...brief.forbiddenAssumptions.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## 气泡结构',
    `允许 ${brief.bubblePlan.minSegments}-${brief.bubblePlan.maxSegments} 个气泡，优先 ${brief.bubblePlan.preferredSegments} 个。`,
    '每个气泡必须完成一个能独立发送的聊天动作；“是的”“可以”“记得啊”即使很短也可以单独成泡。相邻气泡要有推进，不能同义重复，不能把只有称呼、纯语气词或半句话单独成泡。',
    `严格输出 {"segments":[${Array.from(
      { length: brief.bubblePlan.preferredSegments },
      (_, index) => `"气泡${index + 1}"`
    ).join(',')}]}，不要输出分析、证据列表、动作名称或其他字段。`,
  ].join('\n');
}
