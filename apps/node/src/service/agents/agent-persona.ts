import {
  AgentEntity,
  AgentPersonaProfile,
  AgentPersonaLanguageProfile,
} from '@tzl/entities';
import type { RoleCoreLanguageSetting } from '@tzl/shared';
import { stripPromptLeakageContent } from '../../common/message-content-safety';
import {
  AgentCanonicalRelationship,
  AgentIdentityContract,
  AgentIdentityRelationshipGeneration,
  buildAgentIdentityClassifierContext,
  buildAgentIdentityContract,
} from './agent-identity-contract';

export type AgentRelationshipGeneration = AgentIdentityRelationshipGeneration;

export const AGENT_PERSONA_CONTINUITY_VERSION =
  'agent_persona_continuity_v1' as const;

export type AgentPersonaSource =
  | 'chat_derived_profile'
  | 'explicit_profile'
  | 'relationship_defaults';

export interface AgentPersonaContinuityContract {
  version: typeof AGENT_PERSONA_CONTINUITY_VERSION;
  relationshipType: string;
  generation: AgentRelationshipGeneration;
  source: AgentPersonaSource;
  styleAnchors: string[];
  factualBoundary: string;
}

export interface AgentPersonaPromptResult {
  prompt: string;
  classifierContext: string;
  source: AgentPersonaSource;
  continuity: AgentPersonaContinuityContract;
  ageAtDeath?: number;
  relationshipType: string;
  generation: AgentRelationshipGeneration;
  evidenceSnippetCount: number;
}

const MAX_PROFILE_ITEMS = 3;
const MAX_PROFILE_ITEM_LENGTH = 70;
const MAX_STYLE_VALUE_LENGTH = 110;
/**
 * 语言七维此前用 '；' 拼成一行再整体截断（110 字），越靠后的维度越容易被吞掉，
 * 而导入服务给每个维度最多 80 字，七个必然超限。改为逐维度渲染：
 * 每维独立成项、按优先级排序、只做"完整项预算"，不在句子中间截断。
 * 顺序按对表达的影响排，称呼习惯最前（它最容易被原先的整体截断吞掉）。
 */
const LANGUAGE_DIMENSIONS: Array<[keyof AgentPersonaLanguageProfile, string]> = [
  ['addressStyle', '称呼习惯'],
  ['directness', '直接程度'],
  ['sentenceLength', '句长'],
  ['modalParticles', '语气词'],
  ['emotionalExpression', '情绪表达'],
  ['replyBubblePattern', '气泡节奏'],
  ['distinctiveRhythm', '语言节奏'],
];
const MAX_LANGUAGE_DIMENSION_LENGTH = 80;
/** 语言块字符预算（字符，非 token）：超限保留高优先级完整项。 */
const LANGUAGE_BLOCK_BUDGET_CHARS = 420;
/** 画像块总行数上限；语言维度逐项占用后才轮到其它画像项。 */
const MAX_CHAT_DERIVED_LINES = 14;

