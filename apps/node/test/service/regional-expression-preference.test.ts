import { detectRegionalExpressionPreference } from '../../src/service/agents/regional-expression-preference';

describe('regional expression preference', () => {
  it('turns agent and shared origin into a region preference', () => {
    expect(detectRegionalExpressionPreference('你是四川人，我们是四川人')).toMatchObject({
      region: '四川',
      source: 'agent',
      value: '用户希望沿用四川地区的表达习惯交流',
    });
    expect(detectRegionalExpressionPreference('我们都是重庆人')).toMatchObject({
      region: '重庆',
      source: 'shared',
    });
    expect(detectRegionalExpressionPreference('你是四川省人')).toMatchObject({
      region: '四川',
    });
  });

  it('recognizes explicit dialect requests', () => {
    expect(detectRegionalExpressionPreference('你说四川话')).toMatchObject({
      region: '四川',
      dialect: '四川话',
      source: 'dialect',
    });
    expect(detectRegionalExpressionPreference('讲粤语')).toMatchObject({
      region: '广东',
      dialect: '粤语',
    });
    expect(detectRegionalExpressionPreference('说普通话')).toMatchObject({
      dialect: '普通话',
      value: '用户希望用普通话交流',
    });
  });

  it('ignores questions, negation, hypotheticals and non-region words', () => {
    expect(detectRegionalExpressionPreference('你是哪里人')).toBeUndefined();
    expect(detectRegionalExpressionPreference('你是四川人吗')).toBeUndefined();
    expect(detectRegionalExpressionPreference('你不是四川人')).toBeUndefined();
    expect(detectRegionalExpressionPreference('如果你是四川人就好了')).toBeUndefined();
    expect(detectRegionalExpressionPreference('你是好人')).toBeUndefined();
    expect(detectRegionalExpressionPreference('你是中国人')).toBeUndefined();
    expect(detectRegionalExpressionPreference('你是外地人')).toBeUndefined();
    expect(detectRegionalExpressionPreference('我是四川人')).toBeUndefined();
    expect(detectRegionalExpressionPreference('我爸爸是四川人')).toBeUndefined();
  });
});

describe('regional expression preference false positives', () => {
  it('does not turn arbitrary "你是……人/的" sentences into a region', () => {
    const messages = [
      '你是个很好很好的一个人，那么勤快，努力上进的人，在你的身上几乎找不到缺点',
      '快二十年了，我一直不敢提起你，你是我心里永远的痛',
      '你说话的口吻不像我妈，我妈从来不和我们说关心的话',
      '我世界上最理解我的就是你，你是最好的老公。',
      '你是最好的人',
      '你是二十几天前认识的人',
    ];

    for (const message of messages) {
      expect(detectRegionalExpressionPreference(message)).toBeUndefined();
    }
  });

  it('does not treat ordinary "说……话" as a dialect request', () => {
    const messages = [
      '昨晚和你说完话又睡了一会，又梦见你了',
      '会想奶奶说过的话',
      '我太想你了，今天又说不了几句话啊',
      '爸您在说个话，很长很长的那种话',
      '老公昨天都没和你说上话',
      '我只想说心里话',
      '说几句话就好',
    ];

    for (const message of messages) {
      expect(detectRegionalExpressionPreference(message)).toBeUndefined();
    }
  });

  it('still recognizes explicit region and dialect requests', () => {
    expect(detectRegionalExpressionPreference('你是成都人')).toMatchObject({
      region: '成都',
      source: 'agent',
    });
    expect(detectRegionalExpressionPreference('说成都话')).toMatchObject({
      region: '成都',
      dialect: '成都话',
    });
    expect(detectRegionalExpressionPreference('我们都是潮汕人')).toMatchObject({
      region: '潮汕',
      source: 'shared',
    });
    expect(detectRegionalExpressionPreference('你是北方人')).toMatchObject({
      region: '北方',
    });
  });
});
