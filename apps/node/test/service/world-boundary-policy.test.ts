import {
  auditUndeclaredHighRiskAssertions,
  buildReplyEvidenceContract,
  buildWorldBoundaryPolicyPrompt,
  resolveWorldBoundaryPolicy,
} from '../../src/service/agents/world-boundary-policy';

describe('world boundary policy', () => {
  it('allows dream-internal contact without treating it as reality evidence', () => {
    const policy = resolveWorldBoundaryPolicy({
      currentQuery: '妈，今晚来梦里抱抱我',
    });
    const dream = policy.activeSpaces.find(
      item => item.kind === 'dream_internal'
    );

    expect(dream).toMatchObject({ allowed: true, evidencePolicy: 'symbolic' });
    expect(buildWorldBoundaryPolicyPrompt(policy)).toContain(
      '只限制把梦写成醒着时的现实到场、证据或预言'
    );
  });

  it('requires semantic evidence review for death-fact questions', () => {
    const policy = resolveWorldBoundaryPolicy({
      currentQuery: '爸，你最后一刻为什么没告诉我们',
      sceneKinds: ['death_facts'],
    });
    const contract = buildReplyEvidenceContract({ worldPolicy: policy });

    expect(policy.semanticAuditRequired).toBe(true);
    expect(contract).toMatchObject({
      policy: 'grounded',
      semanticAuditRequired: true,
      requiredSourceIds: [],
    });
  });

  it.each([
    ['爸最后一刻怕你们担心，所以什么都没说', '临终、死因或最后心理'],
    ['姐姐就是不想管你，故意把钱拿走了', '在世家人状态、动机或财产归属'],
  ])('finds an undeclared high-risk assertion: %s', (content, reason) => {
    const worldPolicy = resolveWorldBoundaryPolicy({
      currentQuery: '这件事到底为什么会这样？',
      sceneKinds: ['death_facts', 'family_relationships'],
    });
    const contract = buildReplyEvidenceContract({ worldPolicy });

    expect(
      auditUndeclaredHighRiskAssertions({
        content,
        contract,
      })
    ).toEqual([
      expect.objectContaining({ reason: expect.stringContaining(reason) }),
    ]);
  });

  it('does not turn attribution or uncertainty into a definite assertion', () => {
    const worldPolicy = resolveWorldBoundaryPolicy({
      currentQuery: '爸爸最后为什么走得那么急？',
      sceneKinds: ['death_facts'],
    });
    const contract = buildReplyEvidenceContract({ worldPolicy });

    expect(
      auditUndeclaredHighRiskAssertions({
        content: '这件事我不能确认；按你说的，当时大家都很着急',
        contract,
      })
    ).toEqual([]);
  });
});
