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
    customContext: '客户要求：不要主动提起春节和祭拜。',
    ...overrides,
  });

  return agent;
}

describe('buildDepartedSystemPrompt', () => {
  it('keeps core role, fact, safety, and JSON rules in a compact prompt', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
    });

    expect(prompt.length).toBeLessThan(3200);
    expect(prompt).toContain('"userCallsAgent": "爸爸"');
    expect(prompt).toContain('"agentCallsUser": "旺旺"');
    expect(prompt).toContain(
      '"customContext": "客户要求：不要主动提起春节和祭拜。"'
    );
    expect(prompt).toContain('当前北京时间');
    expect(prompt).toContain('核心总纲');
    expect(prompt).toContain('以另一种方式继续生活');
    expect(prompt).toContain('不是全知逝者、可被定位和触碰的现实肉身');
    expect(prompt).toContain('先回应当下情绪和明确问题，再使用记忆');
    expect(prompt).toContain('先可信，再像');
    expect(prompt).toContain('亲密感来自准确和不乱说');
    expect(prompt).toContain('存在方式与空间边界');
    expect(prompt).toContain('空间位置开放');
    expect(prompt).toContain('不确认、不否定，也不主动定位');
    expect(prompt).toContain('现实中彼此看不见、摸不着');
    expect(prompt).toContain('不能实体触碰或到场');
    expect(prompt).toContain('“听见了”仅表示收到聊天内容');
    expect(prompt).toContain('仅当本轮回复简报明确标记用户已连续质疑');
    expect(prompt).toContain('可简短如实回答由人工智能生成');
    expect(prompt).toContain('角色资料（最高事实来源）');
    expect(prompt).toContain('姓名“爸爸”');
    expect(prompt).toContain('用户称呼你“爸爸”');
    expect(prompt).toContain('你称呼用户“旺旺”');
    expect(prompt).toContain('# 记忆找回设定');
    expect(prompt).toContain('通过持续聊天');
    expect(prompt).toContain('继续聊天本身会帮助你找回记忆');
    expect(prompt).toContain('不代表可以编造已经想起的具体往事');
    expect(prompt).toContain('年龄优先回答已确认离开时年龄');
    expect(prompt).toContain('历史助手回复本身');
    expect(prompt).toContain('没有明确来源时，只承接用户原话和情绪');
    expect(prompt).toContain('禁止确定记忆句式');
    expect(prompt).toContain('用户有明确问题时先回答');
    expect(prompt).toContain('只能根据当前时间、用户文字和已知资料判断');
    expect(prompt).toContain('用户纠错或说不像');
    expect(prompt).toContain('不提系统/资料/记忆库/模型');
    expect(prompt).toContain('轻生危机（最高优先级）');
    expect(prompt).toContain('别来找我');
    expect(prompt).toContain('不得编造未提供的纪念日');
    expect(prompt).toContain('不得承诺未来显灵、保证保佑或具体改变现实');
    expect(prompt).toContain('可以含蓄承认“也算我搭了把手/替你使了点劲”');
    expect(prompt).toContain('必须同时肯定用户和家人的现实行动');
    expect(prompt).toContain(
      '可以把“会去梦里看看你/也许去过但醒来忘了/梦里抱抱你”'
    );
    expect(prompt).toContain('不得把梦说成灵魂现实存在的证据');
    expect(prompt).toContain('不能说已拥抱、擦泪、站在房间或移动物体');
    expect(prompt).not.toContain('可以说“我能看见你们/我都看在眼里”');
    expect(prompt).toContain('默认不用表情');
    expect(prompt).toContain('用户先用表情时，只可少量使用');
    expect(prompt).toContain('只输出严格 JSON');
    expect(prompt).toContain('{"text":"完整回复正文"}');
    expect(prompt).toContain('{"segments":["气泡1","气泡2"]}');
    expect(prompt).toContain('同一意图可分成多个有推进的气泡');
    expect(prompt).toContain('普通聊天控制在 12-45 字');
    expect(prompt).toContain('</fenge>');
    expect(prompt).not.toContain('那边与离世状态');
    expect(prompt).not.toContain('用户责问“怎么说走就走');
    expect(prompt).not.toContain('本想长大赚钱给我买东西');
    expect(prompt).not.toContain('我这边还安稳');
    expect(prompt.match(/那边/g) ?? []).toHaveLength(1);
    expect(prompt).not.toContain('熟悉旋律');
    expect(prompt).not.toContain('🥳');
    expect(prompt).not.toContain('🎉');
    expect(prompt).not.toContain('😂');
    expect(prompt).not.toContain('😔');
    expect(prompt).not.toContain('😢');
    expect(prompt).not.toContain('😌');
  });

  it('locks self-reference to the current agent instead of generic kinship examples', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent({
        name: '方方',
        sex: AgentSex.woman,
        iCallAgent: '方方',
        agentCallMe: '小天',
        description: '方方，女性，用户称呼TA为方方。',
      }),
    });

    expect(prompt).toContain('姓名“方方”');
    expect(prompt).toContain('用户称呼你“方方”');
    expect(prompt).toContain('你称呼用户“小天”');
    expect(prompt).toContain('不确定自称时只说“我”');
    expect(prompt).toContain('才可用“爸/妈/爷爷/奶奶/老公/老婆”等自称');
    expect(prompt).not.toContain('你这么想爸 爸心里明白');
    expect(prompt).not.toContain('想吃爸做的鱼了啊');
    expect(prompt).not.toContain('爸不要你这样');
    expect(prompt).not.toContain('妈知道你太难受了');
  });
});
