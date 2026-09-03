import {
  agentEvidenceSupportsClaim,
  AgentEvidenceItem,
  selectAgentEvidence,
} from '../../src/service/agents/agent-evidence';

describe('agent evidence policy', () => {
  it('lets the role naturally take up a fact stated in the current turn', () => {
    const evidence: AgentEvidenceItem[] = [
      {
        id: 'U0',
        source: 'current_user',
        text: '你以前爱旅游爬山玩水',
        assertionPolicy: 'can_assert',
        subjectRef: 'agent',
        factKey: 'utterance.current',
        useMode: 'uptake',
        status: 'active',
      },
    ];

    expect(
      agentEvidenceSupportsClaim(evidence, {
        text: '我以前爱旅游爬山',
        kind: 'memory',
        mode: 'conversational_uptake',
        subjectRef: 'agent',
        evidenceIds: ['U0'],
      })
    ).toBe(true);
  });

  it('rejects an unrelated assertable fact used as a memory citation', () => {
    const evidence: AgentEvidenceItem[] = [
      {
        id: 'A1',
        source: 'agent_profile',
        text: '当前角色姓名是爸爸',
        assertionPolicy: 'can_assert',
        subjectRef: 'agent',
        factKey: 'identity.name',
        useMode: 'assert',
        status: 'active',
      },
    ];

    expect(
      agentEvidenceSupportsClaim(evidence, {
        text: '当年爸背你上过西山',
        kind: 'memory',
        mode: 'autonomous_fact',
        subjectRef: 'agent',
        evidenceIds: ['A1'],
      })
    ).toBe(false);
  });

  it('does not transfer a fact to another conversation object', () => {
    const evidence: AgentEvidenceItem[] = [
      {
        id: 'F1',
        source: 'confirmed_fact',
        text: '女儿小雨今年十一岁',
        assertionPolicy: 'can_assert',
        subjectRef: 'family_xiaoyu',
        factKey: 'family.shared_member.xiaoyu.age',
        useMode: 'assert',
        status: 'active',
      },
    ];

    expect(
      agentEvidenceSupportsClaim(evidence, {
        text: '小雪今年十一岁',
        kind: 'real_world',
        mode: 'autonomous_fact',
        subjectRef: 'family_xiaoxue',
        evidenceIds: ['F1'],
      })
    ).toBe(false);
  });

  it('removes retracted and superseded evidence before prompt selection', () => {
    const evidence: AgentEvidenceItem[] = [
      {
        id: 'F1',
        source: 'confirmed_fact',
        text: '用户十一月去扫墓',
        assertionPolicy: 'can_assert',
        subjectRef: 'user',
        factKey: 'ritual.visit_month',
        useMode: 'assert',
        status: 'active',
      },
      {
        id: 'F2',
        source: 'confirmed_fact',
        text: '用户十月去扫墓',
        assertionPolicy: 'can_assert',
        subjectRef: 'user',
        factKey: 'ritual.visit_month',
        useMode: 'assert',
        status: 'active',
        supersedes: ['F1'],
      },
      {
        id: 'F3',
        source: 'confirmed_fact',
        text: '用户每周都去扫墓',
        assertionPolicy: 'can_assert',
        subjectRef: 'user',
        factKey: 'ritual.visit_frequency',
        useMode: 'assert',
        status: 'retracted',
      },
    ];

    expect(selectAgentEvidence(evidence).map(item => item.id)).toEqual(['F2']);
  });

  it('keeps the evidence pack within its configured budget', () => {
    const evidence: AgentEvidenceItem[] = Array.from(
      { length: 14 },
      (_, index) => ({
        id: `F${index + 1}`,
        source: 'confirmed_fact' as const,
        text: `事实${index + 1}`,
        assertionPolicy: 'can_assert' as const,
        subjectRef: 'user',
        factKey: `memory.fact.${index + 1}`,
        useMode: 'assert' as const,
        status: 'active' as const,
      })
    );

    expect(selectAgentEvidence(evidence, { limit: 10 })).toHaveLength(10);
  });
});
