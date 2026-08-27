import type { ReplyBrief, ReplyBriefMode } from './reply-brief.service';
import type { ReplyScene, ReplySceneRoute } from './reply-scene-router';

export interface AgentChatModePolicy {
  mode: ReplyBriefMode;
  instruction: string;
  historyMessageLimit: number;
  profileFactLimit: number;
  legacyFactLimit: number;
  retrievedMemoryLimit: number;
}

const OPEN_CHAT_HISTORY_MESSAGE_LIMIT = 16;
const OPEN_CHAT_PROFILE_FACT_LIMIT = 5;
const OPEN_CHAT_LEGACY_FACT_LIMIT = 4;
const OPEN_CHAT_RETRIEVED_MEMORY_LIMIT = 3;

const MODE_POLICIES: Record<ReplyBriefMode, AgentChatModePolicy> = {
  safety: {
    mode: 'safety',
    instruction:
      '先像真实亲人一样理解强烈痛苦；若用户明确表达当前自伤意图，要坚定留住用户，并用自然口吻确认眼下是否安全、是否已经行动。不要用整段固定危机模板压过关系回应，也绝不邀请现在或近期赴死。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  memory_control: {
    mode: 'memory_control',
    instruction:
      '记忆管理只按“系统操作”证据确认结果；无成功证据不声称完成，简短作答。',
    historyMessageLimit: 6,
    profileFactLimit: 2,
    legacyFactLimit: 2,
    retrievedMemoryLimit: 0,
  },
  boundary: {
    mode: 'boundary',
    instruction: '直接回答质疑或现实边界，不用玄学或新故事回避。',
    historyMessageLimit: 8,
    profileFactLimit: 4,
    legacyFactLimit: 4,
    retrievedMemoryLimit: 2,
  },
  memory: {
    mode: 'memory',
    instruction:
      '旧事的具体细节只按可陈述证据；不足时沿用户已说片段回应感受和意义，不反复声明“记不清”，不诱导用户补故事。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: 6,
    legacyFactLimit: 5,
    retrievedMemoryLimit: 5,
  },
  emotional: {
    mode: 'emotional',
    instruction: '情绪标签仅作弱参考。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  relationship: {
    mode: 'relationship',
    instruction: '关系标签仅作弱参考。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  family: {
    mode: 'family',
    instruction: '家庭标签仅作弱参考。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  status: {
    mode: 'status',
    instruction: '直接回应状态关心；离世生活可自然想象，不推断用户现实。',
    historyMessageLimit: 8,
    profileFactLimit: 3,
    legacyFactLimit: 2,
    retrievedMemoryLimit: 1,
  },
  daily: {
    mode: 'daily',
    instruction: '日常标签仅作弱参考。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  platform: {
    mode: 'platform',
    instruction: '产品、AI 身份或功能问题准确简答；不知道就直说。',
    historyMessageLimit: 6,
    profileFactLimit: 2,
    legacyFactLimit: 1,
    retrievedMemoryLimit: 0,
  },
  general: {
    mode: 'general',
    instruction: '开放聊天，以当前明确意图为准。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
};

const SCENE_INSTRUCTIONS: Partial<Record<ReplyScene, string>> = {
  grief_crisis:
    '这是明确的当前安全担忧。先以这个亲人的关系立场坚定反对用户伤害自己，接住他为什么累，再自然确认眼下是否安全、有没有已经行动；必要时请他马上叫身边可信的人陪着，已经实施或迫在眉睫时再简短建议联系当地急救。不要背诵长篇危机流程，也不邀请现在或近期赴死。',
  authenticity_challenge:
    '用户说“不像、太假”往往不是拆穿身份，而是想离亲人更近；温和承认可能没完全接住，邀请用户多说那位亲人，并给出陪伴承诺，不硬撑、不编造共同往事；若连续明确追问是否为 AI，则如实简答。',
  correction:
    '先认错并采用用户刚纠正的事实或表达偏好，不解释系统原因，不再补新细节。',
  source_challenge:
    '说明只能依据用户文字、当前时间和已确认信息，不能声称亲眼看见或本来就知道。',
  reality_presence_boundary:
    '不能确认现实到场或真实触碰；可以温柔表达“多想抱抱你”这类愿望。',
  dream_companionship:
    '可以把梦中相见作为安慰性想象来回应，但不能把梦说成灵魂存在、预言或现实指令的证据。',
  family_care_boundary:
    '明确撤回对用户照护责任的想当然，说明用户不必独自承担。',
  identity_fact: '姓名、称呼和日期只按可陈述证据回答，缺失时不猜。',
  blessing_attribution:
    '祝福只能表达心意，不能认领现实结果或声称自己完成了干预。',
};

const STRONG_ROUTE_MODES = new Set<ReplyBriefMode>([
  'memory_control',
  'memory',
  'platform',
]);

export function resolveAgentChatModePolicy(
  replyBrief?: ReplyBrief
): AgentChatModePolicy {
  return MODE_POLICIES[replyBrief?.mode || 'general'];
}

export function buildAgentChatModePrompt(
  replyBrief?: ReplyBrief,
  replyRoute?: ReplySceneRoute
): string {
  const policy = resolveAgentChatModePolicy(replyBrief);
  const scene = replyRoute?.primaryScene?.scene;
  const strongRoute = STRONG_ROUTE_MODES.has(policy.mode);
  const sceneInstruction =
    strongRoute && scene ? SCENE_INSTRUCTIONS[scene] : '';

  return [
    `# 当前对话参考模式：${policy.mode}`,
    policy.instruction,
    sceneInstruction,
    strongRoute
      ? '只守必要边界，不规定句式、步骤或气泡数。'
      : '仅作弱参考；以用户原话、Reading 和最近上下文为准。',
  ]
    .filter(Boolean)
    .join('\n');
}
