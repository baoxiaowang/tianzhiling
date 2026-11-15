import {
  buildPersonReferenceDirective,
  detectPersonReferenceMismatch,
} from '../../src/service/agents/person-reference';

describe('person reference', () => {
  it('converts the user first-person kin into the agent view', () => {
    const directive = buildPersonReferenceDirective(
      '刚才我妈抱了抱我，又哭了'
    );
    expect(directive?.firstPersonTerms).toEqual(['妈']);
    expect(directive?.prompt).toContain('你妈');
    expect(directive?.prompt).toContain('不要原样重复');
    expect(
      detectPersonReferenceMismatch(
        '刚才我妈抱了抱我，又哭了',
        '我妈哭你也难受'
      )
    ).toContain('我妈');
  });

  it('handles second-person kin the other way', () => {
    const directive = buildPersonReferenceDirective('你妈今天来了吗');
    expect(directive?.secondPersonTerms).toEqual(['妈']);
    expect(directive?.prompt).toContain('我妈');
    expect(
      detectPersonReferenceMismatch('你妈今天来了吗', '我妈今天来了')
    ).toBeUndefined();
  });

  it('does not react to non-kin language', () => {
    expect(buildPersonReferenceDirective('我今天有点累')).toBeNull();
  });
});

describe('normalize person reference', () => {
  it('rewrites a copied first-person kin only', () => {
    const { normalizePersonReferenceInReply } = require('../../src/service/agents/person-reference');
    expect(
      normalizePersonReferenceInReply(
        '刚才我妈抱了抱我，又哭了',
        '我妈哭你也难受'
      )
    ).toBe('你妈哭你也难受');
    expect(
      normalizePersonReferenceInReply('刚才我妈抱了抱我', '你妈哭你也难受')
    ).toBe('你妈哭你也难受');
  });
});
