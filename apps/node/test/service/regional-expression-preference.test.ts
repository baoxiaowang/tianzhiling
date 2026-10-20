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
