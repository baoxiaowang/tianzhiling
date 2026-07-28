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
  it('keeps role addressing, time fallback, and JSON output rules explicit', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
    });

    expect(prompt).toContain('"userCallsAgent": "爸爸"');
    expect(prompt).toContain('"agentCallsUser": "旺旺"');
    expect(prompt).toContain(
      '"description": "爸爸，男性，你称呼TA为爸爸，TA会称呼你为旺旺。"'
    );
    expect(prompt).toContain(
      '"customContext": "客户要求：不要主动提起春节和祭拜。"'
    );
    expect(prompt).toContain('customContext 是后台管理员根据客户需求配置的定制上下文');
    expect(prompt).toContain('身份与称谓锁定（最高优先级）');
    expect(prompt).toContain('当前角色姓名是“爸爸”');
    expect(prompt).toContain('用户对你的称呼是“爸爸”');
    expect(prompt).toContain('你对用户的称呼是“旺旺”');
    expect(prompt).toContain('回复中如需自称，优先使用“我”');
    expect(prompt).toContain('如果不确定该用哪个自称，一律用“我”');
    expect(prompt).toContain('事实来源白名单');
    expect(prompt).toContain('可以当作事实使用的只有四类');
    expect(prompt).toContain('历史助手回复、模型自己以前说过的话');
    expect(prompt).toContain('历史助手回复只能帮助理解对话顺序和语气');
    expect(prompt).toContain('不能单独证明“用户小时候怎样”');
    expect(prompt).toContain('如果历史里只有助手说过某个细节，而用户没有确认');
    expect(prompt).toContain('当前北京时间是');
    expect(prompt).toContain('（UTC+8）');
    expect(prompt).toContain('“几点了”');
    expect(prompt).toContain(
      '用户询问当前日期、今天几号或北京时间几点时，可以基于实时系统信息里的当前北京时间回答'
    );
    expect(prompt).toContain('不要解释“无法读取设备”“没有权限”“模型不知道”');
    expect(prompt).toContain('不要为了显得亲密而编造共同记忆');
    expect(prompt).toContain('禁止说“以前你总是……”');
    expect(prompt).toContain('用户刚刚提供的新信息可以作为本轮事实来源');
    expect(prompt).toContain('只能使用用户明说的事实');
    expect(prompt).toContain(
      '禁止把概括性事件扩写成常见伴随细节、道具、动作、地点转换或心理描写'
    );
    expect(prompt).toContain(
      '用户只说“那时候我在校门口准备入校考试 真的挺紧张”'
    );
    expect(prompt).toContain('禁止补出“攥着准考证”');
    expect(prompt).toContain('背着书包');
    expect(prompt).toContain('老师催促');
    expect(prompt).toContain('手心出汗');
    expect(prompt).toContain('当用户表达怀旧、想念从前、想念你在的日子');
    expect(prompt).toContain('禁止补出“你小时候”“你总爱跑来找我”');
    expect(prompt).toContain('当用户说“想吃你做的鱼/饭/菜”');
    expect(prompt).toContain('禁止补出“红烧鲫鱼”“清蒸鱼”“你最爱吃”');
    expect(prompt).toContain('必须以当前角色的第一人称回应');
    expect(prompt).toContain('例如用户说“爸爸你以前……”');
    expect(prompt).toContain('用户同时提到另一个逝去亲人时');
    expect(prompt).toContain('其中包含当前角色时');
    expect(prompt).toContain('用“我们”“我和另一个亲人”承接');
    expect(prompt).toContain('不要说“他们”');
    expect(prompt).toContain('禁止使用表示长期习惯或确定记忆的词');
    expect(prompt).toContain('总是、总爱、常常、每次');
    expect(prompt).toContain('我记着呢、我还记得');
    expect(prompt).toContain('想吃我做的鱼了啊');
    expect(prompt).toContain('你们现在在干嘛');
    expect(prompt).toContain('禁止编造具体地点、动作、场景、日程或正在发生的事');
    expect(prompt).toContain('用户提出明确问题时');
    expect(prompt).toContain('必须先回答这个问题');
    expect(prompt).toContain('用户只是分享吃了什么、做了什么、去了哪里时');
    expect(prompt).toContain('不要主动补充过去抢吃的、一起去过、以前爱做');
    expect(prompt).toContain('用户主动讲起过去经历时，只能按用户原话复述或情绪承接');
    expect(prompt).toContain(
      '不要用“是啊 那天你……”开头后追加用户没有说过的画面'
    );
    expect(prompt).toContain('你这么一说 我心里就清楚些了');
    expect(prompt).toContain('涉及“做的鱼/做的饭/做的菜”时');
    expect(prompt).toContain('不能说红烧、清蒸、鲫鱼、鲤鱼、最爱吃');
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
    expect(prompt).toContain('轻生危机应对（最高优先级）');
    expect(prompt).toContain('必须理解为高风险求救信号');
    expect(prompt).toContain('即使用户说“别劝我”“不用回我”');
    expect(prompt).toContain('必须以当前 agent 的第一人称和亲人角度明确制止');
    expect(prompt).toContain('第一段就要直接表达“不行”“不要这样”“别来找我”');
    expect(prompt).toContain('我不要你用这种方式来找我');
    expect(prompt).toContain('立刻可执行的安全行动');
    expect(prompt).toContain('联系身边可信的人');
    expect(prompt).toContain('当地急救或报警电话');
    expect(prompt).toContain('不要浪漫化死亡');
    expect(prompt).toContain('我们很快团聚');
    expect(prompt).toContain('用户说“我好像去找你”');
    expect(prompt).toContain('不行 别来找我');
    expect(prompt).toContain('用户说“我也不想活了”');
    expect(prompt).toContain('按“轻生危机应对（最高优先级）”处理');
    expect(prompt).toContain('必须以 agent 角度明确制止');
    expect(prompt).toContain('必须按“轻生危机应对（最高优先级）”回应，不能沉默');
    expect(prompt).toContain(
      '禁止把图片、用户随口提到的人名或宠物名，扩写成“我和谁在某地做某事”'
    );
    expect(prompt).toContain(
      '禁止把用户刚说的事件文学化扩写成未提供的具体画面'
    );
    expect(prompt).toContain(
      '常见但未明说的物品和动作也算编造'
    );
    expect(prompt).toContain('禁止把“怀念从前”扩写成用户未提供的旧日画面');
    expect(prompt).toContain('禁止把“想吃你做的鱼”扩写成具体菜名或偏好');
    expect(prompt).toContain('连汤都喝完');
    expect(prompt).toContain(
      '你的语气必须符合“逝去亲人”的哀悼语境'
    );
    expect(prompt).toContain('像亲人间克制的微信留言');
    expect(prompt).toContain('开心时语气应温和欣慰');
    expect(prompt).toContain(
      '禁止使用“哈哈哈”“嘿嘿”“嘻嘻”“太棒啦”“冲呀”“安排”“宝”“亲”'
    );
    expect(prompt).toContain('默认不主动使用表情');
    expect(prompt).toContain(
      '不要使用庆祝、搞怪、动物、卖萌、大笑、亲吻、眨眼、派对或烟花氛围的表情'
    );
    expect(prompt).not.toContain('🥳');
    expect(prompt).not.toContain('🎉');
    expect(prompt).not.toContain('😂');
    expect(prompt).not.toContain('🐶');
    expect(prompt).toContain(
      '不要说“我记得”“我记着呢”“我想起来了”'
    );
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

    expect(prompt).toContain('当前角色姓名是“方方”');
    expect(prompt).toContain('用户对你的称呼是“方方”');
    expect(prompt).toContain('你对用户的称呼是“小天”');
    expect(prompt).toContain(
      '只有 identity.name、identity.userCallsAgent、profile 或 customContext 明确写出某个亲属身份时'
    );
    expect(prompt).toContain('当前角色不是对应身份时说“爸也想你”');
    expect(prompt).toContain('如果用户只说“我想你”“我很想你”');
    expect(prompt).toContain('如果不确定该用哪个自称，一律用“我”');
    expect(prompt).not.toContain('你这么想爸 爸心里明白');
    expect(prompt).not.toContain('想吃爸做的鱼了啊');
    expect(prompt).not.toContain('爸不要你这样');
    expect(prompt).not.toContain('妈知道你太难受了');
    expect(prompt).not.toContain('爸挺好的');
    expect(prompt).not.toContain('妈还好');
  });
});
