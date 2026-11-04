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

  it('does not treat historical contrast or ordinary "today" memories as transient', () => {
    expect(
      isTransientStateFact({
        type: 'memory',
        key: '用户现在学着做饭',
        value: '用户现在学着逝去亲人的样子给爸爸做饭',
      })
    ).toBe(false);
    expect(
      isTransientStateFact({
        type: 'memory',
        key: '幼儿园放学',
        value: '用户小时候上幼儿园，角色放学接用户，回家路上买豆包',
      })
    ).toBe(false);
    expect(
      isTransientStateFact({
        type: 'memory',
        key: '生日记忆',
        value: '今天是角色生日',
      })
    ).toBe(false);
  });

  it('does not expire profile source or resolved states', () => {
    expect(
      isTransientStateFact({
        type: 'memory',
        key: 'profile_source.shared_memories',
        value: '一起聊现在的生活，虽然生病了但身体目前还不错',
      })
    ).toBe(false);
    expect(
      isTransientStateFact({
        type: 'memory',
        key: 'memory.rejected_assistant.x',
        value: '用户否认：现在不疼了，别挂心',
      })
    ).toBe(false);
  });

  it('does not treat long historical memories as current state', () => {
    expect(
      isTransientStateFact({
        type: 'memory',
        key: 'user_event',
        value:
          '用户领到人生中第一个过万的月薪，开车回家路上边开车边哭，希望逝去的母亲还在，想带母亲买新衣服、吃好吃的',
      })
    ).toBe(false);
    expect(
      isTransientStateFact({
        type: 'memory',
        key: '爷爷去世时未能见最后一面',
        value: '爷爷去世时用户正在医院生孩子，未能见最后一面',
      })
    ).toBe(false);
  });

  it('uses a six hour ttl', () => {
    const now = new Date('2026-11-04T00:00:00.000Z');
    expect(transientStateValidUntil(now)).toBe('2026-11-04T06:00:00.000Z');
  });
});
