import { detectDurableExpressionPreference } from '../../src/service/agents/agent-profile-fact.service';

describe('durable expression preference', () => {
  it.each([
    '妈是问都不问，没事就想着打麻将',
    '不过老三都会让沐沐问我几点下班',
    '就是他们都很担心我的个人问题',
    '遇到问题总是逃避没有用的',
    '以前亲戚总是问我，奶奶走了我怎么办',
    '爸爸我好像碎了，小的还问我会不会和爸爸离婚',
  ])('ignores a narrative clause: %s', clause => {
    expect(detectDurableExpressionPreference(clause)).toBeUndefined();
  });

  it.each([
    ['以后别总在最后问我问题', 'closing_question'],
    ['别总问我', 'closing_question'],
    ['以后别说一大段', 'verbosity'],
    ['不要老讲道理', 'preachy'],
    ['以后少说点', 'verbosity'],
  ])('still detects a durable request: %s', (clause, dimension) => {
    expect(detectDurableExpressionPreference(clause)).toMatchObject({
      dimension,
    });
  });
});
