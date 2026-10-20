import { detectComfortPreference } from '../../src/service/agents/comfort-preference';

describe('comfort and death wording preference', () => {
  it('detects explicit comfort taboos', () => {
    expect(detectComfortPreference('以后别跟我说节哀')).toMatchObject({
      comfortAvoid: ['节哀'],
    });
    expect(detectComfortPreference('我讨厌别人跟我说想开点')).toMatchObject({
      comfortAvoid: ['想开点'],
    });
    expect(detectComfortPreference('别再说他在天上')).toMatchObject({
      comfortAvoid: ['他在天上'],
    });
  });

  it('detects death wording preferences in both orders', () => {
    expect(detectComfortPreference('我们不说死，说走了')).toMatchObject({
      deathWording: {
        preferred: '走了',
        avoid: '死',
        value: '用“走了”，不用“死”',
      },
    });
    expect(detectComfortPreference('我们说走了，不说死')).toMatchObject({
      deathWording: {
        preferred: '走了',
        avoid: '死',
      },
    });
    expect(detectComfortPreference('别说死，说走了')).toMatchObject({
      deathWording: {
        preferred: '走了',
        avoid: '死',
      },
    });
  });

  it('does not persist one-off, question or ordinary mention', () => {
    expect(detectComfortPreference('今天别跟我说节哀')).toEqual({
      comfortAvoid: [],
    });
    expect(detectComfortPreference('如果他说别节哀呢')).toEqual({
      comfortAvoid: [],
    });
    expect(detectComfortPreference('大家都跟我说节哀')).toEqual({
      comfortAvoid: [],
    });
  });
});
