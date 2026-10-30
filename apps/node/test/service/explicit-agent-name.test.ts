import { detectExplicitAgentName } from '../../src/service/agents/explicit-agent-name';

describe('explicit agent name instruction', () => {
  it('recognizes direct self-name instructions', () => {
    expect(detectExplicitAgentName('你的名字叫付亚永')).toMatchObject({
      kind: 'realName',
      name: '付亚永',
    });
    expect(detectExplicitAgentName('记住你现在的名字叫徐艳玲')).toMatchObject({
      kind: 'realName',
      name: '徐艳玲',
    });
    expect(detectExplicitAgentName('记住你叫杨志鹏')).toMatchObject({
      kind: 'realName',
      name: '杨志鹏',
    });
  });

  it('recognizes how the user calls the AI', () => {
    expect(detectExplicitAgentName('以后我就叫你老头子')).toMatchObject({
      kind: 'callName',
      name: '老头子',
    });
  });

  it('does not confuse user address or questions with self-name', () => {
    expect(detectExplicitAgentName('你叫我阿慧')).toBeUndefined();
    expect(detectExplicitAgentName('你叫什么')).toBeUndefined();
    expect(detectExplicitAgentName('你的名字叫什么')).toBeUndefined();
    expect(detectExplicitAgentName('你的名字是我的禁区')).toBeUndefined();
    expect(detectExplicitAgentName('你叫阿香嘛老婆')).toBeUndefined();
    expect(detectExplicitAgentName('记住你叫徐艳玲吗')).toBeUndefined();
  });
});
