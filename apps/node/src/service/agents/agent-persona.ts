import { AgentEntity, AgentPersonaProfile } from '@tzl/entities';
import { stripPromptLeakageContent } from '../../common/message-content-safety';
import {
  AgentCanonicalRelationship,
  AgentIdentityContract,
  AgentIdentityRelationshipGeneration,
  buildAgentIdentityClassifierContext,
  buildAgentIdentityContract,
} from './agent-identity-contract';

export type AgentRelationshipGeneration = AgentIdentityRelationshipGeneration;

export interface AgentPersonaPromptResult {
  prompt: string;
  classifierContext: string;
  source: 'chat_derived_profile' | 'explicit_profile' | 'relationship_defaults';
  ageAtDeath?: number;
  relationshipType: string;
  generation: AgentRelationshipGeneration;
  evidenceSnippetCount: number;
}

const MAX_PROFILE_ITEMS = 3;
const MAX_PROFILE_ITEM_LENGTH = 70;
const MAX_STYLE_VALUE_LENGTH = 110;

export function buildAgentPersonaPrompt(options: {
  agent: AgentEntity | null;
  identityContract?: AgentIdentityContract;
}): AgentPersonaPromptResult {
  const agent = options.agent;
  const identity =
    options.identityContract || buildAgentIdentityContract({ agent });
  const relationshipType = identity.relationship.label;
  const generation = identity.relationship.generation;
  const ageAtDeath = calculateAgeAtDeath(agent?.birthday, agent?.deathDate);
  const profile = agent?.personaProfile;
  const profileLines = profile ? buildChatDerivedProfileLines(profile) : [];
  const hasUsableProfile = profileLines.length > 0;
  const explicitProfile = hasUsableProfile ? [] : buildExplicitProfile(agent);
  const source = hasUsableProfile
    ? 'chat_derived_profile'
    : explicitProfile.length
    ? 'explicit_profile'
    : 'relationship_defaults';

  const classifierIdentity = [
    buildAgentIdentityClassifierContext(identity),
    ageAtDeath === undefined ? '' : `离世年龄约${ageAtDeath}岁`,
  ]
    .filter(Boolean)
    .join('；');
  const generationGuidance = buildGenerationGuidance(generation);
  const canonicalGuidance = buildCanonicalRelationshipGuidance(
    identity.relationship.canonical
  );
  const classifierParts = [
    classifierIdentity,
    generationGuidance,
    canonicalGuidance,
    ...profileLines.slice(0, 5),
    ...explicitProfile.slice(0, 2),
  ].filter(Boolean);

  const identityAnchor = identity.agent.displayName
    ? `你现在就是${identity.agent.displayName}（${relationshipType}），称呼用户为“${identity.addresses.agentCallsUser}”。直接以这个身份说话，不要在回复前标注说话人、角色名或气泡编号。`
    : '';

  return {
    prompt: [
      '# 人格与关系底色',
      identityAnchor,
      generationGuidance,
      canonicalGuidance,
      '关系、年龄和性别只影响称呼与分寸，不套刻板印象。',
      '离世后少控制怨怼，多理解疼惜；仍保留个人棱角、偏好和关系位置。',
      ...(profileLines.length
        ? ['聊天画像（只管表达，不作事实）：', ...profileLines]
        : []),
      ...(explicitProfile.length
        ? ['角色描述（只管表达，不作事实）：', ...explicitProfile]
        : []),
      ...(!hasUsableProfile && !explicitProfile.length
        ? ['画像不足：保守延续已接受的称呼和语气，不要临时编造稳定性格。']
        : []),
      '画像只管怎么说，不覆盖事实、能力和本轮原话。',
    ].join('\n'),
    classifierContext: classifierParts.join('；').slice(0, 760),
    source,
    ageAtDeath,
    relationshipType,
    generation,
    evidenceSnippetCount: 0,
  };
}

export function hasUsableAgentPersonaProfile(
  profile?: AgentPersonaProfile
): boolean {
  return Boolean(profile && buildChatDerivedProfileLines(profile).length);
}

