import {
  isTransientStateFact,
  transientStateValidUntil,
} from '../../src/service/agents/transient-state-memory';

describe('transient state memory', () => {
  it('detects current acute states', () => {
    expect(
      isTransientStateFact({
        type: 'memory',
        key: 'health.current',
        value: '今天心脏难受，要去医院',
      })
    ).toBe(true);
    expect(
      isTransientStateFact({
        type: 'memory',
        key: '状态',
        value: '现在在医院路上',
      })
    ).toBe(true);
  });

  it('does not expire stable facts', () => {
    expect(
      isTransientStateFact({
        type: 'memory',
        key: 'health.chronic',
        value: '糖尿病多年，一直吃药',
      })
    ).toBe(false);
    expect(
      isTransientStateFact({
        type: 'memory',
        key: 'personality',
        value: '性格直白，不爱绕弯子',
      })
    ).toBe(false);
  });

  it('uses a six hour ttl', () => {
    const now = new Date('2026-11-04T00:00:00.000Z');
    expect(transientStateValidUntil(now)).toBe('2026-11-04T06:00:00.000Z');
  });
});
