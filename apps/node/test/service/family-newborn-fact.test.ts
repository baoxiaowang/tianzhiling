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

import {
  detectFamilyCorrectionArchive,
  isBirthWishText,
} from '../../src/service/agents/agent-profile-fact.service';
import { filterFamilyFactsByContinuitySummary } from '../../src/service/agents/family-consistency';

describe('family correction archive', () => {
  it('maps only-one-child statements to the opposite keys', () => {
    expect(detectFamilyCorrectionArchive('我们只有一个儿子')).toEqual({
      archiveKeys: ['family.newborn.daughter', 'family.daughter'],
      reason: 'only_son',
    });
    expect(detectFamilyCorrectionArchive('只有一个女儿')).toEqual({
      archiveKeys: ['family.newborn.son', 'family.son'],
      reason: 'only_daughter',
    });
    expect(detectFamilyCorrectionArchive('只有一个孩子')).toEqual({
      archiveKeys: [
        'family.newborn.son',
        'family.newborn.daughter',
        'family.son',
        'family.daughter',
      ],
      reason: 'only_child',
    });
  });

  it('maps no-daughter/no-son statements to the matching keys', () => {
    expect(detectFamilyCorrectionArchive('没有女儿')).toEqual({
      archiveKeys: ['family.newborn.daughter', 'family.daughter'],
      reason: 'no_daughter',
    });
    expect(detectFamilyCorrectionArchive('没生儿子')).toEqual({
      archiveKeys: ['family.newborn.son', 'family.son'],
      reason: 'no_son',
    });
  });

  it('does not treat a wish or hypothetical as a correction', () => {
    expect(detectFamilyCorrectionArchive('如果只有一个儿子就好了')).toBeUndefined();
    expect(detectFamilyCorrectionArchive('希望只有一个女儿')).toBeUndefined();
  });

  it('archives the opposite fact when the user says only one son', async () => {
    const service = new AgentProfileFactService();
    const daughter = {
      key: 'family.newborn.daughter',
      status: 'active',
      updatedAt: null,
    } as never;
    const save = jest.fn(async (fact: never) => fact);
    (service as never as { factModel: unknown }).factModel = {
      find: jest.fn().mockResolvedValue([daughter]),
      save,
    };
    (service as never as { logger: unknown }).logger = { info: jest.fn() };

    await (service as never as {
      applyFamilyCorrectionArchives: (input: {
        userId: string;
        agentId: string;
        sourceText: string;
      }) => Promise<void>;
    }).applyFamilyCorrectionArchives({
      userId: 'user',
      agentId: 'agent',
      sourceText: '我们只有一个儿子',
    });

    expect((daughter as { status: string }).status).toBe('archived');
    expect(save).toHaveBeenCalled();
  });
});

describe('birth wish text', () => {
  it('recognizes wish/dream sources as non-support', () => {
    expect(isBirthWishText('我想给你生个女儿的，来不及了')).toBe(true);
    expect(isBirthWishText('我昨天晚上梦见怀孕了，给你生了个女儿')).toBe(true);
    expect(isBirthWishText('家里给你添了一个外孙女')).toBe(false);
  });
});

describe('summary and fact consistency', () => {
  it('drops the opposite-gender fact when the summary is explicit', () => {
    const result = filterFamilyFactsByContinuitySummary(
      [
        { key: 'family.son', value: '用户和当前角色有儿子' },
        { key: 'family.newborn.daughter', value: '用户家里添了女儿' },
      ],
      '用户和当前角色只有一个儿子'
    );

    expect(result.facts.map(fact => fact.key)).toEqual(['family.son']);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it('only logs when the summary says one child without gender', () => {
    const result = filterFamilyFactsByContinuitySummary(
      [
        { key: 'family.son', value: '用户和当前角色有儿子' },
        { key: 'family.newborn.daughter', value: '用户家里添了女儿' },
      ],
      '用户和当前角色只有一个娃'
    );

    expect(result.facts).toHaveLength(2);
    expect(result.logs[0]).toContain('both son and daughter');
  });
});

describe('support vs correction', () => {
  it('does not increment support for a wish source', async () => {
    const service = new AgentProfileFactService();
    const existing = {
      key: 'family.newborn.daughter',
      value: '用户家里添了女儿（当前角色的晚辈）',
      status: 'active',
      supportCount: 2,
      sourceMessageId: 'old',
      sourceMessageIds: ['old'],
      updatedAt: null,
    };
    const save = jest.fn(async (fact: never) => fact);
    (service as never as { factModel: unknown }).factModel = {
      findOne: jest.fn().mockResolvedValue(existing),
      save,
    };
    (service as never as { logger: unknown }).logger = { info: jest.fn() };

    await (service as never as {
      upsertFact: (input: object) => Promise<unknown>;
    }).upsertFact({
      userId: 'user',
      agentId: 'agent',
      type: 'family',
      key: 'family.newborn.daughter',
      value: '用户家里添了女儿（当前角色的晚辈）',
      polarity: 'positive',
      confidence: 'extracted',
      priority: 2,
      sourceMessageId: 'new',
      sourceText: '我想给你生个女儿的，来不及了',
      trustedSource: false,
    });

    expect((existing as { supportCount: number }).supportCount).toBe(2);
  });
});
