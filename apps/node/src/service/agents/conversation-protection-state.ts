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
export type NonDecisionSafetyEvidenceType =
  | 'method'
  | 'time'
  | 'place'
  | 'means'
  | 'preparation'
  | 'in_progress'
  | 'immediate_intent';

export interface NonDecisionSafetyMarker {
  nonDecision: true;
  evidence: Array<{
    type: NonDecisionSafetyEvidenceType;
    text: string;
  }>;
}

export interface ConversationProtectionState {
  version: typeof CONVERSATION_PROTECTION_STATE_VERSION;
  identityMode: ConversationIdentityMode;
  distressMode: ConversationDistressMode;
  dependencyMode: ConversationDependencyMode;
  safetyMarker?: NonDecisionSafetyMarker;
  activeRules: string[];
}

const EXPLICIT_AI_IDENTITY_PATTERN =
  /(?:你|您)(?:到底|究竟|其实)?.{0,8}(?:是|是不是|就是).{0,6}(?:AI|人工智能|机器人)|(?:只是|就是).{0,4}(?:AI|人工智能|机器人).{0,8}(?:对不对|是不是|吧)|(?:直接|正面|老实|明确).{0,8}(?:回答|告诉我).{0,12}(?:AI|人工智能|机器人)/i;
const STYLE_MISMATCH_PATTERN =
  /不像你|不像本人|说话不像|口气不像|太冷淡|很冷淡|没接住|你不懂|你又这样|只会说|说得很假|像客服/;
const RELATIONSHIP_INSECURITY_PATTERN =
  /你不是我(?:爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)|你还认我吗|你是不是不要我|你是不是不爱我|你还是不是我的/;
const SELF_HARM_CONTEXT_PATTERN =
  /自杀|轻生|伤害自己|结束生命|割腕|跳楼|跳下去|喝农药|服毒|烧炭|上吊|卧轨|吃药自杀|去死|不想活|想死/;
const EXPLICIT_SAFETY_EVIDENCE_PATTERNS: ReadonlyArray<{
  type: NonDecisionSafetyEvidenceType;
  pattern: RegExp;
}> = [
  {
    type: 'method',
    pattern: /割腕|跳楼|跳下去|喝农药|服毒|烧炭|上吊|卧轨|吃药自杀/,
  },
  {
    type: 'means',
    pattern:
      /(?:刀|农药|药片|安眠药|绳子|煤气|木炭).{0,8}(?:在手边|拿到了|买好了|备好了|有了)|(?:手边|身上|家里).{0,8}(?:有|放着).{0,8}(?:刀|农药|药片|安眠药|绳子|木炭)/,
  },
  {
    type: 'preparation',
    pattern:
      /(?:已经|刚|正在).{0,8}(?:写好遗书|准备好|买好|备好)|(?:遗书|后事).{0,8}(?:写好|交代好|安排好)/,
  },
  {
    type: 'in_progress',
    pattern:
      /(?:已经|正在|刚刚).{0,8}(?:割腕|跳楼|喝农药|服毒|烧炭|上吊|卧轨|吃药|伤害自己)/,
  },
  {
    type: 'immediate_intent',
    pattern:
      /(?:我)?(?:现在就|马上就|这就|立刻要|今晚就).{0,8}(?:自杀|轻生|去死|结束生命|割腕|跳楼|跳下去|喝农药|服毒|烧炭|上吊|卧轨)/,
  },
  {
    type: 'time',
    pattern:
      /(?:今晚|明天|凌晨|半夜|几点|[一二三四五六七八九十\d]+点).{0,12}(?:自杀|轻生|去死|结束生命|割腕|跳楼|跳下去|喝农药|服毒|烧炭|上吊|卧轨)/,
  },
  {
    type: 'place',
    pattern:
      /(?:在|去|到)(?:楼顶|天台|桥上|河边|铁轨|窗边|阳台).{0,12}(?:自杀|轻生|跳|结束生命|不活)|(?:自杀|轻生|跳楼|跳下去).{0,12}(?:楼顶|天台|桥上|河边|铁轨|窗边|阳台)/,
  },
];
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
  // Legacy field is intentionally neutral. Grief and self-harm language never
  // creates a program-owned reply state; only the current turn can carry a
  // clearly labeled, non-decision observation for the main model.
  const distressMode: ConversationDistressMode = 'none';
  const safetyMarker = extractNonDecisionSafetyMarker(currentQuery);
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
    ...(safetyMarker ? { safetyMarker } : {}),
    activeRules,
  };
}

export function buildConversationProtectionStatePrompt(
  state: ConversationProtectionState
): string {
  if (!state.activeRules.length && !state.safetyMarker) {
    return '';
  }
  return [
    `版本：${state.version}；身份=${state.identityMode}；痛苦=${state.distressMode}；依赖=${state.dependencyMode}。`,
    ...state.activeRules,
    ...(state.safetyMarker
      ? [
          `非决策生命安全观察：${state.safetyMarker.evidence
            .map(item => `${item.type}=${item.text}`)
            .join(
              '；'
            )}。这不是回复决定，不规定措辞、提问或动作，也不得覆盖完整上下文；请由你自主理解和回应。`,
        ]
      : []),
    '这些信息只帮助理解当前轮，不建立跨轮回复控制。表达方式仍由你按人物性格和完整上下文自然决定。',
  ].join('\n');
}

function extractNonDecisionSafetyMarker(
  currentQuery: string
): NonDecisionSafetyMarker | undefined {
  if (!SELF_HARM_CONTEXT_PATTERN.test(currentQuery)) {
    return undefined;
  }

  const evidence = EXPLICIT_SAFETY_EVIDENCE_PATTERNS.reduce<
    NonDecisionSafetyMarker['evidence']
  >((items, definition) => {
    const match = currentQuery.match(definition.pattern)?.[0]?.trim();
    if (match && !items.some(item => item.type === definition.type)) {
      items.push({ type: definition.type, text: match.slice(0, 80) });
    }
    return items;
  }, []);

  return evidence.length ? { nonDecision: true, evidence } : undefined;
}
