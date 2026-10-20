import { detectUserRequest, isDirectPreferenceRequest } from '../../src/service/agents/user-request-router';

describe('user request router', () => {
  it('detects durable address requests', () => {
    expect(detectUserRequest('以后叫我瑶瑶')).toMatchObject({
      kind: 'address',
      confidence: 'high',
      durable: true,
    });
    expect(detectUserRequest('别叫我宝贝了')).toMatchObject({
      kind: 'address',
      durable: false,
    });
  });

  it('detects durable style preferences', () => {
    expect(detectUserRequest('以后别总问我问题了')).toMatchObject({
      kind: 'style',
      durable: true,
    });
    expect(detectUserRequest('以后说话短一点')).toMatchObject({
      kind: 'style',
      durable: true,
    });
  });

  it('detects durable taboo requests', () => {
    expect(detectUserRequest('以后别提炼他前妻')).toMatchObject({
      kind: 'taboo',
      durable: true,
    });
  });

  it('detects memory requests without treating care as memory', () => {
    expect(detectUserRequest('记住我婆婆是山东人')).toMatchObject({
      kind: 'memory',
    });
    expect(detectUserRequest('你要记得吃饭')).toBeUndefined();
  });

  it('does not persist one-off requests', () => {
    expect(detectUserRequest('今天先别讲道理')).toMatchObject({
      kind: 'one_off',
      durable: false,
    });
  });

  it('leaves tasks to the main model', () => {
    expect(detectUserRequest('帮我查一下天气')).toMatchObject({
      kind: 'task',
    });
    expect(isDirectPreferenceRequest('task')).toBe(false);
  });

  it('only address/style/taboo write direct preferences', () => {
    expect(isDirectPreferenceRequest('address')).toBe(true);
    expect(isDirectPreferenceRequest('style')).toBe(true);
    expect(isDirectPreferenceRequest('taboo')).toBe(true);
    expect(isDirectPreferenceRequest('memory')).toBe(false);
  });
});
