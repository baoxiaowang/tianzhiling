import { detectUserRequest } from '../../src/service/agents/user-request-router';

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

  it('ignores one-off requests', () => {
    expect(detectUserRequest('今天先别讲道理')).toBeUndefined();
  });

  it('leaves memory requests, tasks and ordinary care alone', () => {
    expect(detectUserRequest('记住我婆婆是山东人')).toBeUndefined();
    expect(detectUserRequest('帮我查一下天气')).toBeUndefined();
    expect(detectUserRequest('你要记得吃饭')).toBeUndefined();
  });
});
