import { detectContextualTaboo } from '../../src/service/agents/contextual-taboo';

describe('contextual taboo', () => {
  it('detects time, emotion and topic triggers', () => {
    expect(detectContextualTaboo('晚上别提他')).toMatchObject({
      scope: 'time',
      trigger: '晚上',
    });
    expect(detectContextualTaboo('我哭的时候别讲道理')).toMatchObject({
      scope: 'topic',
      trigger: '哭',
      value: '当用户哭时，不要讲道理',
    });
    expect(detectContextualTaboo('聊到孩子的时候别说这些')).toMatchObject({
      scope: 'topic',
      trigger: '孩子',
    });
  });

  it('ignores one-off, questions and missing actions', () => {
    expect(detectContextualTaboo('今天别提他')).toBeUndefined();
    expect(detectContextualTaboo('晚上别提他吗')).toBeUndefined();
    expect(detectContextualTaboo('晚上我想他')).toBeUndefined();
  });
});

describe('contextual taboo false positives', () => {
  it('does not turn narrative or self-state sentences into a taboo', () => {
    const messages = [
      '当初，我哭着不想在这呆，后来慢慢接受了',
      '现在最怕过年过节，看着别人都有妈，有家回，我心里好难过',
      '别站我旁边，我害怕',
      '晚上安静，白天有阳光，要降温了，你一个人在那里不要着凉了',
      '其实我特别想去你家，但是我害怕，我不敢面对你',
    ];

    for (const message of messages) {
      expect(detectContextualTaboo(message)).toBeUndefined();
    }
  });

  it('still detects real conditional taboos', () => {
    expect(detectContextualTaboo('我哭的时候别讲道理')).toMatchObject({
      trigger: '哭',
      action: '讲道理',
    });
    expect(detectContextualTaboo('晚上别提他')).toMatchObject({
      trigger: '晚上',
      action: '提他',
    });
    expect(detectContextualTaboo('聊到孩子的时候别说这些')).toMatchObject({
      trigger: '孩子',
      action: '说这些',
    });
  });
});
