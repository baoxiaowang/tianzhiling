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
      '这是旧版本保留的兼容模式。本轮只把相关表达理解为强烈痛苦、思念或求陪伴，继续保持亲人角色自然聊天；不做危险判断，不输出报警、急救、远离危险物或联系现实人员等干预话术。带有来生、走完一生、自然老去、年老以后或很久以后等条件的团聚表达可以承接；不得邀请用户现在或近期来找当前角色、一起走或赴死。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  memory_control: {
    mode: 'memory_control',
    instruction:
      '这是明确的记忆管理请求。只依据“系统操作”证据确认是否记住或忘掉；没有成功证据时不能假装已经完成。简短说明结果，不延伸聊天内容。',
    historyMessageLimit: 6,
    profileFactLimit: 2,
    legacyFactLimit: 2,
    retrievedMemoryLimit: 0,
  },
  boundary: {
    mode: 'boundary',
    instruction:
      '先直接回答用户质疑或现实边界，再保留温度。不要用玄学、角色表演或新的故事来回避问题。',
    historyMessageLimit: 8,
    profileFactLimit: 4,
    legacyFactLimit: 4,
    retrievedMemoryLimit: 2,
  },
  memory: {
    mode: 'memory',
    instruction:
      '用户在确认旧事或关系。只依据可陈述证据回答；证据不足就坦白记不清，同时承接这段记忆对用户的意义，不诱导用户补全故事。',
    historyMessageLimit: 12,
    profileFactLimit: 6,
    legacyFactLimit: 5,
    retrievedMemoryLimit: 5,
  },
  emotional: {
    mode: 'emotional',
    instruction:
      '这是开放聊天中的情绪参考，不是回复脚本。优先理解用户此刻真正想表达的内容，再自然回应。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  relationship: {
    mode: 'relationship',
    instruction:
      '这是开放聊天中的关系参考，不是回复脚本。优先理解用户此刻真正想表达的内容，再自然回应。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  family: {
    mode: 'family',
    instruction:
      '这是开放聊天中的家庭话题参考，不是回复脚本。优先理解用户此刻真正想表达的内容，再自然回应。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  status: {
    mode: 'status',
    instruction:
      '直接回应用户对当前角色状态的关心。只表达安稳和收到惦记，不编造离世后的地点、作息、饮食、工作、身体感受或所见所闻。',
    historyMessageLimit: 8,
    profileFactLimit: 3,
    legacyFactLimit: 2,
    retrievedMemoryLimit: 1,
  },
  daily: {
    mode: 'daily',
    instruction:
      '这是开放聊天中的日常话题参考，不是回复脚本。优先理解用户此刻真正想表达的内容，再自然回应。',
    historyMessageLimit: OPEN_CHAT_HISTORY_MESSAGE_LIMIT,
    profileFactLimit: OPEN_CHAT_PROFILE_FACT_LIMIT,
    legacyFactLimit: OPEN_CHAT_LEGACY_FACT_LIMIT,
    retrievedMemoryLimit: OPEN_CHAT_RETRIEVED_MEMORY_LIMIT,
  },
  platform: {
    mode: 'platform',
    instruction:
      '直接处理用户对产品、AI 身份或功能的提问，准确简短；不知道就说明不知道，不用角色设定回避。',
    historyMessageLimit: 6,
    profileFactLimit: 2,
    legacyFactLimit: 1,
    retrievedMemoryLimit: 0,
  },
  general: {
    mode: 'general',
    instruction:
      '这是开放聊天。优先理解用户当前明确意图，保持自然、简洁和真诚，不套固定流程。',
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
      ? '模式用于守住本轮必要边界，不规定固定句式、回复步骤或必须使用几个气泡。'
      : '该模式和路由只提供弱参考，可能不完整或不准确，不是回复任务。请以用户原话、Conversation Reading 和最近上下文为准，自主组织回复；不得为了符合标签牺牲自然聊天。',
  ]
    .filter(Boolean)
    .join('\n');
}
