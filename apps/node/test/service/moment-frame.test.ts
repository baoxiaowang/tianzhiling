import {
  applyMomentFrameToSegments,
  detectMomentFrameViolation,
  resolveMomentFrame,
} from '../../src/service/agents/moment-frame';

describe('moment frame', () => {
  const recent = [
    {
      role: 'user',
      content: '到沈阳站了，候车',
    },
    {
      role: 'user',
      content: '吃了抹茶甜品，也觉得不好吃。去了两个寺庙，也就那么回事。',
    },
    {
      role: 'user',
      content: '打车回家',
    },
  ];

  it('treats coming home after a bad trip as a landing moment', () => {
    const frame = resolveMomentFrame({
      currentQuery: '进屋了',
      recentMessages: recent,
      isDeceased: true,
    });
    expect(frame).toMatchObject({
      momentType: 'after_trip',
      emotionalExposure: 'high',
      primaryNeed: 'land',
      memoryPermission: 'none',
      bubbleBudget: 1,
    });
  });

  it('treats washing up and lying down as a one-bubble rest moment', () => {
    const frame = resolveMomentFrame({
      currentQuery: '洗完澡，躺了',
      recentMessages: recent,
      isDeceased: true,
    });
    expect(frame).toMatchObject({
      momentType: 'daily_rest',
      primaryNeed: 'land',
      memoryPermission: 'none',
      bubbleBudget: 1,
    });
    expect(
      applyMomentFrameToSegments(
        ['躺好，别瞎动，', '我还记着本溪那趟，你炒的番茄炒蛋香得很'],
        frame
      )
    ).toEqual(['躺好，别瞎动。']);
  });

  it('drops an uninvited second-bubble memory after landing', () => {
    const frame = resolveMomentFrame({
      currentQuery: '进屋了',
      recentMessages: recent,
      isDeceased: true,
    });
    expect(
      applyMomentFrameToSegments(
        [
          '昂，进屋就好，把外套脱了缓一缓，',
          '我记着你爱吃的番茄炒蛋味儿呢',
        ],
        frame
      )
    ).toEqual(['昂，进屋就好，把外套脱了缓一缓。']);
    expect(
      detectMomentFrameViolation('我记着你爱吃的番茄炒蛋味儿呢', frame)
    ).toContain('没有当前线索');
  });

  it('does not block a memory the user explicitly opens', () => {
    const frame = resolveMomentFrame({
      currentQuery: '你还记得以前我们吃番茄炒蛋吗',
      recentMessages: recent,
      isDeceased: true,
    });
    expect(frame).toMatchObject({
      momentType: 'memory_invite',
      memoryPermission: 'invited',
    });
    expect(
      detectMomentFrameViolation('记得，你以前总爱做这个菜', frame)
    ).toBeUndefined();
  });

  it('keeps ordinary turns unconstrained', () => {
    const frame = resolveMomentFrame({
      currentQuery: '今天上班好累',
      recentMessages: [],
      isDeceased: true,
    });
    expect(frame.primaryNeed).toBe('accompany');
  });
});
