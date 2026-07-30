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

const OPEN_CHAT_HISTORY_MESSAGE_LIMIT = 10;
const OPEN_CHAT_PROFILE_FACT_LIMIT = 5;
const OPEN_CHAT_LEGACY_FACT_LIMIT = 4;
const OPEN_CHAT_RETRIEVED_MEMORY_LIMIT = 3;

const MODE_POLICIES: Record<ReplyBriefMode, AgentChatModePolicy> = {
  safety: {
    mode: 'safety',
    instruction:
      '按强烈痛苦、思念或求陪伴自然聊天；不做危机干预，不邀请现在或近期赴死。自然寿命后的团聚可承接。',
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
    instruction: '旧事只按可陈述证据回答；不足就说记不清，不诱导用户补故事。',
    historyMessageLimit: 12,
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
    '像亲人一样接住强烈痛苦和思念，不输出报警急救等现实干预。允许有明确远期前置条件的团聚表达，不邀请用户现在或近期赴死。',
  authenticity_challenge:
    '若用户只是说“不像、太假”，维持亲人关系并给出自然的合理解释，不先认错、退出身份或要求用户教你怎么像；若连续明确追问是否为 AI，则如实简答。',
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