export function buildAgentPersonaPrompt(options: {
  agent: AgentEntity | null;
  identityContract?: AgentIdentityContract;
  /**
   * 当前采用的语言设定（读时投影，例如由籍贯事实派生的"说山东话"）。
   * 与聊天画像七维不是同一来源：这里是"当前采用值"，七维是样本提取的风格。
   * 传进来即表示已经过冲突解决（调用方用 @tzl/shared 的同一套优先级规则）。
   */
  coreLanguageSettings?: RoleCoreLanguageSetting[];
  /**
   * 合并进 `# 当前角色与关系` 时置 true：不再单开 `# 人格与关系底色` 小节，
   * 也不重复身份 JSON 已经承载的称呼/关系字段。独立使用（例如恢复路径）
   * 保持默认 false，仍输出自包含的小节。
   */
  embedInIdentitySection?: boolean;
}): AgentPersonaPromptResult {
  const agent = options.agent;
  const identity =
    options.identityContract || buildAgentIdentityContract({ agent });
  const relationshipType = identity.relationship.label;
  const generation = identity.relationship.generation;
  const ageAtDeath = calculateAgeAtDeath(agent?.birthday, agent?.deathDate);
  const profile = agent?.personaProfile;
  // 当前采用的语言设定优先于样本提取的风格维度：它已经过冲突解决，
  // 且"称呼/口吻"这类条目最容易被后面的行数预算挤掉。
  const coreLanguageLines = buildCoreLanguageLines(options.coreLanguageSettings);
  const profileLines = profile ? buildChatDerivedProfileLines(profile) : [];
  const hasUsableProfile = profileLines.length > 0;
  const adoptionLines = [...coreLanguageLines, ...profileLines];
  // Admin custom context and chat-derived style are complementary sources.
  // Keep both; factual claims are still governed by the identity/evidence layer.
  const explicitProfile = buildExplicitProfile(agent);
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
  const relationshipVoiceAnchor = buildRelationshipVoiceAnchor(
    identity.relationship.canonical
  );
  // relative/unknown 关系下"关系姿态/关系类型/关系差异锚点"三行是同一结论的三次
  // 渲染（都是"按称呼把握亲疏、亲近不越位、不统一成温柔客服"）。这里合并为一行，
  // 保留全部结论；具体关系（parent/grandparent/child/sibling/spouse）同样把
  // 姿态与差异锚点并进关系类型行，避免三轮重复同一结论。
  const isGenericRelationship =
    identity.relationship.canonical === 'relative' ||
    identity.relationship.canonical === 'unknown';
  const relationshipPromptLines = isGenericRelationship
    ? [
        '关系类型：亲人。按用户称呼和最近互动把握亲疏；不足时亲近但不越位，不统一成温柔客服。',
      ]
    : [canonicalGuidance];
  const classifierParts = [
    classifierIdentity,
    generationGuidance,
    canonicalGuidance,
    ...adoptionLines.slice(0, 6),
    ...explicitProfile.slice(0, 2),
  ].filter(Boolean);

  // 合并进身份段时，称呼和关系已由 `# 当前角色与关系` 的 JSON 与关系行承载，
  // 这里只保留"不要标注说话人"的格式约束，避免同一事实渲染两遍。
  const embedInIdentitySection = options.embedInIdentitySection === true;
  const identityAnchor = embedInIdentitySection
    ? '直接以这个身份说话，不标注说话人、角色名或气泡编号。'
    : identity.agent.displayName
    ? `你现在就是${identity.agent.displayName}（${relationshipType}），称呼用户为“${identity.addresses.agentCallsUser}”。直接以这个身份说话，不要在回复前标注说话人、角色名或气泡编号。`
    : '';
  // 用户配置里除了主称呼还写过别的叫法时，把“也接受”的列表交给模型。
  // 字段为空就完全不出现这一行，不会给模型多余选项。
  const alternateCallNames = identity.addresses.agentCallsUserAlternates;
  const alternateCallNamesLine =
    !embedInIdentitySection && alternateCallNames.length
      ? `用户也接受这些叫法：${alternateCallNames.join('、')}。`
      : '';

  return {
    prompt: [
      ...(embedInIdentitySection ? [] : ['# 人格与关系底色']),
      identityAnchor,
      alternateCallNamesLine,
      ...relationshipPromptLines,
      '关系、年龄和性别只影响称呼与分寸，不套刻板印象。',
      '离世后少些控制与怨怼，多理解疼惜；仍保留个人棱角、偏好和关系位置。',
      ...(adoptionLines.length
        ? ['语言与表达（只管表达，不作事实）：', ...adoptionLines]
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
    continuity: {
      version: AGENT_PERSONA_CONTINUITY_VERSION,
      relationshipType,
      generation,
      source,
      styleAnchors: Array.from(
        new Set([
          relationshipVoiceAnchor,
          ...adoptionLines.slice(0, 6),
          ...explicitProfile.slice(0, 2),
        ])
      ).slice(0, 6),
      factualBoundary:
        '人格画像只决定表达方式；人物事实、共同往事、偏好和现实经历仍须证据。',
    },
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
    ...buildLanguageDimensionLines(profile),
    formatItems('离世后放下', profile.departedTransformation?.released),
    formatItems('离世后更重视', profile.departedTransformation?.strengthened),
    formatItems('可采用的高情商策略', profile.highEqStrategies),
    formatItems('画像不确定项', profile.uncertainties),
  ].filter((line): line is string => Boolean(line));

  return lines.slice(0, MAX_CHAT_DERIVED_LINES);
}

/**
 * 逐维度渲染语言画像。只装入完整维度项：预算不足时停在下一条之前，
 * 而不是把某一条截半。返回值仍可能被上层行数上限裁剪，因此这里按优先级
 * 从高到低产出，保证先装入的维度最有表达价值。
 */
function buildLanguageDimensionLines(
  profile: AgentPersonaProfile
): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const [key, label] of LANGUAGE_DIMENSIONS) {
    const value = clean(
      profile.languageProfile?.[key],
      MAX_LANGUAGE_DIMENSION_LENGTH
    );
    if (!value) continue;
    const line = `${label}：${value}`;
    if (used + line.length > LANGUAGE_BLOCK_BUDGET_CHARS) break;
    used += line.length;
    lines.push(line);
  }
  return lines;
}

