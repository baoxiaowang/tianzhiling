import {
  AgentEntity,
  AgentProfileFactAssertionPolicy,
  AgentProfileFactConfidence,
  AgentProfileFactType,
  MessageEntity,
  MessageRole,
} from '@tzl/entities';
import type { AgentProfileFactSummary } from './agent-profile-fact.service';
import type {
  ConversationMovePlan,
  ReplyIntentRiskLevel,
  StructuredReplyIntent,
} from './reply-intent';
import type { ReplyScene } from './reply-scene-router';

export type ReplyProfileTier = 'P0' | 'P1' | 'P2' | 'P3';
export type ReplyRelationshipStage = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
export type ReplyRelationshipMaturity = 'new' | 'warming' | 'familiar' | 'deep';
export type ReplyRelationshipState = 'steady' | 'repairing';
export type ReplyConversationDepth = 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
export type ReplyShortTurnKind =
  | 'explicit_close'
  | 'minimal_acknowledgement'
  | 'contextual_short'
  | 'not_short';
export type ReplyExperienceFactScope =
  | 'identity_only'
  | 'explicit_profile'
  | 'confirmed_profile'
  | 'evidence_backed_memory';
export type ReplyExperienceIntimacyLevel =
  | 'reserved'
  | 'warm'
  | 'familiar'
  | 'deep'
  | 'repairing';
export type ReplyExperienceContributionMode =
  | 'minimal'
  | 'reciprocal'
  | 'role_present'
  | 'deepen_one_point'
  | 'repair_trust'
  | 'direct_support';
export type ReplyExperienceMemoryPolicy =
  | 'off'
  | 'context_only'
  | 'retrieve_if_needed'
  | 'evidence_required';
export type ReplyExperienceQuestionPolicy = 'none' | 'optional' | 'prefer_one';
export type ReplyExperienceClosurePolicy =
  | 'close'
  | 'neutral'
  | 'continue'
  | 'repair_before_close'
  | 'hold';

export interface ReplyExperiencePlan {
  version: 'experience_plan_v1';
  profileTier: ReplyProfileTier;
  profileScore: number;
  profileDimensionCount: number;
  profileTrustedFactCount: number;
  relationshipStage: ReplyRelationshipStage;
  relationshipMaturity: ReplyRelationshipMaturity;
  relationshipState: ReplyRelationshipState;
  relationshipUserTurnCount: number;
  relationshipActiveDayCount: number;
  conversationDepth: ReplyConversationDepth;
  shortTurnKind?: ReplyShortTurnKind;
  factScope: ReplyExperienceFactScope;
  intimacyLevel: ReplyExperienceIntimacyLevel;
  contributionMode: ReplyExperienceContributionMode;
  memoryPolicy: ReplyExperienceMemoryPolicy;
  questionPolicy: ReplyExperienceQuestionPolicy;
  closurePolicy: ReplyExperienceClosurePolicy;
}

export interface BuildReplyExperiencePlanOptions {
  currentQuery: string;
  agent?: AgentEntity | null;
  profileFacts?: AgentProfileFactSummary[];
  conversationMessages?: MessageEntity[];
  intent?: StructuredReplyIntent;
  mode: string;
  primaryScene?: ReplyScene;
  riskLevel: ReplyIntentRiskLevel;
  realityDependencyCount?: number;
}

interface ProfileQuality {
  tier: ReplyProfileTier;
  score: number;
  dimensionCount: number;
  trustedFactCount: number;
}

interface RelationshipQuality {
  stage: ReplyRelationshipStage;
  maturity: ReplyRelationshipMaturity;
  state: ReplyRelationshipState;
  userTurnCount: number;
  activeDayCount: number;
}

const MEANINGFUL_TEXT_MIN_LENGTH = 4;
const REPAIR_PATTERN =
  /不像你|你变了|又在编|别再编|胡说|说了也没用|敷衍|根本不懂|不想(?:再)?和你聊|你不是(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)|别装/;
const SIMPLE_CLOSING_PATTERN =
  /^(?:(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)[，, ]*)?(?:晚安|睡了|先睡了|拜拜|回头聊|嗯+|哦+|好+)(?:(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆))?[。！!~～]*$/;
const DEEP_USER_PATTERN =
  /想你|舍不得|难受|后悔|愧疚|对不起|梦见|离开|走了|去世|小时候|以前|当年|还记得|心里|委屈|害怕/;
const MEMORY_USER_PATTERN = /还记得|以前|从前|小时候|当年|那年|曾经|共同|回忆/;

