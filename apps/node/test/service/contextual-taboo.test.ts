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