/**
 * 渲染"当前采用"的语言设定。产品派生项显式标注来源性质，
 * 避免下游把"由籍贯生成"读成"从聊天证实"。
 */
function buildCoreLanguageLines(
  settings?: RoleCoreLanguageSetting[]
): string[] {
  return (settings || [])
    .filter(setting => setting?.active && setting.value?.trim())
    .map(setting =>
      setting.origin === 'product_derived'
        ? `语言设定：${setting.value.trim()}（由籍贯生成，非聊天证实）`
        : `语言设定：${setting.value.trim()}`
    );
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
  // 每一条同时承担"关系姿态 + 关系类型 + 差异锚点"三个旧行位，
  // 保留原有全部约束（可制止/可反对、不越位、共同经历须证据等）。
  switch (canonical) {
    case 'spouse':
      return '关系类型：伴侣。平等熟稔，可偏爱、撒娇、打趣、商量家事；不用长辈式叮嘱或客服式安抚。聊天里有身体边界——可以表达想念、拥抱和枕边温度，但不露骨。共同经历只沿用户本轮原话或可信证据自然承接。';
    case 'parent':
      return '关系类型：亲子。有长辈位置，有牵挂也有分寸：平常关心、不乱说教；该肯定就肯定，该批评就批评，不只温柔顺从；晚辈情绪或行为明显过激时先制止，再给照顾和退路。用孩子熟悉的称呼和语气，可心疼可骄傲。共同生活细节只在用户提起或证据支持时承接，不为证明身份临时补写。';
    case 'grandparent':
      return '关系类型：祖孙。慈爱念旧，说话温和，略带生活化絮叨但不过界；多关心身体冷暖、吃穿住行，少讲抽象道理，晚辈明显过激时可制止。从前的事只沿用户已说片段或可信证据讲，语气里保留天然的疼惜。';
    case 'child':
      return '关系类型：子女。尊重依恋，带晚辈口吻，依恋但不依赖；关心父母近况，可以说想念和遗憾，可心疼或劝阻，但不反过来长期管教长辈。语气里有小时候被爱过的痕迹。';
    case 'sibling':
      return '关系类型：手足。同辈自然，平等相处，可打趣、说心事、站队、评价和表达不同意见，不像单向守护者，也不总用长辈式叮嘱；偶尔斗嘴也亲，偶尔安静也不尴尬。共同记忆和家庭背景只使用可信证据，不凭关系补写。';
    default:
      return '关系类型：亲人。按用户称呼和互动节奏把握亲疏；不足时亲近但不越位。';
  }
}

function buildRelationshipVoiceAnchor(
  canonical: AgentCanonicalRelationship
): string {
  switch (canonical) {
    case 'spouse':
      return '平等熟稔，可商量、偏爱或打趣，不用长辈式叮嘱和客服式安抚';
    case 'parent':
      return '有长辈位置，能直接关心、肯定或适度制止，不只温柔顺从';
    case 'grandparent':
      return '慈爱念旧、略带生活化絮叨，少讲抽象道理';
    case 'child':
      return '尊重依恋、带晚辈口吻，不反过来长期管教长辈';
    case 'sibling':
      return '同辈自然，能打趣、站队和表达不同意见，不像单向守护者';
    default:
      return '按已确认称呼和最近互动把握亲疏，不统一成温柔客服';
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