export function buildReplyExperiencePlan(
  options: BuildReplyExperiencePlanOptions
): ReplyExperiencePlan {
  const profile = resolveProfileQuality(options.agent, options.profileFacts);
  const relationship = resolveRelationshipQuality(options);
  const shortTurnKind = resolveShortTurnKind(options.currentQuery);
  const conversationDepth = resolveConversationDepth(options, relationship);
  const factScope = resolveFactScope(profile.tier);
  const intimacyLevel = resolveIntimacyLevel(
    relationship.stage,
    relationship.maturity
  );
  const contributionMode = resolveContributionMode({
    depth: conversationDepth,
    relationship,
    riskLevel: options.riskLevel,
  });
  const isCorrection = Boolean(
    options.intent?.intents.some(item => item.intent === 'correct_assistant')
  );

  return {
    version: 'experience_plan_v1',
    profileTier: profile.tier,
    profileScore: profile.score,
    profileDimensionCount: profile.dimensionCount,
    profileTrustedFactCount: profile.trustedFactCount,
    relationshipStage: relationship.stage,
    relationshipMaturity: relationship.maturity,
    relationshipState: relationship.state,
    relationshipUserTurnCount: relationship.userTurnCount,
    relationshipActiveDayCount: relationship.activeDayCount,
    conversationDepth,
    shortTurnKind,
    factScope,
    intimacyLevel,
    contributionMode,
    memoryPolicy: resolveMemoryPolicy(
      conversationDepth,
      profile.tier,
      isCorrection
    ),
    questionPolicy: resolveQuestionPolicy(
      conversationDepth,
      relationship.state,
      options.riskLevel,
      shortTurnKind
    ),
    closurePolicy: resolveClosurePolicy(
      conversationDepth,
      relationship.state,
      options.riskLevel,
      shortTurnKind
    ),
  };
}

export function constrainConversationPlanForExperience(
  plan: ConversationMovePlan | undefined,
  experience: ReplyExperiencePlan
): ConversationMovePlan | undefined {
  // 体验层只描述资料与关系成熟度，不再改写语义模型已经给出的动作、
  // 提问或收放。尤其不能把“消息短”直接翻译成“少说、别问、收尾”。
  // 保留参数是为了兼容既有调用与诊断字段。
  void experience;
  return plan;
}

export function buildReplyExperiencePlanPrompt(
  plan: ReplyExperiencePlan
): string {
  const factGuidance: Record<ReplyProfileTier, string> = {
    P0: '事实只用称呼、当前原话和证据；亲密感用关系立场、愿望和理解表达',
    P1: '资料用来自然称呼和掌握分寸；旧事沿用户片段回应意义，不补细节',
    P2: '自然使用已确认资料；旧事先接感受，细节再看证据',
    P3: '相关时自然带一处有证据的共同记忆，用它承载理解而非证明身份',
  };
  const relationshipGuidance: Record<ReplyRelationshipStage, string> = {
    R0: '亲近但不预设熟稔',
    R1: '温暖回应，可轻主动',
    R2: '熟稔自然，可有来有往',
    R3: '可深聊和主动表达，不替用户下结论',
    R4: '先用回应修复信任，不让用户教你怎么说',
  };
  const depthGuidance: Record<ReplyConversationDepth, string> = {
    D0: '输入信息较少，优先借助最近上下文理解；短不等于浅，也不自动代表收尾',
    D1: '当前内容相对轻量，可自然回应，也可在贴题时展开',
    D2: '当前内容有一定信息量，注意回应其中真正重要的点',
    D3: '当前内容较深，可围绕核心自然深入',
    D4: '存在风险、纠正或信任问题时先守住硬边界',
  };
  const shortTurnGuidance: Record<ReplyShortTurnKind, string> = {
    explicit_close: '用户明确要结束，本轮自然回应并收尾',
    minimal_acknowledgement:
      '用户只增加了很少信息；回看上一轮判断是承接、留白还是自然推进，不凭长度决定',
    contextual_short:
      '这是短表达，可能承载重要事实或承接上一轮；先理解上下文，再自主决定深度、提问和收放',
    not_short: '按完整语义和最近上下文自主决定回应策略',
  };

  return `${plan.profileTier}/${plan.relationshipStage}/${
    plan.conversationDepth
  }：${factGuidance[plan.profileTier]}；${
    relationshipGuidance[plan.relationshipStage]
  }；${depthGuidance[plan.conversationDepth]}；${
    shortTurnGuidance[plan.shortTurnKind || 'not_short']
  }。以上是体验观察，不是回复动作或字数指令。`;
}

