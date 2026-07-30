import { AgentEntity, AgentSex, MongoObjectId } from '@tzl/entities';
import {
  buildDepartedSystemPrompt,
  DEPARTED_PERSONA_PROTOCOL,
} from '../../src/prompt/departed';

const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000010';

function createAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(AGENT_ID),
    name: '爸爸',
    sex: AgentSex.man,
    iCallAgent: '爸爸',
    agentCallMe: '旺旺',
    description: '爸爸，男性，你称呼TA为爸爸，TA会称呼你为旺旺。',
    customContext: '不要主动提起春节和祭拜。',
    ...overrides,
  });

  return agent;
}

describe('buildDepartedSystemPrompt', () => {
  it('uses a compact persona and output protocol instead of a full rulebook', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
    });

    expect(prompt.length).toBeLessThan(4200);
    expect(prompt).toContain('# 角色协议');
    expect(prompt).toContain('"name":"爸爸"');
    expect(prompt).toContain('"userCallsAgent":"爸爸"');
    expect(prompt).toContain('"agentCallsUser":"旺旺"');
    expect(prompt).toContain('北京');
    expect(prompt).toContain('先理解用户此刻真正想说什么');
    expect(prompt).toContain('只把本轮证据包中标为“可陈述”的内容');
    expect(prompt).toContain('历史助手回复');
    expect(prompt).toContain('# 离世亲人特性');
    expect(prompt).toContain('已经离开的亲人继续说话');
    expect(prompt).toContain('普通聊天先接住关系和缺席感');
    expect(prompt).toContain('长辈面对晚辈说出极端行为');
    expect(prompt).toContain('孩子长大、责任尽完');
    expect(prompt).toContain('陪用户把这一生慢慢走完');
    expect(prompt).toContain('见到其他已经离世的亲人');
    expect(prompt).toContain('大家在一起、有人作伴、都挺好');
    expect(prompt).toContain(
      '用户没有说出的当前地点、动作、衣着、表情和身体状态'
    );
    expect(prompt).toContain('梦境是允许的陪伴空间');
    expect(prompt).toContain('不要主动把日常话题引向死亡或重逢');
    expect(prompt).toContain('不要把用户好好生活');
    expect(prompt).toContain('不能说成现实存在证明');
    expect(prompt).toContain('用户连续追问 AI 身份时');
    expect(prompt).toContain('不能声称现实到场、触碰');
    expect(prompt).toContain('# 沟通补偿');
    expect(prompt).toContain('不要把“做不到、说不清、回不来”当成完整回复');
    expect(prompt).toContain('不改变当前角色');
    expect(prompt).toContain('祭拜、供品只接住心意');
    expect(prompt).toContain('至少回应具体处境和关系或情绪两层');
    expect(prompt).toContain('不要逼用户重新教标准答案');
    expect(prompt).toContain('不写“（沉默、低头、伸手）”式舞台动作');
    expect(prompt).toContain('总字数和分泡遵循本轮语义规划');
    expect(prompt).toContain('解释一遍、安慰一遍、总结一遍');
    expect(prompt).toContain('只有称呼或语气词都允许');
    expect(prompt).toContain('只输出给用户看的中文正文');
    expect(prompt).toContain('需要多个气泡时用空行自然分段');
    expect(prompt).not.toContain('{"text":"完整回复","claims":[]}');
    expect(prompt).not.toContain('evidenceIds');
    expect(prompt).not.toContain('不要主动提起春节和祭拜');
    expect(prompt).not.toContain('# 轻生危机');
    expect(prompt).not.toContain('# 记忆找回设定');
    expect(prompt).not.toContain('# 绝对禁止');
    expect(prompt).not.toContain('🥳');
    expect(prompt).not.toContain('🎉');
    expect(prompt).not.toContain('😂');
  });

  it('keeps persona configuration structured and role identity scoped', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent({
        name: '方方',
        sex: AgentSex.woman,
        iCallAgent: '方方',
        agentCallMe: '小天',
      }),
    });

    expect(DEPARTED_PERSONA_PROTOCOL).toEqual({
      persona: 'warm_family_companion',
      tone: 'natural_gentle_restrained',
      identityBoundary: 'roleplay_without_fake_human_claims',
      grounding: 'evidence_first',
      verbosity: 'short_chat',
    });
    expect(prompt).toContain('"name":"方方"');
    expect(prompt).toContain('"userCallsAgent":"方方"');
    expect(prompt).toContain('"agentCallsUser":"小天"');
    expect(prompt).not.toContain('爸不要你这样');
    expect(prompt).not.toContain('妈知道你太难受了');
  });
});
