import {
  buildMemoryRetrievalQuery,
  isInjectableMemoryEvidence,
  isKeyLinkedEvidence,
  isPersonAlignedEvidence,
} from '../../src/service/agents/agent.context';
import { isFactBearingUtterance } from '../../src/service/agents/memory-value';

describe('自动注入的相关性过滤', () => {
  it('问奶奶时，不说爷爷的那段话', () => {
    // 线上实测：用户问"您想我奶奶吗"，注入的是"爷爷，你在那边过的怎么样"。
    expect(
      isInjectableMemoryEvidence('爷爷，你在那边过的怎么样', '您想我奶奶吗')
    ).toBe(false);
  });

  it('人选对、说的是同一件事，仍然注入', () => {
    expect(
      isInjectableMemoryEvidence('奶奶生日是三月十二', '您记得我奶奶生日吗')
    ).toBe(true);
  });

  it('这轮没点名任何亲人时，不按人过滤', () => {
    expect(
      isInjectableMemoryEvidence('爷爷，你以前总说想回老家', '我今天很累')
    ).toBe(true);
  });

  it('候选没点名任何亲人（只是旁白）时，不按人过滤', () => {
    expect(isPersonAlignedEvidence('最近总梦见老房子', '您想我奶奶吗')).toBe(
      true
    );
  });

  it('候选同时提到问的那位亲人时保留', () => {
    expect(isPersonAlignedEvidence('妈说奶奶生日是三月', '您想我奶奶吗')).toBe(
      true
    );
  });
});

describe('两个硬过滤：必须有检索键、情绪与问句一律不要', () => {
  it('只靠相似度撞上、不含检索键的老话不要', () => {
    // 检索按相似度打分，"比以前方便多了"这类闲话会被捞回来。
    expect(isKeyLinkedEvidence('比以前方便多了', '你记得我生日吗')).toBe(false);
    expect(isInjectableMemoryEvidence('比以前方便多了', '你记得我生日吗')).toBe(
      false
    );
  });

  it('含检索键的事实原话保留', () => {
    expect(
      isInjectableMemoryEvidence('你以前说过生日要吃长寿面', '你记得我生日吗')
    ).toBe(true);
  });

  it('纯情绪原话不要', () => {
    expect(
      isInjectableMemoryEvidence('大姐我想你了', '大姐以前是做什么的')
    ).toBe(false);
  });

  it('夹在句子中间的问句不要（不只认句尾问号）', () => {
    expect(
      isInjectableMemoryEvidence('爷爷，你在那边过的怎么样', '您想我奶奶吗')
    ).toBe(false);
  });

  it('用户长期在讲的事（抽烟）照样能挂钩', () => {
    const turn = '那段时间有你陪着，真的没抽，可是自从你走了，又捡起来了';
    expect(isKeyLinkedEvidence('以前你也让大儿能不抽就不抽', turn)).toBe(true);
    expect(isInjectableMemoryEvidence('以前你也让大儿能不抽就不抽', turn)).toBe(
      true
    );
  });
});

describe('习惯类原话的检索键与入库', () => {
  it('从否定式说法里抽出"抽烟"这个话题键', () => {
    const key = buildMemoryRetrievalQuery(
      '那段时间有你陪着，真的没抽，可是自从你走了，又捡起来了'
    );
    expect(key).toContain('抽烟');
    expect(key).toContain('走了');
  });

  it('讲同一件事的各种说法都进检索索引', () => {
    expect(isFactBearingUtterance('就是现在偶尔抽烟了')).toBe(true);
    expect(isFactBearingUtterance('爸爸，你大儿今天一颗烟都没有抽呢')).toBe(
      true
    );
    expect(isFactBearingUtterance('爸爸，大儿今天没忍住又抽烟了')).toBe(true);
    expect(isFactBearingUtterance('以前你也让大儿能不抽就不抽')).toBe(true);
  });

  it('真发问的"呢"仍然不入库', () => {
    expect(isFactBearingUtterance('你在干嘛呢')).toBe(false);
  });
});
