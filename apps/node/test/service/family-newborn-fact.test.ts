import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';

function ruleFacts(text: string): Array<{ key: string; value: string }> {
  const service = new AgentProfileFactService();
  return (service as never as {
    extractFactsWithRules: (text: string, options: object) => Array<{
      key: string;
      value: string;
    }>;
  }).extractFactsWithRules(text, {});
}

describe('family newborn fact rule', () => {
  it.each([
    '我想给你生个女儿的，来不及了……',
    '我昨天晚上梦见怀孕了，给你生了个女儿',
    '你走前虽然你没说，你都是希望我生个儿子',
    '如果生了个女儿就好了',
  ])('does not write a newborn fact for a wish/dream/hypothetical: %s', text => {
    const newborn = ruleFacts(text).filter(fact =>
      fact.key.startsWith('family.newborn.')
    );
    expect(newborn).toEqual([]);
  });

  it.each([
    ['家里给你添了一个外孙女', 'family.newborn.外孙女'],
    ['给你生了个大胖孙子', 'family.newborn.孙子'],
    ['我生了女儿，去年又生了个儿子', 'family.newborn.daughter'],
  ])('still writes actual births: %s', (text, expectedKey) => {
    const keys = ruleFacts(text).map(fact => fact.key);
    expect(keys).toContain(expectedKey);
  });

  it('writes a son fact from 我们只有一个儿子', () => {
    const keys = ruleFacts('我们只有一个儿子').map(fact => fact.key);
    expect(keys).toContain('family.son');
  });
});
