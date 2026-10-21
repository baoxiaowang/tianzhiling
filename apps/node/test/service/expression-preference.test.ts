import { detectDurableExpressionPreference } from '../../src/service/agents/agent-profile-fact.service';

describe('durable expression preference', () => {
  it.each([
    '妈是问都不问，没事就想着打麻将',
    '不过老三都会让沐沐问我几点下班',
    '就是他们都很担心我的个人问题',
    '遇到问题总是逃避没有用的',
    '以前亲戚总是问我，奶奶走了我怎么办',
    '爸爸我好像碎了，小的还问我会不会和爸爸离婚',
    '我以后找不到东西就不能问你了',
    '我想那些疼我的日子有啥用，你不在我身边了，以后回家你不会在问我到哪了，几点回来，想吃什么',
    '嗯，虽然每次你抱着我睡我都嫌热，不要你抱，但是每次都是只要我挣扎你就会故意问，怎么抱都不给抱',
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
