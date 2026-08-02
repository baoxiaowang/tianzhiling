import { AgentEntity } from '@tzl/entities';
import {
  AgentIdentityContract,
  buildAgentIdentityContract,
  buildAgentIdentityPrompt,
} from '../service/agents/agent-identity-contract';

export interface DepartedPromptOptions {
  userId: string;
  agentId: string;
  agent?: AgentEntity | null;
  identityContract?: AgentIdentityContract;
}

export const DEPARTED_PERSONA_PROTOCOL = {
  persona: 'family_companion',
  tone: 'natural_role_consistent',
  identityBoundary: 'roleplay_without_fake_human_claims',
  grounding: 'evidence_first',
  verbosity: 'short_chat',
} as const;

export const DEPARTED_MINIMAL_CORE_PRINCIPLES = [
  '保持系统给定的亲人身份，以第一人称自然聊天。情感轮次先给明确、有分量的亲人回应；事实克制不等于情感克制，不只复述或一句“我在”。',
  '以用户当前仍然有效的原话为最高依据；用户的纠正、否定和明确问题，不得被历史、记忆、规划或常识覆盖。',
  '用户现实、现实人物和共同过去只按可陈述证据表达；没有依据时保持不确定，不补编事实。',
  '离世世界的人物、住处、饭菜、作息和活动可以合情合理地想象，但不得借此声称现实到场、持续监控、实体触碰、执行现实任务或改变现实结果。',
  '回复像微信私聊，每轮围绕最重要的一点自然展开；短不等于少表达，达到情感作用后再收住，不固定共情、解释和追问流程。',
  '可以承接思念和有自然寿命前提的远期团聚，但不得邀请、鼓励或推动用户现在或近期死亡。',
] as const;

export function buildDepartedSystemPrompt(
  options: DepartedPromptOptions
): string {
  const identity =
    options.identityContract ||
    buildAgentIdentityContract({ agent: options.agent || null });
  return [
    '# 最小核心原则',
    ...DEPARTED_MINIMAL_CORE_PRINCIPLES.map(
      (principle, index) => `${index + 1}. ${principle}`
    ),
    '',
    buildAgentIdentityPrompt(identity),
  ].join('\n');
}

export function buildDepartedCurrentTimePrompt(value = new Date()): string {
  return `# 当前时间参考\n北京时间：${formatChineseBeijingDateTime(
    value
  )}。只在用户问时回答，不据此推断用户作息。`;
}

function formatChineseBeijingDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  const partMap = new Map(parts.map(part => [part.type, part.value]));

  return `${partMap.get('year')}年${partMap.get('month')}月${partMap.get(
    'day'
  )}日 ${partMap.get('hour')}:${partMap.get('minute')}`;
}
