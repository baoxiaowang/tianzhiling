import {
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactType,
} from '@tzl/entities';
import { AgentContextService } from '../../src/service/agents/agent.context';
import { AgentProfileFactSummary } from '../../src/service/agents/agent-profile-fact.service';
import {
  classifyProfileFact,
  shouldInjectProfileFact,
} from '../../src/service/agents/profile-fact-injection';

const identity: AgentProfileFactSummary = {
  type: AgentProfileFactType.relationship,
  key: 'relationship.preferred_user_name',
  value: '当前用户希望当前角色称呼其为小宝',
  polarity: AgentProfileFactPolarity.positive,
  confidence: AgentProfileFactConfidence.confirmed,
  priority: 3,
};
const pickup: AgentProfileFactSummary = {
  ...identity,
  type: AgentProfileFactType.memory,
  key: 'memory.station_pickup',
  value: '以前和小明一起去高铁站接人',
};
const sensitive: AgentProfileFactSummary = {
  ...identity,
  type: AgentProfileFactType.taboo,
  key: 'taboo.conflict',
  value: '用户不想提以前因为搬家吵架的事',
};

describe('profile fact classification and injection', () => {
  it.each([
    [identity, 'identity_relationship_style'],
    [pickup, 'episodic_event_preference'],
    [sensitive, 'sensitive_taboo'],
    [{ ...identity, value: '双方关系中有不想提的矛盾' }, 'sensitive_taboo'],
    [{ ...pickup, type: AgentProfileFactType.correction, value: '以前住院复查' }, 'episodic_event_preference'],
    [{ ...pickup, type: AgentProfileFactType.correction, key: 'unknown', value: '未分类信息' }, 'identity_relationship_style'],
  ])('classifies %j as %s', (fact, expected) => {
    expect(classifyProfileFact(fact as AgentProfileFactSummary)).toBe(expected);
  });

  it.each(['', '天气凉了', '我回来了'])('always admits identity for %s', query => {
    expect(shouldInjectProfileFact(identity, query)).toBe(true);
  });

  it.each(['高铁站在哪', '今天又要接人', '小明回来了'])('admits a user-cued event for %s', query => {
    expect(shouldInjectProfileFact(pickup, query)).toBe(true);
  });

  it.each(['', '天气凉了', '我回来了', '我们以前一起聊天'])('blocks an unrelated event for %s', query => {
    expect(shouldInjectProfileFact(pickup, query)).toBe(false);
  });

  it.each(['天气凉了', '我回来了', '以前的事情'])('blocks unopened sensitive topics for %s', query => {
    expect(shouldInjectProfileFact(sensitive, query)).toBe(false);
  });

  it('admits a sensitive topic explicitly mentioned by the user', () => {
    expect(shouldInjectProfileFact(sensitive, '那次搬家吵架我还记得')).toBe(true);
  });

  it('does not use technical keys as cues or mutate facts', () => {
    const before = { ...pickup };
    expect(shouldInjectProfileFact(pickup, 'station_pickup')).toBe(false);
    expect(pickup).toEqual(before);
  });
});

describe('profile fact evidence injection', () => {
  const service = new AgentContextService();
  const build = (query: string, currentUserText?: string, facts = [identity, pickup, sensitive]) =>
    (service as any).buildEvidencePack({
      currentQuery: query,
      currentUserText,
      profileFacts: facts,
      recentMessages: [],
      agent: null,
      hardFacts: [],
      retrievedMemories: [],
    });

  it('production simulation: weather does not inject the station pickup fact', () => {
    const evidence = build('天气凉了');
    expect(evidence.some(item => item.factKey === identity.key)).toBe(true);
    expect(evidence.some(item => item.factKey === pickup.key)).toBe(false);
    expect(evidence.some(item => item.factKey === sensitive.key)).toBe(false);
  });

  it('keeps the preferred name on a returning greeting', () => {
    expect(build('我回来了')).toEqual(expect.arrayContaining([
      expect.objectContaining({ factKey: identity.key, text: identity.value }),
    ]));
  });

  it('injects an event when the user supplies its cue', () => {
    expect(build('今天要去高铁站')).toEqual(expect.arrayContaining([
      expect.objectContaining({ factKey: pickup.key }),
    ]));
  });

  it('injects sensitive evidence only after the user opens that topic', () => {
    expect(build('那次搬家吵架我还记得')).toEqual(expect.arrayContaining([
      expect.objectContaining({ factKey: sensitive.key }),
    ]));
  });

  it('ignores cues from expanded retrieval text when raw user text is supplied', () => {
    expect(build('天气凉了 高铁站接人 搬家吵架', '天气凉了')
      .some(item => [pickup.key, sensitive.key].includes(item.factKey))).toBe(false);
    expect(build('高铁站接人', '').some(item => item.factKey === pickup.key)).toBe(false);
  });

  it('filters before the evidence quota so skipped events do not consume slots', () => {
    expect(build('我回来了', undefined, [...Array(5).fill(pickup), identity]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ factKey: identity.key })]));
  });
});