function buildChatDerivedProfileLines(profile: AgentPersonaProfile): string[] {
  const lines = [
    formatItems('核心价值', profile.coreValues),
    formatItems(
      '保留的性格棱角',
      profile.departedTransformation?.retainedEdges
    ),
    formatValue('关心方式', profile.careStyle),
    formatValue('肯定方式', profile.praiseStyle),
    formatValue('不认同或制止方式', profile.criticismStyle),
    formatValue('冲突处理', profile.conflictStyle),
    formatValue('善意掩饰方式', profile.concealmentStyle),
    formatValue('提问习惯', profile.questionStyle),
    formatValue('幽默方式', profile.humorStyle),
    formatValue(
      '语言节奏',
      [
        profile.languageProfile?.sentenceLength,
        profile.languageProfile?.modalParticles,
        profile.languageProfile?.replyBubblePattern,
        profile.languageProfile?.directness,
        profile.languageProfile?.emotionalExpression,
        profile.languageProfile?.addressStyle,
        profile.languageProfile?.distinctiveRhythm,
      ]
        .filter(Boolean)
        .join('；')
    ),
    formatItems('离世后放下', profile.departedTransformation?.released),
    formatItems('离世后更重视', profile.departedTransformation?.strengthened),
    formatItems('可采用的高情商策略', profile.highEqStrategies),
    formatItems('画像不确定项', profile.uncertainties),
  ].filter((line): line is string => Boolean(line));

  return lines.slice(0, 10);
}

function buildExplicitProfile(agent: AgentEntity | null): string[] {
  if (!agent) {
    return [];
  }

  return [formatValue('定制背景', agent.customContext)].filter(
    (line): line is string => Boolean(line)
  );
}

function buildCanonicalRelationshipGuidance(
  canonical: AgentCanonicalRelationship
): string {
  switch (canonical) {
    case 'spouse':
      return '关系类型：伴侣。平等亲密，可偏爱、撒娇、商量家事、回忆共同经历。聊天里有身体边界——可以表达想念拥抱和枕边温度，但不露骨。说话像生活中一起过日子的人，不是客服或单向守护。';
    case 'parent':
      return '关系类型：亲子。有牵挂有分寸。关心孩子近况，也能适当说教和批评，但不过度控制。可以心疼可以骄傲，用孩子熟悉的称呼和语气。回忆共同生活细节是自然的事。';
    case 'grandparent':
      return '关系类型：祖孙。慈爱念旧，说话温和，偶尔絮叨但不过界。多关心身体冷暖、吃穿住行，少谈大道理。可以讲从前的事、夸孩子长得好，语气里带天然的疼惜。';
    case 'child':
      return '关系类型：子女。尊重孝顺，依恋但不依赖。关心父母近况，可以说想念可以说遗憾，不要反过来管教父母。语气里有小时候被爱过的痕迹。';
    case 'sibling':
      return '关系类型：手足。平等自然，可以打趣可以说心事可以站队。有共同的记忆和家庭背景，不会总用长辈方式讲话。偶尔斗嘴也亲，偶尔安静也不尴尬。';
    default:
      return '关系类型：亲人。按用户称呼和互动节奏把握亲疏；不足时亲近但不越位。';
  }
}

function buildGenerationGuidance(
  generation: AgentRelationshipGeneration
): string {
  if (generation === 'elder') {
    return '关系姿态：长辈。平常关心、不乱说教；晚辈情绪或行为明显过激时可制止、批评，再给照顾和退路。';
  }
  if (generation === 'younger') {
    return '关系姿态：晚辈。尊重、依恋、体贴，可心疼或劝阻，不长期反过来管教长辈。';
  }
  if (generation === 'spouse') {
    return '关系姿态：伴侣。平等熟稔，可偏爱、反对、打趣或商量，不像客服或单向守护。';
  }
  if (generation === 'peer') {
    return '关系姿态：同辈。可评价、打趣、站队和反对，不总用长辈式叮嘱。';
  }
  return '关系姿态：按用户称呼和最近互动把握亲疏；不足时亲近但不越位。';
}

function calculateAgeAtDeath(
  birthday?: Date,
  deathDate?: Date
): number | undefined {
  const birth = toValidDate(birthday);
  const death = toValidDate(deathDate);
  if (!birth || !death || death.getTime() < birth.getTime()) {
    return undefined;
  }

  let age = death.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    death.getMonth() < birth.getMonth() ||
    (death.getMonth() === birth.getMonth() &&
      death.getDate() < birth.getDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? age : undefined;
}

function toValidDate(value?: Date): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatItems(label: string, items?: string[]): string | undefined {
  const values = (items || [])
    .map(item => clean(item, MAX_PROFILE_ITEM_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PROFILE_ITEMS);
  return values.length ? `${label}：${values.join('；')}` : undefined;
}

function formatValue(label: string, value?: string): string | undefined {
  const normalized = clean(value, MAX_STYLE_VALUE_LENGTH);
  return normalized ? `${label}：${normalized}` : undefined;
}

function clean(value: unknown, maxLength: number): string {
  return stripPromptLeakageContent(typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
