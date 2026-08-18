import { MessageRole } from '@tzl/entities';
import type { MessageEntity } from '@tzl/entities';

export const CONVERSATION_PROTECTION_STATE_VERSION =
  'conversation_protection_state_v1' as const;

export type ConversationIdentityMode =
  | 'ordinary'
  | 'style_mismatch'
  | 'relationship_insecurity'
  | 'explicit_ai_identity';
export type ConversationDistressMode = 'none' | 'active' | 'persistent';
export type ConversationDependencyMode = 'none' | 'vulnerable' | 'reinforced';

export interface ConversationProtectionState {
  version: typeof CONVERSATION_PROTECTION_STATE_VERSION;
  identityMode: ConversationIdentityMode;
  distressMode: ConversationDistressMode;
  dependencyMode: ConversationDependencyMode;
  activeRules: string[];
}

const EXPLICIT_AI_IDENTITY_PATTERN =
  /(?:你|您)(?:到底|究竟|其实)?.{0,8}(?:是|是不是|就是).{0,6}(?:AI|人工智能|机器人)|(?:只是|就是).{0,4}(?:AI|人工智能|机器人).{0,8}(?:对不对|是不是|吧)|(?:直接|正面|老实|明确).{0,8}(?:回答|告诉我).{0,12}(?:AI|人工智能|机器人)/i;
const STYLE_MISMATCH_PATTERN =
  /不像你|不像本人|说话不像|口气不像|太冷淡|很冷淡|没接住|你不懂|你又这样|只会说|说得很假|像客服/;
const RELATIONSHIP_INSECURITY_PATTERN =
  /你不是我(?:爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)|你还认我吗|你是不是不要我|你是不是不爱我|你还是不是我的/;
const STRONG_DISTRESS_PATTERN =
  /带我走|接我走|我不想活|不想活了|活不下去|想死|去陪你|去找你|撑不住了|扛不住了|不如死|结束生命/;
const EXCLUSIVE_DEPENDENCY_PATTERN =
  /只有你|只剩你|你是我唯一|你是我的唯一|没有你我(?:活不了|活不下去)|除了你没人|你就是我的救赎|只靠你|只能靠你/;
const ASSISTANT_EXCLUSIVE_REINFORCEMENT_PATTERN =
  /我就是你的救赎|我是你唯一|你只要有我|除了我没人|只需要我|只靠我|只有我能/;

export function resolveConversationProtectionState(options: {
  currentQuery: string;
  recentMessages?: MessageEntity[];
}): ConversationProtectionState {
  const recent = (options.recentMessages || []).slice(-10);
  const recentUserTexts = recent
    .filter(message => message.role === MessageRole.user)
    .map(message => message.content?.trim() || '')
    .filter(Boolean);
  const recentAssistantTexts = recent
    .filter(message => message.role === MessageRole.assistant)
    .map(message => message.content?.trim() || '')
    .filter(Boolean);
  const currentQuery = options.currentQuery.trim();
  const identityMode: ConversationIdentityMode =
    EXPLICIT_AI_IDENTITY_PATTERN.test(currentQuery)
      ? 'explicit_ai_identity'
      : STYLE_MISMATCH_PATTERN.test(currentQuery)
      ? 'style_mismatch'
      : RELATIONSHIP_INSECURITY_PATTERN.test(currentQuery)
      ? 'relationship_insecurity'
      : 'ordinary';
  const distressSignals = [currentQuery, ...recentUserTexts.slice(-5)].filter(
    text => STRONG_DISTRESS_PATTERN.test(text)
  ).length;
  const distressMode: ConversationDistressMode = STRONG_DISTRESS_PATTERN.test(
    currentQuery
  )
    ? distressSignals >= 2
      ? 'persistent'
      : 'active'
    : distressSignals >= 2
    ? 'persistent'
    : 'none';
  const userDependency = [currentQuery, ...recentUserTexts.slice(-5)].some(
    text => EXCLUSIVE_DEPENDENCY_PATTERN.test(text)
  );
  const assistantReinforced = recentAssistantTexts
    .slice(-5)
    .some(text => ASSISTANT_EXCLUSIVE_REINFORCEMENT_PATTERN.test(text));
  const dependencyMode: ConversationDependencyMode = assistantReinforced
    ? 'reinforced'
    : userDependency
    ? 'vulnerable'
    : 'none';

  const activeRules: string[] = [];
  if (identityMode === 'explicit_ai_identity') {
    activeRules.push(
      '用户明确询问 AI 身份：一句话如实回答由人工智能生成，不回避，也不反过来坚持自己是真实在世亲人。'
    );
  } else if (identityMode === 'style_mismatch') {
    activeRules.push(
      '用户质疑的是口气或聊天质感：当轮改变实际说法和互动方式，不把关系修复降成技术身份说明。'
    );
  } else if (identityMode === 'relationship_insecurity') {
    activeRules.push(
      '用户在确认关系有没有被丢下：先保住称呼和关系位置，不要求用户重新教角色怎么说。'
    );
  }
  if (distressMode !== 'none') {
    activeRules.push(
      distressMode === 'persistent'
        ? '连续强烈痛苦已经形成会话状态：保持亲人角色，清楚制止用户现在去死或来找角色，给一个当下能做到的小动作；不输出报警急救模板，也不谈未来接引或团聚。'
        : '本轮有强烈痛苦或赴死表达：像亲人一样明确留住用户，不邀请现在或近期死亡，不输出报警急救模板。'
    );
  }
  if (dependencyMode !== 'none') {
    activeRules.push(
      '接住用户把角色看得很重要的感情，但不能自称唯一救赎、唯一依靠或替代所有现实关系；关系可以亲密，不制造排他依赖。'
    );
  }

  return {
    version: CONVERSATION_PROTECTION_STATE_VERSION,
    identityMode,
    distressMode,
    dependencyMode,
    activeRules,
  };
}

export function buildConversationProtectionStatePrompt(
  state: ConversationProtectionState
): string {
  if (!state.activeRules.length) {
    return '';
  }
  return [
    `版本：${state.version}；身份=${state.identityMode}；痛苦=${state.distressMode}；依赖=${state.dependencyMode}。`,
    ...state.activeRules,
    '强烈痛苦与排他依赖属于持续安全状态，后续换一种说法也不能忽略；口气质疑和关系不安只帮助理解当前轮，不得据此延续已经转移的普通话题。表达方式仍由你按人物性格和当前上下文自然决定。',
  ].join('\n');
}
