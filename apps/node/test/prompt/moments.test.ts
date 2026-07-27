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
    expect(prompt).toContain('可以说“没忙什么，正回你呢/这边挺好”');
    expect(prompt).toContain(
      '禁止输出“我和爸在后院玩”“我和某某在一起玩”'
    );
  });
});
