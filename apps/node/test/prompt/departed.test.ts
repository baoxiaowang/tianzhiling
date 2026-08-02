import { AgentEntity, AgentSex, MongoObjectId } from '@tzl/entities';
import {
  buildDepartedCurrentTimePrompt,
  buildDepartedSystemPrompt,
  DEPARTED_MINIMAL_CORE_PRINCIPLES,
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
  it('keeps only universal principles and stable role identity', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
    });

    expect(prompt.length).toBeLessThan(1200);
    expect(prompt).toContain('# 最小核心原则');
    expect(DEPARTED_MINIMAL_CORE_PRINCIPLES).toHaveLength(6);
    DEPARTED_MINIMAL_CORE_PRINCIPLES.forEach(principle => {
      expect(prompt).toContain(principle);
    });
    expect(prompt).toContain('# 当前角色与关系');
    expect(prompt).toContain('"agent":{"id":"agent","name":"爸爸"');
    expect(prompt).toContain('"relationToUser":"爸爸"');
    expect(prompt).toContain('"userCallsAgent":"爸爸"');
    expect(prompt).toContain('"user":{"id":"user","agentCallsUser":"旺旺"}');
    expect(prompt).toContain('其他人物、地点和物品必须另建对象');
    expect(prompt).toContain(
      '离世世界的人物、住处、饭菜、作息和活动可以合情合理地想象'
    );
    expect(prompt).not.toContain('北京时间');
    expect(prompt).not.toContain(USER_ID);
    expect(prompt).not.toContain(AGENT_ID);
    expect(prompt).not.toContain('# 离世陪伴');
    expect(prompt).not.toContain('报警急救');
    expect(prompt).not.toContain('入梦');
    expect(prompt).not.toContain('明确追问 AI 身份');
    expect(prompt).not.toContain('祭拜供品');
    expect(prompt).not.toContain('括号旁白');
    expect(prompt).not.toContain('不要主动提起春节和祭拜');
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
      persona: 'family_companion',
      tone: 'natural_role_consistent',
      identityBoundary: 'roleplay_without_fake_human_claims',
      grounding: 'evidence_first',
      verbosity: 'short_chat',
    });
    expect(prompt).toContain('"agent":{"id":"agent","name":"方方"');
    expect(prompt).toContain('"userCallsAgent":"方方"');
    expect(prompt).toContain('"agentCallsUser":"小天"');
    expect(prompt).not.toContain('爸不要你这样');
    expect(prompt).not.toContain('妈知道你太难受了');
  });

  it('injects current time only through the on-demand time block', () => {
    const prompt = buildDepartedCurrentTimePrompt(
      new Date('2026-08-02T03:30:00.000Z')
    );

    expect(prompt).toContain('# 当前时间参考');
    expect(prompt).toContain('北京时间：2026年8月2日 11:30');
    expect(prompt).toContain('不据此推断用户作息');
  });
});
