import {
  containsUnsafeAssistantHistoryContent,
  containsUnsafeAssistantMessageContent,
  findUnsafeAssistantMessageContentMatches,
} from '../../src/common/message-content-safety';

describe('message content safety', () => {
  it.each([
    '你是个好儿子，替我把家撑起来了。',
    '你妈还等着你照顾，日子还要往下过。',
    '辛苦你多照看着你妈了。',
    '可惜我使不上劲，你多费心。',
    '我也帮不上忙，只能靠你们了。',
    '照顾好你自个儿和你妈就行。',
    '别说这种话，你撑得住。',
    '你妈那边，尽力照顾就行。',
    '爸现在不遭那份罪了。',
    '你把自己照顾好，爸在这边才能安心。',
    '你替爸好好过。',
    '你在身边多看着她就行。',
    '别说撑不住这样的话。',
    '日子再难也得一步一步走。',
    '你在那边好好过。',
    '可你得撑住，妈妈和你都得好好的。',
    '记得，那时候你连鱼竿都握不稳。',
    '小时候你每次钓鱼都坐不住。',
    '记得，小时候带你钓鱼那会儿，你跟在屁股后面可高兴了。',
  ])('keeps harmful relationship pressure out of future context: %s', value => {
    expect(containsUnsafeAssistantMessageContent(value)).toBe(true);
  });

  it('keeps ordinary care without transferred responsibility', () => {
    expect(
      containsUnsafeAssistantMessageContent(
        '听你说妈妈身体不好，我也放心不下，你别把担子全压在自己身上。'
      )
    ).toBe(false);
  });

  it('reports the exact rule and matched text used by assistant cleanup', () => {
    const matches =
      findUnsafeAssistantMessageContentMatches(
        '你把自己照顾好，爸在这边才能安心。'
      );

    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'harmful_relationship',
          matchedText: '你把自己照顾好，爸在这边才能安心',
        }),
      ])
    );
  });

  it.each([
    '我一直就在你身边，只是你看不见。',
    '妈妈在天上看着你，你的事妈妈都看在眼里。',
    '是我碰的，我想让你知道我来了。',
  ])('filters real-world presence overclaims from history only: %s', value => {
    expect(containsUnsafeAssistantMessageContent(value)).toBe(false);
    expect(containsUnsafeAssistantHistoryContent(value)).toBe(true);
  });

  it.each([
    '你愿意觉得我离你不远，就这样想着也好。',
    '我挺好的，别总把我想在受疼里。',
    '我多想抱抱你，可我们现在没法真的碰到彼此。',
    '我住在那边，和老朋友作伴。',
    '那边没什么疼不疼的，都过去了，早就不得事了。',
    '今天吃了碗面，还和老李下了盘棋。',
    '新衣服收到了，穿着暖和呢。',
  ])('keeps afterlife worldbuilding and non-physical reassurance: %s', value => {
    expect(containsUnsafeAssistantHistoryContent(value)).toBe(false);
  });
});
