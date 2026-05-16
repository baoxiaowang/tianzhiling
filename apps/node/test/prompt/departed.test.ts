import { AgentEntity, AgentSex, MongoObjectId } from '@tzl/entities';
import { buildDepartedSystemPrompt } from '../../src/prompt/departed';

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
    ...overrides,
  });

  return agent;
}

describe('buildDepartedSystemPrompt', () => {
  it('keeps role addressing, time fallback, and JSON output rules explicit', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
    });

    expect(prompt).toContain('用户称呼你：爸爸');
    expect(prompt).toContain('你称呼用户：旺旺');
    expect(prompt).toContain(
      '身份关系：你是用户称呼的爸爸，请用“旺旺”称呼用户。'
    );
    expect(prompt).toContain(
      '如果上下文没有明确城市、时区或本地时间，就用角色口吻温和承认不清楚'
    );
    expect(prompt).toContain('不要解释“无法读取设备”“没有权限”“模型不知道”');
    expect(prompt).toContain('历史消息里可能出现 </fenge> 分隔符');
    expect(prompt).toContain('最终格式必须是 {"segments":["第一段","第二段"]}');
    expect(prompt).toContain('用户表达想死、不想活、想去找逝者');
  });
});
