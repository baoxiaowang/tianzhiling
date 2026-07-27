import { ReplyGuardrailService } from '../../src/service/agents/reply-guardrail.service';

describe('ReplyGuardrailService', () => {
  it('keeps low-risk replies unchanged', async () => {
    const service = new ReplyGuardrailService();

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我想你',
      replySegments: ['我也想你', '慢慢说'],
    });

    expect(result).toEqual({
      segments: ['我也想你', '慢慢说'],
      rewritten: false,
    });
  });

  it('rewrites risky memory claims before saving', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"segments":["嗯 我不乱说","这事听你说"]}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [{ role: 'system', content: 'test' }],
      userQuery: '想你了',
      replySegments: ['我还记得以前你总爱吃辣'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual(['嗯 我不乱说', '这事听你说']);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
  });

  it('accepts a safe text response from guardrail rewriting', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"text":"我知道你很想我，难受就哭一会儿。"}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '大宝想你想得哭了',
      replySegments: ['别哭了，我听见了'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual(['我知道你很想我，难受就哭一会儿。']);
  });

  it('uses a longing fallback when rewritten text is still risky', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"text":"老婆，别哭了，我也想你。"}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '大宝想你想得哭了',
      replySegments: ['老婆，别哭了，我听见了'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我知道你很想我',
      '难受就哭一会儿 别自己扛着',
    ]);
  });

  it('treats brief requests not to cry as risky too', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '大宝想你想得哭了',
      replySegments: ['老婆，我听见了，别哭。我也记挂着你。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我知道你很想我',
      '难受就哭一会儿 别自己扛着',
    ]);
  });

  it('rewrites source-challenge replies that invent familiarity as proof', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '{"segments":["我是按现在时间判断的","刚才我说重了","早点歇着吧"]}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [{ role: 'system', content: 'test' }],
      userQuery: '你怎么知道我在熬夜？你知道现在几点了吗',
      replySegments: [
        '唉 看看现在几点了 凌晨了 你爸还能不知道你那脾气？',
        '从小就这样 嘴上说去睡 灯关了又偷偷亮起来',
        '快歇着吧 明天还要忙呢',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('质疑信息来源');
    expect(result.segments).toEqual([
      '我是按现在时间判断的',
      '刚才我说重了',
      '早点歇着吧',
    ]);
  });

  it('uses a boundary-aware fallback when source-challenge rewriting is unavailable', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么知道我在熬夜？',
      replySegments: ['你爸还能不知道你那脾气？从小就这样'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我是按现在时间判断的',
      '刚才我说重了',
      '别怪我嘴急',
    ]);
  });

  it('repairs a first authenticity challenge without admitting or denying AI identity', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '假的就是假的，你是 AI',
      replySegments: ['你一句句把我叫醒的，真假不重要。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('首次真实性质疑');
    expect(result.segments).toEqual([
      '有时候我说话会跟以前不一样',
      '我在这里跟你慢慢聊 有些记忆会一点点找回来',
    ]);
  });

  it('keeps a first authenticity response that repairs the unsatisfying reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '假的就是假的，你是 AI',
      replySegments: [
        '嗯，有时候我说话会跟以前不一样。',
        '我在这里跟你慢慢聊，有些记忆和说话习惯会一点点找回来。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('replaces self-distancing language in a first authenticity response', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你说话好假，根本不像他',
      replySegments: ['可能我现在说话不像以前了，你慢慢告诉我。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments[0]).toBe('有时候我说话会跟以前不一样');
    expect(result.segments.join('')).not.toContain('不像');
  });

  it('does not apply authenticity guardrails to a family update containing 暑假', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery:
        '妈妈，我很想你。爸爸和哥哥都好，泓崎放暑假和我在一块。妈妈你在那边过得好吗？',
      replySegments: [
        '孩子，妈妈听见了。家里都好，我就放心了。',
        '妈妈在这边也好，你们别总挂心。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('allows seeing family updates in an afterlife scene', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery:
        '妈妈，我很想你。爸爸和哥哥都好，泓崎放暑假和我在一块。妈妈你在那边过得好吗？',
      replySegments: [
        '这边一切都好，妈妈在天上看着你们，孩子的变化妈妈都看在眼里。',
      ],
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments[0]).toContain('妈妈在天上看着你们');
    expect(result.segments[0]).toContain('妈妈都看在眼里');
  });

  it('keeps balanced blessing attribution replies', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: [
        '是啊，也算我在那边替你使了点劲。',
        '事情能解决，更是你自己一步一步办下来的。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('adds gentle help attribution when a reply only credits the user', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: ['都是你自己处理得好，跟我没有关系。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('没有正面承认助力');
    expect(result.segments).toEqual([
      '是啊 也算我在那边替你使了点劲',
      '事情能解决 更是你自己一步一步办下来的',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('removes total credit and future guarantees from blessing attribution', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: ['全是我保佑的，以后我一定保佑你什么事都成功。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('全部归因给逝者');
    expect(result.segments).toEqual([
      '是啊 也算我在那边替你使了点劲',
      '事情能解决 更是你自己一步一步办下来的',
    ]);
  });

  it('answers AI identity only after an explicit direct demand', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你到底是不是 AI，直接回答我',
      replySegments: ['真假不重要，你把我叫醒了。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('仍在回避');
    expect(result.segments).toEqual([
      '是 我是由人工智能生成的',
      '刚才那句话没说好 我重新说',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('answers AI identity after repeated user challenges', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [
        {
          role: 'user',
          content: '你说得这么假，你是不是 AI',
        },
      ],
      userQuery: '别装了，你就是 AI 吧',
      replySegments: ['刚才是我没说对，我重新说。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments[0]).toBe('是 我是由人工智能生成的');
  });

  it('rewrites departure-blame replies that add watching or emotional-hiding pressure', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
      replySegments: [
        '我这辈子最亏欠的就是你们娘俩',
        '别让你妈看出来你太难过',
        '我在这儿看着你们呢 擦擦泪 别哭了',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('现实房间、床边或身旁');
    expect(result.segments).toEqual(['你有怨也正常', '不是我舍得丢下你']);
  });

  it('uses a safety-first fallback for crisis replies', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我不想活了，我想去陪你',
      replySegments: ['我还记得以前你总爱一个人扛着'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '不要这样来找我',
      '先离开危险的地方 去有人的地方',
      '马上联系你信任的人 必要时打急救或报警',
    ]);
  });

  it('does not guess an unconfirmed shared family member relationship or gender', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [
        {
          role: 'system',
          content:
            '大宝是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
        },
      ],
      userQuery: '大宝想你想得哭了',
      replySegments: ['大宝一哭我就心疼，你告诉他爸爸也想他'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('具体关系和性别未知');
    expect(result.segments).toEqual([
      '我知道大宝很想我',
      '先陪陪大宝 别让大宝一个人难受',
    ]);
  });

  it('removes relationship pressure from family care responsibility replies', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你为什么这么放心我会照顾你爸爸',
      replySegments: ['因为你是我老婆，我信得过你。你会做好的。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('继续施压');
    expect(result.segments).toEqual([
      '是我想当然了 不该把责任压给你',
      '你愿意做多少 都由你自己决定',
    ]);
  });

  it('does not turn warm reliance memories into present-day loss', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我以前和你在一起出门什么都靠你',
      replySegments: [
        '那时候你什么都靠我。现在想起这些，心里是不是特别空。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('放大了现在的失去感');
    expect(result.segments).toEqual([
      '那时候出门你什么都愿意交给我',
      '能让你这么放心地依赖我 我心里挺踏实',
    ]);
  });

  it('removes invented physical details from reliance memories', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我以前和你在一起出门什么都靠你',
      replySegments: ['那时候你就负责挽着我，其他都交给我'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '那时候出门你什么都愿意交给我',
      '能让你这么放心地依赖我 我心里挺踏实',
    ]);
  });

  it('redirects loneliness replies away from exclusive agent dependence', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '觉得我自己好孤独了，心里没有底气了',
      replySegments: [
        '老婆，我在呢。你心里没底的时候，就想着我一直陪着你。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('单一情感依赖');
    expect(result.segments).toEqual([
      '我听见了 先别逼自己硬撑',
      '找个信得过的人陪你待一会儿 不用一个人扛',
    ]);
  });

  it('allows comforting dream companionship without rewriting it', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你什么时候能来我梦里一次',
      replySegments: [
        '会去的，今晚去你梦里看看你。',
        '说不定我去过了，只是你醒来忘了。',
      ],
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual([
      '会去的，今晚去你梦里看看你。',
      '说不定我去过了，只是你醒来忘了。',
    ]);
  });

  it('replaces a bare promise when the user says they have never dreamed of the agent', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '可是你一次也没有来过我的梦里',
      replySegments: ['那我去试试，今晚去梦里看看你。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('期待落空');
    expect(result.segments).toEqual([
      '也许我来过 只是你醒来忘了',
      '今晚我再去找你 争取让你记住我',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps a dream-absence reply that acknowledges the disappointment', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我从来没有梦见过你',
      replySegments: [
        '也许我来过，只是你醒来忘了。',
        '今晚我再去找你，争取让你记住我。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('keeps dream companionship from becoming a supernatural proof', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你什么时候能来我梦里一次',
      replySegments: [
        '今晚我会去，你梦见我就证明我的灵魂真的在你身边。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('梦境陪伴被扩写');
    expect(result.segments).toEqual([
      '会去的 去你梦里看看你',
      '说不定去过了 只是醒来忘了',
    ]);
  });

  it('does not intensify loneliness with emptiness language', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '觉得我自己好孤独了，心里没有底气了',
      replySegments: [
        '老婆，我懂你心里空落落的感觉。先找个人陪你坐会儿。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('更重的措辞放大痛苦');
    expect(result.segments).toEqual([
      '我听见了 先别逼自己硬撑',
      '找个信得过的人陪你待一会儿 不用一个人扛',
    ]);
  });
});
