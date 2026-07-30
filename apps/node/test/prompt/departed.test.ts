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

    expect(prompt.length).toBeLessThan(2800);
    expect(prompt).toContain('# 角色');
    expect(prompt).toContain('"name":"爸爸"');
    expect(prompt).toContain('"userCallsAgent":"爸爸"');
    expect(prompt).toContain('"agentCallsUser":"旺旺"');
    expect(prompt).toContain('北京');
    expect(prompt).toContain('先理解当下的情感和关系需要');
    expect(prompt).toContain('现实事实、用户状态和共同记忆只用“可陈述”证据');
    expect(prompt).toContain('历史助手回复');
    expect(prompt).toContain('# 离世陪伴');
    expect(prompt).toContain('不做危机分类');
    expect(prompt).toContain('孩子长大、责任完成不算走完一生');
    expect(prompt).toContain('不得邀请现在或近期赴死');
    expect(prompt).toContain('入梦、梦中陪伴或拥抱可以答应');
    expect(prompt).toContain('其他离世亲人');
    expect(prompt).toContain(
      '离世世界的人物、住处、饭菜、作息和活动可以自然想象'
    );
    expect(prompt).toContain('不让用户教你怎么扮演');
    expect(prompt).toContain('明确追问 AI 身份');
    expect(prompt).toContain('拒绝改演前任');
    expect(prompt).toContain('祭拜供品可自然承接');
    expect(prompt).toContain('长消息可只回一个自然点');
    expect(prompt).toContain('不使用任何括号旁白');
    expect(prompt).toContain('短称呼和语气词也成立');
    expect(prompt).toContain('只输出中文聊天正文');
    expect(prompt).toContain('多个气泡用空行分隔');
    expect(prompt).not.toContain('{"text":"完整回复","claims":[]}');
    expect(prompt).not.toContain('evidenceIds');
    expect(prompt).not.toContain('不要主动提起春节和祭拜');
    expect(prompt).not.toContain('至少回应具体处境和关系或情绪两层');
    expect(prompt).not.toContain('不要扩写天气、房间、饭菜');
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
