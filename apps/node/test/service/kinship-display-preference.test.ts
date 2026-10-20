import { detectKinshipDisplayPreference } from '../../src/service/agents/kinship-display-preference';

describe('kinship display preference', () => {
  it('detects replace and avoid requests', () => {
    expect(detectKinshipDisplayPreference('别叫姥爷，叫外公')).toMatchObject({
      action: 'display',
      oldTerm: '姥爷',
      newTerm: '外公',
    });
    expect(detectKinshipDisplayPreference('以后叫他外公')).toMatchObject({
      action: 'display',
      newTerm: '外公',
    });
    expect(detectKinshipDisplayPreference('你也跟着叫家家')).toMatchObject({
      action: 'display',
      newTerm: '家家',
    });
    expect(detectKinshipDisplayPreference('别叫姥爷了')).toMatchObject({
      action: 'avoid',
      oldTerm: '姥爷',
    });
  });

  it('ignores relationship correction, one-off and questions', () => {
    expect(detectKinshipDisplayPreference('他不是我外公，是我爷爷')).toBeUndefined();
    expect(detectKinshipDisplayPreference('这次别叫姥爷')).toBeUndefined();
    expect(detectKinshipDisplayPreference('你是谁')).toBeUndefined();
  });
});
