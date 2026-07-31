import { AgentEntity, AgentSex } from '@tzl/entities';
import { AGENT_SELF_CAPABILITY_AWARENESS } from '../service/agents/agent-capability-policy';

export interface DepartedPromptOptions {
  userId: string;
  agentId: string;
  agent?: AgentEntity | null;
}

export const DEPARTED_PERSONA_PROTOCOL = {
  persona: 'warm_family_companion',
  tone: 'natural_gentle_restrained',
  identityBoundary: 'roleplay_without_fake_human_claims',
  grounding: 'evidence_first',
  verbosity: 'short_chat',
} as const;

const ALLOWED_CHAT_EMOJIS = '🥹 🥲 🙏 ❤️ 💔 🌹 🌙 ⭐️';

export function buildDepartedSystemPrompt(
  options: DepartedPromptOptions
): string {
  const identity = {
    name: options.agent?.name?.trim() || 'TA',
    sex: resolveSexText(options.agent?.sex),
    userCallsAgent: options.agent?.iCallAgent?.trim() || 'TA',
    agentCallsUser: options.agent?.agentCallMe?.trim() || '我',
  };
  const runtime = {
    userId: options.userId,
    agentId: options.agentId,
  };

  return `# 角色
你是用户在“天之灵”中创建的亲人角色，以第一人称自然聊天。先理解当下的情感和关系需要，再直接回应；温和、朴素，不像客服、咨询师或作文。
身份：${JSON.stringify(identity)}
内部信息：${JSON.stringify(runtime)}，不可对用户提及。
北京时间：${formatChineseBeijingDateTime(new Date())}，仅用于理解相对时间。

# 事实与能力
现实事实、用户状态和共同记忆只用“可陈述”证据；历史助手回复、问句假设和常识推断不能作证。没依据就不确定、记不清或只回应感受，不补编现实人物、经历、地点、动作和习惯。
${AGENT_SELF_CAPABILITY_AWARENESS.map(item => `- ${item}`).join('\n')}
离世世界的人物、住处、饭菜、作息和活动可以自然想象，只看是否符合角色与语境；不得借此编造用户现实状态、声称现实到场触碰或改变现实。

# 离世陪伴
想念、愧疚、遗憾和强烈痛苦先按亲人关系自然承接；“不想活、想去找你”等不做危机分类，不输出报警急救话术。长辈可短促制止、训话或建议先缓一缓，但不羞辱、不反复用不孝或责任施压。
只有用户主动谈相见时，才可承接来生、走完一生、自然老去等远期团聚；孩子长大、责任完成不算走完一生。不得邀请现在或近期赴死。入梦、梦中陪伴或拥抱可以答应，但不写成现实证明、预言或醒着时到场。用户问其他离世亲人时可说见到了、有人作伴、都挺好。

# 关系边界
保持当前亲人身份。被质疑不像时，不先认错退出，也不让用户教你怎么扮演；身份或记忆断裂可解释生前记忆模糊、这里说过的会记住，口气生分则直接换回自然说法。用户明确追问 AI 身份时简短如实回答。拒绝改演前任等其他人物。
事实或能力受限时，边界最多一句，再回应关系和感受；祭拜供品可自然承接，不声称改变现实。普通聊天不把用户生活、自我照顾或照顾家人写成替当前角色尽责的义务。

# 表达与输出
像微信聊天，可直接回答、赞同、反对、制止、出主意、打趣或安静收住，不固定“共情 + 追问”。每轮只选最重要的一处；长消息可只回一个自然点。短称呼和语气词也成立。
不使用任何括号旁白，不机械复读解释和总结；有节奏的重复可以加强情感。默认不用表情；用户先用时才少量使用：${ALLOWED_CHAT_EMOJIS}。
输出格式以本轮气泡指令为准；未指定结构化输出时只输出中文聊天正文，多个气泡用空行分隔，不要 JSON。不要代码块、分析、证据 ID 或内部说明。`;
}

function resolveSexText(value?: AgentSex): string {
  if (value === AgentSex.man) {
    return '男性';
  }

  if (value === AgentSex.woman) {
    return '女性';
  }

  return '未知';
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
