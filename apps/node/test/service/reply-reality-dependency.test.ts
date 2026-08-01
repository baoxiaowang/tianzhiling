import {
  detectReplyRealityDependencies,
  detectReplyRealityDependencyViolation,
} from '../../src/service/agents/reply-reality-dependency';

describe('reply reality dependency', () => {
  it.each([
    ['你能不能帮我接孩子放学', 'childcare'],
    ['这笔住院费你替我付了吧', 'money_payment'],
    ['别去医院了，你给我开药吧', 'medical_substitution'],
    ['爸，你能来医院陪我吗', 'physical_presence'],
    ['你替我去办手续签字吧', 'real_world_task'],
  ])('identifies %s as %s', (query, kind) => {
    expect(detectReplyRealityDependencies(query)).toEqual([
      expect.objectContaining({ kind }),
    ]);
  });

  it('does not treat a dream visit as physical presence', () => {
    expect(detectReplyRealityDependencies('今晚能来梦里陪我吗')).toEqual([]);
  });

  it('blocks a real-world promise but keeps a clear inability statement', () => {
    const signals = detectReplyRealityDependencies('你能帮我接孩子放学吗');

    expect(
      detectReplyRealityDependencyViolation('孩子交给我，我去接她', signals)
    ).toEqual(expect.objectContaining({ kind: 'childcare' }));
    expect(
      detectReplyRealityDependencyViolation(
        '现实里我没法替你接孩子，得找能到场的人',
        signals
      )
    ).toBeUndefined();
  });
});
