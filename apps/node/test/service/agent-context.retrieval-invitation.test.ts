import {
  hasRecentDeferMarker,
  isRitualAnchorToday,
  shouldTriggerMemoryRetrieval,
} from '../../src/service/agents/agent.context';

describe('memory retrieval invitation (hard cues)', () => {
  it('纯应答仍然不检索（请柬不越过 ack 守卫）', () => {
    expect(
      shouldTriggerMemoryRetrieval('', '好', false, {
        entityNameMatched: false,
        deferReturn: true,
        ritualAnchorToday: true,
      })
    ).toBe(false);
  });

  it('实体命中触发检索（短核心也放行）', () => {
    expect(
      shouldTriggerMemoryRetrieval('', '二哥呢', false, {
        entityNameMatched: true,
      })
    ).toBe(true);
  });

  it('defer 回归触发检索', () => {
    expect(
      shouldTriggerMemoryRetrieval('', '我回来了', false, {
        deferReturn: true,
      })
    ).toBe(true);
  });

  it('仪式锚点触发检索（忌日当天的短问候）', () => {
    expect(
      shouldTriggerMemoryRetrieval('', '早', false, {
        ritualAnchorToday: true,
      })
    ).toBe(true);
  });

  it('无请柬时保持原门行为：闲聊不检索、回忆信号检索', () => {
    expect(shouldTriggerMemoryRetrieval('', '今天天气不错', false)).toBe(false);
    expect(shouldTriggerMemoryRetrieval('', '还记得咱们去沈阳那趟吗', false)).toBe(
      true
    );
  });

  it('defer 标记识别（封闭集）', () => {
    expect(hasRecentDeferMarker(['我先洗个澡，等一下我再跟你聊'])).toBe(true);
    expect(hasRecentDeferMarker(['回头说', '别的'])).toBe(true);
    expect(hasRecentDeferMarker(['现在聊聊吧'])).toBe(false);
    expect(hasRecentDeferMarker([])).toBe(false);
  });

  it('defer 只看最近 6 条且不含本轮（由调用方保证传入历史）', () => {
    const history = [
      '等一下再聊',
      ...Array.from({ length: 6 }, () => '别的'),
    ];
    expect(hasRecentDeferMarker(history)).toBe(false);
  });

  it('仪式锚点按月日命中忌日/生日，非当日不命中', () => {
    const agent = {
      birthday: new Date('1962-04-05T00:00:00+08:00'),
      deathDate: new Date('2026-04-01T00:00:00+08:00'),
    };
    expect(isRitualAnchorToday(agent, new Date('2026-04-05T10:00:00+08:00'))).toBe(
      true
    );
    expect(isRitualAnchorToday(agent, new Date('2026-04-01T10:00:00+08:00'))).toBe(
      true
    );
    expect(isRitualAnchorToday(agent, new Date('2026-11-16T10:00:00+08:00'))).toBe(
      false
    );
  });

  it('无日期不命中仪式锚点', () => {
    expect(
      isRitualAnchorToday({}, new Date('2026-11-16T10:00:00+08:00'))
    ).toBe(false);
  });
});
