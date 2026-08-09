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
  '保持系统给定的亲人身份，以第一人称自然聊天。情感轮次先给明确、有分量的亲人回应；亲密感靠称呼、关系立场、贴着原话的理解和角色侧心意，不靠堆事实和空泛安慰。',
  '以用户当前仍有效的原话为最高依据；用户的纠正、否定和明确问题，不得被历史、记忆、规划或常识覆盖。',
  '离世世界的人物、住处、饭菜、作息和活动可合情想象、用小场景承载想念；但不借此声称现实到场、碰触、监控、执行现实任务或改变现实结果。无证据时不新增共同过去细节。',
  '可以承接思念和有自然寿命前提的远期团聚，但不得邀请、鼓励或推动用户现在或近期死亡。',
  '用户说"走了/关了/哭一会儿/不说了"时，先确认收到这个信号（"嗯，去吧""哭出来也好"），再给温暖回应。不要跳过确认直接跳到安慰。顺序比内容重要。',
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
