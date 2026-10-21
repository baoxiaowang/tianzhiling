import { AgentEntity, AgentSex, MongoObjectId } from '@tzl/entities';
import {
  buildDepartedCompanionCorePrompt,
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

    expect(prompt.length).toBeLessThan(1600);
    expect(prompt).toContain('# 最小核心原则');
    expect(DEPARTED_MINIMAL_CORE_PRINCIPLES).toHaveLength(9);
    DEPARTED_MINIMAL_CORE_PRINCIPLES.forEach(principle => {
      expect(prompt).toContain(principle);
    });
    expect(DEPARTED_MINIMAL_CORE_PRINCIPLES.join('')).not.toContain(
      '不要根据当前时间推断'
    );
    expect(prompt).toContain('# 当前角色与关系');
    // 空值和与显示名重复的字段不再渲染，身份 JSON 保持最小。
    expect(prompt).toContain(
      '"agent":{"id":"agent","name":"爸爸","sex":"男性"}'
    );
    expect(prompt).toContain('"user":{"id":"user","agentCallsUser":"旺旺"}');
    expect(prompt).not.toContain('"realName":"未知"');
    expect(prompt).not.toContain('"preferredName":"未设置"');
    expect(prompt).not.toContain('"aliases":[]');
    expect(prompt).not.toContain('"relationToUser":"爸爸"');
    expect(prompt).not.toContain('"userCallsAgent":"爸爸"');
    expect(prompt).toContain('其他人物、地点和物品必须另建对象');
    expect(prompt).toContain(
      '亲密感靠称呼、关系立场、贴着原话的理解和角色侧心意'
    );
    expect(prompt).toContain('这是用户递给你的关系动作');
    expect(prompt).toContain('按人物性格接住');
    expect(prompt).toContain('别挡回去');
    expect(prompt).toContain('别用固定句式或额外气泡完成它');
    // 身份质疑不解释系统、不自证。
    expect(prompt).toContain('不解释系统、不自证身份');
    expect(prompt).not.toContain('我吃过了，你总惦记我，我心里暖');
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
      verbosity: 'relationship_adaptive',
    });
    expect(prompt).toContain('"agent":{"id":"agent","name":"方方","sex":"女性"}');
    expect(prompt).toContain('"agentCallsUser":"小天"');
    expect(prompt).not.toContain('爸不要你这样');
    expect(prompt).not.toContain('妈知道你太难受了');
  });

  it('keeps the companion core person-first rather than rule-first', () => {
    const prompt = buildDepartedCompanionCorePrompt();

    expect(prompt).toContain('# 陪伴心法');
    expect(prompt).toContain('在天之灵');
    expect(prompt).toContain('记忆回声');
    expect(prompt).toContain('真诚比正确重要');
    expect(prompt).toContain('先回答字面问题');
    // “每轮先判断用户需要什么 / 回应后自然收住”只在稳定段 `# 主模型自主理解`
    // 保留一处，陪伴心法不再重复。
    expect(prompt).not.toContain('每轮先在心里判断');
    expect(prompt).not.toContain('自然决定停住');
    expect(prompt).not.toContain('输出合同');
    expect(prompt).not.toContain('riskLevel');
  });

  it('injects current time only through the on-demand time block', () => {
    const prompt = buildDepartedCurrentTimePrompt(
      new Date('2026-08-02T03:30:00.000Z')
    );

    expect(prompt).toContain('# 当前时间参考');
    expect(prompt).toContain('北京时间：2026年8月2日 11:30');
  });
});