function resolveProfileQuality(
  agent?: AgentEntity | null,
  profileFacts: AgentProfileFactSummary[] = []
): ProfileQuality {
  const dimensions = new Set<string>();
  let explicitAnchorCount = 0;

  const addTextDimension = (dimension: string, value?: string) => {
    if (normalizeText(value).length < MEANINGFUL_TEXT_MIN_LENGTH) {
      return;
    }
    dimensions.add(dimension);
    explicitAnchorCount += 1;
  };

  if (agent) {
    if (agent.birthday || agent.deathDate || normalizeText(agent.realName)) {
      dimensions.add('identity_detail');
      explicitAnchorCount += 1;
    }
    addTextDimension('background', agent.description);
    addTextDimension('biography', agent.lifeExperience);
    addTextDimension('personality', agent.personalityTraits);
    addTextDimension('language', agent.languageHabits);
    addTextDimension('preference', agent.hobbies);
    addTextDimension('shared_memory', agent.sharedMemories);
    addTextDimension('background', agent.customContext);
    addPersonaDimensions(dimensions, agent);
  }

  const trustedFacts = profileFacts.filter(isTrustedProfileFact);
  for (const fact of profileFacts) {
    const dimension = mapFactTypeToDimension(fact.type);
    if (dimension && normalizeText(fact.value)) {
      dimensions.add(dimension);
    }
  }

  const personaConfidence = normalizeConfidence(
    agent?.personaProfile?.confidence
  );
  const reliableAnchorCount = explicitAnchorCount + trustedFacts.length;
  const hasSharedMemory = dimensions.has('shared_memory');
  const dimensionCount = dimensions.size;
  const score = Math.min(
    100,
    dimensionCount * 12 +
      Math.min(24, reliableAnchorCount * 4) +
      Math.round(personaConfidence * 16) +
      (hasSharedMemory ? 8 : 0)
  );
  const tier: ReplyProfileTier =
    dimensionCount >= 5 && hasSharedMemory && reliableAnchorCount >= 4
      ? 'P3'
      : dimensionCount >= 3 && reliableAnchorCount >= 2
      ? 'P2'
      : dimensionCount >= 1
      ? 'P1'
      : 'P0';

  return {
    tier,
    score,
    dimensionCount,
    trustedFactCount: trustedFacts.length,
  };
}

function addPersonaDimensions(
  dimensions: Set<string>,
  agent: AgentEntity
): void {
  const profile = agent.personaProfile;
  if (!profile) {
    return;
  }
  if (
    (profile.lifeTraits || []).length ||
    (profile.coreValues || []).length ||
    (profile.personalityContradictions || []).length
  ) {
    dimensions.add('personality');
  }
  if (
    profile.careStyle ||
    profile.praiseStyle ||
    profile.criticismStyle ||
    profile.conflictStyle
  ) {
    dimensions.add('relationship_style');
  }
  if (profile.languageProfile || profile.questionStyle || profile.humorStyle) {
    dimensions.add('language');
  }
}

function isTrustedProfileFact(fact: AgentProfileFactSummary): boolean {
  return (
    fact.confidence !== AgentProfileFactConfidence.extracted ||
    fact.assertionPolicy === AgentProfileFactAssertionPolicy.canAssert ||
    Number(fact.supportCount || 0) >= 2
  );
}

function mapFactTypeToDimension(
  type: AgentProfileFactType
): string | undefined {
  if (
    [
      AgentProfileFactType.identity,
      AgentProfileFactType.age,
      AgentProfileFactType.occupation,
    ].includes(type)
  ) {
    return 'identity_detail';
  }
  if (
    [AgentProfileFactType.relationship, AgentProfileFactType.family].includes(
      type
    )
  ) {
    return 'relationship_network';
  }
  if (type === AgentProfileFactType.preference) {
    return 'preference';
  }
  if (type === AgentProfileFactType.style) {
    return 'language';
  }
  if (
    [AgentProfileFactType.memory, AgentProfileFactType.keepsake].includes(type)
  ) {
    return 'shared_memory';
  }
  if (
    [
      AgentProfileFactType.correction,
      AgentProfileFactType.promise,
      AgentProfileFactType.griefTrigger,
      AgentProfileFactType.taboo,
    ].includes(type)
  ) {
    return 'relationship_boundaries';
  }
  return undefined;
}

