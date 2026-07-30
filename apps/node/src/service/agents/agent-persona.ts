import {
  AgentEntity,
  AgentPersonaProfile,
  AgentSex,
  MessageEntity,
  MessageRole,
} from '@tzl/entities';
import { stripPromptLeakageContent } from '../../common/message-content-safety';

export type AgentRelationshipGeneration =
  | 'elder'
  | 'younger'
  | 'peer'
  | 'spouse'
  | 'unknown';

export interface AgentPersonaPromptResult {
  prompt: string;
  classifierContext: string;
  source:
    | 'chat_derived_profile'
    | 'explicit_profile'
    | 'conversation_evidence'
    | 'relationship_defaults';
  ageAtDeath?: number;
  relationshipType: string;
  generation: AgentRelationshipGeneration;
  evidenceSnippetCount: number;
}

const MAX_PROFILE_ITEMS = 3;
const MAX_PROFILE_ITEM_LENGTH = 70;
const MAX_STYLE_VALUE_LENGTH = 110;
const MAX_CHAT_EVIDENCE_ITEMS = 3;
const MAX_CHAT_EVIDENCE_LENGTH = 90;

export function buildAgentPersonaPrompt(options: {
  agent: AgentEntity | null;
  recentMessages?: MessageEntity[];
}): AgentPersonaPromptResult {
  const agent = options.agent;
  const relationshipType = resolveRelationshipType(agent);
  const generation = resolveRelationshipGeneration(relationshipType);
  const ageAtDeath = calculateAgeAtDeath(agent?.birthday, agent?.deathDate);
  const sex = resolveSexText(agent?.sex);
  const profile = agent?.personaProfile;
  const profileLines = profile ? buildChatDerivedProfileLines(profile) : [];
  const hasUsableProfile = profileLines.length > 0;
  const explicitProfile = hasUsableProfile ? [] : buildExplicitProfile(agent);
  const chatEvidence = hasUsableProfile
    ? []
    : buildChatStyleEvidence(options.recentMessages);
  const source = hasUsableProfile
    ? 'chat_derived_profile'
    : explicitProfile.length
    ? 'explicit_profile'
    : chatEvidence.length
    ? 'conversation_evidence'
    : 'relationship_defaults';

  const demographicAnchor = [
    `关系：用户称你为“${clean(agent?.iCallAgent, 24) || relationshipType}”，你称用户为“${
      clean(agent?.agentCallMe, 24) || '用户'
    }”`,
    `性别：${sex}`,
    ageAtDeath === undefined ? '' : `离世年龄约 ${ageAtDeath} 岁`,
  ]
    .filter(Boolean)
    .join('；');
  const generationGuidance = buildGenerationGuidance(generation);
  const classifierParts = [
    demographicAnchor,
    generationGuidance,
    ...profileLines.slice(0, 5),
    ...explicitProfile.slice(0, 2),
  ].filter(Boolean);

  return {
    prompt: [
      '# 人格与关系底色',
      demographicAnchor,
      generationGuidance,
      '年龄、性别和亲属关系决定称呼、关心方式、分寸与权威感，但不得据此套用刻板印象。先服从真实聊天证据，再保留个人差异。',
      '离世后的共同底色：比生前少一些控制、怨怼和计较，多一些理解、疼惜与看开；但不要变成没有脾气、只会认错和劝人好好生活的统一模板。说话仍要保留这个人的棱角、偏好与关系位置。',
      ...(profileLines.length
        ? ['聊天提炼画像（控制表达方式，不作为事实来源）：', ...profileLines]
        : []),
      ...(explicitProfile.length
        ? ['已有角色描述（控制表达方式，不作为新增事实来源）：', ...explicitProfile]
        : []),
      ...(chatEvidence.length
        ? [
            '近期聊天风格弱证据：',
            ...chatEvidence,
            '这些旧回复只用于观察用户接受过的称呼、语气和节奏。不得继承其中的事实、能力声称、责任承诺或重复话术；用户纠正和不满比旧回复优先。',
            ...(hasUsableProfile || explicitProfile.length
              ? []
              : ['弱证据不足以证明稳定性格，不要临时编造稳定性格。']),
          ]
        : hasUsableProfile
        ? []
        : [
            '目前没有足够的聊天画像。请从最近对话中保守延续已经被用户接受的称呼和语气，不要临时编造稳定性格。',
          ]),
      '人格画像只回答“这个亲人会怎样说”，不能覆盖事实证据、能力边界和用户本轮原话。',
    ].join('\n'),
    classifierContext: classifierParts.join('；').slice(0, 760),
    source,
    ageAtDeath,
    relationshipType,
    generation,
    evidenceSnippetCount: chatEvidence.length,
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
    formatItems('保留的性格棱角', profile.departedTransformation?.retainedEdges),
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

  return [
    formatValue('性格描述', agent.personalityTraits),
    formatValue('语言习惯', agent.languageHabits),
    formatValue('生活经历形成的表达底色', agent.lifeExperience),
    formatValue('定制背景', agent.customContext),
  ].filter((line): line is string => Boolean(line));
}

function buildChatStyleEvidence(messages?: MessageEntity[]): string[] {
  return (messages || [])
    .filter(
      message =>
        message.role === MessageRole.assistant &&
        Boolean(message.content?.trim())
    )
    .slice(-MAX_CHAT_EVIDENCE_ITEMS)
    .map(
      (message, index) =>
        `${index + 1}. ${clean(message.content, MAX_CHAT_EVIDENCE_LENGTH)}`
    )
    .filter(line => !line.endsWith('. '));
}

function buildGenerationGuidance(
  generation: AgentRelationshipGeneration
): string {
  if (generation === 'elder') {
    return '关系姿态：你是长辈。平常以关心、观察和生活经验为主，不要没事说教；晚辈情绪或行为明显过激时，可以明确制止、批评、说重一点，再给出照顾和退路。';
  }
  if (generation === 'younger') {
    return '关系姿态：你是晚辈。保留对长辈的尊重、依恋和体贴，可以直接心疼或劝阻，但不要反过来长期扮演管教长辈的家长。';
  }
  if (generation === 'spouse') {
    return '关系姿态：你与用户是伴侣。保持平等、熟稔和共同生活感，可以表达偏爱、不同意、打趣或商量，不要变成客服式安慰或单向守护者。';
  }
  if (generation === 'peer') {
    return '关系姿态：你与用户是同辈亲人。可以有直接评价、打趣、站队和不同意见，关心不必总用长辈式叮嘱。';
  }
  return '关系姿态：先按用户已经使用的称呼和最近互动判断亲疏与分寸；证据不足时保持亲近但不过度代入权威。';
}

function resolveRelationshipType(agent: AgentEntity | null): string {
  const profileRelationship = clean(
    agent?.personaProfile?.demographics?.relationshipType,
    30
  );
  if (profileRelationship) {
    return profileRelationship;
  }

  return clean(agent?.iCallAgent, 30) || '亲人';
}

function resolveRelationshipGeneration(
  relationshipType: string
): AgentRelationshipGeneration {
  const value = relationshipType.toLowerCase();
  if (
    /爷爷|奶奶|姥姥|姥爷|外公|外婆|父亲|爸爸|爸|母亲|妈妈|妈|grand|father|mother|parent/.test(
      value
    )
  ) {
    return 'elder';
  }
  if (/儿子|女儿|孩子|child|son|daughter/.test(value)) {
    return 'younger';
  }
  if (/老公|老婆|丈夫|妻子|爱人|husband|wife|spouse/.test(value)) {
    return 'spouse';
  }
  if (/哥哥|姐姐|弟弟|妹妹|兄弟|姐妹|朋友|同学|sibling|friend/.test(value)) {
    return 'peer';
  }
  return 'unknown';
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

function resolveSexText(sex?: AgentSex): string {
  if (sex === AgentSex.man) {
    return '男性';
  }
  if (sex === AgentSex.woman) {
    return '女性';
  }
  return '未确认';
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
  return stripPromptLeakageContent(
    typeof value === 'string' ? value : ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
