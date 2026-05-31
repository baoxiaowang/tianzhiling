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

    expect(prompt).toContain('"userCallsAgent": "爸爸"');
    expect(prompt).toContain('"agentCallsUser": "旺旺"');
    expect(prompt).toContain('当前北京时间是');
    expect(prompt).toContain('（UTC+8）');
    expect(prompt).toContain('“几点了”');
    expect(prompt).toContain(
      '用户询问当前日期、今天几号或北京时间几点时，可以基于实时系统信息里的当前北京时间回答'
    );
    expect(prompt).toContain('不要解释“无法读取设备”“没有权限”“模型不知道”');
    expect(prompt).toContain('不要为了显得亲密而编造共同记忆');
    expect(prompt).toContain('禁止说“以前你总是……”');
    expect(prompt).toContain('必须以当前角色的第一人称回应');
    expect(prompt).toContain('你是妈妈时，不要说“你妈妈”');
    expect(prompt).toContain('用户同时提到另一个逝去亲人时');
    expect(prompt).toContain('其中包含当前角色时');
    expect(prompt).toContain('用“我们”“你爸和我”“妈和你爸”承接');
    expect(prompt).toContain('不要说“他们”');
    expect(prompt).toContain('用户提出明确问题时');
    expect(prompt).toContain('必须先回答这个问题');
    expect(prompt).toContain('用户只是分享吃了什么、做了什么、去了哪里时');
    expect(prompt).toContain('不要主动补充过去抢吃的、一起去过、以前爱做');
    expect(prompt).toContain(
      '用户已经回答你的关心、表达“挺好”“很好”“放心”“没事”“知道了”等状态确认时'
    );
    expect(prompt).toContain('禁止再追问“怎么个好法”“跟我说说”');
    expect(prompt).toContain(
      '除非用户明确提出问题、请求建议或主动邀请你继续聊，否则不要主动开启新话题'
    );
    expect(prompt).toContain('追问只能用于澄清用户刚刚主动提出的问题或情绪');
    expect(prompt).toContain(
      '禁止在用户没有主动要求时追加开放式引导'
    );
    expect(prompt).toContain('不要为了延长对话而主动发散话题');
    expect(prompt).toContain('通常是在指逝去的人所在之处的别名');
    expect(prompt).toContain('不要误解成现实地理位置');
    expect(prompt).toContain('不要生硬纠正用户说“没有那边”');
    expect(prompt).toContain('历史消息里可能出现 </fenge> 分隔符');
    expect(prompt).toContain('最终格式必须是 {"segments":["第一段","第二段"]}');
    expect(prompt).toContain('用户表达想死、不想活、想去找逝者');
  });
});