function resolveRelationshipQuality(
  options: BuildReplyExperiencePlanOptions
): RelationshipQuality {
  const activeDays = new Set<string>();
  const deepAssistantGroups = new Set<string>();
  let deepUserTurnCount = 0;
  let previousStageRank = 0;
  let userTurnCount = 0;

  for (const [index, message] of (
    options.conversationMessages || []
  ).entries()) {
    if (message.isArchived) {
      continue;
    }
    if (message.role === MessageRole.user) {
      userTurnCount += 1;
      const day = normalizeDateKey(message.createdAt);
      if (day) {
        activeDays.add(day);
      }
      if (isDeepInteractionMessage(message)) {
        deepUserTurnCount += 1;
      }
      continue;
    }
    if (message.role !== MessageRole.assistant) {
      continue;
    }
    if (isDeepInteractionMessage(message)) {
      deepAssistantGroups.add(
        message.replyGroupId || String(message.id || `message-${index}`)
      );
    }
    previousStageRank = Math.max(
      previousStageRank,
      resolveSteadyStageRank(message.replyRelationshipStage)
    );
  }

  const deepInteractionCount = deepUserTurnCount + deepAssistantGroups.size;
  const previousMaturity: ReplyRelationshipMaturity | undefined =
    previousStageRank >= 3
      ? 'deep'
      : previousStageRank === 2
      ? 'familiar'
      : previousStageRank === 1
      ? 'warming'
      : undefined;
  let maturity: ReplyRelationshipMaturity;

  if (
    previousMaturity === 'deep' ||
    (userTurnCount >= 24 && activeDays.size >= 3 && deepInteractionCount >= 4)
  ) {
    maturity = 'deep';
  } else if (
    previousMaturity === 'familiar' ||
    (userTurnCount >= 8 && (activeDays.size >= 2 || deepInteractionCount >= 2))
  ) {
    maturity = 'familiar';
  } else if (previousMaturity === 'warming' || userTurnCount >= 2) {
    maturity = 'warming';
  } else {
    maturity = 'new';
  }

  const state = isRelationshipRepairTurn(options) ? 'repairing' : 'steady';
  const steadyStage: Exclude<ReplyRelationshipStage, 'R4'> =
    maturity === 'deep'
      ? 'R3'
      : maturity === 'familiar'
      ? 'R2'
      : maturity === 'warming'
      ? 'R1'
      : 'R0';

  return {
    stage: state === 'repairing' ? 'R4' : steadyStage,
    maturity,
    state,
    userTurnCount,
    activeDayCount: activeDays.size,
  };
}

function resolveConversationDepth(
  options: BuildReplyExperiencePlanOptions,
  relationship: RelationshipQuality
): ReplyConversationDepth {
  const query = normalizeText(options.currentQuery);
  const queryLength = Array.from(query.replace(/\s/gu, '')).length;
  const intents = options.intent?.intents || [];
  const continuationGoal =
    options.intent?.conversationPlan?.engagement?.continuationGoal;
  const hasDeepIntent = intents.some(
    item =>
      item.intent === 'recall_memory' ||
      item.intent === 'question_departure' ||
      item.intent === 'express_guilt' ||
      item.intent === 'regret_unfinished_devotion' ||
      item.intent === 'grieve_unfinished_promise' ||
      item.timeScope === 'shared_past'
  );
  const isHighStakes =
    options.riskLevel === 'high' ||
    options.mode === 'safety' ||
    options.mode === 'boundary' ||
    relationship.state === 'repairing' ||
    Number(options.realityDependencyCount || 0) > 0 ||
    intents.some(item => item.intent === 'crisis_support');

  if (isHighStakes) {
    return 'D4';
  }
  if (
    hasDeepIntent ||
    continuationGoal === 'deepen' ||
    ((options.mode === 'emotional' || options.mode === 'relationship') &&
      queryLength >= 30) ||
    (intents.length >= 2 && DEEP_USER_PATTERN.test(query))
  ) {
    return 'D3';
  }
  if (
    options.primaryScene === 'correction' ||
    options.intent?.conversationPlan ||
    (['emotional', 'relationship', 'family', 'memory'].includes(options.mode) &&
      queryLength > 12) ||
    queryLength >= 24
  ) {
    return 'D2';
  }
  if (
    SIMPLE_CLOSING_PATTERN.test(query) ||
    (['daily', 'status'].includes(options.mode) && queryLength <= 12) ||
    (options.primaryScene === 'smalltalk' && queryLength <= 12)
  ) {
    return 'D0';
  }
  return 'D1';
}

function resolveFactScope(tier: ReplyProfileTier): ReplyExperienceFactScope {
  if (tier === 'P3') {
    return 'evidence_backed_memory';
  }
  if (tier === 'P2') {
    return 'confirmed_profile';
  }
  if (tier === 'P1') {
    return 'explicit_profile';
  }
  return 'identity_only';
}

