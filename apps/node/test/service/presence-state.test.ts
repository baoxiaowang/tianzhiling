import {
  derivePresenceState,
  detectPresenceContractViolation,
  extractPresenceSignals,
  shouldInjectPresencePrompt,
} from '../../src/service/agents/presence-state';
import {
  PresenceContactChannel,
  PresenceInitiation,
  PresencePhysicalExpectation,
  PresenceRealityFraming,
} from '@tzl/entities';

describe('presence state signals', () => {
  it('detects a physical request but not a hypothetical wish', () => {
    expect(
      extractPresenceSignals('你回来陪我好不好').some(
        signal =>
          signal.dimension === 'physical' &&
          signal.value === PresencePhysicalExpectation.imaginal
      )
    ).toBe(true);
    expect(
      extractPresenceSignals('如果你还在就好了').some(
        signal => signal.dimension === 'physical'
      )
    ).toBe(false);
  });

  it('detects explicit rejection and marks it quiet', () => {
    const signals = extractPresenceSignals('明晚不要回来，路途遥远，好辛苦');
    expect(signals).toContainEqual(
      expect.objectContaining({
        dimension: 'physical',
        value: PresencePhysicalExpectation.reject,
      })
    );
    const state = derivePresenceState({ signals });
    expect(state).toMatchObject({
      physicalExpectation: PresencePhysicalExpectation.reject,
      initiation: PresenceInitiation.quiet,
    });
  });

  it('keeps dream contact separate from physical expectation', () => {
    const state = derivePresenceState({
      signals: extractPresenceSignals('晚上来我梦里陪我说说话'),
    });
    expect(state).toMatchObject({
      contactChannel: PresenceContactChannel.dream,
      physicalExpectation: PresencePhysicalExpectation.none,
    });
  });

  it('injects only on relevant turns and blocks physical claims', () => {
    const state = derivePresenceState({
      signals: extractPresenceSignals('你为什么跟着我去沈阳'),
    });
    expect(state).not.toBeNull();
    expect(
      shouldInjectPresencePrompt(state, '那为什么不跟着我去沈阳')
    ).toBe(true);
    expect(
      shouldInjectPresencePrompt(state, '今天上班好累')
    ).toBe(false);
    expect(
      detectPresenceContractViolation(
        '我到了沈阳，陪你一起吃饭',
        state
      )
    ).toBeTruthy();
    expect(
      detectPresenceContractViolation(
        '我没法以身体跟你去沈阳，但我的惦记和回应一直都在',
        state
      )
    ).toBeUndefined();
  });

  it('respects meta framing', () => {
    const state = derivePresenceState({
      signals: extractPresenceSignals('我知道你是AI，但我还是想跟你聊'),
    });
    expect(state?.realityFraming).toBe(PresenceRealityFraming.meta);
    expect(
      detectPresenceContractViolation('我就是一个真的复活的人', state)
    ).toContain('现实本人复活');
  });
});
