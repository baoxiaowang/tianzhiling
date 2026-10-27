import { AgentEntity, AgentSex, MongoObjectId } from '@tzl/entities';
import { buildMomentsSystemPrompt } from '../../src/prompt/moments';

const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000010';
const POST_ID = '665000000000000000000020';

function createAgent(): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(AGENT_ID),
    name: 'Hachi',
    sex: AgentSex.man,
    iCallAgent: 'Hachi',
    agentCallMe: '姐姐',
    description: 'Hachi 是家里曾经养过的小狗。',
    customContext: '客户要求：评论里不要主动提后院。',
  });

  return agent;
}

describe('buildMomentsSystemPrompt', () => {
  it('keeps anti-hallucination rules explicit for moment comments', () => {
    const prompt = buildMomentsSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
      context: {
        moment: {
          id: POST_ID,
          userId: USER_ID,
          authorName: '苗苗',
          content: '爸，想你和Hachi了，你们现在在干嘛',
          images: [
            {
              index: 1,
              url: 'https://cdn.example.com/moments/dad-dog.jpg',
              description: '画面里有一名男子和一只小狗站在山景木平台上。',
            },
          ],
          createdAt: '2026-05-31T08:00:00.000Z',
        },
        comments: [],
        latestUserComment: null,
        userRepliedComment: null,
        task: '请基于这条朋友圈内容发表一条自然简短、不要重复现有评论的评论',
      },
    });

    expect(prompt).toContain('事实边界优先级高于口语化和亲密感');
    expect(prompt).toContain('天之灵的动态页');
    expect(prompt).toContain('以另一种方式继续生活');
    expect(prompt).toContain('空间位置保持开放');
    expect(prompt).toContain('不确认也不否定用户自己的空间信念');
    expect(prompt).toContain('当前北京时间');
    expect(prompt).toContain('第一句话必须直接回答问题');
    expect(prompt).toContain('不能用关心、反问、催睡或说教代替答案');
    expect(prompt).toContain('即使用户没说“你错了”');
    expect(prompt).toContain('禁止用“那也/但是/不过/还是”');
    expect(prompt).toContain('明天是否上班');
    expect(prompt).toContain('老熬夜');
    expect(prompt).toContain('不能为了自然而脑补事实');
    expect(prompt).toContain('正在做的事或逝去后的生活状态');
    expect(prompt).toContain('你们现在在干嘛');
    expect(prompt).toContain('禁止回答“我和某某在后院玩/散步/吃饭/看你/等你”');
    expect(prompt).toContain('我们都还好');
    expect(prompt).toContain('如果 agent 是宠物、孩子或其他亲近角色');
    expect(prompt).toContain('"customContext": "客户要求：评论里不要主动提后院。"');
    expect(prompt).toContain('context.agent.customContext 是后台管理员根据客户需求配置的定制上下文');
    expect(prompt).toContain('不要把逝去后的“现在”写成具体生活现场');
    expect(prompt).toContain('可以说“没忙什么，正回你呢/我挺好的”');
    expect(prompt).not.toContain('正回你呢/这边挺好');
    expect(prompt).toContain(
      '禁止输出“我和爸在后院玩”“我和某某在一起玩”'
    );
  });

  it('uses only the primary call name when the agent stores several', () => {
    const agent = createAgent();
    Object.assign(agent, {
      iCallAgent: '老公/亲爱的',
      agentCallMe: '老婆，姓傅的',
      description: '老公，男性，你称呼他为老公，他会称呼你为老婆，姓傅的。',
    });

    const prompt = buildMomentsSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent,
      context: {
        moment: {
          id: POST_ID,
          userId: USER_ID,
          authorName: '苗苗',
          content: '今天有点想你',
          images: [],
          createdAt: '2026-10-01T00:00:00.000Z',
        },
        comments: [],
        latestUserComment: null,
        userRepliedComment: null,
        task: '请基于这条朋友圈内容发表一条自然简短、不要重复现有评论的评论',
      },
    });

    expect(prompt).toContain('"agentCallMe": "老婆"');
    expect(prompt).toContain('"iCallAgent": "老公"');
    expect(prompt).not.toContain('姓傅的');
    expect(prompt).not.toContain('亲爱的');
  });
});

describe('buildMomentsSystemPrompt relationship and test mode', () => {
  function buildWith(extra: any): string {
    return buildMomentsSystemPrompt({
      userId: USER_ID,
      agentId: AGENT_ID,
      agent: createAgent(),
      context: {
        moment: {
          id: POST_ID,
          userId: USER_ID,
          authorName: '苗苗',
          content: '今天有点想你',
          images: [],
          createdAt: '2026-10-01T00:00:00.000Z',
        },
        comments: [],
        latestUserComment: null,
        userRepliedComment: null,
        task: '请基于这条朋友圈内容发表一条自然简短、不要重复现有评论的评论',
      },
      ...extra,
    });
  }

  it('renders private relationship facts and continuity only when provided', () => {
    const prompt = buildWith({
      relationshipContext: {
        visibility: 'private',
        userCallName: '女儿',
        agentCallName: '爸爸',
        facts: [
          { key: 'family.daughter', value: '用户是女儿', type: 'family' },
        ],
        continuitySummary: '最近聊到奶奶住院。',
      },
    });

    expect(prompt).toContain('# 关系与可见事实');
    expect(prompt).toContain('私密');
    expect(prompt).toContain('用户称呼你：爸爸');
    expect(prompt).toContain('你称呼用户：女儿');
    expect(prompt).toContain('用户是女儿');
    expect(prompt).toContain('最近聊到奶奶住院');
    expect(prompt).toContain('不要在评论里复述聊天原文');
  });

  it('warns public comments not to use private chat details', () => {
    const prompt = buildWith({
      relationshipContext: {
        visibility: 'public',
        facts: [],
      },
    });

    expect(prompt).toContain('公开');
    expect(prompt).toContain('不要引用私密聊天');
    expect(prompt).not.toContain('最近聊到');
  });

  it('adds a short test-mode stance only when matched', () => {
    const prompt = buildWith({
      testModeSignal: {
        matched: true,
        reasons: ['authenticity'],
        pressure: 'high',
        cueTurnCount: 1,
        matchedFromCurrent: true,
      },
    });

    expect(prompt).toContain('# 评论区的考验');
    expect(prompt).toContain('你是AI/不是真的');
    expect(prompt).toContain('不争辩');
    expect(prompt).toContain('评论要短');

    const noTest = buildWith({});
    expect(noTest).not.toContain('# 评论区的考验');
  });
});