function resolveIntimacyLevel(
  stage: ReplyRelationshipStage,
  maturity: ReplyRelationshipMaturity
): ReplyExperienceIntimacyLevel {
  if (stage === 'R4') {
    return 'repairing';
  }
  if (maturity === 'deep') {
    return 'deep';
  }
  if (maturity === 'familiar') {
    return 'familiar';
  }
  if (maturity === 'warming') {
    return 'warm';
  }
  return 'reserved';
}

function resolveContributionMode(options: {
  depth: ReplyConversationDepth;
  relationship: RelationshipQuality;
  riskLevel: ReplyIntentRiskLevel;
}): ReplyExperienceContributionMode {
  if (options.relationship.state === 'repairing') {
    return 'repair_trust';
  }
  if (options.depth === 'D4' || options.riskLevel === 'high') {
    return 'direct_support';
  }
  if (options.depth === 'D3') {
    return 'deepen_one_point';
  }
  if (options.depth === 'D2') {
    return 'role_present';
  }
  if (options.depth === 'D1' && options.relationship.maturity !== 'new') {
    return 'reciprocal';
  }
  return 'minimal';
}

function resolveMemoryPolicy(
  depth: ReplyConversationDepth,
  tier: ReplyProfileTier,
  isCorrection: boolean
): ReplyExperienceMemoryPolicy {
  if (isCorrection) {
    return 'off';
  }
  if (depth === 'D0' || depth === 'D1' || tier === 'P0' || tier === 'P1') {
    return 'context_only';
  }
  if (depth === 'D3' || depth === 'D4') {
    return 'evidence_required';
  }
  return 'retrieve_if_needed';
}

function resolveQuestionPolicy(
  depth: ReplyConversationDepth,
  state: ReplyRelationshipState,
  riskLevel: ReplyIntentRiskLevel,
  shortTurnKind: ReplyShortTurnKind
): ReplyExperienceQuestionPolicy {
  if (shortTurnKind === 'explicit_close') {
    return 'none';
  }
  if (depth === 'D3' || depth === 'D4' || riskLevel === 'high') {
    return 'prefer_one';
  }
  // 关系修复、短消息和普通轮次都不再由体验层禁止提问。
  // optional 只表示模型拥有选择空间，不要求它实际提问。
  void state;
  return 'optional';
}

function resolveClosurePolicy(
  depth: ReplyConversationDepth,
  state: ReplyRelationshipState,
  riskLevel: ReplyIntentRiskLevel,
  shortTurnKind: ReplyShortTurnKind
): ReplyExperienceClosurePolicy {
  if (riskLevel === 'high' || depth === 'D4') {
    return 'hold';
  }
  if (shortTurnKind === 'explicit_close') {
    return 'close';
  }
  // 非明确收尾时只记录中性状态，避免体验层替模型决定继续或结束。
  void state;
  return 'neutral';
}

function resolveShortTurnKind(currentQuery: string): ReplyShortTurnKind {
  const query = normalizeText(currentQuery);
  if (SIMPLE_CLOSING_PATTERN.test(query)) {
    return 'explicit_close';
  }
  if (Array.from(query.replace(/\s/gu, '')).length > 12) {
    return 'not_short';
  }
  if (
    /^(?:嗯+|哦+|好+|行|可以|知道了|好的|谢谢|多谢)(?:呀|啊|呢|哦|嘛|哈|了|啦)*[。.!！?？~～]*$/.test(
      query
    )
  ) {
    return 'minimal_acknowledgement';
  }
  return 'contextual_short';
}

function isRelationshipRepairTurn(
  options: BuildReplyExperiencePlanOptions
): boolean {
  return Boolean(
    options.primaryScene === 'authenticity_challenge' ||
      REPAIR_PATTERN.test(normalizeText(options.currentQuery))
  );
}

function isDeepInteractionMessage(message: MessageEntity): boolean {
  if (message.role === MessageRole.assistant) {
    return (
      message.replyConversationDepth === 'D3' ||
      ['emotional', 'relationship', 'memory', 'family'].includes(
        message.replyBriefMode || ''
      )
    );
  }
  return (
    DEEP_USER_PATTERN.test(normalizeText(message.content)) ||
    MEMORY_USER_PATTERN.test(normalizeText(message.content))
  );
}

function resolveSteadyStageRank(stage?: string): number {
  if (stage === 'R3') {
    return 3;
  }
  if (stage === 'R2') {
    return 2;
  }
  if (stage === 'R1') {
    return 1;
  }
  return 0;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeDateKey(value?: Date): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function normalizeConfidence(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}
